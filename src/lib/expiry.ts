import type { InventoryItem } from "@/lib/types";
import { tokenizeName } from "@/lib/normalize";

const CATEGORY_SHELF_LIFE_DAYS: Record<string, number> = {
  bakery: 5,
  dairy: 5,
  fruit: 7,
  herbs: 4,
  leafy: 3,
  meat: 2,
  seafood: 1,
  vegetable: 10,
};

const RAW_NAME_OVERRIDES: Array<{ tokens: string[]; days: number }> = [
  { tokens: ["milk"], days: 3 },
  { tokens: ["bread"], days: 5 },
  { tokens: ["curd"], days: 7 },
  { tokens: ["paneer"], days: 5 },
  { tokens: ["egg"], days: 21 },
  { tokens: ["eggs"], days: 21 },
];

export function getShelfLifeDays(item: InventoryItem, rawProductName: string): number {
  const rawTokens = new Set(tokenizeName(rawProductName));
  const override = RAW_NAME_OVERRIDES.find(({ tokens }) => tokens.some((token) => rawTokens.has(token)));

  if (override) {
    return override.days;
  }

  return CATEGORY_SHELF_LIFE_DAYS[item.category.toLowerCase()] ?? item.default_shelf_life_days;
}

export function calculateExpiryDate(orderDate: Date, item: InventoryItem, rawProductName: string): string {
  const expiry = new Date(orderDate);
  expiry.setUTCDate(expiry.getUTCDate() + getShelfLifeDays(item, rawProductName));
  return expiry.toISOString().slice(0, 10);
}

export function getExpiryState(expiryDate: string, now = new Date()): "expired" | "soon" | "ok" {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const expiry = Date.parse(`${expiryDate}T00:00:00.000Z`);
  const days = Math.ceil((expiry - today) / 86_400_000);

  if (days < 0) {
    return "expired";
  }

  if (days <= 3) {
    return "soon";
  }

  return "ok";
}
