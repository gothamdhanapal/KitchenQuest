import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

type Command =
  | "diagnose"
  | "capture"
  | "dump-ui"
  | "open"
  | "list-invoices"
  | "pull-invoices"
  | "recent-files"
  | "list-downloads"
  | "pull-downloads";

const ADB_MAX_BUFFER_BYTES = 50 * 1024 * 1024;
const BLINKIT_PACKAGE_FALLBACK = "com.grofers.customerapp";
const ANDROID_SEARCH_DIRS = [
  "/sdcard",
  "/storage/emulated/0",
  "/sdcard/Download",
  "/sdcard/Downloads",
  "/storage/emulated/0/Download",
  "/storage/emulated/0/Downloads",
  "/sdcard/Documents",
  "/storage/emulated/0/Documents",
  "/sdcard/Android/data/com.grofers.customerapp",
  "/storage/emulated/0/Android/data/com.grofers.customerapp",
];
const ANDROID_DOWNLOAD_PROVIDER_URIS = [
  "content://downloads/my_downloads",
  "content://downloads/public_downloads",
  "content://downloads/all_downloads",
];

const command = (process.argv[2] ?? "diagnose") as Command;
const artifactDir = resolve(process.cwd(), "artifacts", "blinkit");
const adb = resolveAdbPath();

main();

function main() {
  if (
    ![
      "diagnose",
      "capture",
      "dump-ui",
      "open",
      "list-invoices",
      "pull-invoices",
      "recent-files",
      "list-downloads",
      "pull-downloads",
    ].includes(command)
  ) {
    fail(
      `Unknown command "${command}". Use diagnose, capture, dump-ui, open, list-invoices, pull-invoices, recent-files, list-downloads, or pull-downloads.`,
    );
  }

  ensureArtifactDir();
  const devices = listDevices();

  if (devices.length === 0) {
    fail("No Android devices found. Start the emulator, then run this command again.");
  }

  const deviceId = process.env.ADB_DEVICE_ID ?? devices[0];
  const foreground = getForegroundApp(deviceId);
  const candidatePackages = listBlinkitCandidatePackages(deviceId);

  if (command === "diagnose") {
    console.log("ADB:", adb);
    console.log("Device:", deviceId);
    console.log("Foreground package:", foreground.packageName ?? "unknown");
    console.log("Foreground activity:", foreground.activity ?? "unknown");
    console.log("Blinkit-like packages:", candidatePackages.length ? candidatePackages.join(", ") : "none found");
    console.log("");
    console.log("Next:");
    console.log("1. Open Blinkit order history/order details in the emulator.");
    console.log("2. If an invoice PDF is available, download it in the emulator and run `npm run blinkit:pull-invoices`.");
    console.log("3. Otherwise run `npm run blinkit:capture`.");
    return;
  }

  if (command === "open") {
    const packageName = candidatePackages[0] ?? BLINKIT_PACKAGE_FALLBACK;
    adbExec(["-s", deviceId, "shell", "monkey", "-p", packageName, "-c", "android.intent.category.LAUNCHER", "1"]);
    console.log(`Requested launch for ${packageName}.`);
    return;
  }

  if (command === "list-invoices") {
    const invoices = listInvoiceCandidates(deviceId);
    writeInvoiceManifest(invoices);

    if (invoices.length === 0) {
      console.log("No PDF candidates found in Android shared/app storage.");
      console.log("Try `npm run blinkit:recent-files` immediately after tapping Download invoice.");
      return;
    }

    console.log("PDF candidates:");
    invoices.forEach((invoice, index) => {
      console.log(`${index + 1}. ${invoice.path} (${invoice.sizeBytes} bytes, ${invoice.modifiedAt})`);
    });
    console.log("Manifest:", join(artifactDir, "invoice-candidates.json"));
    return;
  }

  if (command === "pull-invoices") {
    const invoices = listInvoiceCandidates(deviceId);
    writeInvoiceManifest(invoices);

    if (invoices.length === 0) {
      fail("No PDF candidates found. Tap Download invoice in Blinkit, then try `npm run blinkit:recent-files`.");
    }

    const pulled = pullInvoices(deviceId, invoices);
    console.log("Pulled invoice PDFs:");
    pulled.forEach((path) => console.log(`- ${path}`));
    console.log("Latest invoice:", join(artifactDir, "latest-invoice.pdf"));
    console.log("Manifest:", join(artifactDir, "invoice-candidates.json"));
    return;
  }

  if (command === "recent-files") {
    const files = listRecentFiles(deviceId);
    writeFileManifest("recent-files.json", files);

    if (files.length === 0) {
      console.log("No recent files found in Android shared/app storage.");
      return;
    }

    console.log("Recent files:");
    files.slice(0, 50).forEach((file, index) => {
      console.log(`${index + 1}. ${file.path} (${file.sizeBytes} bytes, ${file.modifiedAt})`);
    });
    console.log("Manifest:", join(artifactDir, "recent-files.json"));
    return;
  }

  if (command === "list-downloads") {
    const downloads = listDownloadProviderCandidates(deviceId);
    writeDownloadManifest(downloads);

    if (downloads.length === 0) {
      console.log("No Android download-provider entries found.");
      return;
    }

    console.log("Android download-provider entries:");
    downloads.slice(0, 50).forEach((download, index) => {
      console.log(
        `${index + 1}. ${download.displayName} | ${download.mimeType ?? "unknown mime"} | ${download.path ?? download.contentUri}`,
      );
    });
    console.log("Manifest:", join(artifactDir, "download-provider-candidates.json"));
    return;
  }

  if (command === "pull-downloads") {
    const downloads = listDownloadProviderCandidates(deviceId).filter(isLikelyInvoiceDownload);
    writeDownloadManifest(downloads);

    if (downloads.length === 0) {
      fail("No invoice-like Android download-provider entries found. Try `npm run blinkit:list-downloads`.");
    }

    const pulled = pullDownloadProviderFiles(deviceId, downloads);
    console.log("Pulled download-provider files:");
    pulled.forEach((path) => console.log(`- ${path}`));
    console.log("Latest download:", join(artifactDir, "latest-invoice.pdf"));
    console.log("Manifest:", join(artifactDir, "download-provider-candidates.json"));
    return;
  }

  if (command === "capture") {
    const screenshotPath = captureScreenshot(deviceId);
    const uiPath = dumpUi(deviceId);
    const { textPath, summaryPath } = extractUiDiagnostics(uiPath, {
      deviceId,
      foreground,
      candidatePackages,
    });

    console.log("Captured screenshot:", screenshotPath);
    console.log("Captured UI XML:", uiPath);
    console.log("Extracted visible text:", textPath);
    console.log("Captured UI summary:", summaryPath);
    return;
  }

  if (command === "dump-ui") {
    const uiPath = dumpUi(deviceId);
    const { textPath, summaryPath } = extractUiDiagnostics(uiPath, {
      deviceId,
      foreground,
      candidatePackages,
    });

    console.log("Captured UI XML:", uiPath);
    console.log("Extracted visible text:", textPath);
    console.log("Captured UI summary:", summaryPath);
  }
}

