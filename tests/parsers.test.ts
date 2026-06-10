import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { blinkitParser } from "../src/lib/parsers/blinkit";
import { instamartParser } from "../src/lib/parsers/instamart";

describe("instamartParser", () => {
  it("extracts quantity, product name, and price from POC-style lines", () => {
    const items = instamartParser.parse("2 x Amul Milk 1L ₹ 120\n1 x Bread ₹45", new Date("2026-06-10"));

    assert.equal(items.length, 2);
    assert.deepEqual(
      items.map((item) => [item.quantity, item.rawName, item.price]),
      [
        [2, "Amul Milk 1L", 120],
        [1, "Bread", 45],
      ],
    );
  });
});

describe("blinkitParser", () => {
  it("extracts line items from simple product rows", () => {
    const html = `
      <table>
        <tr class="product"><td>2 x Tomato 500g</td><td>₹40</td></tr>
        <tr class="product"><td>Bread</td><td>₹55</td></tr>
      </table>
    `;

    const items = blinkitParser.parse(html, new Date("2026-06-10"));

    assert.equal(items.length, 2);
    assert.equal(items[0].rawName, "Tomato 500g");
    assert.equal(items[0].quantity, 2);
    assert.equal(items[0].price, 40);
    assert.equal(items[1].rawName, "Bread");
  });
});
