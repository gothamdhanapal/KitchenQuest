import { NextRequest, NextResponse } from "next/server";
import { calculateExpiryDate } from "@/lib/expiry";
import { normalizeName } from "@/lib/normalize";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { InventoryItem, PurchaseLog } from "@/lib/types";

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const purchaseId = String(formData.get("purchaseId") ?? "");
  const itemId = String(formData.get("itemId") ?? "");
  const redirectTo = request.headers.get("referer") ?? "/";

  if (!purchaseId || !itemId) {
    return NextResponse.redirect(new URL("/?review=missing_fields", request.url));
  }

  const supabase = await createSupabaseServerClient();
  const { data: purchase, error: purchaseError } = await supabase
    .from("purchase_log")
    .select("*")
    .eq("id", purchaseId)
    .single();

  if (purchaseError || !purchase) {
    return NextResponse.redirect(new URL("/?review=purchase_not_found", request.url));
  }

  const typedPurchase = purchase as PurchaseLog;
  const { data: item, error: itemError } = await supabase
    .from("inventory_items")
    .select("*")
    .eq("id", itemId)
    .eq("household_id", typedPurchase.household_id)
    .single();

  if (itemError || !item) {
    return NextResponse.redirect(new URL("/?review=item_not_found", request.url));
  }

  const typedItem = item as InventoryItem;
  const normalizedAlias = normalizeName(typedPurchase.raw_product_name);

  await supabase.from("item_aliases").upsert(
    {
      household_id: typedPurchase.household_id,
      item_id: typedItem.id,
      alias: typedPurchase.raw_product_name,
      normalized_alias: normalizedAlias,
    },
    { onConflict: "household_id,normalized_alias" },
  );

  const { error: updateError } = await supabase
    .from("purchase_log")
    .update({ matched_item_id: typedItem.id, status: "matched" })
    .eq("id", typedPurchase.id);

  if (updateError) {
    return NextResponse.redirect(new URL("/?review=update_failed", request.url));
  }

  await incrementMappedStock(supabase, typedPurchase, typedItem);

  return NextResponse.redirect(redirectTo);
}

async function incrementMappedStock(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  purchase: PurchaseLog,
  item: InventoryItem,
) {
  const expiryDate = calculateExpiryDate(new Date(purchase.order_date), item, purchase.raw_product_name);
  const { data: existingStock, error } = await supabase
    .from("inventory_stock")
    .select("id, quantity")
    .eq("household_id", purchase.household_id)
    .eq("item_id", item.id)
    .eq("expiry_date", expiryDate)
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (existingStock) {
    await supabase
      .from("inventory_stock")
      .update({
        quantity: Number(existingStock.quantity) + Number(purchase.quantity),
        last_updated_at: new Date().toISOString(),
      })
      .eq("id", existingStock.id);
    return;
  }

  await supabase.from("inventory_stock").insert({
    household_id: purchase.household_id,
    item_id: item.id,
    quantity: purchase.quantity,
    expiry_date: expiryDate,
  });
}
