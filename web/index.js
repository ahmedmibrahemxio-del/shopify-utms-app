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
app.use(express.static(join(__dirname, "frontend/dist")));

app.get("/api/orders", async (req, res) => {
  const shop = req.query.shop || process.env.SHOP_NAME;

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

    const minDate = `${fromStr}T00:00:00${TIMEZONE_OFFSET}`;
    const maxDate = `${toStr}T23:59:59${TIMEZONE_OFFSET}`;

    let allOrders = [];
    let url =
      `https://${shop}.myshopify.com/admin/api/2024-01/orders.json` +
      `?status=any&limit=250` +
      `&created_at_min=${encodeURIComponent(minDate)}` +
      `&created_at_max=${encodeURIComponent(maxDate)}` +
      `&fields=id,created_at,line_items,note_attributes,landing_site,total_price,financial_status,customer,shipping_address`;

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
      shortId: "#" + String(order.id).slice(-8),
      date: order.created_at,
      status: order.financial_status,
      total: parseFloat(order.total_price || 0),
      customer: order.customer
        ? `${order.customer.first_name || ""} ${order.customer.last_name || ""}`.trim()
        : "—",
      city: order.shipping_address?.city || "—",
      country: order.shipping_address?.country || "—",
      products: (order.line_items || []).map(i => ({
        title: i.title,
        quantity: i.quantity,
        price: parseFloat(i.price)
      })),
      utm: extractUTM(order)
    }));

    const totalRevenue = processed.reduce((s, o) => s + o.total, 0);
    const paidOrders = processed.filter(o => o.status === "paid").length;

    const productMap = {};
    processed.forEach(order => {
      order.products.forEach(p => {
        if (!productMap[p.title]) productMap[p.title] = { units: 0, revenue: 0 };
        productMap[p.title].units += p.quantity;
        productMap[p.title].revenue += p.price * p.quantity;
      });
    });

    const products = Object.entries(productMap)
      .map(([name, data]) => ({ name, ...data }))
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
  res.sendFile(join(__dirname, "frontend", "dist", "index.html"));
});

app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
