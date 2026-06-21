import { readFile } from "node:fs/promises";
import { PDFParse } from "pdf-parse";

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
};

export type BlinkitInvoiceLineCandidate = {
  line: string;
  quantity: number | null;
  price: number | null;
};

export async function parseBlinkitInvoicePdf(sourcePath: string): Promise<BlinkitInvoiceParseResult> {
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

    return {
      sourcePath,
      text,
      pages,
      tables,
      debug: {
        numberedLines: splitMeaningfulLines(text).map((line, index) => `${String(index + 1).padStart(4, "0")}: ${line}`),
        likelyItemSections: extractLikelyItemSections(text),
      },
      metadata: extractInvoiceMetadata(text),
      lineCandidates: extractLineCandidates(text, tables),
    };
  } finally {
    await parser.destroy();
  }
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
    }));

  return dedupeCandidates(candidates);
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

function firstMatch(value: string, pattern: RegExp): string | null {
  return value.match(pattern)?.[1]?.trim() ?? null;
}

function dedupeCandidates(candidates: BlinkitInvoiceLineCandidate[]): BlinkitInvoiceLineCandidate[] {
  const seen = new Set<string>();

  return candidates.filter((candidate) => {
    const key = `${candidate.line}|${candidate.quantity ?? ""}|${candidate.price ?? ""}`;
    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}
