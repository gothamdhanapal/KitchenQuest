import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { calculateExpiryDate } from "../src/lib/expiry";
import { matchInventoryItem } from "../src/lib/matching";
import type { InventoryItem } from "../src/lib/types";

const inventoryItems: InventoryItem[] = [
  {
    id: "milk",
    household_id: "household",
    item_name: "Milk",
    normalized_name: "milk",
    category: "dairy",
    unit: "l",
    default_shelf_life_days: 3,
    essential_to_refill: true,
  },
  {
    id: "basmati-rice",
    household_id: "household",
    item_name: "Basmati Rice",
    normalized_name: "basmati rice",
    category: "grain",
    unit: "kg",
    default_shelf_life_days: 180,
    essential_to_refill: true,
  },
];

describe("matchInventoryItem", () => {
  it("matches by exact token inclusion", () => {
    const match = matchInventoryItem("Amul Taaza Milk 1L", inventoryItems);
    assert.equal(match.item?.id, "milk");
    assert.equal(match.status, "matched");
    assert.equal(match.reason, "exact_tokens");
  });

  it("falls back to needs_review when there is no safe match", () => {
    const match = matchInventoryItem("Organic Baby Spinach", inventoryItems);
    assert.equal(match.item, null);
    assert.equal(match.status, "needs_review");
  });
});

describe("calculateExpiryDate", () => {
  it("uses short dairy shelf life from the delivery date", () => {
    assert.equal(calculateExpiryDate(new Date("2026-06-10T10:00:00Z"), inventoryItems[0], "Milk"), "2026-06-13");
  });
});