function resolveAdbPath(): string {
  const explicit = process.env.ADB_PATH;
  if (explicit && existsSync(explicit)) {
    return explicit;
  }

  const androidHome = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT;
  const candidates = [
    androidHome ? join(androidHome, "platform-tools", "adb") : null,
    join(process.env.HOME ?? "", "Library", "Android", "sdk", "platform-tools", "adb"),
    "adb",
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of candidates) {
    const result = spawnSync(candidate, ["version"], { encoding: "utf8" });
    if (result.status === 0) {
      return candidate;
    }
  }

  fail("Could not find adb. Set ADB_PATH or install Android SDK Platform Tools.");
}

function listDevices(): string[] {
  const output = adbExec(["devices"]);

  return output
    .split("\n")
    .slice(1)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => line.endsWith("\tdevice"))
    .map((line) => line.split(/\s+/)[0]);
}

function getForegroundApp(deviceId: string): { packageName: string | null; activity: string | null } {
  const output = adbExec(["-s", deviceId, "shell", "dumpsys", "window"]);
  const focusLine =
    output
      .split("\n")
      .find((line) => line.includes("mCurrentFocus") || line.includes("mFocusedApp")) ?? "";
  const component = focusLine.match(/([a-zA-Z0-9_.]+)\/([a-zA-Z0-9_.$]+)/);

  return {
    packageName: component?.[1] ?? null,
    activity: component?.[2] ?? null,
  };
}

function listBlinkitCandidatePackages(deviceId: string): string[] {
  const output = adbExec(["-s", deviceId, "shell", "pm", "list", "packages"]);
  const packageNames = output
    .split("\n")
    .map((line) => line.replace(/^package:/, "").trim())
    .filter(Boolean);

  return packageNames.filter((packageName) =>
    /(blinkit|grofers|locodel|zomato)/i.test(packageName),
  );
}

type InvoiceCandidate = {
  path: string;
  fileName: string;
  sizeBytes: number;
  modifiedAt: string;
};

type AndroidFileCandidate = {
  path: string;
  fileName: string;
  sizeBytes: number;
  modifiedAt: string;
};

