import { createServer } from "node:http";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";

const rootDir = resolve(".");
const landingDir = join(rootDir, "landing");
const dataDir = join(rootDir, "data");
const submissionsPath = join(dataDir, "submissions.csv");
const scanCachePath = join(dataDir, "scan-cache.json");
loadLocalEnv();
const port = Number(process.env.PORT || 3000);
const scanLimitPerIpPerDay = Number(process.env.SCAN_LIMIT_PER_IP_PER_DAY || 5);
const scanLimitPerStorePerDay = Number(process.env.SCAN_LIMIT_PER_STORE_PER_DAY || 2);
const scanCacheVersion = 3;
const scanAttempts = new Map();
const scanCache = loadScanCache();

function loadLocalEnv() {
  const envPath = join(rootDir, ".env");
  if (!existsSync(envPath)) return {};

  return readFileSync(envPath, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .reduce((acc, line) => {
      const separatorIndex = line.indexOf("=");
      if (separatorIndex === -1) return acc;
      const key = line.slice(0, separatorIndex).trim();
      const value = line.slice(separatorIndex + 1).trim().replace(/^"|"$/g, "");
      acc[key] = value;
      if (!process.env[key]) process.env[key] = value;
      return acc;
    }, {});
}

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml"
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === "POST" && url.pathname === "/api/scan") {
      await handleScan(req, res);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/feedback") {
      await handleFeedback(req, res);
      return;
    }

    if (req.method === "GET" && url.pathname === "/admin/submissions") {
      await handleSubmissionsAdmin(url, res);
      return;
    }

    if (req.method === "GET" && url.pathname === "/submissions.csv") {
      await handleSubmissionsCsv(url, res);
      return;
    }

    if (req.method !== "GET") {
      sendJson(res, 405, { error: "Method not allowed" });
      return;
    }

    await serveStatic(url.pathname, res);
  } catch (error) {
    console.error(error);
    sendJson(res, 500, { error: "Something went wrong" });
  }
});

server.listen(port, () => {
  console.log(`CatalogueWise running at http://localhost:${port}`);
});

async function handleScan(req, res) {
  const body = await readJsonBody(req);
  const storeUrl = normalizeStoreUrl(body.storeUrl);

  if (!storeUrl) {
    sendJson(res, 400, { error: "Enter a valid Shopify store URL." });
    return;
  }

  const cached = getCachedScan(storeUrl);
  if (cached) {
    sendJson(res, 200, { ...cached, cached: true });
    return;
  }

  const clientIp = getClientIp(req);
  const limitResult = checkScanLimit({ clientIp, storeUrl });
  if (!limitResult.allowed) {
    sendJson(res, 429, {
      error: limitResult.message,
      retryAfter: limitResult.retryAfter
    });
    return;
  }

  const products = await fetchStoreProducts(storeUrl);
  const report = await generateReport({ storeUrl, products });
  setCachedScan(storeUrl, report);
  sendJson(res, 200, report);
}

async function handleFeedback(req, res) {
  const body = await readJsonBody(req);
  const storeUrl = normalizeStoreUrl(body.storeUrl);

  if (!storeUrl) {
    sendJson(res, 400, { error: "Store URL is required." });
    return;
  }

  const wouldPay = String(body.wouldPay || "").trim();
  const mostImportantFeature = String(body.mostImportantFeature || "").trim();

  if (!wouldPay || !mostImportantFeature) {
    sendJson(res, 400, {
      error: "Payment interest and preferred feature are required."
    });
    return;
  }

  const submission = {
    createdAt: new Date().toISOString(),
    ip: getClientIp(req),
    storeUrl,
    wouldPay,
    mostImportantFeature,
    source: String(body.source || "").trim(),
    healthScore: String(body.healthScore || "").trim(),
    summary: String(body.summary || "").trim()
  };

  const sheetsResult = await saveSubmission(submission);
  sendJson(res, 200, { ok: true, sheets: sheetsResult });
}

