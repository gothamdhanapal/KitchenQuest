import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { basename, join, resolve } from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { ensureUserProfile } from "@/lib/households";
import { ingestOrderLineItems } from "@/lib/ingestion/process-order";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ParsedLineItem } from "@/lib/types";

type ParsedBlinkitInvoiceJson = {
  metadata: {
    orderId: string | null;
    invoiceNumber: string | null;
  };
  parsedItems: ParsedLineItem[];
};

export async function POST(request: NextRequest) {
  const redirectUrl = new URL("/", request.url);
  const userClient = await createSupabaseServerClient();
  const {
    data: { user },
    error: userError,
  } = await userClient.auth.getUser();

  if (userError || !user) {
    redirectUrl.searchParams.set("import", "not_authenticated");
    return NextResponse.redirect(redirectUrl);
  }

  const invoicePaths = await getLocalBlinkitInvoicePaths();

  if (invoicePaths.length === 0) {
    redirectUrl.searchParams.set("import", "failed");
    redirectUrl.searchParams.set("message", "No local Blinkit invoice PDFs found in artifacts/blinkit.");
    return NextResponse.redirect(redirectUrl);
  }

  const adminClient = createSupabaseAdminClient();
  const profile = await ensureUserProfile(adminClient, user);
  const summary = {
    invoices: invoicePaths.length,
    items: 0,
    inserted: 0,
    matched: 0,
    needsReview: 0,
    errors: [] as string[],
  };

  for (const invoicePath of invoicePaths) {
    try {
      const invoice = await parseInvoiceWithLocalScript(invoicePath);
      summary.items += invoice.parsedItems.length;

      if (invoice.parsedItems.length === 0) {
        summary.errors.push(`${basename(invoicePath)}: no parsed item rows`);
        continue;
      }

      const result = await ingestOrderLineItems(adminClient, {
        householdId: profile.household_id,
        userId: profile.id,
        gmailConnectionId: null,
        retailer: "blinkit",
        sourceMessageId: invoice.metadata.orderId ?? invoice.metadata.invoiceNumber ?? `invoice:${basename(invoicePath)}`,
        lineItems: invoice.parsedItems,
      });

      summary.inserted += result.inserted;
      summary.matched += result.matched;
      summary.needsReview += result.needsReview;
    } catch (error) {
      summary.errors.push(`${basename(invoicePath)}: ${error instanceof Error ? error.message : "unknown error"}`);
    }
  }

  redirectUrl.searchParams.set("import", summary.errors.length > 0 ? "partial" : "complete");
  redirectUrl.searchParams.set("days", "invoice");
  redirectUrl.searchParams.set("emails", String(summary.invoices));
  redirectUrl.searchParams.set("items", String(summary.items));
  redirectUrl.searchParams.set("inserted", String(summary.inserted));
  redirectUrl.searchParams.set("retailers", `Blinkit invoices ${summary.invoices}/${summary.items}`);

  if (summary.errors[0]) {
    redirectUrl.searchParams.set("message", summary.errors[0]);
  }

  return NextResponse.redirect(redirectUrl);
}

async function getLocalBlinkitInvoicePaths(): Promise<string[]> {
  const artifactDir = resolve(process.cwd(), "artifacts", "blinkit");
  const latestInvoice = join(artifactDir, "latest-invoice.pdf");
  const invoiceDir = join(artifactDir, "invoices");
  const paths = new Set<string>();

  if (existsSync(latestInvoice)) {
    paths.add(latestInvoice);
  }

  if (existsSync(invoiceDir)) {
    const entries = await readdir(invoiceDir);
    entries
      .filter((entry) => entry.toLowerCase().endsWith(".pdf"))
      .forEach((entry) => paths.add(join(invoiceDir, entry)));
  }

  return Array.from(paths).sort();
}

async function parseInvoiceWithLocalScript(invoicePath: string): Promise<ParsedBlinkitInvoiceJson> {
  const parseCacheDir = resolve(process.cwd(), "artifacts", "blinkit", "parse-cache");
  const jsonOut = join(parseCacheDir, `${sanitizeFileName(basename(invoicePath))}.json`);
  const command = process.platform === "win32" ? "npx.cmd" : "npx";
  const result = spawnSync(command, ["tsx", "scripts/parse-blinkit-invoice.ts", invoicePath, "--json-out", jsonOut], {
    cwd: process.cwd(),
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });

  if (result.status !== 0) {
    throw new Error([result.stderr.trim(), result.stdout.trim()].filter(Boolean).join("\n") || "Invoice parser failed.");
  }

  const parsed = JSON.parse(await readFile(jsonOut, "utf8")) as ParsedBlinkitInvoiceJson;

  return {
    ...parsed,
    parsedItems: parsed.parsedItems.map((item) => ({
      ...item,
      orderDate: new Date(item.orderDate),
    })),
  };
}

function sanitizeFileName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_");
}
