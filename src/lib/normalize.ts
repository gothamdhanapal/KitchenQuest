const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "by",
  "for",
  "fresh",
  "gm",
  "gms",
  "kg",
  "l",
  "ltr",
  "ml",
  "of",
  "pack",
  "pcs",
  "piece",
  "the",
  "with",
  "x",
]);

export function normalizeName(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\b\d+(\.\d+)?\s*(g|gm|gms|kg|ml|l|ltr|pcs|pieces|pack|packs)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokenizeName(value: string): string[] {
  return normalizeName(value)
    .split(" ")
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token));
}

export function containsConsecutiveTokens(candidateTokens: string[], queryTokens: string[]): boolean {
  if (queryTokens.length === 0 || queryTokens.length > candidateTokens.length) {
    return false;
  }

  return candidateTokens.some((_, startIndex) =>
    queryTokens.every((token, offset) => candidateTokens[startIndex + offset] === token),
  );
}
