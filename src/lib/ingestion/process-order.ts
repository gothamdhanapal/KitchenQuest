import "server-only";

import crypto from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { calculateExpiryDate } from "@/lib/expiry";
import { matchInventoryItem } from "@/lib/matching";
import type { InventoryItem, ItemAlias, ParsedLineItem, Retailer } from "@/lib/types";

type IngestOrderInput = {
  householdId: string;
  userId: string;
  gmailConnectionId?: string | null;
  retailer: Retailer;
  sourceMessageId: string;
  lineItems: ParsedLineItem[];
};

type IngestOrderResult = {
  inserted: number;
  matched: number;
  needsReview: number;
};

type MatchableInventoryItem = InventoryItem & { aliases: ItemAlias[] };

export async function ingestOrderLineItems(
  supabase: SupabaseClient,
  input: IngestOrderInput,
): Promise<IngestOrderResult> {
  const inventoryItems = await loadInventoryItems(supabase, input.householdId);
  const result: IngestOrderResult = { inserted: 0, matched: 0, needsReview: 0 };

  for (const [index, lineItem] of input.lineItems.entries()) {
    const match = matchInventoryItem(lineItem.rawName, inventoryItems);
    const sourceLineHash = createSourceLineHash(input.sourceMessageId, index, lineItem);

    const { error } = await supabase.from("purchase_log").insert({
      household_id: input.householdId,
      user_id: input.userId,
      gmail_connection_id: input.gmailConnectionId ?? null,
      retailer: input.retailer,
      order_date: lineItem.orderDate.toISOString(),
      raw_product_name: lineItem.rawName,
      matched_item_id: match.item?.id ?? null,
      quantity: lineItem.quantity,
      price: lineItem.price,
      status: match.status,
      source_message_id: input.sourceMessageId,
      source_line_hash: sourceLineHash,
    });

    if (error?.code === "23505") {
      continue;
    }

    if (error) {
      throw error;
    }

    result.inserted += 1;

    if (!match.item) {
      result.needsReview += 1;
      continue;
    }

    result.matched += 1;
    await incrementStockLot(supabase, input.householdId, match.item, lineItem);
  }

  return result;
}

async function loadInventoryItems(
  supabase: SupabaseClient,
  householdId: string,
): Promise<MatchableInventoryItem[]> {
  const { data: items, error: itemsError } = await supabase
    .from("inventory_items")
    .select("*")
    .eq("household_id", householdId);

  if (itemsError) {
    throw itemsError;
  }

  const { data: aliases, error: aliasesError } = await supabase
    .from("item_aliases")
    .select("*")
    .eq("household_id", householdId);

  if (aliasesError) {
    throw aliasesError;
  }

  return ((items ?? []) as InventoryItem[]).map((item) => ({
    ...item,
    aliases: ((aliases ?? []) as ItemAlias[]).filter((alias) => alias.item_id === item.id),
  }));
}

async function incrementStockLot(
  supabase: SupabaseClient,
  householdId: string,
  item: InventoryItem,
  lineItem: ParsedLineItem,
) {
  const expiryDate = calculateExpiryDate(lineItem.orderDate, item, lineItem.rawName);
  const { data: existingStock, error: stockError } = await supabase
    .from("inventory_stock")
    .select("id, quantity")
    .eq("household_id", householdId)
    .eq("item_id", item.id)
    .eq("expiry_date", expiryDate)
    .maybeSingle();

  if (stockError) {
    throw stockError;
  }

  if (existingStock) {
    const nextQuantity = Number(existingStock.quantity) + lineItem.quantity;
    const { error } = await supabase
      .from("inventory_stock")
      .update({ quantity: nextQuantity, last_updated_at: new Date().toISOString() })
      .eq("id", existingStock.id);

    if (error) {
      throw error;
    }

    return;
  }

  const { error } = await supabase.from("inventory_stock").insert({
    household_id: householdId,
    item_id: item.id,
    quantity: lineItem.quantity,
    expiry_date: expiryDate,
  });

  if (error) {
    throw error;
  }
}

function createSourceLineHash(messageId: string, index: number, item: ParsedLineItem): string {
  return crypto
    .createHash("sha256")
    .update(`${messageId}|${index}|${item.rawName}|${item.quantity}|${item.price ?? ""}`)
    .digest("hex");
}