async function handleSubmissionsAdmin(url, res) {
  const adminToken = process.env.ADMIN_TOKEN;

  if (adminToken && adminToken !== "change-this-before-deploying") {
    const token = url.searchParams.get("token");
    if (token !== adminToken) {
      res.writeHead(401, { "content-type": "text/html; charset=utf-8" });
      res.end("<h1>Unauthorized</h1>");
      return;
    }
  }

  let csv = "No submissions yet.";
  try {
    csv = await readFile(submissionsPath, "utf8");
  } catch {
    // Empty state is fine for a fresh pre-MVP.
  }

  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(renderSubmissionsPage(csv));
}

async function handleSubmissionsCsv(url, res) {
  const adminToken = process.env.ADMIN_TOKEN;

  if (adminToken && adminToken !== "change-this-before-deploying") {
    const token = url.searchParams.get("token");
    if (token !== adminToken) {
      sendJson(res, 401, { error: "Unauthorized" });
      return;
    }
  }

  try {
    const csv = await readFile(submissionsPath, "utf8");
    res.writeHead(200, {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": "attachment; filename=\"cataloguewise-submissions.csv\""
    });
    res.end(csv);
  } catch {
    res.writeHead(200, {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": "attachment; filename=\"cataloguewise-submissions.csv\""
    });
    res.end("createdAt,ip,storeUrl,wouldPay,mostImportantFeature,source,healthScore,summary\n");
  }
}

async function serveStatic(pathname, res) {
  const requestedPath = pathname === "/" ? "/index.html" : pathname;
  const filePath = normalize(join(landingDir, requestedPath));

  if (!filePath.startsWith(landingDir)) {
    sendJson(res, 403, { error: "Forbidden" });
    return;
  }

  try {
    const content = await readFile(filePath);
    const contentType = mimeTypes[extname(filePath)] || "application/octet-stream";
    res.writeHead(200, { "content-type": contentType });
    res.end(content);
  } catch {
    sendJson(res, 404, { error: "Not found" });
  }
}

async function readJsonBody(req) {
  let rawBody = "";
  for await (const chunk of req) rawBody += chunk;
  if (!rawBody) return {};
  return JSON.parse(rawBody);
}

function getClientIp(req) {
  const forwardedFor = req.headers["x-forwarded-for"];
  if (typeof forwardedFor === "string" && forwardedFor.trim()) {
    return forwardedFor.split(",")[0].trim();
  }
  return req.socket.remoteAddress || "unknown";
}

function checkScanLimit({ clientIp, storeUrl }) {
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  const ipKey = `ip:${clientIp}`;
  const storeKey = `store:${storeUrl}`;
  const ipAttempts = pruneAttempts(scanAttempts.get(ipKey) || [], now, dayMs);
  const storeAttempts = pruneAttempts(scanAttempts.get(storeKey) || [], now, dayMs);

  if (ipAttempts.length >= scanLimitPerIpPerDay) {
    return {
      allowed: false,
      message: "Daily preview scan limit reached for this device.",
      retryAfter: secondsUntilReset(ipAttempts[0], now, dayMs)
    };
  }

  if (storeAttempts.length >= scanLimitPerStorePerDay) {
    return {
      allowed: false,
      message: "Daily preview scan limit reached for this store URL.",
      retryAfter: secondsUntilReset(storeAttempts[0], now, dayMs)
    };
  }

  ipAttempts.push(now);
  storeAttempts.push(now);
  scanAttempts.set(ipKey, ipAttempts);
  scanAttempts.set(storeKey, storeAttempts);

  return { allowed: true };
}

function pruneAttempts(attempts, now, windowMs) {
  return attempts.filter((attemptTime) => now - attemptTime < windowMs);
}

function secondsUntilReset(firstAttempt, now, windowMs) {
  return Math.max(1, Math.ceil((windowMs - (now - firstAttempt)) / 1000));
}

