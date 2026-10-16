import express from "express";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

dotenv.config();
const app = express();
const __dirname = dirname(fileURLToPath(import.meta.url));
const port = process.env.PORT || 3000;
const dist = join(__dirname, "frontend", "dist");

app.disable("x-powered-by");
app.use((req, res, next) => {
  res.set("X-Content-Type-Options", "nosniff");
  next();
});

// All merchant data loads inside authenticated Shopify Admin via Direct API.
// Never expose store orders or Admin access tokens from the public Render origin.
app.use("/api", (req, res) => {
  res.set("Cache-Control", "no-store");
  res.status(404).json({ error: "This API is no longer available. Open UTM Track in Shopify Admin." });
});

app.get("/", (req, res) => {
  const key = String(process.env.SHOPIFY_CLIENT_ID || "").replace(/[^a-zA-Z0-9_-]/g, "");
  const shop = String(process.env.SHOP_NAME || "").replace(/^https?:\/\//, "").replace(/\.myshopify\.com.*$/i, "").toLowerCase();
  if (/^[a-z0-9][a-z0-9-]*$/.test(shop)) {
    res.set("Content-Security-Policy",
      "frame-ancestors https://admin.shopify.com https://" + shop + ".myshopify.com");
  }
  res.set("Cache-Control", "no-store");
  res.type("html").send(`<!DOCTYPE html><html lang="ar" dir="rtl"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="shopify-api-key" content="${key}">
<title>UTM Track — Shopify Dashboard</title>
<script src="https://cdn.shopify.com/shopifycloud/app-bridge.js"></script>
<link rel="stylesheet" href="/dashboard.css"></head>
<body><div id="root"></div><script src="/shopify-direct.js"></script><script src="/dashboard.js" defer></script></body></html>`);
});
app.use(express.static(dist));
app.get("*", (req, res) => res.redirect("/"));

app.listen(port, () => console.log("UTM Track frontend listening on " + port));
