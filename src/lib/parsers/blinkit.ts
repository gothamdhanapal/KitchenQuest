import * as cheerio from "cheerio";
import type { ParsedLineItem, RetailerParser } from "@/lib/types";

const PRICE_PATTERN = /₹\s?([\d,.]+)/;
const QUANTITY_PREFIX_PATTERN = /^(\d+(?:\.\d+)?)\s*x\s+(.+)$/i;
const TEXT_LINE_PATTERN = /(?:(\d+(?:\.\d+)?)\s*x\s+)?(.+?)\s+₹\s?([\d,.]+)/g;

function parsePrice(value: string | undefined): number | null {
  if (!value) {
    return null;
  }

  const match = value.match(PRICE_PATTERN);
  return match ? Number.parseFloat(match[1].replace(/,/g, "")) : null;
}

function normalizeProductText(value: string): string {
  return value
    .replace(PRICE_PATTERN, "")
    .replace(/\b(qty|quantity)\s*[:\-]?\s*\d+(?:\.\d+)?\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

export const blinkitParser: RetailerParser = {
  retailer: "blinkit",
  gmailQuery:
    '(from:no-reply@blinkit.com OR from:noreply@blinkit.com OR from:orders@blinkit.com) (subject:delivered OR subject:"order delivered" OR subject:"order has been delivered")',
  parse(emailHtml: string, emailDate: Date): ParsedLineItem[] {
    const $ = cheerio.load(emailHtml);
    const candidates: ParsedLineItem[] = [];

    $('[data-testid*="item" i], [class*="item" i], [class*="product" i], tr').each((_, element) => {
      const text = $(element).text().replace(/\s+/g, " ").trim();
      if (!text || !PRICE_PATTERN.test(text)) {
        return;
      }

      const quantityMatch = text.match(QUANTITY_PREFIX_PATTERN);
      const quantity = quantityMatch ? Number.parseFloat(quantityMatch[1]) : 1;
      const rawName = normalizeProductText(quantityMatch?.[2] ?? text);
      const price = parsePrice(text);

      if (rawName.length > 1) {
        candidates.push({
          retailer: "blinkit",
          rawName,
          quantity: Number.isFinite(quantity) ? quantity : 1,
          price,
          orderDate: emailDate,
        });
      }
    });

    if (candidates.length > 0) {
      return dedupeLineItems(candidates);
    }

    const plainText = $.text().replace(/\s+/g, " ");
    return dedupeLineItems(
      Array.from(plainText.matchAll(TEXT_LINE_PATTERN)).map((match) => ({
        retailer: "blinkit" as const,
        quantity: match[1] ? Number.parseFloat(match[1]) : 1,
        rawName: normalizeProductText(match[2]),
        price: Number.parseFloat(match[3].replace(/,/g, "")),
        orderDate: emailDate,
      })),
    );
  },
};

function dedupeLineItems(items: ParsedLineItem[]): ParsedLineItem[] {
  const seen = new Set<string>();

  return items.filter((item) => {
    const key = `${item.rawName.toLowerCase()}|${item.quantity}|${item.price ?? ""}`;
    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}
