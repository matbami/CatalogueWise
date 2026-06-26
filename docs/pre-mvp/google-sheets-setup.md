# Google Sheets Submission Setup

Use this to send CatalogueWise form submissions into Google Sheets.

## 1. Create The Sheet

Create a Google Sheet with one tab named:

```text
Submissions
```

The script below will create the `Submissions` tab and header row automatically if they do not exist.

## 2. Add Apps Script

In the Google Sheet:

1. Click `Extensions`.
2. Click `Apps Script`.
3. Delete any starter code.
4. Paste this:

```javascript
const SHEET_NAME = "Submissions";
const HEADERS = [
  "createdAt",
  "ip",
  "storeUrl",
  "email",
  "wouldPay",
  "mostImportantFeature",
  "source",
  "healthScore",
  "summary"
];

function doPost(e) {
  const sheet = getOrCreateSubmissionsSheet();
  const body = JSON.parse(e.postData.contents || "{}");

  sheet.appendRow([
    body.createdAt || new Date().toISOString(),
    body.ip || "",
    body.storeUrl || "",
    body.email || "",
    body.wouldPay || "",
    body.mostImportantFeature || "",
    body.source || "",
    body.healthScore || "",
    body.summary || ""
  ]);

  return ContentService
    .createTextOutput(JSON.stringify({ ok: true }))
    .setMimeType(ContentService.MimeType.JSON);
}

function getOrCreateSubmissionsSheet() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = spreadsheet.getSheetByName(SHEET_NAME);

  if (!sheet) {
    sheet = spreadsheet.insertSheet(SHEET_NAME);
  }

  const firstRow = sheet.getRange(1, 1, 1, HEADERS.length).getValues()[0];
  const hasHeaders = firstRow.some(Boolean);

  if (!hasHeaders) {
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
    sheet.setFrozenRows(1);
  }

  return sheet;
}
```

5. Save the project as `CatalogueWise Submissions`.

## 3. Deploy The Web App

1. Click `Deploy`.
2. Click `New deployment`.
3. Choose `Web app`.
4. Set `Execute as` to `Me`.
5. Set `Who has access` to `Anyone`.
6. Click `Deploy`.
7. Copy the Web app URL.

## 4. Add The URL To CatalogueWise

In `.env`, add:

```text
GOOGLE_SHEETS_WEBHOOK_URL=your_google_apps_script_web_app_url
```

Restart the server:

```bash
npm run dev
```

## 5. Test

1. Scan a Shopify URL.
2. Fill the validation form.
3. Click `Unlock my report and join beta`.
4. Check the Google Sheet.

The app still saves a local CSV copy at:

```text
data/submissions.csv
```

So if Google Sheets fails, you still have a backup.
