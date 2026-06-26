# CatalogWise Pre-MVP

A lightweight Shopify catalog health scanner used to validate demand before building the full Shopify app.

## Run Locally

```bash
npm run dev
```

Open:

```text
http://localhost:3000
```

## Environment Variables

Copy `.env.example` to `.env` and fill in values:

```text
AI_PROVIDER=gemini
GEMINI_API_KEY=
GEMINI_MODEL=gemini-3.1-flash-lite
PORT=3000
ADMIN_TOKEN=change-this-before-deploying
SCAN_LIMIT_PER_IP_PER_DAY=3
SCAN_LIMIT_PER_STORE_PER_DAY=1
```

## Admin Submissions

Saved responses are written locally to:

```text
data/submissions.csv
```

View submissions:

```text
http://localhost:3000/admin/submissions?token=YOUR_ADMIN_TOKEN
```

To also send submissions to Google Sheets, see:

```text
docs/pre-mvp/google-sheets-setup.md
```

## Deploy

Use a Node hosting platform such as Render or Railway.

Start command:

```bash
npm start
```
