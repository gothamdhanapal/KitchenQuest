import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { PDFParse } from "pdf-parse";
import type { ParsedLineItem } from "@/lib/types";

export type BlinkitInvoiceParseResult = {
  sourcePath: string;
  text: string;
  pages: Array<{ pageNumber: number; text: string; lineCount: number }>;
  tables: string[][][];
  debug: {
    numberedLines: string[];
    likelyItemSections: Array<{ title: string; lines: string[] }>;
  };
  metadata: {
    orderId: string | null;
    orderDate: string | null;
    invoiceNumber: string | null;
    totalAmount: number | null;
  };
  lineCandidates: BlinkitInvoiceLineCandidate[];
  parsedItems: ParsedLineItem[];
};

export type BlinkitInvoiceLineCandidate = {
  line: string;
  quantity: number | null;
  price: number | null;
  rawName: string | null;
};

export async function parseBlinkitInvoicePdf(sourcePath: string): Promise<BlinkitInvoiceParseResult> {
  configurePdfWorker();
  const data = await readFile(sourcePath);
  const parser = new PDFParse({ data });

  try {
    const [textResult, tableResult] = await Promise.all([parser.getText(), parser.getTable().catch(() => null)]);
    const text = normalizeExtractedText(textResult.text);
    const pages = textResult.pages.map((page) => {
      const pageText = normalizeExtractedText(page.text);

      return {
        pageNumber: page.num,
        text: pageText,
        lineCount: splitMeaningfulLines(pageText).length,
      };
    });
    const tables = tableResult?.mergedTables ?? [];

    const metadata = extractInvoiceMetadata(text);
    const lineCandidates = extractLineCandidates(text, tables);

    return {
      sourcePath,
      text,
      pages,
      tables,
      debug: {
        numberedLines: splitMeaningfulLines(text).map((line, index) => `${String(index + 1).padStart(4, "0")}: ${line}`),
        likelyItemSections: extractLikelyItemSections(text),
      },
      metadata,
      lineCandidates,
      parsedItems: extractParsedLineItems(lineCandidates, tables, parseInvoiceDate(metadata.orderDate)),
    };
  } finally {
    await parser.destroy();
  }
}

function configurePdfWorker() {
  const workerPath = pathToFileURL(`${process.cwd()}/node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs`).toString();
  PDFParse.setWorker(workerPath);
}

