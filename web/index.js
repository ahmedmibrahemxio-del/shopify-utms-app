import express from "express";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import fetch from "node-fetch";

dotenv.config();

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Serve React frontend build
app.use(express.static(join(__dirname, "frontend/dist")));

// =============================================
// API: Get Today's Orders
// =============================================
app.get("/api/orders", async (req, res) => {
  const shop  = req.query.shop  || process.env.SHOP_NAME;
  const token = process.env.ACCESS_TOKEN;

  if (!shop || !token) {
    return res.status(400).json({ error: "Missing shop or token" });
  }

  try {
    // Date range — default to today
    // نحول التاريخ لـ UTC عشان نجيب كل أوردرات اليوم بغض النظر عن الـ Timezone
    const TIMEZONE_OFFSET = parseInt(process.env.TIMEZONE_OFFSET || "2"); // Cairo = +2
    const today   = new Date();
    const dateStr = today.toISOString().split("T")[0];

    const fromStr = req.query.date_from || dateStr;
    const toStr   = req.query.date_to   || dateStr;

    // بداية اليوم بتوقيت القاهرة → UTC
    const minDate = new Date(`${fromStr}T00:00:00`);
    minDate.setHours(minDate.getHours() - TIMEZONE_OFFSET);

    // نهاية اليوم بتوقيت القاهرة → UTC
    const maxDate = new Date(`${toStr}T23:59:59`);
    maxDate.setHours(maxDate.getHours() - TIMEZONE_OFFSET);

    let allOrders = [];
    let url = `https://${shop}.myshopify.com/admin/api/2024-01/orders.json`
            + `?status=any&limit=250`
            + `&created_at_min=${encodeURIComponent(minDate.toISOString())}`
            + `&created_at_max=${encodeURIComponent(maxDate.toISOString())}`
            + `&fields=id,created_at,line_items,note_attributes,landing_site,total_price,financial_status,customer,shipping_address`;

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

      // Pagination
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

    // Sort newest first
    allOrders.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    // Process orders
    const processed = allOrders.map(order => ({
      id:       order.id,
      shortId:  "#" + String(order.id).slice(-8),
      date:     order.created_at,
      status:   order.financial_status,
      total:    parseFloat(order.total_price || 0),
      customer: order.customer
        ? `${order.customer.first_name || ""} ${order.customer.last_name || ""}`.trim()
        : "—",
      city:     order.shipping_address?.city    || "—",
      country:  order.shipping_address?.country || "—",
      products: (order.line_items || []).map(i => ({
        title:    i.title,
        quantity: i.quantity,
        price:    parseFloat(i.price)
      })),
      utm: extractUTM(order)
    }));

    // Stats
    const totalRevenue  = processed.reduce((s, o) => s + o.total, 0);
    const paidOrders    = processed.filter(o => o.status === "paid").length;

    // Product counts
    const productMap = {};
    processed.forEach(order => {
      order.products.forEach(p => {
        if (!productMap[p.title]) productMap[p.title] = { units: 0, revenue: 0 };
        productMap[p.title].units   += p.quantity;
        productMap[p.title].revenue += p.price * p.quantity;
      });
    });
    const products = Object.entries(productMap)
      .map(([name, data]) => ({ name, ...data }))
      .sort((a, b) => b.units - a.units);

    // UTM summary
    const utmMap = {}, camMap = {};
    processed.forEach(order => {
      const src = order.utm.source   || "(غير محدد)";
      const cam = order.utm.campaign || "(غير محدد)";
      utmMap[src] = (utmMap[src] || 0) + 1;
      camMap[cam] = (camMap[cam] || 0) + 1;
    });
    const utmSources = Object.entries(utmMap)
      .map(([source, count]) => ({ source, count }))
      .sort((a, b) => b.count - a.count);
    const utmCampaigns = Object.entries(camMap)
      .map(([campaign, count]) => ({ campaign, count }))
      .sort((a, b) => b.count - a.count);

    res.json({
      date:         `${req.query.date_from || dateStr} → ${req.query.date_to || dateStr}`,
      dateFrom:     req.query.date_from || dateStr,
      dateTo:       req.query.date_to   || dateStr,
      totalOrders:  processed.length,
      totalRevenue: totalRevenue.toFixed(2),
      paidOrders,
      orders:       processed,
      products,
      utmSources,
      utmCampaigns
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// =============================================
// Helper: Extract UTM
// =============================================
function extractUTM(order) {
  const utm = { source: "", medium: "", campaign: "", content: "", term: "" };

  // From note_attributes
  for (const attr of (order.note_attributes || [])) {
    const name = (attr.name || "").toLowerCase();
    const val  = attr.value || "";
    if (name === "utm_source")   utm.source   = val;
    if (name === "utm_medium")   utm.medium   = val;
    if (name === "utm_campaign") utm.campaign = val;
    if (name === "utm_content")  utm.content  = val;
    if (name === "utm_term")     utm.term     = val;
  }

  // From landing_site URL
  if (!utm.source && order.landing_site) {
    const landing = order.landing_site;
    const getParam = (url, param) => {
      const match = url.match(new RegExp(`[?&]${param}=([^&]*)`));
      return match ? decodeURIComponent(match[1]) : "";
    };
    utm.source   = getParam(landing, "utm_source");
    utm.medium   = getParam(landing, "utm_medium");
    utm.campaign = getParam(landing, "utm_campaign");
    utm.content  = getParam(landing, "utm_content");
    utm.term     = getParam(landing, "utm_term");
  }

  return utm;
}

// Fallback to React app
app.get("*", (req, res) => {
  res.sendFile(join(__dirname, "frontend/dist/index.html"));
});

app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});