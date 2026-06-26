# Pre-MVP Action Checklist

## Decisions Needed From User

- Product name
- First niche confirmation
- Sender name
- Sender email
- Domain choice
- Form destination
- Brand style preference

Recommended defaults:

- Product name: CatalogWise
- Niche: Fashion/apparel Shopify stores
- Domain: Not yet
- Form: mailto link or Tally/Google Form
- Style: Clean SaaS/professional
- Build style: Static HTML/CSS first

## Accounts Needed

Minimum:

- Google account for Sheets, Docs, Drive, and optionally Forms
- Email account for outreach
- Hosting account if deploying the landing page
- Analytics account if tracking visits

Optional but useful:

- Domain registrar account
- Professional domain email
- Tally or Typeform account for audit requests
- Calendly account for calls
- LinkedIn/X account for outreach
- Shopify Partner account, later for real MVP

Not needed yet:

- Shopify public app
- Shopify billing
- Database hosting
- AWS/GCP setup
- Mobile app account

## Assets To Create

- Landing page
- Mock dashboard screenshot
- Mock product issues table
- Mock before/after product fix preview
- Mock bulk optimization preview
- Audit request form
- Audit report template
- Outreach message templates
- Follow-up templates
- Lead tracker spreadsheet
- Feedback/pricing survey questions

## Landing Page Requirements

Sections:

- Hero with clear promise
- Free 10-product audit CTA
- Problem bullets
- Mock product health dashboard
- What the audit checks
- Example before/after fix
- How it works
- CTA repeated near bottom
- Lightweight credibility note

Primary CTA:

> Get my free 10-product audit

Secondary CTA:

> See sample audit

## Manual Audit Workflow

1. Receive store URL and contact email.
2. Pick 10 public product pages.
3. Record product title, URL, description quality, image quality, visible SEO issues, and notes.
4. Use AI assistance to draft improved titles/descriptions/meta examples.
5. Put findings into the audit report template.
6. Send report to merchant.
7. Ask pricing and beta interest questions.
8. Record response in tracker.

## Outreach Workflow

Daily target:

- 20 personalized messages per day
- 5 days
- 100 total stores

Channels:

- Store contact form
- Public email from website
- Instagram DM
- LinkedIn
- X/Twitter
- Ecommerce communities
- Shopify agencies

Message angle:

Do not lead with AI. Lead with the free audit and visible product-page improvements.

## Cost Expectation

Lean setup:

- $0-$20

More polished setup:

- $20-$80

Possible costs:

- Domain: $10-$20/year
- Professional email: $0-$6/month
- Landing page hosting/tool: $0-$19/month
- AI usage: $0-$20 for initial audits
- Google Sheets/Forms: $0
- Canva/Docs: $0
- Analytics: $0

## Immediate Next Build

Once the user confirms or accepts placeholder defaults:

1. Build static landing page.
2. Create mock UI screenshots in HTML/CSS.
3. Add audit request CTA.
4. Add sample audit page or downloadable sample.
5. Create outreach and tracker templates.
6. Run locally and provide URL/file path.

## Today's Priority Order

1. Choose temporary product name, recommended: CatalogWise.
2. Confirm first niche, recommended: fashion/apparel Shopify stores.
3. Choose form destination: Tally, Google Form, Formspree, or mailto.
4. Build the landing page with mock dashboard sections.
5. Create the audit report template.
6. Create the lead tracker template.
7. Create the first outreach scripts as reusable files.
8. Start collecting the first 20 Shopify store leads.

## Functionality Added

- Static page converted into a local Node-powered scan flow.
- `/api/scan` accepts a Shopify store URL.
- The backend tries to read 1-2 public products from `/products.json`.
- If `AI_PROVIDER=gemini` and `GEMINI_API_KEY` exist, Gemini generates the compact report.
- If `AI_PROVIDER=openai` and `OPENAI_API_KEY` exist, OpenAI can generate the compact report.
- If no key exists or AI fails, local rule-based fallback generates the report.
- The popup now shows dynamic report content instead of fixed static content.
- Visitor feedback is saved to `data/submissions.csv`.
- Submissions can be viewed at `/admin/submissions`.
- Basic scan rate limits and 24-hour scan caching protect API spend.