function getCachedScan(storeUrl) {
  const cached = scanCache.get(storeUrl);
  if (!cached) return null;

  const cacheTtlMs = 24 * 60 * 60 * 1000;
  if (cached.version !== scanCacheVersion || Date.now() - cached.createdAt > cacheTtlMs) {
    scanCache.delete(storeUrl);
    return null;
  }

  return cached.report;
}

function setCachedScan(storeUrl, report) {
  scanCache.set(storeUrl, {
    version: scanCacheVersion,
    createdAt: Date.now(),
    report
  });
  persistScanCache();
}

function loadScanCache() {
  try {
    const rawCache = readFileSync(scanCachePath, "utf8");
    const entries = Object.entries(JSON.parse(rawCache));
    return new Map(entries);
  } catch {
    return new Map();
  }
}

async function persistScanCache() {
  try {
    await mkdir(dataDir, { recursive: true });
    await writeFile(scanCachePath, JSON.stringify(Object.fromEntries(scanCache), null, 2));
  } catch (error) {
    console.error("Could not persist scan cache:", error.message);
  }
}

function normalizeStoreUrl(input) {
  if (!input || typeof input !== "string") return null;

  const withProtocol = /^https?:\/\//i.test(input.trim())
    ? input.trim()
    : `https://${input.trim()}`;

  try {
    const parsed = new URL(withProtocol);
    if (!parsed.hostname.includes(".")) return null;
    parsed.hash = "";
    parsed.search = "";
    return parsed.origin;
  } catch {
    return null;
  }
}

async function fetchStoreProducts(storeUrl) {
  const productsUrl = new URL("/products.json", storeUrl);
  productsUrl.searchParams.set("limit", "2");

  try {
    const response = await fetch(productsUrl, {
      headers: {
        "accept": "application/json",
        "user-agent": "CatalogueWise pre-MVP scanner"
      },
      signal: AbortSignal.timeout(8000)
    });

    if (!response.ok) throw new Error(`Products endpoint returned ${response.status}`);

    const data = await response.json();
    const products = Array.isArray(data.products) ? data.products : [];
    return products.slice(0, 2).map((product) => ({
      title: product.title || "Untitled product",
      handle: product.handle || "",
      url: product.handle ? `${storeUrl}/products/${product.handle}` : storeUrl,
      description: stripHtml(product.body_html || "").slice(0, 1200),
      vendor: product.vendor || "",
      productType: product.product_type || "",
      tags: Array.isArray(product.tags) ? product.tags : String(product.tags || "").split(","),
      images: Array.isArray(product.images)
        ? product.images.slice(0, 3).map((image) => ({
            alt: image.alt || "",
            src: image.src || ""
          }))
        : [],
      variants: Array.isArray(product.variants)
        ? product.variants.slice(0, 8).map((variant) => ({
            title: variant.title || "",
            sku: variant.sku || "",
            option1: variant.option1 || "",
            option2: variant.option2 || "",
            option3: variant.option3 || ""
          }))
        : []
    }));
  } catch (error) {
    return [];
  }
}

async function generateReport({ storeUrl, products }) {
  if (products.length > 0) {
    try {
      const provider = (process.env.AI_PROVIDER || "gemini").toLowerCase();

      if (provider === "gemini" && process.env.GEMINI_API_KEY) {
        return await generateGeminiReport({ storeUrl, products });
      }

      if (provider === "openai" && process.env.OPENAI_API_KEY) {
        return await generateOpenAiReport({ storeUrl, products });
      }
    } catch (error) {
      console.error("AI report failed, using fallback:", error.message);
    }
  }

  return generateFallbackReport({ storeUrl, products });
}