type DownloadProviderCandidate = {
  contentUri: string;
  displayName: string;
  mimeType: string | null;
  path: string | null;
  raw: Record<string, string>;
};

function listInvoiceCandidates(deviceId: string): InvoiceCandidate[] {
  return listAndroidFiles(deviceId, {
    maxDepth: 6,
    minutes: 24 * 60 * 14,
    nameExpression: "\\( -iname '*.pdf' -o -iname '*invoice*' -o -iname '*receipt*' -o -iname '*bill*' \\)",
  }).filter(isLikelyInvoiceFile);
}

function listRecentFiles(deviceId: string): AndroidFileCandidate[] {
  return listAndroidFiles(deviceId, {
    maxDepth: 6,
    minutes: Number(process.env.BLINKIT_RECENT_MINUTES ?? 60),
    nameExpression: "",
  });
}

function listAndroidFiles(
  deviceId: string,
  options: { maxDepth: number; minutes: number; nameExpression: string },
): AndroidFileCandidate[] {
  const candidates: AndroidFileCandidate[] = [];

  for (const directory of ANDROID_SEARCH_DIRS) {
    const nameFilter = options.nameExpression ? ` ${options.nameExpression}` : "";
    const command = `find ${shellQuote(directory)} -maxdepth ${options.maxDepth} -type f -mmin -${options.minutes}${nameFilter} -printf '%T@|%s|%p\\n' 2>/dev/null`;
    const result = adbTryExecText(["-s", deviceId, "shell", "sh", "-c", command]);

    if (!result.ok) {
      continue;
    }

    candidates.push(...parseFindRows(result.stdout));
  }

  return dedupeFiles(candidates).sort((a, b) => Date.parse(b.modifiedAt) - Date.parse(a.modifiedAt));
}

function parseFindRows(output: string): AndroidFileCandidate[] {
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      const [modifiedEpoch, size, path] = line.split("|");
      if (!path) {
        return [];
      }

      return [
        {
          path,
          fileName: path.split("/").pop() ?? "downloaded-file",
          sizeBytes: Number(size) || 0,
          modifiedAt: new Date(Number(modifiedEpoch) * 1000).toISOString(),
        },
      ];
    });
}

function isLikelyInvoiceFile(file: AndroidFileCandidate): file is InvoiceCandidate {
  return /\.pdf$/i.test(file.fileName) || /(invoice|receipt|bill)/i.test(file.fileName);
}

function dedupeFiles<T extends AndroidFileCandidate>(invoices: T[]): T[] {
  const seen = new Set<string>();

  return invoices.filter((invoice) => {
    if (seen.has(invoice.path)) {
      return false;
    }

    seen.add(invoice.path);
    return true;
  });
}

function writeInvoiceManifest(invoices: InvoiceCandidate[]) {
  writeFileManifest("invoice-candidates.json", invoices);
}

function writeFileManifest(fileName: string, files: AndroidFileCandidate[]) {
  writeFileSync(join(artifactDir, fileName), `${JSON.stringify(files, null, 2)}\n`);
}

function pullInvoices(deviceId: string, invoices: InvoiceCandidate[]): string[] {
  const invoiceDir = join(artifactDir, "invoices");
  mkdirSync(invoiceDir, { recursive: true });

  return invoices.map((invoice, index) => {
    const localName = `${String(index + 1).padStart(2, "0")}-${sanitizeFileName(invoice.fileName)}`;
    const localPath = join(invoiceDir, localName);
    adbExec(["-s", deviceId, "pull", invoice.path, localPath]);

    if (index === 0) {
      copyFileSync(localPath, join(artifactDir, "latest-invoice.pdf"));
    }

    return localPath;
  });
}

function listDownloadProviderCandidates(deviceId: string): DownloadProviderCandidate[] {
  const downloads: DownloadProviderCandidate[] = [];

  for (const uri of ANDROID_DOWNLOAD_PROVIDER_URIS) {
    const result = adbTryExecText(["-s", deviceId, "shell", "content", "query", "--uri", uri]);

    if (!result.ok) {
      continue;
    }

    downloads.push(...parseDownloadProviderRows(uri, result.stdout));
  }

  return dedupeDownloads(downloads);
}

