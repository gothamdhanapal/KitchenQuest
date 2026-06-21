# Blinkit emulator connector

Blinkit does not appear to send order-detail emails, so FreshLoop needs a local connector for Blinkit.
This connector starts with a safe, local-only workflow:

1. Run Blinkit in an Android emulator.
2. Navigate manually to order history or a specific order detail screen.
3. Capture the screen and Android UI hierarchy.
4. Extract visible text into JSON so we can build reliable order parsing before automating navigation.

The connector does not make purchases, bypass login, or call private Blinkit APIs.

## Prerequisites

- Android Studio emulator running.
- Blinkit installed and logged in inside the emulator.
- ADB available at `~/Library/Android/sdk/platform-tools/adb` or through `ANDROID_HOME`.

## Commands

Check emulator/package state:

```bash
npm run blinkit:diagnose
```

Launch the detected Blinkit app package:

```bash
npm run blinkit:open
```

Capture the current emulator screen and UI text:

```bash
npm run blinkit:capture
```

Only dump the current Android UI hierarchy:

```bash
npm run blinkit:dump-ui
```

List downloaded invoice PDFs in common Android download folders:

```bash
npm run blinkit:list-invoices
```

Pull downloaded invoice PDFs into local artifacts:

```bash
npm run blinkit:pull-invoices
```

List recently changed files in Android shared/app storage:

```bash
npm run blinkit:recent-files
```

List invoice/download records registered with Android's Downloads provider, including Chrome-handled
downloads:

```bash
npm run blinkit:list-downloads
```

Pull invoice-like records from Android's Downloads provider:

```bash
npm run blinkit:pull-downloads
```

Open Chrome's downloads page inside the emulator:

```bash
npm run blinkit:open-chrome-downloads
```

Artifacts are written locally under:

```txt
artifacts/blinkit/
```

Pulled invoice PDFs are written under:

```txt
artifacts/blinkit/invoices/
artifacts/blinkit/latest-invoice.pdf
artifacts/blinkit/invoice-candidates.json
```

The most useful file for the next parser iteration is:

```txt
artifacts/blinkit/latest-text.json
```

If that is empty, inspect:

```txt
artifacts/blinkit/latest-summary.json
```

The summary includes foreground app metadata, UI node counts, resource IDs, and class names. If
`visibleTextOrDescriptionCount` is `0` while `latest.png` clearly shows order details, Android is
not exposing Blinkit's visible text through the UI hierarchy. At that point, continuing to tune
`uiautomator` has low value; the practical next options are OCR from the screenshot or a local
network/session connector.

## How to collect a useful sample

1. Open Blinkit in the emulator, or run `npm run blinkit:open`.
2. Tap **Order Again** or account/order history.
3. Open a delivered order details screen that shows product names, quantities, and prices.
4. Run:

   ```bash
   npm run blinkit:capture
   ```

5. Inspect or share `artifacts/blinkit/latest-text.json` and `artifacts/blinkit/latest-summary.json`.

If `latest-text.json` does not contain the product names/prices, the next step is OCR from
`artifacts/blinkit/latest.png`.

## Invoice workflow

If Blinkit exposes a **Download invoice** action, prefer this over screenshot/OCR:

1. Open a delivered Blinkit order in the emulator.
2. Tap **Download invoice**.
3. Run:

   ```bash
   npm run blinkit:list-invoices
   npm run blinkit:pull-invoices
   ```

4. If no invoices are found, immediately run:

   ```bash
   npm run blinkit:recent-files
   ```

   This writes `artifacts/blinkit/recent-files.json` and helps identify whether Blinkit saved the
   invoice with a different name/extension or in app-specific storage. You can widen the recent
   file window with:

   ```bash
   BLINKIT_RECENT_MINUTES=180 npm run blinkit:recent-files
   ```

5. If the invoice opens in Chrome or appears under Chrome downloads, use the Downloads provider:

   ```bash
   npm run blinkit:open-chrome-downloads
   npm run blinkit:list-downloads
   npm run blinkit:pull-downloads
   ```

   The filesystem search also checks Chrome app-specific external folders such as
   `/sdcard/Android/data/com.android.chrome`.

6. Open the latest pulled invoice:

   ```bash
   open artifacts/blinkit/latest-invoice.pdf
   ```

The invoice PDF should contain structured order details, line items, prices, timestamps, and
address information. This is a better source for FreshLoop ingestion than UI screenshots.