function buildAiPrompt({ storeUrl, products }) {
  return {
    storeUrl,
    products,
    instructions: [
      "Create a compact pre-MVP Shopify catalogue health preview.",
      "Audit only the provided public product data.",
      "Return strict JSON only.",
      "Do not promise SEO ranking improvement.",
      "Focus on fashion/apparel catalogue issues when relevant.",
      "Keep the report short and useful.",
      "Do not claim access to Shopify admin, internal tags, private SEO fields, inventory, sales, or customer data.",
      "Do not invent facts that are not visible in the provided product data.",
      "Do not use hype, exaggerated claims, medical claims, or guaranteed revenue language.",
      "Make suggestions practical for a small ecommerce merchant.",
      "Mention bulk editing only as a future full-app capability that requires merchant approval before publishing.",
      "Use plain language a non-technical store owner can understand.",
      "Use short, simple sentences.",
      "Do not use em dashes.",
      "Prefer periods and commas over complex punctuation.",
      "Avoid jargon unless it is a common ecommerce term like SEO, meta description, or alt text.",
      "Optimize product descriptions only.",
      "Do not rewrite product titles in this preview.",
      "Current and optimized examples must compare descriptions, not titles.",
      "Optimized descriptions must be concise, clear, straightforward, and descriptive enough to help a shopper understand the product.",
      "Keep optimized descriptions to 2 or 3 short sentences.",
      "Avoid generic filler words.",
      "Avoid emojis."
    ],
    schema: {
      healthScore: "number from 1 to 55. This is a sample opportunity score, not a store health guarantee.",
      summary: "one sentence",
      opportunities: ["three short issue strings"],
      beforeAfterExamples: [
        {
          product: "product name",
          current: "current product description",
          optimized: "optimized product description"
        }
      ],
      beforeAfter: {
        product: "product name",
        current: "current product description",
        optimized: "optimized product description"
      },
      bulkOpportunity: "one sentence about bulk scanning and approved updates"
    }
  };
}

async function generateGeminiReport({ storeUrl, products }) {
  const prompt = buildAiPrompt({ storeUrl, products });
  const model = process.env.GEMINI_MODEL || "gemini-3.1-flash-lite";
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    model
  )}:generateContent?key=${encodeURIComponent(process.env.GEMINI_API_KEY)}`;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [
            {
              text: [
                "You are an ecommerce catalogue quality analyst.",
                "Produce concise Shopify product content, SEO, and conversion clarity feedback.",
                "Return strict JSON only.",
                JSON.stringify(prompt)
              ].join("\n")
            }
          ]
        }
      ],
      generationConfig: {
        temperature: 0.4,
        maxOutputTokens: 720,
        responseMimeType: "application/json"
      }
    }),
    signal: AbortSignal.timeout(12000)
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Gemini returned ${response.status}: ${errorBody}`);
  }

  const data = await response.json();
  const content = data.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
  const parsed = JSON.parse(content);

  return normalizeReport({
    storeUrl,
    products,
    source: "gemini",
    ...parsed
  });
}

async function generateOpenAiReport({ storeUrl, products }) {
  const prompt = buildAiPrompt({ storeUrl, products });

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${process.env.OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      temperature: 0.4,
      max_tokens: 720,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You are an ecommerce catalogue quality analyst. You produce concise Shopify product content, SEO, and conversion clarity feedback."
        },
        {
          role: "user",
          content: JSON.stringify(prompt)
        }
      ]
    }),
    signal: AbortSignal.timeout(12000)
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`OpenAI returned ${response.status}: ${errorBody}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || "{}";
  const parsed = JSON.parse(content);

  return normalizeReport({
    storeUrl,
    products,
    source: "openai",
    ...parsed
  });
}

async function saveSubmission(submission) {
  await mkdir(dataDir, { recursive: true });

  if (!existsSync(submissionsPath)) {
    await appendFile(
      submissionsPath,
      "createdAt,ip,storeUrl,wouldPay,mostImportantFeature,source,healthScore,summary\n"
    );
  }

  await appendFile(
    submissionsPath,
    [
      submission.createdAt,
      submission.ip,
      submission.storeUrl,
      submission.wouldPay,
      submission.mostImportantFeature,
      submission.source,
      submission.healthScore,
      submission.summary
    ]
      .map(csvEscape)
      .join(",") + "\n"
  );

  return sendSubmissionToGoogleSheets(submission);
}

async function sendSubmissionToGoogleSheets(submission) {
  const webhookUrl = process.env.GOOGLE_SHEETS_WEBHOOK_URL;

  if (!webhookUrl) {
    return { enabled: false };
  }

  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify(submission),
      signal: AbortSignal.timeout(8000)
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Google Sheets webhook returned ${response.status}: ${errorBody}`);
    }

    return { enabled: true, ok: true };
  } catch (error) {
    console.error("Google Sheets sync failed:", error.message);
    return { enabled: true, ok: false, error: error.message };
  }
}