export function normalizeExtractedText(value: string): string {
  return value
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function extractInvoiceMetadata(text: string): BlinkitInvoiceParseResult["metadata"] {
  return {
    orderId: firstMatch(text, /\b(?:order|ord)[\s#:.-]*(ORD[A-Z0-9]+)/i),
    orderDate: firstMatch(
      text,
      /\b(\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\s+\d{4}(?:[,\s]+\d{1,2}:\d{2}\s*(?:AM|PM)?)?)/i,
    ),
    invoiceNumber: firstMatch(text, /\b(?:invoice|inv)[\s#:.-]*([A-Z0-9/-]{5,})/i),
    totalAmount: parseCurrency(firstMatch(text, /\b(?:grand total|total amount|amount paid|invoice total)\D{0,20}(?:₹|rs\.?)\s*([\d,.]+)/i)),
  };
}

export function extractLineCandidates(text: string, tables: string[][][] = []): BlinkitInvoiceLineCandidate[] {
  const tableCandidates = tables.flatMap((table) =>
    table
      .map((row) => row.map((cell) => cell.trim()).filter(Boolean).join(" | "))
      .filter(isLikelyItemLine),
  );
  const textCandidates = splitMeaningfulLines(text).filter(isLikelyItemLine);
  const candidates = [...tableCandidates, ...textCandidates]
    .map((line) => ({
      line,
      quantity: parseQuantity(line),
      price: parseCurrency(firstMatch(line, /(?:₹|rs\.?)\s*([\d,.]+)/i)),
      rawName: parseProductNameFromLine(line),
    }));

  return dedupeCandidates(candidates);
}

export function extractParsedLineItems(
  lineCandidates: BlinkitInvoiceLineCandidate[],
  tables: string[][][] = [],
  orderDate = new Date(),
): ParsedLineItem[] {
  const tableItems = extractItemsFromTables(tables, orderDate);
  const lineItems = lineCandidates
    .filter((candidate) => candidate.rawName && candidate.price !== null)
    .map((candidate) => ({
      retailer: "blinkit" as const,
      rawName: candidate.rawName ?? candidate.line,
      quantity: candidate.quantity ?? 1,
      price: candidate.price,
      orderDate,
    }));

  return dedupeParsedItems([...tableItems, ...lineItems]);
}

export function splitMeaningfulLines(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

export function extractLikelyItemSections(text: string): Array<{ title: string; lines: string[] }> {
  const lines = splitMeaningfulLines(text);
  const headerIndexes = lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => /description|particulars|item|product|qty|quantity|mrp|rate|amount|taxable|hsn/i.test(line));

  return headerIndexes.slice(0, 8).map(({ line, index }) => ({
    title: line,
    lines: lines.slice(Math.max(0, index - 3), Math.min(lines.length, index + 18)),
  }));
}

function isLikelyItemLine(line: string): boolean {
  if (isKnownNonItemLine(line)) {
    return false;
  }

  const hasCurrency = /(?:₹|rs\.?)\s*[\d,.]+/i.test(line);
  const hasQuantity = /\b(?:qty|quantity)\b|\b\d+(?:\.\d+)?\s*(?:x|pcs?|g|kg|ml|l|unit|pack)\b/i.test(line);
  const hasMultipleNumericColumns = (line.match(/\b\d+(?:\.\d+)?\b/g) ?? []).length >= 2;
  const hasLetters = /[a-zA-Z]/.test(line);

  return hasLetters && (hasCurrency || (hasQuantity && hasMultipleNumericColumns));
}

function isKnownNonItemLine(line: string): boolean {
  return /grand total|total amount|amount paid|invoice total|delivery charge|handling charge|platform fee|tax invoice|sold by|bill to|ship to|customer|address|gstin|cin|fssai|payment|page \d+|terms|conditions/i.test(line);
}

function extractItemsFromTables(tables: string[][][], orderDate: Date): ParsedLineItem[] {
  return tables.flatMap((table) => {
    const headerIndex = table.findIndex((row) =>
      row.some((cell) => /description|particulars|item|product|qty|quantity|amount|total/i.test(cell)),
    );

    if (headerIndex === -1) {
      return [];
    }

    const header = table[headerIndex].map(normalizeHeaderCell);
    const itemIndex = findHeaderIndex(header, /description|particulars|item|product|name/);
    const quantityIndex = findHeaderIndex(header, /qty|quantity/);
    const priceIndex = findLastHeaderIndex(header, /amount|total|price|net/);

    if (itemIndex === -1) {
      return [];
    }

    return table
      .slice(headerIndex + 1)
      .map((row) => parseTableItemRow(row, { itemIndex, quantityIndex, priceIndex }, orderDate))
      .filter((item): item is ParsedLineItem => item !== null);
  });
}

function parseTableItemRow(
  row: string[],
  indexes: { itemIndex: number; quantityIndex: number; priceIndex: number },
  orderDate: Date,
): ParsedLineItem | null {
  const cells = row.map((cell) => cell.trim()).filter(Boolean);
  if (cells.length === 0 || cells.some((cell) => /grand total|total amount|delivery charge|handling charge/i.test(cell))) {
    return null;
  }

  const rawName = cleanProductName(cells[indexes.itemIndex] ?? "");
  if (!rawName || !/[a-zA-Z]/.test(rawName)) {
    return null;
  }

  const quantity = indexes.quantityIndex >= 0 ? parseQuantity(cells[indexes.quantityIndex]) : parseQuantity(cells.join(" "));
  const price =
    (indexes.priceIndex >= 0 ? parseAnyNumber(cells[indexes.priceIndex]) : null) ??
    parseRightmostCurrencyOrNumber(cells);

  if (price === null) {
    return null;
  }

  return {
    retailer: "blinkit",
    rawName,
    quantity: quantity ?? 1,
    price,
    orderDate,
  };
}

function parseProductNameFromLine(line: string): string | null {
  const parts = line
    .split("|")
    .map((part) => part.trim())
    .filter(Boolean);
  const candidate = parts.length > 1 ? parts.find((part) => /[a-zA-Z]/.test(part) && !isKnownNonItemLine(part)) : line;

  if (!candidate) {
    return null;
  }

  return cleanProductName(
    candidate
      .replace(/(?:₹|rs\.?)\s*[\d,.]+/gi, " ")
      .replace(/\b(?:qty|quantity)\s*[:x-]?\s*\d+(?:\.\d+)?\b/gi, " ")
      .replace(/\b\d+(?:\.\d+)?\s*x\b/gi, " "),
  );
}

function cleanProductName(value: string): string {
  return value
    .replace(/\b(?:hsn|sku|qty|quantity|mrp|rate|amount|total|price)\b\s*[:#-]?\s*/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeHeaderCell(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function findHeaderIndex(header: string[], pattern: RegExp): number {
  return header.findIndex((cell) => pattern.test(cell));
}

function findLastHeaderIndex(header: string[], pattern: RegExp): number {
  for (let index = header.length - 1; index >= 0; index -= 1) {
    if (pattern.test(header[index])) {
      return index;
    }
  }

  return -1;
}

function parseQuantity(line: string): number | null {
  const rawQuantity =
    firstMatch(line, /\bqty\s*[:x-]?\s*(\d+(?:\.\d+)?)/i) ??
    firstMatch(line, /\bquantity\s*[:x-]?\s*(\d+(?:\.\d+)?)/i) ??
    firstMatch(line, /\b(\d+(?:\.\d+)?)\s*x\b/i);

  if (!rawQuantity) {
    return null;
  }

  const quantity = Number.parseFloat(rawQuantity);
  return Number.isFinite(quantity) ? quantity : null;
}

function parseCurrency(value: string | null): number | null {
  if (!value) {
    return null;
  }

  const amount = Number.parseFloat(value.replace(/,/g, ""));
  return Number.isFinite(amount) ? amount : null;
}

function parseRightmostCurrencyOrNumber(cells: string[]): number | null {
  for (let index = cells.length - 1; index >= 0; index -= 1) {
    const amount = parseCurrency(firstMatch(cells[index], /(?:₹|rs\.?)\s*([\d,.]+)/i)) ?? parseAnyNumber(cells[index]);

    if (amount !== null) {
      return amount;
    }
  }

  return null;
}

function parseAnyNumber(value: string | undefined): number | null {
  if (!value) {
    return null;
  }

  const normalized = value.replace(/,/g, "").trim();
  if (!/^-?\d+(?:\.\d+)?$/.test(normalized)) {
    return null;
  }

  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseInvoiceDate(value: string | null): Date {
  if (!value) {
    return new Date();
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function firstMatch(value: string, pattern: RegExp): string | null {
  return value.match(pattern)?.[1]?.trim() ?? null;
}

function dedupeCandidates(candidates: BlinkitInvoiceLineCandidate[]): BlinkitInvoiceLineCandidate[] {
  const seen = new Set<string>();

  return candidates.filter((candidate) => {
    const key = `${candidate.line}|${candidate.quantity ?? ""}|${candidate.price ?? ""}|${candidate.rawName ?? ""}`;
    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function dedupeParsedItems(items: ParsedLineItem[]): ParsedLineItem[] {
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
