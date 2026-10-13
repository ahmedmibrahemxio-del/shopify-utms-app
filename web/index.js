import express from "express";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import fetch from "node-fetch";

dotenv.config();

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

let cachedToken = null;
let tokenExpiresAt = 0;

async function getShopifyAccessToken(shop) {
  const now = Date.now();

  if (cachedToken && now < tokenExpiresAt - 5 * 60 * 1000) {
    return cachedToken;
  }

  const response = await fetch(
    `https://${shop}.myshopify.com/admin/oauth/access_token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "client_credentials",
        client_id: process.env.SHOPIFY_CLIENT_ID,
        client_secret: process.env.SHOPIFY_CLIENT_SECRET
      })
    }
  );

  const data = await response.json();

  if (!response.ok) {
    throw new Error(JSON.stringify(data));
  }

  cachedToken = data.access_token;
  tokenExpiresAt = Date.now() + ((data.expires_in || 86400) * 1000);

  return cachedToken;
}

function safeDecode(value = "") {
  try {
    return decodeURIComponent(String(value).replace(/\+/g, " "));
  } catch {
    return String(value).replace(/\+/g, " ");
  }
}

app.use(express.json());

// Enforce Shopify embedded session authentication for all order data.
async function verifyShopifySession(req, res, next) {
  const authorization = req.get("authorization") || "";
  const match = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/.exec(authorization);
  const reject = (code, status = 401) => {
    // Log a reason code only. Never log JWTs, headers, secrets, or order data.
    console.warn("[shopify-auth]", code);
    if (status === 401) {
      // Shopify App Bridge can request a fresh short-lived ID token and retry.
      res.set("X-Shopify-Retry-Invalid-Session-Request", "1");
    }
    return res.status(status).json({
      error: status === 503
        ? "إعدادات توثيق Shopify غير مكتملة على Render."
        : "تعذر التحقق من جلسة Shopify. افتح التطبيق من داخل Shopify Admin وحاول تاني.",
      code
    });
  };

  if (!match) return reject("AUTH_MISSING_OR_MALFORMED_TOKEN");
  const secret = process.env.SHOPIFY_CLIENT_SECRET;
  const apiKey = process.env.SHOPIFY_CLIENT_ID;
  const shopConfig = (process.env.SHOP_NAME || "").trim();
  const expectedShop = shopConfig
    .replace(/^https?:\/\//i, "")
    .replace(/\.myshopify\.com(?:\/.*)?$/i, "")
    .replace(/\/.*$/, "")
    .toLowerCase();
  if (!secret || !apiKey || !/^[a-z0-9][a-z0-9-]*$/.test(expectedShop)) {
    return reject("AUTH_CONFIGURATION_MISSING", 503);
  }

  try {
    const parts = match[1].split(".");
    const decode = part => JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
    const header = decode(parts[0]);
    if (header?.alg !== "HS256") return reject("AUTH_UNSUPPORTED_ALGORITHM");
    const payload = decode(parts[1]);
    const now = Math.floor(Date.now() / 1000);
    if (!Number.isFinite(payload.exp) || payload.exp <= now) {
      return reject("AUTH_TOKEN_EXPIRED");
    }
    if (payload.nbf !== undefined &&
        (!Number.isFinite(payload.nbf) || payload.nbf > now + 30)) {
      return reject("AUTH_TOKEN_NOT_YET_VALID");
    }
    if (payload.iat !== undefined &&
        (!Number.isFinite(payload.iat) || payload.iat > now + 30)) {
      return reject("AUTH_INVALID_ISSUED_AT");
    }
    if (payload.aud !== apiKey) return reject("AUTH_CLIENT_ID_MISMATCH");

    // Shopify's specification requires issuer/destination HOSTNAMES to match,
    // not a specific issuer URL path or trailing slash.
    let issuer, destination;
    try {
      issuer = new URL(payload.iss);
      destination = new URL(payload.dest);
    } catch {
      return reject("AUTH_INVALID_SHOP_URL");
    }
    if (issuer.protocol !== "https:" || destination.protocol !== "https:" ||
        issuer.username || issuer.password || destination.username || destination.password ||
        issuer.hostname.toLowerCase() !== destination.hostname.toLowerCase()) {
      return reject("AUTH_ISSUER_DESTINATION_MISMATCH");
    }
    if (destination.hostname.toLowerCase() !== expectedShop + ".myshopify.com") {
      return reject("AUTH_SHOP_MISMATCH");
    }
    // Exchange the ID token for a short-lived online token; Shopify verifies authenticity.
    const exchange = await fetch("https://" + expectedShop + ".myshopify.com/admin/oauth/access_token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: apiKey,
        client_secret: secret,
        grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
        subject_token: match[1],
        subject_token_type: "urn:ietf:params:oauth:token-type:id_token",
        requested_token_type: "urn:shopify:params:oauth:token-type:online-access-token"
      }),
      signal: AbortSignal.timeout(12000)
    });
    if (!exchange.ok) {
      return reject(
        exchange.status === 400 ? "AUTH_SHOPIFY_TOKEN_REJECTED" :
        (exchange.status === 401 || exchange.status === 403) ?
          "AUTH_SHOPIFY_CREDENTIALS_REJECTED" : "AUTH_SHOPIFY_EXCHANGE_FAILED",
        exchange.status === 400 ? 401 : 502
      );
    }
    const credentials = await exchange.json();
    if (!credentials || typeof credentials.access_token !== "string" || !credentials.access_token) {
      return reject("AUTH_SHOPIFY_EMPTY_ACCESS_TOKEN", 502);
    }
    req.shop = expectedShop;
    req.shopifyToken = credentials.access_token;
    next();
  } catch {
    return reject("AUTH_TOKEN_DECODE_FAILED");
  }
}

app.get("/", (req, res) => {
  const apiKey = process.env.SHOPIFY_CLIENT_ID || "";
  const html = `<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="shopify-api-key" content="${apiKey.replace(/[^a-zA-Z0-9_-]/g, "")}">
<title>UTM Track — Shopify Dashboard</title>
<script src="https://cdn.shopify.com/shopifycloud/app-bridge.js"></script>
<link rel="stylesheet" href="/dashboard.css"></head>
<body><div id="root"></div><script src="/dashboard.js" defer></script></body></html>`;
  res.type("html").send(html);
});
app.use(express.static(join(__dirname, "frontend/dist")));

app.get("/api/orders", verifyShopifySession, async (req, res) => {
  const shop = req.shop;

  if (!shop) {
    return res.status(400).json({ error: "Missing shop" });
  }

  try {
    const token = req.shopifyToken;

    const TIMEZONE_OFFSET = process.env.TIMEZONE_OFFSET || "+03:00";
    const today = new Date();
    const dateStr = today.toLocaleDateString("en-CA", {
      timeZone: "Africa/Cairo"
    });

    const fromStr = req.query.date_from || dateStr;
    const toStr = req.query.date_to || dateStr;
    const valid = s => /^\d{4}-\d{2}-\d{2}$/.test(s) &&
      !Number.isNaN(Date.parse(s + "T00:00:00Z")) &&
      new Date(s + "T00:00:00Z").toISOString().slice(0, 10) === s;
    if (!valid(fromStr) || !valid(toStr) || fromStr > toStr) {
      return res.status(400).json({ error: "نطاق التاريخ غير صحيح." });
    }
    const days = Math.round((Date.parse(toStr) - Date.parse(fromStr)) / 86400000) + 1;
    if (days > 366) return res.status(400).json({ error: "أقصى مدة للبحث سنة واحدة." });

    const minDate = `${fromStr}T00:00:00${TIMEZONE_OFFSET}`;
    const maxDate = `${toStr}T23:59:59${TIMEZONE_OFFSET}`;

    let allOrders = [];
    let url =
      `https://${shop}.myshopify.com/admin/api/2024-01/orders.json` +
      `?status=any&limit=250` +
      `&created_at_min=${encodeURIComponent(minDate)}` +
      `&created_at_max=${encodeURIComponent(maxDate)}` +
      `&fields=id,name,order_number,created_at,line_items,note_attributes,landing_site,total_price,financial_status,customer,shipping_address`;

    while (url) {
      const response = await fetch(url, {
        headers: { "X-Shopify-Access-Token": token }
      });

      if (!response.ok) {
        const errText = await response.text();
        return res.status(response.status).json({ error: errText });
      }

      const data = await response.json();
      allOrders = allOrders.concat(data.orders || []);

      const linkHeader = response.headers.get("Link") || "";
      url = null;

      if (linkHeader.includes('rel="next"')) {
        const parts = linkHeader.split(",");
        for (const part of parts) {
          if (part.includes('rel="next"')) {
            url = part.split(";")[0].trim().replace(/[<>]/g, "");
            break;
          }
        }
      }
    }

    allOrders.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    const processed = allOrders.map(order => ({
      id: order.id,
      shortId: order.name || (order.order_number ? "#" + order.order_number : "#" + String(order.id).slice(-8)),
      date: order.created_at,
      status: order.financial_status,
      total: parseFloat(order.total_price || 0),
      customer: order.customer
        ? `${order.customer.first_name || ""} ${order.customer.last_name || ""}`.trim()
        : "—",
      city: order.shipping_address?.city || "—",
      country: order.shipping_address?.country || "—",
      products: (order.line_items || []).map((i, index) => ({
        key: i.product_id != null ? `product:${i.product_id}` :
          i.variant_id != null ? `variant:${i.variant_id}` :
          `line:${i.id ?? `${order.id}:${index}`}`,
        title: i.title,
        quantity: i.quantity,
        price: parseFloat(i.price)
      })),
      utm: extractUTM(order)
    }));

    const totalRevenue = processed.reduce((s, o) => s + o.total, 0);
    const paidOrders = processed.filter(o => o.status === "paid").length;
    const paidOrderValue = processed.filter(o => o.status === "paid").reduce((sum, o) => sum + o.total, 0);
    const trackedOrders = processed.filter(o => Object.values(o.utm).some(Boolean)).length;

    const productMap = new Map();
    processed.forEach(order => {
      order.products.forEach(p => {
        const product = productMap.get(p.key) || { key: p.key, name: p.title, units: 0, revenue: 0 };
        product.units += p.quantity;
        product.revenue += p.price * p.quantity;
        productMap.set(p.key, product);
      });
    });

    const products = [...productMap.values()]
      .sort((a, b) => b.units - a.units);

    const utmMap = {};
    const camMap = {};

    processed.forEach(order => {
      const src = order.utm.source || "(غير محدد)";
      const cam = order.utm.campaign || "(غير محدد)";
      utmMap[src] = (utmMap[src] || 0) + 1;
      camMap[cam] = (camMap[cam] || 0) + 1;
    });

    res.json({
      date: `${fromStr} → ${toStr}`,
      dateFrom: fromStr,
      dateTo: toStr,
      totalOrders: processed.length,
      totalRevenue: totalRevenue.toFixed(2),
      paidOrders,
      paidOrderValue: paidOrderValue.toFixed(2),
      utmCoverage: { tracked: trackedOrders, total: processed.length },
      orders: processed,
      products,
      utmSources: Object.entries(utmMap)
        .map(([source, count]) => ({ source, count }))
        .sort((a, b) => b.count - a.count),
      utmCampaigns: Object.entries(camMap)
        .map(([campaign, count]) => ({ campaign, count }))
        .sort((a, b) => b.count - a.count)
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

function extractUTM(order) {
  const utm = { source: "", medium: "", campaign: "", content: "", term: "" };

  for (const attr of order.note_attributes || []) {
    const name = (attr.name || "").toLowerCase();
    const val = safeDecode(attr.value || "");

    if (name === "utm_source") utm.source = val;
    if (name === "utm_medium") utm.medium = val;
    if (name === "utm_campaign") utm.campaign = val;
    if (name === "utm_content") utm.content = val;
    if (name === "utm_term") utm.term = val;
  }

  if (order.landing_site) {
    const landing = order.landing_site;

    const getParam = (url, param) => {
      const match = url.match(new RegExp(`[?&]${param}=([^&]*)`));
      return match ? safeDecode(match[1]) : "";
    };

    utm.source = utm.source || getParam(landing, "utm_source");
    utm.medium = utm.medium || getParam(landing, "utm_medium");
    utm.campaign = utm.campaign || getParam(landing, "utm_campaign");
    utm.content = utm.content || getParam(landing, "utm_content");
    utm.term = utm.term || getParam(landing, "utm_term");
  }

  return utm;
}

app.use((req, res) => {
  if (req.path.startsWith("/api/")) return res.status(404).json({ error: "Endpoint غير موجود." });
  res.redirect("/");
});

app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
