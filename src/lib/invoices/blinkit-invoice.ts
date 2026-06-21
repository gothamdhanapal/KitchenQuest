import { readFile } from "node:fs/promises";
import { PDFParse } from "pdf-parse";

export type BlinkitInvoiceParseResult = {
  sourcePath: string;
  text: string;
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
    const result = await parser.getText();
    const text = normalizeExtractedText(result.text);

    return {
      sourcePath,
      text,
      metadata: extractInvoiceMetadata(text),
      lineCandidates: extractLineCandidates(text),
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

export function extractLineCandidates(text: string): BlinkitInvoiceLineCandidate[] {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const candidates = lines
    .filter((line) => /(₹|rs\.?|\bqty\b|\bquantity\b|\d+\s*x\s+)/i.test(line))
    .filter((line) => !/grand total|total amount|amount paid|invoice total|delivery charge|handling charge/i.test(line))
    .map((line) => ({
      line,
      quantity: parseQuantity(line),
      price: parseCurrency(firstMatch(line, /(?:₹|rs\.?)\s*([\d,.]+)/i)),
    }));

  return dedupeCandidates(candidates);
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
