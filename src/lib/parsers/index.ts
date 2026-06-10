import { blinkitParser } from "@/lib/parsers/blinkit";
import { instamartParser } from "@/lib/parsers/instamart";
import type { Retailer, RetailerParser } from "@/lib/types";

export const retailerParsers: RetailerParser[] = [instamartParser, blinkitParser];

export function getRetailerParser(retailer: Retailer): RetailerParser {
  const parser = retailerParsers.find((candidate) => candidate.retailer === retailer);

  if (!parser) {
    throw new Error(`No parser registered for retailer: ${retailer}`);
  }

  return parser;
}
