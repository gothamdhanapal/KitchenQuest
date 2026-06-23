export type Retailer = "instamart" | "blinkit";

export type PurchaseStatus = "matched" | "unmatched" | "needs_review";

export type ParsedLineItem = {
  rawName: string;
  quantity: number;
  price: number | null;
  retailer: Retailer;
  orderDate: Date;
};

export type RetailerParser = {
  retailer: Retailer;
  gmailQuery: string;
  gmailQueries?: string[];
  parse(emailHtml: string, emailDate: Date): ParsedLineItem[];
};

export type InventoryItem = {
  id: string;
  household_id: string;
  item_name: string;
  normalized_name: string;
  category: string;
  unit: string;
  default_shelf_life_days: number;
  essential_to_refill: boolean;
};

export type ItemAlias = {
  id: string;
  household_id: string;
  item_id: string;
  alias: string;
  normalized_alias: string;
};

export type InventoryStock = {
  id: string;
  household_id: string;
  item_id: string;
  quantity: number;
  expiry_date: string;
  last_updated_at: string;
  inventory_items?: Pick<InventoryItem, "item_name" | "category" | "unit" | "essential_to_refill">;
};

export type PurchaseLog = {
  id: string;
  household_id: string;
  user_id: string;
  retailer: Retailer;
  order_date: string;
  raw_product_name: string;
  matched_item_id: string | null;
  quantity: number;
  price: number | null;
  status: PurchaseStatus;
  created_at: string;
  inventory_items?: Pick<InventoryItem, "item_name" | "category" | "unit"> | null;
};

export type MatchResult = {
  item: InventoryItem | null;
  status: PurchaseStatus;
  confidence: number;
  reason: "alias" | "exact_tokens" | "consecutive_tokens" | "combined_tokens" | "none";
};
