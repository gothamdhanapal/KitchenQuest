import "server-only";

import { demoInventoryItems, demoPurchases, demoStock } from "@/lib/demo-data";
import { ensureUserProfile } from "@/lib/households";
import { getPublicSupabaseEnv } from "@/lib/supabase/env";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { InventoryItem, InventoryStock, PurchaseLog } from "@/lib/types";

export type DashboardData =
  | {
      mode: "demo";
      inventoryItems: InventoryItem[];
      stock: InventoryStock[];
      needsReview: PurchaseLog[];
      purchases: PurchaseLog[];
      gmailConnections: number;
      userEmail: null;
    }
  | {
      mode: "signed_out";
      inventoryItems: [];
      stock: [];
      needsReview: [];
      purchases: [];
      gmailConnections: 0;
      userEmail: null;
    }
  | {
      mode: "setup_required";
      inventoryItems: [];
      stock: [];
      needsReview: [];
      purchases: [];
      gmailConnections: 0;
      userEmail: string | null;
      setupError: string;
    }
  | {
      mode: "app";
      inventoryItems: InventoryItem[];
      stock: InventoryStock[];
      needsReview: PurchaseLog[];
      purchases: PurchaseLog[];
      gmailConnections: number;
      userEmail: string | null;
    };

export async function getDashboardData(): Promise<DashboardData> {
  if (!getPublicSupabaseEnv()) {
    return {
      mode: "demo",
      inventoryItems: demoInventoryItems,
      stock: demoStock,
      needsReview: demoPurchases.filter((purchase) => purchase.status === "needs_review"),
      purchases: demoPurchases,
      gmailConnections: 0,
      userEmail: null,
    };
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      mode: "signed_out",
      inventoryItems: [],
      stock: [],
      needsReview: [],
      purchases: [],
      gmailConnections: 0,
      userEmail: null,
    };
  }

  const adminClient = createSupabaseAdminClient();
  try {
    await ensureUserProfile(adminClient, user);
  } catch (error) {
    if (isMissingSchemaError(error)) {
      return {
        mode: "setup_required",
        inventoryItems: [],
        stock: [],
        needsReview: [],
        purchases: [],
        gmailConnections: 0,
        userEmail: user.email ?? null,
        setupError: getErrorMessage(error),
      };
    }

    throw error;
  }

  const [inventoryItems, stock, needsReview, purchases, gmailConnections] = await Promise.all([
    supabase.from("inventory_items").select("*").order("item_name"),
    supabase
      .from("inventory_stock")
      .select("*, inventory_items(item_name, category, unit, essential_to_refill)")
      .order("expiry_date"),
    supabase
      .from("purchase_log")
      .select("*, inventory_items(item_name, category, unit)")
      .eq("status", "needs_review")
      .order("order_date", { ascending: false }),
    supabase
      .from("purchase_log")
      .select("*, inventory_items(item_name, category, unit)")
      .order("order_date", { ascending: false })
      .limit(25),
    supabase.from("gmail_connections").select("id", { count: "exact", head: true }).eq("status", "active"),
  ]);

  return {
    mode: "app",
    inventoryItems: (inventoryItems.data ?? []) as InventoryItem[],
    stock: (stock.data ?? []) as InventoryStock[],
    needsReview: (needsReview.data ?? []) as PurchaseLog[],
    purchases: (purchases.data ?? []) as PurchaseLog[],
    gmailConnections: gmailConnections.count ?? 0,
    userEmail: user.email ?? null,
  };
}

function isMissingSchemaError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const maybeError = error as { code?: string; message?: string };
  return (
    maybeError.code === "PGRST205" ||
    maybeError.message?.includes("Could not find the table") === true ||
    maybeError.message?.includes("schema cache") === true
  );
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message: unknown }).message);
  }

  return "Supabase schema has not been applied yet.";
}
