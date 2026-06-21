import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseBlinkitInvoicePdf } from "../src/lib/invoices/blinkit-invoice";

const sourcePath = resolve(process.cwd(), process.argv[2] ?? "artifacts/blinkit/latest-invoice.pdf");
const artifactDir = resolve(process.cwd(), "artifacts", "blinkit");

async function main() {
  mkdirSync(artifactDir, { recursive: true });
  const result = await parseBlinkitInvoicePdf(sourcePath);
  const textPath = join(artifactDir, "latest-invoice-text.txt");
  const numberedTextPath = join(artifactDir, "latest-invoice-numbered-lines.txt");
  const sectionsPath = join(artifactDir, "latest-invoice-sections.json");
  const tablesPath = join(artifactDir, "latest-invoice-tables.json");
  const jsonPath = join(artifactDir, "latest-invoice-parse.json");

  writeFileSync(textPath, `${result.text}\n`);
  writeFileSync(numberedTextPath, `${result.debug.numberedLines.join("\n")}\n`);
  writeFileSync(sectionsPath, `${JSON.stringify(result.debug.likelyItemSections, null, 2)}\n`);
  writeFileSync(tablesPath, `${JSON.stringify(result.tables, null, 2)}\n`);
  writeFileSync(
    jsonPath,
    `${JSON.stringify(
      {
        sourcePath: result.sourcePath,
        metadata: result.metadata,
        pages: result.pages,
        lineCandidates: result.lineCandidates,
        debugArtifacts: {
          textPath,
          numberedTextPath,
          sectionsPath,
          tablesPath,
        },
      },
      null,
      2,
    )}\n`,
  );

  console.log("Parsed invoice:", sourcePath);
  console.log("Extracted text:", textPath);
  console.log("Numbered lines:", numberedTextPath);
  console.log("Likely item sections:", sectionsPath);
  console.log("Detected tables:", tablesPath);
  console.log("Parse JSON:", jsonPath);
  console.log("Order ID:", result.metadata.orderId ?? "not found");
  console.log("Line candidates:", result.lineCandidates.length);

  if (result.lineCandidates.length === 0) {
    console.log("No line candidates found. Inspect latest-invoice-sections.json and latest-invoice-numbered-lines.txt to tune the invoice parser.");
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
