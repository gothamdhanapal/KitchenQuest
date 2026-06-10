import type { InventoryItem, ItemAlias, MatchResult } from "@/lib/types";
import { containsConsecutiveTokens, normalizeName, tokenizeName } from "@/lib/normalize";

type MatchableItem = InventoryItem & {
  aliases?: ItemAlias[];
};

export function matchInventoryItem(rawName: string, inventoryItems: MatchableItem[]): MatchResult {
  const rawNormalized = normalizeName(rawName);
  const rawTokens = tokenizeName(rawName);
  const rawTokenSet = new Set(rawTokens);

  for (const item of inventoryItems) {
    if (
      item.aliases?.some((alias) => alias.normalized_alias === rawNormalized) ||
      item.normalized_name === rawNormalized
    ) {
      return { item, status: "matched", confidence: 1, reason: "alias" };
    }
  }

  for (const item of inventoryItems) {
    const itemTokens = tokenizeName(item.normalized_name || item.item_name);
    if (itemTokens.length > 0 && itemTokens.every((token) => rawTokenSet.has(token))) {
      return { item, status: "matched", confidence: 0.94, reason: "exact_tokens" };
    }
  }

  for (const item of inventoryItems) {
    const itemTokens = tokenizeName(item.normalized_name || item.item_name);
    if (containsConsecutiveTokens(rawTokens, itemTokens) || containsConsecutiveTokens(itemTokens, rawTokens)) {
      return { item, status: "matched", confidence: 0.86, reason: "consecutive_tokens" };
    }
  }

  const rawCombined = rawTokens.join("");
  for (const item of inventoryItems) {
    const itemCombined = tokenizeName(item.normalized_name || item.item_name).join("");
    if (itemCombined.length > 2 && rawCombined.includes(itemCombined)) {
      return { item, status: "matched", confidence: 0.78, reason: "combined_tokens" };
    }
  }

  return { item: null, status: "needs_review", confidence: 0, reason: "none" };
}