function parseDownloadProviderRows(baseUri: string, output: string): DownloadProviderCandidate[] {
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("Row:"))
    .flatMap((line) => {
      const raw = parseContentRow(line);
      const id = raw._id;

      if (!id) {
        return [];
      }

      const displayName =
        raw._display_name ??
        raw.title ??
        raw.name ??
        raw.description ??
        raw.hint?.split("/").pop() ??
        `download-${id}`;
      const mimeType = raw.mime_type ?? raw.mimetype ?? null;
      const path = raw.local_filename ?? raw._data ?? normalizeFileUri(raw.uri) ?? normalizeFileUri(raw.hint);

      return [
        {
          contentUri: `${baseUri}/${id}`,
          displayName,
          mimeType,
          path,
          raw,
        },
      ];
    });
}

function parseContentRow(line: string): Record<string, string> {
  const withoutPrefix = line.replace(/^Row:\s*\d+\s*/, "");
  const values: Record<string, string> = {};

  for (const part of withoutPrefix.split(/,\s(?=[A-Za-z0-9_.$-]+=)/)) {
    const separator = part.indexOf("=");
    if (separator === -1) {
      continue;
    }

    values[part.slice(0, separator)] = part.slice(separator + 1);
  }

  return values;
}

function normalizeFileUri(value: string | undefined): string | null {
  if (!value?.startsWith("file://")) {
    return null;
  }

  return decodeURIComponent(value.replace(/^file:\/\//, ""));
}

function dedupeDownloads(downloads: DownloadProviderCandidate[]): DownloadProviderCandidate[] {
  const seen = new Set<string>();

  return downloads.filter((download) => {
    const key = download.path ?? download.contentUri;
    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function isLikelyInvoiceDownload(download: DownloadProviderCandidate): boolean {
  return (
    download.mimeType === "application/pdf" ||
    /\.pdf$/i.test(download.displayName) ||
    /(invoice|receipt|bill)/i.test(download.displayName)
  );
}

function writeDownloadManifest(downloads: DownloadProviderCandidate[]) {
  writeFileSync(join(artifactDir, "download-provider-candidates.json"), `${JSON.stringify(downloads, null, 2)}\n`);
}

function pullDownloadProviderFiles(deviceId: string, downloads: DownloadProviderCandidate[]): string[] {
  const invoiceDir = join(artifactDir, "invoices");
  mkdirSync(invoiceDir, { recursive: true });

  return downloads.map((download, index) => {
    const localName = `${String(index + 1).padStart(2, "0")}-${sanitizeFileName(ensurePdfExtension(download.displayName))}`;
    const localPath = join(invoiceDir, localName);

    if (download.path && adbTryExecText(["-s", deviceId, "shell", "test", "-f", download.path]).ok) {
      adbExec(["-s", deviceId, "pull", download.path, localPath]);
    } else {
      const content = adbTryExecBuffer(["-s", deviceId, "shell", "content", "read", "--uri", download.contentUri]);

      if (!content.ok || content.stdout.length === 0) {
        fail(`Unable to pull ${download.displayName} from ${download.path ?? download.contentUri}`);
      }

      writeFileSync(localPath, content.stdout);
    }

    if (index === 0) {
      copyFileSync(localPath, join(artifactDir, "latest-invoice.pdf"));
    }

    return localPath;
  });
}

function ensurePdfExtension(value: string): string {
  return /\.pdf$/i.test(value) ? value : `${value}.pdf`;
}

function sanitizeFileName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function captureScreenshot(deviceId: string): string {
  const screenshot = captureScreenshotBuffer(deviceId);
  const timestamp = timestampForFile();
  const path = join(artifactDir, `${timestamp}.png`);
  writeFileSync(path, screenshot);
  writeFileSync(join(artifactDir, "latest.png"), screenshot);
  return path;
}

function captureScreenshotBuffer(deviceId: string): Buffer {
  const directCapture = adbTryExecBuffer(["-s", deviceId, "exec-out", "screencap", "-p"]);

  if (directCapture.ok && directCapture.stdout.length > 0) {
    return directCapture.stdout;
  }

  adbExec(["-s", deviceId, "shell", "screencap", "-p", "/sdcard/freshloop-screen.png"]);
  const fileCapture = adbTryExecBuffer(["-s", deviceId, "exec-out", "cat", "/sdcard/freshloop-screen.png"]);

  if (fileCapture.ok && fileCapture.stdout.length > 0) {
    return fileCapture.stdout;
  }

  fail(
    [
      "Unable to capture emulator screenshot.",
      getCaptureError("Direct capture", directCapture),
      getCaptureError("File capture", fileCapture),
    ]
      .filter(Boolean)
      .join("\n"),
  );
}

function getCaptureError(
  label: string,
  result: { ok: true; stdout: Buffer } | { ok: false; stdout: Buffer; error: string },
): string | null {
  return result.ok ? null : `${label} error: ${result.error}`;
}

function dumpUi(deviceId: string): string {
  adbExec(["-s", deviceId, "shell", "uiautomator", "dump", "/sdcard/freshloop-window.xml"]);
  const xml = adbExec(["-s", deviceId, "exec-out", "cat", "/sdcard/freshloop-window.xml"]);
  const timestamp = timestampForFile();
  const path = join(artifactDir, `${timestamp}.xml`);
  writeFileSync(path, xml);
  writeFileSync(join(artifactDir, "latest.xml"), xml);
  return path;
}

function extractUiDiagnostics(
  uiPath: string,
  metadata: {
    deviceId: string;
    foreground: { packageName: string | null; activity: string | null };
    candidatePackages: string[];
  },
): { textPath: string; summaryPath: string } {
  const xml = readTextFile(uiPath);
  const nodes = Array.from(xml.matchAll(/<node\b[^>]*>/g)).map((match) => match[0]);
  const nodeDiagnostics = nodes.map((node) => ({
    text: decodeXmlAttribute(extractAttribute(node, "text")),
    contentDescription: decodeXmlAttribute(extractAttribute(node, "content-desc")),
    resourceId: decodeXmlAttribute(extractAttribute(node, "resource-id")),
    className: decodeXmlAttribute(extractAttribute(node, "class")),
    bounds: decodeXmlAttribute(extractAttribute(node, "bounds")),
    clickable: decodeXmlAttribute(extractAttribute(node, "clickable")),
  }));
  const visibleNodes = nodeDiagnostics.filter(
    (node) => node.text.length > 0 || node.contentDescription.length > 0,
  );
  const resourceIds = Array.from(new Set(nodeDiagnostics.map((node) => node.resourceId).filter(Boolean))).sort();
  const classNames = Array.from(new Set(nodeDiagnostics.map((node) => node.className).filter(Boolean))).sort();
  const textPath = join(artifactDir, "latest-text.json");
  const summaryPath = join(artifactDir, "latest-summary.json");

  writeFileSync(textPath, `${JSON.stringify(visibleNodes, null, 2)}\n`);
  writeFileSync(
    summaryPath,
    `${JSON.stringify(
      {
        capturedAt: new Date().toISOString(),
        deviceId: metadata.deviceId,
        foreground: metadata.foreground,
        blinkitLikePackages: metadata.candidatePackages,
        nodeCount: nodeDiagnostics.length,
        visibleTextOrDescriptionCount: visibleNodes.length,
        resourceIds,
        classNames,
        guidance:
          visibleNodes.length === 0
            ? "Android UI hierarchy exposed no text or content descriptions. If the screenshot shows order text, use OCR or investigate app network/session data next."
            : "Use latest-text.json to build selectors or parsers for the visible order detail screen.",
      },
      null,
      2,
    )}\n`,
  );

  return { textPath, summaryPath };
}

function extractAttribute(node: string, attributeName: string): string {
  return node.match(new RegExp(`${attributeName}="([^"]*)"`))?.[1] ?? "";
}

function decodeXmlAttribute(value: string): string {
  return value
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function readTextFile(path: string): string {
  return readFileSync(path, "utf8");
}

function adbExec(args: string[]): string {
  const result = adbTryExecText(args);

  if (!result.ok) {
    fail(result.error);
  }

  return result.stdout;
}

function adbTryExecText(args: string[]): { ok: true; stdout: string } | { ok: false; stdout: string; error: string } {
  const result = spawnSync(adb, args, { encoding: "utf8", maxBuffer: ADB_MAX_BUFFER_BYTES });

  if (result.status !== 0 || result.error) {
    return {
      ok: false,
      stdout: result.stdout,
      error: formatAdbError(args, result.stderr, result.error),
    };
  }

  return { ok: true, stdout: result.stdout };
}

function adbTryExecBuffer(args: string[]): { ok: true; stdout: Buffer } | { ok: false; stdout: Buffer; error: string } {
  const result = spawnSync(adb, args, { maxBuffer: ADB_MAX_BUFFER_BYTES });

  if (result.status !== 0 || result.error) {
    return {
      ok: false,
      stdout: result.stdout,
      error: formatAdbError(args, result.stderr?.toString(), result.error),
    };
  }

  return { ok: true, stdout: result.stdout };
}

function formatAdbError(args: string[], stderr?: string, error?: Error): string {
  const details = [stderr?.trim(), error?.message].filter(Boolean).join("\n");
  return details ? `adb ${args.join(" ")} failed\n${details}` : `adb ${args.join(" ")} failed`;
}

function ensureArtifactDir() {
  mkdirSync(artifactDir, { recursive: true });
}

function timestampForFile(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}
