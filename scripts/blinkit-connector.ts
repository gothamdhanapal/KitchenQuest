import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

type Command = "diagnose" | "capture" | "dump-ui" | "open";

const ADB_MAX_BUFFER_BYTES = 50 * 1024 * 1024;
const BLINKIT_PACKAGE_FALLBACK = "com.grofers.customerapp";

const command = (process.argv[2] ?? "diagnose") as Command;
const artifactDir = resolve(process.cwd(), "artifacts", "blinkit");
const adb = resolveAdbPath();

main();

function main() {
  if (!["diagnose", "capture", "dump-ui", "open"].includes(command)) {
    fail(`Unknown command "${command}". Use diagnose, capture, dump-ui, or open.`);
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
    console.log("2. Run `npm run blinkit:capture`.");
    console.log("3. Share artifacts/blinkit/latest-text.json if the text extraction misses order details.");
    return;
  }

  if (command === "open") {
    const packageName = candidatePackages[0] ?? BLINKIT_PACKAGE_FALLBACK;
    adbExec(["-s", deviceId, "shell", "monkey", "-p", packageName, "-c", "android.intent.category.LAUNCHER", "1"]);
    console.log(`Requested launch for ${packageName}.`);
    return;
  }

  if (command === "capture") {
    const screenshotPath = captureScreenshot(deviceId);
    const uiPath = dumpUi(deviceId);
    const textPath = extractUiText(uiPath);

    console.log("Captured screenshot:", screenshotPath);
    console.log("Captured UI XML:", uiPath);
    console.log("Extracted visible text:", textPath);
    return;
  }

  if (command === "dump-ui") {
    const uiPath = dumpUi(deviceId);
    const textPath = extractUiText(uiPath);

    console.log("Captured UI XML:", uiPath);
    console.log("Extracted visible text:", textPath);
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

function extractUiText(uiPath: string): string {
  const xml = readTextFile(uiPath);
  const nodes = Array.from(xml.matchAll(/<node\b[^>]*>/g)).map((match) => match[0]);
  const textNodes = nodes
    .map((node) => ({
      text: decodeXmlAttribute(extractAttribute(node, "text")),
      resourceId: decodeXmlAttribute(extractAttribute(node, "resource-id")),
      className: decodeXmlAttribute(extractAttribute(node, "class")),
      bounds: decodeXmlAttribute(extractAttribute(node, "bounds")),
    }))
    .filter((node) => node.text.length > 0);
  const path = join(artifactDir, "latest-text.json");
  writeFileSync(path, `${JSON.stringify(textNodes, null, 2)}\n`);
  return path;
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
  const result = spawnSync(adb, args, { encoding: "utf8", maxBuffer: ADB_MAX_BUFFER_BYTES });

  if (result.status !== 0) {
    fail(formatAdbError(args, result.stderr, result.error));
  }

  return result.stdout;
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
