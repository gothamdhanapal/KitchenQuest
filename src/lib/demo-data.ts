import type { InventoryItem, InventoryStock, PurchaseLog } from "@/lib/types";

export const demoInventoryItems: InventoryItem[] = [
  {
    id: "milk",
    household_id: "demo",
    item_name: "Milk",
    normalized_name: "milk",
    category: "dairy",
    unit: "l",
    default_shelf_life_days: 3,
    essential_to_refill: true,
  },
  {
    id: "tomato",
    household_id: "demo",
    item_name: "Tomato",
    normalized_name: "tomato",
    category: "vegetable",
    unit: "kg",
    default_shelf_life_days: 7,
    essential_to_refill: true,
  },
  {
    id: "rice",
    household_id: "demo",
    item_name: "Rice",
    normalized_name: "rice",
    category: "grain",
    unit: "kg",
    default_shelf_life_days: 180,
    essential_to_refill: true,
  },
];

export const demoStock: InventoryStock[] = [
  {
    id: "stock-milk",
    household_id: "demo",
    item_id: "milk",
    quantity: 1,
    expiry_date: new Date(Date.now() + 86_400_000).toISOString().slice(0, 10),
    last_updated_at: new Date().toISOString(),
    inventory_items: {
      item_name: "Milk",
      category: "dairy",
      unit: "l",
      essential_to_refill: true,
    },
  },
  {
    id: "stock-tomato",
    household_id: "demo",
    item_id: "tomato",
    quantity: 0.5,
    expiry_date: new Date(Date.now() - 86_400_000).toISOString().slice(0, 10),
    last_updated_at: new Date().toISOString(),
    inventory_items: {
      item_name: "Tomato",
      category: "vegetable",
      unit: "kg",
      essential_to_refill: true,
    },
  },
];

export const demoPurchases: PurchaseLog[] = [
  {
    id: "purchase-1",
    household_id: "demo",
    user_id: "demo-user",
    retailer: "instamart",
    order_date: new Date().toISOString(),
    raw_product_name: "2 x Fresh Milk ₹120",
    matched_item_id: "milk",
    quantity: 2,
    price: 120,
    status: "matched",
    created_at: new Date().toISOString(),
    inventory_items: {
      item_name: "Milk",
      category: "dairy",
      unit: "l",
    },
  },
  {
    id: "purchase-2",
    household_id: "demo",
    user_id: "demo-user",
    retailer: "blinkit",
    order_date: new Date().toISOString(),
    raw_product_name: "Organic Baby Spinach",
    matched_item_id: null,
    quantity: 1,
    price: 89,
    status: "needs_review",
    created_at: new Date().toISOString(),
    inventory_items: null,
  },
];