function csvEscape(value) {
  const text = String(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}

function renderSubmissionsPage(csv) {
  const rows = parseCsv(csv);
  const [headers, ...records] = rows;
  const tableRows = records
    .map(
      (record) =>
        `<tr>${headers
          .map((_, index) => `<td>${escapeHtml(record[index] || "")}</td>`)
          .join("")}</tr>`
    )
    .join("");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>CatalogueWise Submissions</title>
    <style>
      body { margin: 0; padding: 24px; font-family: system-ui, sans-serif; color: #121716; background: #f5f8f6; }
      h1 { margin-top: 0; }
      table { width: 100%; border-collapse: collapse; background: #fff; }
      th, td { padding: 10px; border: 1px solid #dfe8e3; text-align: left; vertical-align: top; font-size: 14px; }
      th { background: #ddf7e8; }
      .empty { padding: 18px; border: 1px solid #dfe8e3; background: #fff; }
      .download { display: inline-block; margin-bottom: 16px; color: #0e5d38; font-weight: 700; }
    </style>
  </head>
  <body>
    <h1>CatalogueWise Submissions</h1>
    <a class="download" href="${process.env.ADMIN_TOKEN && process.env.ADMIN_TOKEN !== "change-this-before-deploying" ? `/submissions.csv?token=${encodeURIComponent(process.env.ADMIN_TOKEN)}` : "/submissions.csv"}">Download CSV</a>
    ${
      records.length
        ? `<table><thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead><tbody>${tableRows}</tbody></table>`
        : `<div class="empty">No submissions yet.</div>`
    }
  </body>
</html>`;
}

function parseCsv(csv) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let index = 0; index < csv.length; index += 1) {
    const char = csv[index];
    const next = csv[index + 1];

    if (char === '"' && inQuotes && next === '"') {
      field += '"';
      index += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      row.push(field);
      field = "";
    } else if (char === "\n" && !inQuotes) {
      row.push(field);
      if (row.some((cell) => cell.length)) rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }

  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function generateFallbackReport({ storeUrl, products }) {
  const product = products[0] || {
    title: "Sample product",
    description: "Short product description.",
    images: []
  };
  const missingAltCount = products.reduce(
    (count, item) => count + item.images.filter((image) => !image.alt).length,
    0
  );
  const shortDescriptions = products.filter((item) => (item.description || "").length < 180).length;
  const healthScore = products.length ? Math.min(55, Math.max(38, 64 - missingAltCount * 3 - shortDescriptions * 6)) : 55;
  const beforeAfterExamples = (products.length ? products : [product]).slice(0, 2).map((item) => ({
    product: item.title,
    current: buildCurrentDescriptionSample(item),
    optimized: buildOptimizedDescriptionSuggestion(item)
  }));

  return normalizeReport({
    storeUrl,
    products,
    source: products.length ? "local-rules" : "demo-fallback",
    healthScore,
    summary: products.length
      ? `CatalogueWise reviewed ${products.length} public product page${products.length > 1 ? "s" : ""} and found visible catalogue issues.`
      : "CatalogueWise could not read public Shopify product data from this URL, so this is a sample preview of the report format.",
    opportunities: [
      shortDescriptions > 0
        ? "Some product descriptions are short and could include fit, material, care, and buyer-use details."
        : "Product descriptions can be strengthened with clearer buyer benefits and product-specific details.",
      missingAltCount > 0
        ? "Several product images appear to be missing descriptive alt text."
        : "Image alt text should be checked across the full catalogue for accessibility and SEO context.",
      "SEO meta descriptions can be generated in bulk and reviewed before publishing."
    ],
    beforeAfterExamples,
    beforeAfter: beforeAfterExamples[0],
    bulkOpportunity:
      "The full app will scan every product, group issues by priority, generate fixes, and let you approve bulk updates before publishing."
  });
}

function normalizeReport(report) {
  const products = Array.isArray(report.products) ? report.products : [];
  const opportunities = Array.isArray(report.opportunities)
    ? report.opportunities.slice(0, 3)
    : [];

  while (opportunities.length < 3) {
    opportunities.push("Review product content for clearer buyer details and stronger search snippets.");
  }

  const beforeAfterExamples = normalizeBeforeAfterExamples(report, products);

  return {
    storeUrl: report.storeUrl,
    scannedProducts: products.map((product) => ({
      title: product.title,
      url: product.url
    })),
    source: report.source || "unknown",
    healthScore: clampNumber(report.healthScore, 1, 55, 55),
    summary: String(report.summary || "CatalogueWise found visible catalogue cleanup opportunities."),
    opportunities,
    beforeAfterExamples,
    beforeAfter: beforeAfterExamples[0],
    bulkOpportunity:
      report.bulkOpportunity ||
      "The full app will scan the entire catalogue, group issues by priority, and preview approved updates in bulk."
  };
}

function normalizeBeforeAfterExamples(report, products) {
  const sourceExamples = Array.isArray(report.beforeAfterExamples)
    ? report.beforeAfterExamples
    : report.beforeAfter
      ? [report.beforeAfter]
      : [];

  const examples = sourceExamples.slice(0, 2).map((example, index) => {
    const product = products[index] || example;
    const productName = String(product.title || example.product || `Sample product ${index + 1}`);

    return {
      product: productName,
      current: sanitizeDescriptionCandidate(example.current || buildCurrentDescriptionSample(product)),
      optimized: sanitizeDescriptionCandidate(example.optimized || buildOptimizedDescriptionSuggestion(product))
    };
  });

  return examples;
}

function stripHtml(html) {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function compactText(text, maxLength) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (clean.length <= maxLength) return clean;
  return `${clean.slice(0, maxLength - 3)}...`;
}

function buildCurrentDescriptionSample(product) {
  return compactText(
    product.description ||
      `${product.title || "This product"} is listed with limited public description details.`,
    240
  );
}

function buildOptimizedDescriptionSuggestion(product) {
  const title = product.title || "Product";
  const type = product.productType || "fashion item";
  const vendor = product.vendor ? ` from ${product.vendor}` : "";
  const description = product.description || "";
  const materialHint = findMaterialHint(description);
  const materialCopy = materialHint ? ` with ${materialHint}` : "";

  return compactText(
    `${title} is a ${type}${vendor}${materialCopy}. It gives shoppers a clearer view of the style, fit, and everyday use before they buy.`,
    260
  );
}

function sanitizeDescriptionCandidate(value) {
  const text = String(value || "")
    .replace(/^optimized description:\s*/i, "")
    .replace(/^description:\s*/i, "")
    .replace(/—/g, ",")
    .replace(/\s+/g, " ")
    .trim();

  return compactText(text || "Clear product description preview unavailable.", 260);
}

function findMaterialHint(text) {
  const match = String(text || "").match(/\b(cotton|linen|silk|wool|denim|leather|suede|polyester|nylon|spandex|elastane|viscose|rayon|jersey|fleece)\b/i);
  return match ? match[0].toLowerCase() : "";
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.round(number)));
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}
