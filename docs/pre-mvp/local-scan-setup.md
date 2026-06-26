# Local Scan Setup

CatalogWise now has a small Node backend for the pre-MVP scan flow.

## What It Does

1. Serves the landing page from `landing/`.
2. Accepts a Shopify store URL at `POST /api/scan`.
3. Tries to read up to 2 public products from:

```text
https://store-domain.com/products.json?limit=2
```

4. Sends the extracted product data to Gemini if `AI_PROVIDER=gemini` and `GEMINI_API_KEY` are configured.
5. Can still use OpenAI if `AI_PROVIDER=openai` and `OPENAI_API_KEY` are configured.
6. Falls back to local rule-based report generation if no AI key exists or AI fails.
6. Returns a compact report for the popup:

- health score
- short summary
- top 3 opportunities
- before/after suggestion
- bulk cleanup opportunity
- sampled product names

## Score And Summary Logic

If Gemini is enabled, Gemini returns the sample opportunity score and summary from the sampled public product data.

If Gemini is not enabled or fails, the local fallback estimates the sample opportunity score like this:

```text
64 - (missing image alt text count * 3) - (short description count * 6)
```

The app caps the visible score at `55` because this is a limited public sample scan, not a full store health grade. The fallback score cannot go below `38` when products are found. If no products are readable, it returns a demo fallback score of `55`.

## Run Locally

```bash
npm run dev
```

Then open:

```text
http://localhost:3000
```

## Enable Gemini AI

Create a `.env` file from `.env.example`:

```bash
cp .env.example .env
```

Add:

```text
AI_PROVIDER=gemini
GEMINI_API_KEY=your_gemini_key_here
GEMINI_MODEL=gemini-3.1-flash-lite
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4o-mini
PORT=3000
ADMIN_TOKEN=change-this-before-deploying
SCAN_LIMIT_PER_IP_PER_DAY=5
SCAN_LIMIT_PER_STORE_PER_DAY=2
GOOGLE_SHEETS_WEBHOOK_URL=
```

Restart the server after editing `.env`.

Get a Gemini API key from:

```text
https://aistudio.google.com/app/apikey
```

For the pre-MVP, keep `GEMINI_MODEL=gemini-3.1-flash-lite` unless we have a reason to use a bigger model.

## View Responses Later

When a visitor saves their response in the popup, the server appends it to:

```text
data/submissions.csv
```

You can view submissions in the browser:

```text
http://localhost:3000/admin/submissions
```

If you set a real `ADMIN_TOKEN` in `.env`, use:

```text
http://localhost:3000/admin/submissions?token=your_admin_token
```

The admin page also has a CSV download link.

To send submissions into Google Sheets too, follow:

```text
docs/pre-mvp/google-sheets-setup.md
```

## Budget Protection

Current protections:

- Only 1-2 products are scanned per store.
- AI output is capped with `max_tokens`.
- Scan results are cached per store URL for 24 hours.
- Each IP can only scan `SCAN_LIMIT_PER_IP_PER_DAY` times per day.
- Each store URL can only be scanned `SCAN_LIMIT_PER_STORE_PER_DAY` times per day.
- If Gemini is not configured or fails, local rule-based fallback runs instead.

Recommended pre-MVP settings:

```text
SCAN_LIMIT_PER_IP_PER_DAY=3
SCAN_LIMIT_PER_STORE_PER_DAY=1
```

## Current Limits

- This is a pre-MVP scanner, not a full Shopify app.
- It only uses public product data.
- Some Shopify stores block or hide `/products.json`.
- It scans only 1-2 products for now to keep cost, free-tier usage, and latency low.
- It does not update Shopify products.
- Bulk updates are described as the future paid feature.

## Next Functionality Upgrade

The next step is to replace the email-based feedback capture with a real form submission endpoint that stores:

- store URL
- generated report
- willingness to pay answer
- most important feature answer
- timestamp

For a fast version, store submissions in a local CSV or Google Sheet.
