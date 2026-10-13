import express from "express";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import fetch from "node-fetch";
import { randomBytes, pbkdf2Sync, timingSafeEqual, createHash } from "node:crypto";

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

// Private dashboard authentication, independent of Shopify App Bridge sessions.
const sessions = new Map();
const attempts = new Map();
const SESSION_MS = 8 * 60 * 60 * 1000;
const hashToken = token => createHash("sha256").update(token).digest("hex");
app.disable("x-powered-by");
app.use((req, res, next) => {
  if (req.path.startsWith("/api/")) res.set("Cache-Control", "no-store");
  next();
});
app.post("/api/login", (req, res) => {
  const ip = req.ip || "unknown";
  const now = Date.now();
  const existing = attempts.get(ip);
  if (existing && existing.until > now && existing.count >= 5) {
    return res.status(429).json({ error: "محاولات كتير. جرّب بعد 15 دقيقة." });
  }
  const config = process.env.DASHBOARD_PASSWORD_HASH || "";
  const [salt, expected] = config.split(":");
  if (!salt || !expected || !/^[a-f0-9]{32}$/i.test(salt) || !/^[a-f0-9]{64}$/i.test(expected)) {
    return res.status(503).json({ error: "إعداد كلمة المرور غير مكتمل." });
  }
  const password = req.body?.password;
  if (typeof password !== "string" || password.length > 256) {
    return res.status(400).json({ error: "كلمة المرور غير صحيحة." });
  }
  const actual = pbkdf2Sync(password, Buffer.from(salt, "hex"), 210000, 32, "sha256");
  const correct = timingSafeEqual(actual, Buffer.from(expected, "hex"));
  if (!correct) {
    attempts.set(ip, { count: existing && existing.until > now ? existing.count + 1 : 1, until: now + 900000 });
    return res.status(401).json({ error: "كلمة المرور غير صحيحة." });
  }
  attempts.delete(ip);
  const token = randomBytes(32).toString("base64url");
  sessions.set(hashToken(token), now + SESSION_MS);
  return res.json({ token, expiresIn: SESSION_MS / 1000 });
});
function verifyDashboardSession(req, res, next) {
  const header = req.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const key = token.length >= 32 && token.length <= 256 ? hashToken(token) : "";
  const expiration = sessions.get(key);
  if (!expiration || expiration <= Date.now()) {
    if (expiration) sessions.delete(key);
    return res.status(401).json({ error: "سجّل دخول بكلمة المرور علشان تشوف الأوردرات.", code: "DASHBOARD_LOGIN_REQUIRED" });
  }
  next();
}
app.post("/api/logout", verifyDashboardSession, (req, res) => {
  sessions.delete(hashToken((req.get("authorization") || "").slice(7)));
  res.json({ ok: true });
});
setInterval(() => {
  const now = Date.now();
  for (const [key, expiration] of sessions) if (expiration <= now) sessions.delete(key);
  for (const [key, entry] of attempts) if (entry.until <= now) attempts.delete(key);
}, 10 * 60 * 1000).unref();

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

app.get("/api/orders", verifyDashboardSession, async (req, res) => {
  const shop = (process.env.SHOP_NAME || "").replace(/\\.myshopify\\.com$/i, "");

  if (!shop) {
    return res.status(400).json({ error: "Missing shop" });
  }

  try {
    const token = await getShopifyAccessToken(shop);

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
      const productsInOrder = new Set();
      order.products.forEach(p => {
        const product = productMap.get(p.key) || {
          key: p.key, name: p.title, orders: 0, units: 0, revenue: 0
        };
        if (!productsInOrder.has(p.key)) {
          product.orders += 1;
          productsInOrder.add(p.key);
        }
        product.units += p.quantity;
        product.revenue += p.price * p.quantity;
        productMap.set(p.key, product);
      });
    });

    const products = [...productMap.values()]
      .sort((a, b) => b.orders - a.orders || b.units - a.units);

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
