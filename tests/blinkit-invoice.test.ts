import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  extractBlinkitTableItems,
  extractInvoiceMetadata,
  extractParsedLineItems,
  extractLineCandidates,
} from "../src/lib/invoices/blinkit-invoice";

const SAMPLE_INVOICE_TEXT = `
Sold By / Seller
Blink Commerce Private Limited
GSTIN : 36AAFCG9846E2ZF
Invoice To
Order Id : 1118947369
Name : Harish Madhavaram
Invoice : 02-Jul-2025
Sr. no UPC Item Description MRP Discount Qty. Taxable Value CGST (%) CGST (INR) SGST (%) SGST (INR) Cess (%) Additional Cess Val Total
1 890 Godrej Protekt 99.00 15.00 2 142.37 9.00 12.81 9.00 12.81 0.00 0.00 168.00
102 Germ Fighter 302 Aqua - Liquid
409 Hand Wash(Pack) 2 (HSN-34011941)
2 890 Crystal Garbage 70.00 11.00 2 100.00 9.00 9.00 9.00 9.00 0.00 0.00 118.00
414 Bag (Small, Black) 950 (Pack) (HSN-39232100)
Total 4 21.81 21.81 286.00
1 998549 Handling charge 11.0 0 1 9.32 9 0.84 9 0.84 11.0
Total 0 1 9.32 0.84 0.84 11.0
Amount in Words: Two Hundred Eighty-Six Rupees And Zero Paisa Only
`.trim();

describe("blinkit invoice parser", () => {
  it("extracts invoice metadata from Blinkit tax invoice text", () => {
    const metadata = extractInvoiceMetadata(SAMPLE_INVOICE_TEXT);

    assert.equal(metadata.orderId, "1118947369");
    assert.equal(metadata.orderDate, "02-Jul-2025");
    assert.equal(metadata.totalAmount, 286);
  });

  it("extracts multi-line Blinkit item rows with quantity and total price", () => {
    const orderDate = new Date("2026-07-02");
    const items = extractBlinkitTableItems(SAMPLE_INVOICE_TEXT, orderDate);

    assert.equal(items.length, 2);
    assert.match(items[0].rawName, /Godrej Protekt/i);
    assert.match(items[0].rawName, /Hand Wash/i);
    assert.equal(items[0].quantity, 2);
    assert.equal(items[0].price, 168);
    assert.match(items[1].rawName, /Crystal Garbage/i);
    assert.match(items[1].rawName, /Bag/i);
    assert.equal(items[1].quantity, 2);
    assert.equal(items[1].price, 118);
  });

  it("skips handling charge rows", () => {
    const items = extractBlinkitTableItems(SAMPLE_INVOICE_TEXT, new Date("2026-07-02"));
    assert.equal(items.some((item) => /handling charge/i.test(item.rawName)), false);
  });

  it("falls back to line candidates for single-line item rows", () => {
    const line = "1 890 Happilo Premium 75.00 9.00 2 117.86 6.00 7.07 6.00 7.07 0.00 0.00 132.00";
    const candidates = extractLineCandidates(`${SAMPLE_INVOICE_TEXT}\n${line}`);
    const items = extractParsedLineItems(candidates, [], new Date("2026-07-02"));

    assert.equal(candidates.length >= 1, true);
    assert.equal(items.some((item) => item.rawName.includes("Happilo Premium")), true);
    assert.equal(items.find((item) => item.rawName.includes("Happilo Premium"))?.price, 132);
  });
});
