# 🛍️ Shopify UTMS Orders Dashboard

لوحة تحكم جوّا شوبيفاي لعرض الأوردرات، المنتجات، وبيانات UTM.

---

## 🚀 خطوات التشغيل على Railway

### الخطوة 1: جهّز الـ Token
1. روح Shopify Admin → Settings → Apps → Develop apps
2. Create an app → Configure API scopes → فعّل `read_orders, read_customers, read_products`
3. Install app → انسخ الـ `Admin API access token`

### الخطوة 2: ارفع على GitHub
```bash
git init
git add .
git commit -m "first commit"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/shopify-utms-app.git
git push -u origin main
```

### الخطوة 3: Deploy على Railway
1. روح railway.app وسجّل بحساب GitHub
2. New Project → Deploy from GitHub repo
3. اختار الـ repo بتاعك
4. من Settings → Variables أضف:
   - `SHOP_NAME` = اسم الستور بتاعك (بدون .myshopify.com)
   - `ACCESS_TOKEN` = التوكن اللي نسخته
5. من Settings → Networking → Generate Domain

### الخطوة 4: ربط الـ App بشوبيفاي
1. روح Shopify Partners → تطبيقك
2. App setup → App URL = رابط Railway بتاعك
3. Allowed redirection URLs = نفس الرابط + `/auth/callback`
4. Save

### الخطوة 5: Build الـ Frontend
Railway هيعمل `npm run build` أوتوماتيك عند الـ deploy.

---

## 📁 هيكل المشروع
```
shopify-utms-app/
├── web/
│   ├── index.js          ← Express server
│   ├── package.json
│   └── frontend/
│       ├── src/
│       │   ├── App.jsx   ← الواجهة الرئيسية
│       │   └── main.jsx
│       ├── index.html
│       └── package.json
├── package.json
├── Procfile
└── .env.example
```

---

## 🎨 الـ Tabs في الـ App
- **📊 ملخص**: كروت إحصائيات + أكتر المنتجات مبيعاً + مصادر UTM بالـ progress bars
- **📦 الأوردرات**: جدول كل أوردرات النهارده
- **🛍️ المنتجات**: ترتيب المنتجات حسب المبيعات
- **🔗 UTM**: تفاصيل UTM لكل أوردر
