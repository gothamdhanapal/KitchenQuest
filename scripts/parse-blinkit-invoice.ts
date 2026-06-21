import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseBlinkitInvoicePdf } from "../src/lib/invoices/blinkit-invoice";

const sourcePath = resolve(process.cwd(), process.argv[2] ?? "artifacts/blinkit/latest-invoice.pdf");
const artifactDir = resolve(process.cwd(), "artifacts", "blinkit");

async function main() {
  mkdirSync(artifactDir, { recursive: true });
  const result = await parseBlinkitInvoicePdf(sourcePath);
  const textPath = join(artifactDir, "latest-invoice-text.txt");
  const jsonPath = join(artifactDir, "latest-invoice-parse.json");

  writeFileSync(textPath, `${result.text}\n`);
  writeFileSync(
    jsonPath,
    `${JSON.stringify(
      {
        sourcePath: result.sourcePath,
        metadata: result.metadata,
        lineCandidates: result.lineCandidates,
      },
      null,
      2,
    )}\n`,
  );

  console.log("Parsed invoice:", sourcePath);
  console.log("Extracted text:", textPath);
  console.log("Parse JSON:", jsonPath);
  console.log("Order ID:", result.metadata.orderId ?? "not found");
  console.log("Line candidates:", result.lineCandidates.length);

  if (result.lineCandidates.length === 0) {
    console.log("No line candidates found. Inspect latest-invoice-text.txt to tune the invoice parser.");
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
