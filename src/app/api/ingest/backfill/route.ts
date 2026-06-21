import { NextRequest, NextResponse } from "next/server";
import { ensureUserProfile } from "@/lib/households";
import {
  type GmailConnectionForIngestion,
  runGmailIngestionForConnections,
} from "@/lib/ingestion/gmail-ingestion";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const MAX_LOOKBACK_DAYS = 7;

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const lookbackDays = clampLookbackDays(Number(formData.get("lookbackDays") ?? 1));
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

  const adminClient = createSupabaseAdminClient();
  const profile = await ensureUserProfile(adminClient, user);
  const { data: connections, error } = await adminClient
    .from("gmail_connections")
    .select("id, household_id, user_id, gmail_address, refresh_token_ciphertext, last_checked_at")
    .eq("household_id", profile.household_id)
    .eq("status", "active");

  if (error) {
    redirectUrl.searchParams.set("import", "failed");
    redirectUrl.searchParams.set("message", error.message);
    return NextResponse.redirect(redirectUrl);
  }

  if (!connections || connections.length === 0) {
    redirectUrl.searchParams.set("import", "no_connections");
    return NextResponse.redirect(redirectUrl);
  }

  const since = new Date();
  since.setUTCDate(since.getUTCDate() - lookbackDays);

  const summary = await runGmailIngestionForConnections(
    adminClient,
    connections as GmailConnectionForIngestion[],
    {
      getSince: () => since.toISOString(),
      updateLastChecked: false,
    },
  );

  redirectUrl.searchParams.set("import", summary.errors.length > 0 ? "partial" : "complete");
  redirectUrl.searchParams.set("days", String(lookbackDays));
  redirectUrl.searchParams.set("emails", String(summary.emailsScanned));
  redirectUrl.searchParams.set("items", String(summary.itemsExtracted));
  redirectUrl.searchParams.set("inserted", String(summary.insertedPurchases));

  if (summary.errors[0]) {
    redirectUrl.searchParams.set("message", summary.errors[0].message);
  }

  return NextResponse.redirect(redirectUrl);
}

function clampLookbackDays(value: number): number {
  if (!Number.isFinite(value)) {
    return 1;
  }

  return Math.min(Math.max(Math.trunc(value), 1), MAX_LOOKBACK_DAYS);
}
