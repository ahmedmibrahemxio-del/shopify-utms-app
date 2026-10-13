
(function () {
  "use strict";
  const $ = (selector) => document.querySelector(selector);
  const root = $("#root");
  const state = {
    data: null, busy: false, error: "", view: "overview",
    from: new Date().toISOString().slice(0, 10),
    to: new Date().toISOString().slice(0, 10),
    source: "", campaign: "", product: "", search: "", level: "campaign",
    selectedProduct: null, refreshedAt: null, sessionToken: sessionStorage.getItem("utm_track_session") || "", loginError: "", password: ""
  };
  const labels = {
    overview: "نظرة عامة", campaigns: "أداء الحملات",
    orders: "الأوردرات", products: "المنتجات", utm: "تفاصيل UTM"
  };
  const icon = {
    overview: "◫", campaigns: "◎", orders: "▤", products: "◈", utm: "↗"
  };
  const safe = (value) => String(value == null ? "" : value)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  const num = (n) => new Intl.NumberFormat("en-US", {maximumFractionDigits: 0}).format(Number(n || 0));
  const money = (n) => new Intl.NumberFormat("en-US", {maximumFractionDigits: 2}).format(Number(n || 0)) + " ج.م";
  const pct = (n, d) => d ? Math.round(n / d * 100) + "%" : "0%";
  const value = (text) => text == null || text === "" ? "غير محدد" : String(text);
  const iso = (d) => d.toISOString().split("T")[0];
  const dt = (d) => {
    try { return new Date(d).toLocaleString("ar-EG"); }
    catch { return "—"; }
  };
  const choices = (arr, selected) => arr.map(v => '<option value="' + safe(v) + '"' + (v === selected ? ' selected' : '') + '>' + safe(value(v)) + '</option>').join("");
  function preset(days, yesterday) {
    const end = new Date();
    if (yesterday) end.setDate(end.getDate() - 1);
    const start = new Date(end);
    start.setDate(end.getDate() - days + 1);
    state.from = iso(start);
    state.to = iso(end);
    load();
  }
  function currentOrders() {
    if (!state.data) return [];
    return state.data.orders.filter(o => {
      const u = o.utm || {};
      if (state.source && value(u.source) !== state.source) return false;
      if (state.campaign && value(u.campaign) !== state.campaign) return false;
      if (state.product && !o.products.some(p => p.key === state.product)) return false;
      if (state.search) {
        const term = state.search.toLowerCase();
        const content = [o.shortId, o.customer, o.city, u.source, u.campaign, u.content,
          ...o.products.map(p => p.title)].join(" ").toLowerCase();
        if (!content.includes(term)) return false;
      }
      return true;
    });
  }
  function aggregate(orders, groupBy) {
    const groups = new Map();
    orders.forEach(o => {
      const u = o.utm || {};
      const source = value(u.source), campaign = value(u.campaign), content = value(u.content);
      const key = groupBy === "content" ? JSON.stringify([source, campaign, content]) :
        JSON.stringify([source, campaign]);
      if (!groups.has(key)) groups.set(key, {
        key, source, campaign, content: groupBy === "content" ? content : "—",
        orders: 0, orderValue: 0, paidOrders: 0, units: 0
      });
      const g = groups.get(key);
      g.orders += 1;
      g.orderValue += Number(o.total || 0);
      if (o.status === "paid") g.paidOrders += 1;
      g.units += o.products.reduce((total, p) => total + Number(p.quantity || 0), 0);
    });
    return [...groups.values()].sort((a, b) => b.orders - a.orders || b.orderValue - a.orderValue);
  }
  function metric(title, val, note, glyph, tone) {
    return '<article class="metric"><div class="metric-head"><span class="metric-icon ' + tone + '">' +
      glyph + '</span><span class="metric-title">' + safe(title) + '</span></div>' +
      '<div class="metric-value">' + safe(val) + '</div><div class="metric-note">' +
      safe(note || "") + '</div></article>';
  }
  function empty(message) {
    return '<div class="empty"><div class="empty-symbol">⌕</div><strong>مفيش بيانات للعرض</strong><p>' +
      safe(message || "جرّب تغيير الفلاتر أو الفترة.") + '</p></div>';
  }
  function barRows(entries, total, field) {
    if (!entries.length) return empty("مفيش بيانات للفترة دي.");
    return '<div class="bar-list">' + entries.slice(0, 8).map((e) => {
      const label = e[field], count = e.count, width = Math.max(3, Math.round(count / Math.max(total, 1) * 100));
      return '<div class="bar-item"><div class="bar-info"><span title="' + safe(label) + '">' +
        safe(label) + '</span><b>' + num(count) + ' <small>' + pct(count, total) +
        '</small></b></div><div class="track"><i style="width:' + width + '%"></i></div></div>';
    }).join("") + '</div>';
  }
  function overview() {
    const d = state.data, total = d.totalOrders || 0;
    const coverage = d.utmCoverage || {};
    return '<section class="metric-grid">' +
      metric("إجمالي الأوردرات", num(total), "خلال الفترة المختارة", "▤", "blue") +
      metric("قيمة الطلبات", money(d.totalRevenue), "قيمة الأوردرات وليست التحصيل", "￡", "teal") +
      metric("أوردرات مدفوعة", num(d.paidOrders), pct(d.paidOrders, total) + " من الأوردرات", "✓", "green") +
      metric("UTM Coverage", pct(coverage.tracked, coverage.total), num(coverage.tracked || 0) +
        " أوردر له UTM من " + num(coverage.total || 0), "↗", "purple") +
      '</section><div class="two-panels">' +
      '<section class="panel"><div class="panel-heading"><div><span class="eyebrow">PRODUCT INSIGHTS</span>' +
      '<h2>أكثر المنتجات مبيعًا</h2></div><button class="text-link" data-view="products">كل المنتجات ←</button></div>' +
      (d.products.length ? '<div class="products-compact">' + d.products.slice(0, 7).map((p, i) =>
        '<button class="product-mini" data-product="' + safe(p.key) + '"><span class="product-number">' +
        (i + 1) + '</span><span class="product-name">' + safe(p.name) + '</span><span class="product-qty">' +
        num(p.units) + ' وحدة</span></button>').join("") + '</div>' : empty()) + '</section>' +
      '<section class="panel"><div class="panel-heading"><div><span class="eyebrow">ATTRIBUTION</span><h2>مصادر الزيارات</h2></div></div>' +
      barRows(d.utmSources || [], total, "source") +
      '<div class="panel-separator"></div><div class="panel-heading compact"><h2>الحملات الأعلى</h2>' +
      '<button class="text-link" data-view="campaigns">التفاصيل ←</button></div>' +
      barRows((d.utmCampaigns || []).slice(0, 5), total, "campaign") + '</section></div>';
  }
  function filterBar() {
    const d = state.data;
    const sources = ["", ...new Set(d.orders.map(o => value(o.utm?.source)))].sort((a,b) => a.localeCompare(b));
    const campaigns = ["", ...new Set(d.orders.map(o => value(o.utm?.campaign)))].sort((a,b) => a.localeCompare(b));
    const products = [{key:"",name:"كل المنتجات"},...d.products];
    return '<section class="panel filters"><div class="filter-field"><label for="source">UTM Source</label><select id="source" data-filter="source">' +
      choices(sources, state.source).replace('<option value="">غير محدد</option>','<option value="">كل المصادر</option>') +
      '</select></div><div class="filter-field"><label for="campaign">UTM Campaign</label><select id="campaign" data-filter="campaign">' +
      choices(campaigns, state.campaign).replace('<option value="">غير محدد</option>','<option value="">كل الحملات</option>') +
      '</select></div><div class="filter-field"><label for="product">Product</label><select id="product" data-filter="product">' +
      products.map(p => '<option value="' + safe(p.key) + '"' + (p.key === state.product ? ' selected' : '') +
      '>' + safe(p.name) + '</option>').join("") +
      '</select></div><div class="filter-field search-field"><label for="search">بحث</label>' +
      '<input id="search" data-filter="search" value="' + safe(state.search) + '" placeholder="أوردر، منتج، أو حملة"></div>' +
      '<button class="clear-button" data-action="reset-filters">مسح الفلاتر</button></section>';
  }
  function table(headers, rows, cols) {
    if (!rows.length) return empty("مفيش أوردرات أو حملات مطابقة للفلاتر.");
    return '<div class="table-scroll"><table><thead><tr>' +
      headers.map(h => '<th>' + safe(h) + '</th>').join("") + '</tr></thead><tbody>' +
      rows.map(row => '<tr>' + row.map((cell, i) => '<td' +
        (cols && cols[i] ? ' class="' + cols[i] + '"' : '') + '>' + cell + '</td>').join("") +
      '</tr>').join("") + '</tbody></table></div>';
  }
  function campaigns() {
    const orders = currentOrders(), data = aggregate(orders, state.level);
    const tracked = orders.filter(o => o.utm && (o.utm.source || o.utm.campaign || o.utm.content)).length;
    const revenue = orders.reduce((s, o) => s + Number(o.total || 0), 0);
    const group = state.level === "content";
    const rows = data.map(g => [
      '<b>' + safe(g.campaign) + '</b><div class="sub">' + safe(g.source) + '</div>',
      group ? '<span class="mono">' + safe(g.content) + '</span>' : '<span class="pill muted">جميع الإعلانات</span>',
      '<b>' + num(g.orders) + '</b>',
      money(g.orderValue),
      num(g.paidOrders),
      num(g.units)
    ]);
    return '<div class="section-intro"><div><span class="eyebrow">CAMPAIGN ANALYTICS</span><h2>أداء الحملات من Shopify</h2>' +
      '<p>الأرقام مبنية على الأوردرات وقيمتها المسجلة، بدون Ad Spend أو CPP من Meta وTikTok.</p></div>' +
      '<div class="segmented"><button data-level="campaign" class="' + (!group ? 'active' : '') +
      '">Campaign</button><button data-level="content" class="' + (group ? 'active' : '') +
      '">Content / Ad</button></div></div>' + filterBar() +
      '<section class="metric-grid metric-grid-small">' +
      metric("الأوردرات المطابقة", num(orders.length), "بعد تطبيق الفلاتر", "▤", "blue") +
      metric("قيمة الطلبات", money(revenue), "مش صافي ربح أو تحصيل", "￡", "teal") +
      metric("UTM Coverage", pct(tracked, orders.length), num(tracked) + " أوردر له UTM", "↗", "purple") +
      '</section><section class="panel"><div class="panel-heading"><div><h2>تفصيل ' +
      (group ? 'الإعلانات' : 'الحملات') + '</h2><p>' + num(data.length) + ' صف</p></div>' +
      '<button class="outline-button" data-action="export-campaigns">↓ تصدير CSV</button></div>' +
      table(["UTM Campaign","UTM Content","Orders","Order Value","Paid Orders","Units"], rows,
        ["", "", "number", "number", "number", "number"]) + '</section>';
  }
  function statusText(s) {
    return ({paid:"مدفوع",pending:"معلق",refunded:"مسترد",partially_paid:"مدفوع جزئيًا",
      partially_refunded:"مسترد جزئيًا",voided:"ملغي"})[s] || s || "غير محدد";
  }
  function orderTable(orders, details) {
    const rows = orders.map(o => [
      '<b class="order-number">' + safe(o.shortId) + '</b>',
      '<span class="sub-date">' + safe(dt(o.date)) + '</span>',
      safe(o.customer || "—"),
      '<div class="cell-products">' + safe(o.products.map(p => p.title + " ×" + p.quantity).join(" / ")) + '</div>',
      '<span class="pill ' + (o.status === "paid" ? "success" : "muted") + '">' + safe(statusText(o.status)) + '</span>',
      safe(value(o.utm?.source)),
      safe(value(o.utm?.campaign)),
      money(o.total)
    ]);
    return table(["الأوردر","التاريخ","العميل","المنتجات","الحالة","Source","Campaign","القيمة"],
      rows, ["", "", "", "", "", "", "", "number"]);
  }
  function orders() {
    const filtered = currentOrders();
    return '<div class="section-intro"><div><span class="eyebrow">SHOPIFY ORDERS</span><h2>الأوردرات</h2>' +
      '<p>' + num(filtered.length) + ' أوردر مطابق للفلاتر</p></div></div>' + filterBar() +
      '<section class="panel">' + orderTable(filtered) + '</section>';
  }
  function productCards() {
    const d = state.data, list = state.source || state.campaign || state.search ?
      (() => {
        const m = new Map();
        currentOrders().forEach(o => o.products.forEach(p => {
          const row = m.get(p.key) || {key:p.key,name:p.title,units:0,revenue:0};
          row.units += Number(p.quantity || 0);
          row.revenue += Number(p.quantity || 0) * Number(p.price || 0);
          m.set(p.key, row);
        }));
        return [...m.values()].sort((a,b) => b.units - a.units);
      })() : d.products;
    return '<div class="section-intro"><div><span class="eyebrow">PRODUCT INSIGHTS</span><h2>تحليل المنتجات</h2>' +
      '<p>التجميع باستخدام Product ID لمنع دمج منتجات مختلفة بنفس الاسم.</p></div></div>' +
      '<div class="cards-grid">' + (list.length ? list.map(p =>
        '<button class="product-card" data-product="' + safe(p.key) +
        '"><div class="product-card-head"><span>◈ المنتج</span><span>↗</span></div>' +
        '<strong>' + safe(p.name) + '</strong><div class="product-stats"><span><b>' +
        num(p.units) + '</b> وحدة</span><span><b>' + money(p.revenue) +
        '</b> قيمة الأصناف</span></div></button>').join("") : empty()) + '</div>';
  }
  function utmTable() {
    const filtered = currentOrders();
    const rows = filtered.map(o => [
      '<b class="order-number">' + safe(o.shortId) + '</b>',
      safe(dt(o.date)),
      safe(value(o.utm?.source)), safe(value(o.utm?.medium)),
      safe(value(o.utm?.campaign)), safe(value(o.utm?.content)),
      safe(value(o.utm?.term)), money(o.total)
    ]);
    return '<div class="section-intro"><div><span class="eyebrow">ATTRIBUTION DETAILS</span>' +
      '<h2>تفاصيل UTM</h2><p>Campaign وContent وSource زي ما Shopify سجّلهم لكل أوردر.</p></div></div>' +
      filterBar() + '<section class="panel">' +
      table(["الأوردر","التاريخ","Source","Medium","Campaign","Content","Term","Order Value"],
        rows, ["", "", "", "", "", "", "", "number"]) + '</section>';
  }
  function productModal() {
    if (!state.selectedProduct || !state.data) return "";
    const product = state.data.products.find(p => p.key === state.selectedProduct);
    if (!product) return "";
    const orders = state.data.orders.filter(o => o.products.some(p => p.key === product.key));
    const units = orders.reduce((n,o) => n + o.products.filter(p=>p.key === product.key)
      .reduce((a,p)=>a+Number(p.quantity || 0),0),0);
    const valueSum = orders.reduce((n,o)=>n + o.products.filter(p=>p.key === product.key)
      .reduce((a,p)=>a+Number(p.quantity || 0)*Number(p.price || 0),0),0);
    const grouping = aggregate(orders, "campaign").slice(0, 6);
    return '<div class="modal-backdrop" data-action="close-modal"><section class="modal" role="dialog" aria-modal="true" aria-label="تحليل المنتج">' +
      '<header class="modal-header"><div><span class="eyebrow">PRODUCT DETAILS</span><h2>' +
      safe(product.name) + '</h2></div><button class="close" data-action="close-modal" aria-label="إغلاق">✕</button></header>' +
      '<div class="modal-metrics"><div><span>Orders</span><b>' + num(orders.length) +
      '</b></div><div><span>Units</span><b>' + num(units) +
      '</b></div><div><span>Product Value</span><b>' + money(valueSum) +
      '</b></div></div><h3>UTM Campaigns</h3>' +
      (grouping.length ? '<div class="modal-campaigns">' + grouping.map(g=>
        '<div><span>' + safe(g.campaign) + '<small>' + safe(g.source) +
        '</small></span><b>' + num(g.orders) + ' أوردر</b></div>').join("") + '</div>' : empty()) +
      '<h3>آخر الأوردرات</h3><div class="modal-orders">' + orders.slice(0,20).map(o=>
        '<div><b>' + safe(o.shortId) + '</b><span>' + safe(dt(o.date)) +
        '</span><strong>' + money(o.total) + '</strong></div>').join("") +
      '</div></section></div>';
  }
  function loginPage() {
    return '<div class="login-backdrop"><section class="login-card"><div class="brand-icon">UT</div>' +
      '<h2>تسجيل الدخول إلى UTM Track</h2><p>اكتب كلمة المرور الخاصة بالـDashboard لعرض بيانات الأوردرات.</p>' +
      '<form id="login-form"><label for="dashboard-password">كلمة المرور</label>' +
      '<input id="dashboard-password" type="password" autocomplete="current-password" required />' +
      (state.loginError ? '<div class="inline-error">' + safe(state.loginError) + '</div>' : '') +
      '<button class="primary-button" type="submit" ' + (state.busy ? "disabled" : "") + '>دخول آمن</button></form>' +
      '</section></div>';
  }
  async function login(password) {
    if (state.busy) return;
    state.busy = true;
    state.loginError = "";
    render();
    try {
      const response = await fetch("/api/login", {
        method: "POST",
        headers: {"Content-Type":"application/json","Accept":"application/json"},
        body: JSON.stringify({password}),
        cache: "no-store"
      });
      const result = await response.json();
      if (!response.ok || !result.token) throw new Error(result.error || "تعذر تسجيل الدخول");
      state.sessionToken = result.token;
      sessionStorage.setItem("utm_track_session", result.token);
      state.error = "";
    } catch (err) {
      state.loginError = err.message || "تعذر تسجيل الدخول";
    } finally {
      state.busy = false;
      render();
    }
    if (state.sessionToken) await load();
  }
  function render() {
    if (!root) return;
    let body = "";
    if (!state.data) {
      body = state.error ? '<div class="error-screen"><b>تعذر تحميل البيانات</b><p>' +
        safe(state.error) + '</p><button data-action="retry" class="primary-button">إعادة المحاولة</button></div>' :
        '<div class="loading-screen"><div class="spinner"></div><p>جاري تحميل Dashboard...</p></div>';
    } else {
      body = '<nav class="tabs" aria-label="صفحات Dashboard">' +
        Object.keys(labels).map(k => '<button data-view="' + k + '" class="' +
        (state.view === k ? "active" : "") + '">' + icon[k] + ' ' + labels[k] + '</button>').join("") +
        '</nav><main>' + (state.view === "overview" ? overview() : state.view === "campaigns" ?
        campaigns() : state.view === "orders" ? orders() :
        state.view === "products" ? productCards() : utmTable()) + '</main>' +
        productModal();
    }
    if (!state.sessionToken) { root.innerHTML = loginPage(); return; }
    root.innerHTML = '<div class="app-shell"><header class="topbar">' +
      '<div class="identity"><div class="brand-icon">UT</div><div><h1>UTM Track</h1><span>Shopify Orders Intelligence</span></div></div>' +
      '<div class="header-right"><span class="secure-pill">● متجر موثّق</span><button class="refresh-button" data-action="retry" ' +
      (state.busy ? "disabled" : "") + '>↻ تحديث</button></div></header>' +
      '<div class="body-shell"><div class="page-heading"><div><div class="eyebrow">ORDERS ANALYTICS</div>' +
      '<h2>Dashboard <span>الأوردرات والحملات</span></h2><p>راقب الأوردرات ومصادرها من مكان واحد.</p></div>' +
      '<div class="last-updated">' + (state.refreshedAt ? "آخر تحديث: " + safe(dt(state.refreshedAt)) : "بيانات Shopify") +
      '</div></div>' +
      '<section class="date-panel"><div class="date-group"><label>من تاريخ<input type="date" id="date-from" value="' +
      safe(state.from) + '" /></label><label>إلى تاريخ<input type="date" id="date-to" value="' +
      safe(state.to) + '" /></label><button class="primary-button" data-action="search">بحث ←</button></div>' +
      '<div class="presets"><button data-days="1">النهارده</button><button data-days="1" data-yesterday="true">أمس</button>' +
      '<button data-days="7">7 أيام</button><button data-days="30">30 يوم</button></div></section>' +
      (state.error && state.data ? '<div class="inline-error">' + safe(state.error) + '</div>' : '') +
      (state.busy ? '<div class="progress"></div>' : '') + body +
      '<footer><span>UTM Track • Private Shopify Dashboard</span><span>Order Value ≠ Collected Revenue</span></footer>' +
      '</div></div>';
  }
  async function load() {
    if (state.busy) return;
    state.busy = true;
    state.error = "";
    render();
    try {
      const token = state.sessionToken;
      const query = new URLSearchParams({date_from: state.from, date_to: state.to});
      const response = await fetch("/api/orders?" + query.toString(), {
        headers: {Authorization: "Bearer " + token, Accept: "application/json"},
        cache: "no-store"
      });
      const contentType = response.headers.get("content-type") || "";
      if (!contentType.includes("application/json")) throw new Error("الخادم رجّع استجابة غير متوقعة، جرّب التحديث.");
      const json = await response.json();
      if (response.status === 401 && json.code === "DASHBOARD_LOGIN_REQUIRED") {
        state.sessionToken = "";
        sessionStorage.removeItem("utm_track_session");
        state.loginError = "الجلسة انتهت. سجل الدخول مرة تانية.";
        return;
      }
      if (!response.ok) throw new Error((json.error || "فشل في جلب الأوردرات") + (json.code ? " [" + json.code + "]" : "") + " (HTTP " + response.status + ")");
      state.data = json;
      state.selectedProduct = null;
      state.refreshedAt = new Date();
    } catch (err) {
      state.error = err.message || "حصل خطأ أثناء جلب البيانات.";
    } finally {
      state.busy = false;
      render();
    }
  }
  function exportCampaigns() {
    const values = [["Source","Campaign","Content","Orders","Order Value","Paid Orders","Units"]];
    aggregate(currentOrders(), state.level).forEach(g =>
      values.push([g.source,g.campaign,g.content,g.orders,g.orderValue.toFixed(2),g.paidOrders,g.units]));
    const text = "\ufeff" + values.map(row => row.map(v => '"' +
      String(v == null ? "" : v).replace(/"/g, '""') + '"').join(",")).join("\r\n");
    const blob = new Blob([text], {type:"text/csv;charset=utf-8"});
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "utm-campaigns-" + state.from + "-to-" + state.to + ".csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(a.href);
  }
  root.addEventListener("submit", event => {
    if (event.target?.id !== "login-form") return;
    event.preventDefault();
    login(event.target.querySelector("#dashboard-password").value);
  });
  root.addEventListener("click", (event) => {
    if (event.target.classList.contains("modal-backdrop")) {
      state.selectedProduct = null; render(); return;
    }
    const el = event.target.closest("[data-action],[data-view],[data-days],[data-level],[data-product]");
    if (!el) return;
    if (el.dataset.view) {
      state.view = el.dataset.view; state.selectedProduct = null; render(); return;
    }
    if (el.dataset.days) { preset(Number(el.dataset.days), el.dataset.yesterday === "true"); return; }
    if (el.dataset.level) { state.level = el.dataset.level; render(); return; }
    if (el.dataset.product) { state.selectedProduct = el.dataset.product; render(); return; }
    switch (el.dataset.action) {
      case "retry": load(); break;
      case "search": {
        const from = $("#date-from")?.value, to = $("#date-to")?.value;
        if (!from || !to || from > to) {
          state.error = "اتأكد إن تاريخ البداية قبل تاريخ النهاية."; render(); return;
        }
        state.from = from; state.to = to; load(); break;
      }
      case "reset-filters":
        state.source = ""; state.campaign = ""; state.product = ""; state.search = ""; render(); break;
      case "export-campaigns": exportCampaigns(); break;
      case "close-modal": state.selectedProduct = null; render(); break;
    }
  });
  root.addEventListener("change", (event) => {
    const k = event.target?.dataset?.filter;
    if (k && Object.prototype.hasOwnProperty.call(state,k)) { state[k] = event.target.value; render(); }
  });
  root.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && state.selectedProduct) { state.selectedProduct = null; render(); }
    if (event.key === "Enter" && event.target?.id === "search") {
      state.search = event.target.value; render();
    }
  });
  render();
  if (state.sessionToken) load();
})();
