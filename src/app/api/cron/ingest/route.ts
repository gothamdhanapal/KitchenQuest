import { NextRequest, NextResponse } from "next/server";
import { createGmailClientFromRefreshToken } from "@/lib/gmail/oauth";
import { getGmailOrderMessage, searchGmailMessages } from "@/lib/gmail/messages";
import { ingestOrderLineItems } from "@/lib/ingestion/process-order";
import { retailerParsers } from "@/lib/parsers";
import { decryptSecret } from "@/lib/security/encryption";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

type GmailConnection = {
  id: string;
  household_id: string;
  user_id: string;
  gmail_address: string;
  refresh_token_ciphertext: string;
  last_checked_at: string | null;
};

export async function POST(request: NextRequest) {
  const expectedSecret = process.env.CRON_SECRET;
  const receivedSecret = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");

  if (!expectedSecret || receivedSecret !== expectedSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createSupabaseAdminClient();
  const { data: connections, error } = await supabase
    .from("gmail_connections")
    .select("id, household_id, user_id, gmail_address, refresh_token_ciphertext, last_checked_at")
    .eq("status", "active");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const summary = {
    connections: connections?.length ?? 0,
    emailsScanned: 0,
    itemsExtracted: 0,
    insertedPurchases: 0,
    errors: [] as Array<{ connectionId: string; retailer?: string; message: string }>,
  };

  for (const connection of (connections ?? []) as GmailConnection[]) {
    try {
      const gmail = createGmailClientFromRefreshToken(decryptSecret(connection.refresh_token_ciphertext));

      for (const parser of retailerParsers) {
        let emailsScanned = 0;
        let itemsExtracted = 0;
        const parserErrors: string[] = [];

        try {
          const messageIds = await searchGmailMessages(gmail, parser.gmailQuery, connection.last_checked_at);
          emailsScanned = messageIds.length;
          summary.emailsScanned += messageIds.length;

          for (const messageId of messageIds) {
            const message = await getGmailOrderMessage(gmail, messageId);
            const lineItems = parser.parse(message.html, message.date);
            itemsExtracted += lineItems.length;
            summary.itemsExtracted += lineItems.length;

            const result = await ingestOrderLineItems(supabase, {
              householdId: connection.household_id,
              userId: connection.user_id,
              gmailConnectionId: connection.id,
              retailer: parser.retailer,
              sourceMessageId: message.id,
              lineItems,
            });

            summary.insertedPurchases += result.inserted;
          }
        } catch (parserError) {
          const message = parserError instanceof Error ? parserError.message : "Unknown parser error";
          parserErrors.push(message);
          summary.errors.push({ connectionId: connection.id, retailer: parser.retailer, message });
        } finally {
          await supabase.from("parser_runs").insert({
            household_id: connection.household_id,
            user_id: connection.user_id,
            retailer: parser.retailer,
            emails_scanned: emailsScanned,
            items_extracted: itemsExtracted,
            errors: parserErrors,
          });
        }
      }

      await supabase
        .from("gmail_connections")
        .update({ last_checked_at: new Date().toISOString(), error_message: null })
        .eq("id", connection.id);
    } catch (connectionError) {
      const message = connectionError instanceof Error ? connectionError.message : "Unknown connection error";
      summary.errors.push({ connectionId: connection.id, message });
      await supabase.from("gmail_connections").update({ status: "error", error_message: message }).eq("id", connection.id);
    }
  }

  return NextResponse.json(summary);
}
