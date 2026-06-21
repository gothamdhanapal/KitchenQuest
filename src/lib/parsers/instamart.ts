import type { ParsedLineItem, RetailerParser } from "@/lib/types";

const LINE_ITEM_PATTERN = /(\d+(?:\.\d+)?)\s*x\s+(.*?)\s+₹\s?([\d,.]+)/g;

export const instamartParser: RetailerParser = {
  retailer: "instamart",
  gmailQuery: "from:noreply@swiggy.in subject:Instamart",
  gmailQueries: [
    'from:noreply@swiggy.in subject:"Your Swiggy Instamart order was successfully delivered"',
    "from:noreply@swiggy.in subject:Instamart",
    "from:noreply@swiggy.in Instamart",
    "from:swiggy.in Instamart",
  ],
  parse(emailHtml: string, emailDate: Date): ParsedLineItem[] {
    return Array.from(emailHtml.matchAll(LINE_ITEM_PATTERN))
      .map((match) => ({
        retailer: "instamart" as const,
        quantity: Number.parseFloat(match[1]),
        rawName: match[2].replace(/\s+/g, " ").trim(),
        price: Number.parseFloat(match[3].replace(/,/g, "")),
        orderDate: emailDate,
      }))
      .filter((item) => item.rawName.length > 0 && Number.isFinite(item.quantity));
  },
};
