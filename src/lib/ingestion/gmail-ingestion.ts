import "server-only";

import type { gmail_v1 } from "googleapis";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getGmailOrderMessage, searchGmailMessages } from "@/lib/gmail/messages";
import { createGmailClientFromRefreshToken } from "@/lib/gmail/oauth";
import { ingestOrderLineItems } from "@/lib/ingestion/process-order";
import { retailerParsers } from "@/lib/parsers";
import { decryptSecret } from "@/lib/security/encryption";
import type { Retailer, RetailerParser } from "@/lib/types";

export type GmailConnectionForIngestion = {
  id: string;
  household_id: string;
  user_id: string;
  gmail_address: string;
  refresh_token_ciphertext: string;
  last_checked_at: string | null;
};

export type GmailIngestionSummary = {
  connections: number;
  emailsScanned: number;
  itemsExtracted: number;
  insertedPurchases: number;
  retailers: Record<Retailer, RetailerIngestionSummary>;
  errors: Array<{ connectionId: string; retailer?: string; message: string }>;
};

export type RetailerIngestionSummary = {
  emailsScanned: number;
  itemsExtracted: number;
  insertedPurchases: number;
};

type RunGmailIngestionOptions = {
  getSince: (connection: GmailConnectionForIngestion) => string | null;
  updateLastChecked?: boolean;
};

export async function runGmailIngestionForConnections(
  supabase: SupabaseClient,
  connections: GmailConnectionForIngestion[],
  options: RunGmailIngestionOptions,
): Promise<GmailIngestionSummary> {
  const summary: GmailIngestionSummary = {
    connections: connections.length,
    emailsScanned: 0,
    itemsExtracted: 0,
    insertedPurchases: 0,
    retailers: {
      blinkit: { emailsScanned: 0, itemsExtracted: 0, insertedPurchases: 0 },
      instamart: { emailsScanned: 0, itemsExtracted: 0, insertedPurchases: 0 },
    },
    errors: [],
  };

  for (const connection of connections) {
    try {
      const gmail = createGmailClientFromRefreshToken(decryptSecret(connection.refresh_token_ciphertext));

      for (const parser of retailerParsers) {
        let emailsScanned = 0;
        let itemsExtracted = 0;
        const parserErrors: string[] = [];

        try {
          const messageIds = await searchRetailerMessages(gmail, parser, options.getSince(connection));
          emailsScanned = messageIds.length;
          summary.emailsScanned += messageIds.length;
          summary.retailers[parser.retailer].emailsScanned += messageIds.length;

          for (const messageId of messageIds) {
            const message = await getGmailOrderMessage(gmail, messageId);
            const lineItems = parser.parse(message.html, message.date);
            itemsExtracted += lineItems.length;
            summary.itemsExtracted += lineItems.length;
            summary.retailers[parser.retailer].itemsExtracted += lineItems.length;

            const result = await ingestOrderLineItems(supabase, {
              householdId: connection.household_id,
              userId: connection.user_id,
              gmailConnectionId: connection.id,
              retailer: parser.retailer,
              sourceMessageId: message.id,
              lineItems,
            });

            summary.insertedPurchases += result.inserted;
            summary.retailers[parser.retailer].insertedPurchases += result.inserted;
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

      if (options.updateLastChecked) {
        await supabase
          .from("gmail_connections")
          .update({ last_checked_at: new Date().toISOString(), error_message: null })
          .eq("id", connection.id);
      }
    } catch (connectionError) {
      const message = connectionError instanceof Error ? connectionError.message : "Unknown connection error";
      summary.errors.push({ connectionId: connection.id, message });
      await supabase.from("gmail_connections").update({ status: "error", error_message: message }).eq("id", connection.id);
    }
  }

  return summary;
}

async function searchRetailerMessages(
  gmail: gmail_v1.Gmail,
  parser: RetailerParser,
  since: string | null,
): Promise<string[]> {
  const queries = parser.gmailQueries?.length ? parser.gmailQueries : [parser.gmailQuery];
  const messageIds = new Set<string>();

  for (const query of queries) {
    const ids = await searchGmailMessages(gmail, query, since);
    ids.forEach((id) => messageIds.add(id));
  }

  return Array.from(messageIds);
}
