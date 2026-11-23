(function () {
  "use strict";

  const TZ = "Africa/Cairo";
  const root = document.getElementById("root");

  // ---------- Dates (always in Cairo time) ----------
  const todayCairo = () => new Date().toLocaleDateString("en-CA", { timeZone: TZ });
  const shiftDate = (dateStr, days) => {
    const [y, m, d] = dateStr.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
  };
  const fmtDateTime = (v) => {
    try {
      return new Date(v).toLocaleString("ar-EG-u-nu-latn", {
        timeZone: TZ, day: "numeric", month: "short", hour: "numeric", minute: "2-digit"
      });
    } catch { return "—"; }
  };
  const fmtTime = (v) => {
    try { return new Date(v).toLocaleTimeString("ar-EG-u-nu-latn", { timeZone: TZ, hour: "numeric", minute: "2-digit" }); }
    catch { return "—"; }
  };
  const fmtDay = (s) => {
    const [y, m, d] = s.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString("ar-EG-u-nu-latn", { timeZone: "UTC", day: "numeric", month: "short" });
  };

  const PRESETS = {
    today: { label: "النهارده", range: () => { const t = todayCairo(); return [t, t]; } },
    yesterday: { label: "امبارح", range: () => { const y = shiftDate(todayCairo(), -1); return [y, y]; } },
    last7: { label: "آخر 7 أيام", range: () => { const t = todayCairo(); return [shiftDate(t, -6), t]; } },
    last30: { label: "آخر 30 يوم", range: () => { const t = todayCairo(); return [shiftDate(t, -29), t]; } }
  };

  const VIEWS = { overview: "نظرة عامة", campaigns: "الحملات", orders: "الأوردرات", products: "المنتجات" };

  const initial = PRESETS.today.range();
  const state = {
    view: "overview", preset: "today", from: initial[0], to: initial[1], customOpen: false,
    data: null, busy: false, error: "", fatal: "", refreshedAt: null,
    source: "", campaign: "", search: "", level: "campaign", page: 0,
    productSearch: "", productSort: "orders",
    selectedProduct: null, selectedOrder: null
  };

  // ---------- Formatting ----------
  const esc = (v) => String(v == null ? "" : v)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  const num = (n) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(Number(n || 0));
  const money = (n) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(Number(n || 0)) + " ج.م";
  const pct = (n, d) => (d ? Math.round((n / d) * 100) : 0) + "%";
  const label = (t) => (t == null || t === "" || t === "(غير محدد)" ? "غير محدد" : String(t));
  const STATUS = {
    paid: ["مدفوع", "ok"], pending: ["معلق", "warn"], refunded: ["مسترد", "bad"],
    partially_paid: ["مدفوع جزئيًا", "warn"], partially_refunded: ["مسترد جزئيًا", "bad"],
    voided: ["ملغي", "bad"], authorized: ["مصرّح", "warn"]
  };
  const statusPill = (s) => {
    const [text, tone] = STATUS[s] || [s || "غير محدد", "muted"];
    return '<span class="pill ' + tone + '">' + esc(text) + "</span>";
  };

  // ---------- Shopify session ----------
  const embedded = (() => { try { return window.top !== window.self; } catch { return true; } })();
  async function sessionToken() {
    if (!embedded || !window.shopify || typeof window.shopify.idToken !== "function") {
      throw Object.assign(new Error("not-embedded"), { fatal: true });
    }
    return Promise.race([
      window.shopify.idToken(),
      new Promise((_, rej) => setTimeout(() => rej(new Error("تعذر التحقق من جلسة Shopify. حدّث الصفحة.")), 8000))
    ]);
  }

  // ---------- Data ----------
  async function load() {
    if (state.busy) return;
    state.busy = true; state.error = ""; render();
    try {
      const token = await sessionToken();
      const q = new URLSearchParams({ date_from: state.from, date_to: state.to });
      const res = await fetch("/api/orders?" + q, {
        headers: { Authorization: "Bearer " + token, Accept: "application/json" }, cache: "no-store"
      });
      const type = res.headers.get("content-type") || "";
      if (!type.includes("application/json")) throw new Error("الخادم رجّع استجابة غير متوقعة، جرّب تاني.");
      const json = await res.json();
      if (res.status === 401) throw Object.assign(new Error("not-embedded"), { fatal: true });
      if (!res.ok) throw new Error(json.error || "فشل في جلب الأوردرات");
      state.data = json; state.refreshedAt = new Date(); state.page = 0;
      state.selectedProduct = null; state.selectedOrder = null;
    } catch (err) {
      if (err.fatal) state.fatal = "not-embedded";
      else state.error = err.message || "حصل خطأ";
    } finally {
      state.busy = false; render();
    }
  }

  function filteredOrders() {
    if (!state.data) return [];
    const term = state.search.trim().toLowerCase();
    return state.data.orders.filter((o) => {
      const u = o.utm || {};
      if (state.source && label(u.source) !== state.source) return false;
      if (state.campaign && label(u.campaign) !== state.campaign) return false;
      if (term) {
        const hay = [o.shortId, o.customer, o.city, u.source, u.campaign, u.content, ...o.products.map((p) => p.title)]
          .join(" ").toLowerCase();
        if (!hay.includes(term)) return false;
      }
      return true;
    });
  }

  function aggregate(orders, by) {
    const groups = new Map();
    orders.forEach((o) => {
      const u = o.utm || {};
      const source = label(u.source), campaign = label(u.campaign), content = label(u.content);
      const key = by === "content" ? JSON.stringify([source, campaign, content]) : JSON.stringify([source, campaign]);
      if (!groups.has(key)) groups.set(key, { source, campaign, content, orders: 0, value: 0, paid: 0, units: 0 });
      const g = groups.get(key);
      g.orders += 1; g.value += Number(o.total || 0);
      if (o.status === "paid") g.paid += 1;
      g.units += o.products.reduce((t, p) => t + Number(p.quantity || 0), 0);
    });
    return [...groups.values()].sort((a, b) => b.orders - a.orders || b.value - a.value);
  }

  // ---------- Building blocks ----------
  const empty = (msg) => '<div class="empty"><div class="empty-ico">∅</div><p>' + esc(msg || "مفيش بيانات في الفترة دي.") + "</p></div>";

  function kpi(title, value, sub, accent) {
    return '<div class="kpi' + (accent ? " kpi-accent" : "") + '"><span class="kpi-title">' + esc(title) +
      '</span><span class="kpi-value">' + esc(value) + "</span>" +
      (sub ? '<span class="kpi-sub">' + esc(sub) + "</span>" : "") + "</div>";
  }

  function bars(rows, total, limit) {
    if (!rows.length) return empty();
    const max = Math.max(...rows.map((r) => r.count), 1);
    return '<ul class="bars">' + rows.slice(0, limit || 6).map((r) =>
      '<li><div class="bar-row"><span class="bar-label" title="' + esc(label(r.name)) + '">' + esc(label(r.name)) +
      '</span><span class="bar-num">' + num(r.count) + ' <em>' + pct(r.count, total) + "</em></span></div>" +
      '<div class="bar-track"><i style="width:' + Math.max(2, Math.round((r.count / max) * 100)) + '%"></i></div></li>'
    ).join("") + "</ul>";
  }

  function pager(total, perPage) {
    const last = Math.max(0, Math.ceil(total / perPage) - 1);
    const page = Math.min(state.page, last);
    if (total <= perPage) return { page, html: "" };
    return {
      page,
      html: '<div class="pager"><span>' + num(page * perPage + 1) + "–" + num(Math.min((page + 1) * perPage, total)) +
        " من " + num(total) + '</span><div><button class="btn-ghost" data-page="-1"' + (page === 0 ? " disabled" : "") +
        '>السابق</button><button class="btn-ghost" data-page="1"' + (page >= last ? " disabled" : "") + ">التالي</button></div></div>"
    };
  }

  function filters(withLevel) {
    const d = state.data;
    const opts = (values, selected, all) => '<option value="">' + all + "</option>" + values.map((v) =>
      '<option value="' + esc(v) + '"' + (v === selected ? " selected" : "") + ">" + esc(v) + "</option>").join("");
    const sources = [...new Set(d.orders.map((o) => label(o.utm && o.utm.source)))].sort();
    const campaigns = [...new Set(d.orders.map((o) => label(o.utm && o.utm.campaign)))].sort();
    const active = state.source || state.campaign || state.search;
    return '<div class="toolbar">' +
      '<div class="search"><span aria-hidden="true">⌕</span><input id="search" type="search" placeholder="ابحث برقم الأوردر، العميل، المنتج أو الحملة" value="' + esc(state.search) + '" /></div>' +
      '<select data-filter="source" aria-label="المصدر">' + opts(sources, state.source, "كل المصادر") + "</select>" +
      '<select data-filter="campaign" aria-label="الحملة">' + opts(campaigns, state.campaign, "كل الحملات") + "</select>" +
      (withLevel ? '<div class="seg"><button data-level="campaign" class="' + (state.level === "campaign" ? "on" : "") +
        '">حملة</button><button data-level="content" class="' + (state.level === "content" ? "on" : "") + '">إعلان</button></div>' : "") +
      (active ? '<button class="btn-link" data-action="reset-filters">مسح</button>' : "") + "</div>";
  }

  // ---------- Views ----------
  function overview() {
    const d = state.data, total = d.totalOrders || 0, cov = d.utmCoverage || {};
    const sources = (d.utmSources || []).map((s) => ({ name: s.source, count: s.count }));
    const camps = (d.utmCampaigns || []).map((c) => ({ name: c.campaign, count: c.count }));
    const avg = total ? Number(d.totalRevenue) / total : 0;
    const top = (d.products || []).slice(0, 5);
    const maxOrders = Math.max(...top.map((p) => p.orders || 0), 1);
    return '<div class="kpis">' +
      kpi("الأوردرات", num(total), null, true) +
      kpi("قيمة الأوردرات", money(d.totalRevenue), "متوسط الأوردر " + money(avg)) +
      kpi("المدفوع", num(d.paidOrders), pct(d.paidOrders, total) + " من الأوردرات") +
      kpi("عليها UTM", pct(cov.tracked, cov.total), num(cov.tracked || 0) + " من " + num(cov.total || 0)) +
      "</div>" +
      '<div class="grid-2">' +
      '<section class="card"><header class="card-head"><h3>المصادر</h3></header>' + bars(sources, total) + "</section>" +
      '<section class="card"><header class="card-head"><h3>أعلى الحملات</h3><button class="btn-link" data-view="campaigns">الكل ←</button></header>' + bars(camps, total, 5) + "</section>" +
      "</div>" +
      '<section class="card"><header class="card-head"><h3>أكثر المنتجات طلبًا</h3><button class="btn-link" data-view="products">الكل ←</button></header>' +
      (top.length ? '<ol class="top-products">' + top.map((p, i) =>
        '<li><button data-product="' + esc(p.key) + '"><span class="rank">' + (i + 1) + '</span><span class="tp-name" title="' + esc(p.name) + '">' + esc(p.name) +
        '</span><span class="tp-bar"><i style="width:' + Math.round(((p.orders || 0) / maxOrders) * 100) + '%"></i></span><span class="tp-num">' +
        num(p.orders) + " أوردر</span></button></li>").join("") + "</ol>" : empty()) +
      "</section>";
  }

  function campaigns() {
    const orders = filteredOrders(), rows = aggregate(orders, state.level), byAd = state.level === "content";
    const p = pager(rows.length, 20);
    const body = rows.slice(p.page * 20, p.page * 20 + 20).map((g) =>
      "<tr><td><div class=\"strong\">" + esc(g.campaign) + '</div><div class="muted">' + esc(g.source) + "</div></td>" +
      (byAd ? '<td class="mono">' + esc(g.content) + "</td>" : "") +
      '<td class="n strong">' + num(g.orders) + '</td><td class="n">' + money(g.value) + '</td><td class="n">' + num(g.paid) +
      '</td><td class="n">' + num(g.units) + "</td></tr>").join("");
    return filters(true) +
      '<section class="card flush"><header class="card-head pad"><h3>' + num(rows.length) + (byAd ? " إعلان" : " حملة") +
      ' <span class="muted">· ' + num(orders.length) + ' أوردر</span></h3><button class="btn-ghost" data-action="export">تصدير CSV</button></header>' +
      (rows.length ? '<div class="table-wrap"><table><thead><tr><th>الحملة</th>' + (byAd ? "<th>الإعلان (Content)</th>" : "") +
        '<th class="n">أوردرات</th><th class="n">القيمة</th><th class="n">مدفوع</th><th class="n">وحدات</th></tr></thead><tbody>' + body + "</tbody></table></div>" + p.html
        : empty("مفيش نتائج. جرّب تغيّر الفلاتر.")) + "</section>";
  }

  function orders() {
    const list = filteredOrders(), p = pager(list.length, 25);
    const body = list.slice(p.page * 25, p.page * 25 + 25).map((o) => {
      const u = o.utm || {};
      const items = o.products.map((x) => x.title + (x.quantity > 1 ? " ×" + x.quantity : "")).join("، ");
      return '<tr class="clickable" data-order="' + esc(o.id) + '"><td class="strong">' + esc(o.shortId) +
        '</td><td class="muted nowrap">' + esc(fmtDateTime(o.date)) + "</td><td>" + esc(o.customer || "—") +
        '<div class="muted">' + esc(o.city || "") + '</div></td><td><div class="clip" title="' + esc(items) + '">' + esc(items) +
        "</div></td><td>" + esc(label(u.source)) + '<div class="muted clip">' + esc(label(u.campaign)) + "</div></td>" +
        "<td>" + statusPill(o.status) + '</td><td class="n strong">' + money(o.total) + "</td></tr>";
    }).join("");
    return filters(false) + '<section class="card flush"><header class="card-head pad"><h3>' + num(list.length) +
      ' أوردر</h3><span class="muted small">اضغط على أي أوردر لتفاصيل الـ UTM</span></header>' +
      (list.length ? '<div class="table-wrap"><table><thead><tr><th>الأوردر</th><th>الوقت</th><th>العميل</th><th>المنتجات</th><th>المصدر / الحملة</th><th>الحالة</th><th class="n">القيمة</th></tr></thead><tbody>' +
        body + "</tbody></table></div>" + p.html : empty("مفيش أوردرات مطابقة.")) + "</section>";
  }

  function products() {
    const all = state.data.products || [];
    const term = state.productSearch.trim().toLowerCase();
    const key = state.productSort;
    const list = all.filter((p) => !term || String(p.name || "").toLowerCase().includes(term))
      .sort((a, b) => Number(b[key] || 0) - Number(a[key] || 0) || Number(b.orders || 0) - Number(a.orders || 0));
    const max = Math.max(...list.map((p) => Number(p[key] || 0)), 1);
    const p = pager(list.length, 25);
    const sorts = { orders: "الأوردرات", units: "الوحدات", revenue: "القيمة" };
    const body = list.slice(p.page * 25, p.page * 25 + 25).map((x, i) =>
      '<tr class="clickable" data-product="' + esc(x.key) + '"><td class="muted n">' + num(p.page * 25 + i + 1) +
      '</td><td><div class="clip strong" title="' + esc(x.name) + '">' + esc(x.name) + '</div><div class="inline-bar"><i style="width:' +
      Math.max(2, Math.round((Number(x[key] || 0) / max) * 100)) + '%"></i></div></td><td class="n strong">' + num(x.orders) +
      '</td><td class="n">' + num(x.units) + '</td><td class="n">' + money(x.revenue) + "</td></tr>").join("");
    return '<div class="toolbar"><div class="search"><span aria-hidden="true">⌕</span><input id="product-search" type="search" placeholder="ابحث باسم المنتج" value="' +
      esc(state.productSearch) + '" /></div><div class="seg">' + Object.keys(sorts).map((k) =>
        '<button data-sort="' + k + '" class="' + (key === k ? "on" : "") + '">' + sorts[k] + "</button>").join("") + "</div></div>" +
      '<section class="card flush"><header class="card-head pad"><h3>' + num(list.length) + ' منتج</h3><span class="muted small">مرتبة حسب ' + sorts[key] + "</span></header>" +
      (list.length ? '<div class="table-wrap"><table><thead><tr><th class="n">#</th><th>المنتج</th><th class="n">أوردرات</th><th class="n">وحدات</th><th class="n">قيمة الأصناف</th></tr></thead><tbody>' +
        body + "</tbody></table></div>" + p.html : empty("مفيش منتجات بالاسم ده.")) + "</section>";
  }

  // ---------- Drawers ----------
  function productDrawer() {
    const prod = state.data.products.find((x) => x.key === state.selectedProduct);
    if (!prod) return "";
    const list = state.data.orders.filter((o) => o.products.some((x) => x.key === prod.key));
    const groups = aggregate(list, "campaign").slice(0, 8);
    return drawer(prod.name, "منتج",
      '<div class="mini-kpis">' + kpi("أوردرات", num(prod.orders)) + kpi("وحدات", num(prod.units)) + kpi("القيمة", money(prod.revenue)) + "</div>" +
      "<h4>جاي من أنهي حملات</h4>" + bars(groups.map((g) => ({ name: g.campaign, count: g.orders })), list.length, 8) +
      "<h4>آخر الأوردرات</h4><ul class=\"list\">" + list.slice(0, 15).map((o) =>
        '<li><span class="strong">' + esc(o.shortId) + '</span><span class="muted">' + esc(fmtDateTime(o.date)) + "</span><span>" + money(o.total) + "</span></li>").join("") + "</ul>");
  }

  function orderDrawer() {
    const o = state.data.orders.find((x) => String(x.id) === state.selectedOrder);
    if (!o) return "";
    const u = o.utm || {};
    const row = (k, v) => "<div><dt>" + k + "</dt><dd>" + esc(label(v)) + "</dd></div>";
    return drawer("أوردر " + o.shortId, fmtDateTime(o.date),
      '<div class="mini-kpis">' + kpi("القيمة", money(o.total)) + kpi("الحالة", (STATUS[o.status] || [o.status || "—"])[0]) + "</div>" +
      '<h4>العميل</h4><dl class="dl">' + row("الاسم", o.customer) + row("المدينة", o.city) + "</dl>" +
      '<h4>UTM</h4><dl class="dl">' + row("Source", u.source) + row("Medium", u.medium) + row("Campaign", u.campaign) +
      row("Content", u.content) + row("Term", u.term) + "</dl>" +
      '<h4>المنتجات</h4><ul class="list">' + o.products.map((p) =>
        '<li><span class="clip">' + esc(p.title) + '</span><span class="muted">×' + num(p.quantity) + "</span><span>" + money(p.price * p.quantity) + "</span></li>").join("") + "</ul>");
  }

  function drawer(title, sub, content) {
    return '<div class="scrim" data-action="close"></div><aside class="drawer" role="dialog" aria-modal="true" aria-label="' + esc(title) + '">' +
      '<header><div><span class="muted small">' + esc(sub) + "</span><h3>" + esc(title) + '</h3></div><button class="icon-btn" data-action="close" aria-label="إغلاق">✕</button></header>' +
      '<div class="drawer-body">' + content + "</div></aside>";
  }

  // ---------- Shell ----------
  function rangeLabel() {
    if (state.preset && PRESETS[state.preset]) return PRESETS[state.preset].label;
    return state.from === state.to ? fmtDay(state.from) : fmtDay(state.from) + " – " + fmtDay(state.to);
  }

  function render() {
    if (!root) return;
    if (state.fatal) {
      root.innerHTML = '<div class="center"><div class="notice"><div class="logo">UT</div><h2>افتح الداشبورد من Shopify Admin</h2>' +
        "<p>الداشبورد بيفتح على طول من غير باسورد، بس من جوه لوحة تحكم شوبيفاي: Apps ← UTM Track.</p></div></div>";
      return;
    }
    const tabs = Object.keys(VIEWS).map((k) => '<button class="tab' + (state.view === k ? " on" : "") + '" data-view="' + k + '">' + VIEWS[k] + "</button>").join("");
    const presets = Object.keys(PRESETS).map((k) => '<button class="' + (state.preset === k ? "on" : "") + '" data-preset="' + k + '">' + PRESETS[k].label + "</button>").join("") +
      '<button class="' + (!state.preset ? "on" : "") + '" data-action="custom">مخصص</button>';
    const custom = state.customOpen ? '<div class="custom-range"><label>من<input type="date" id="from" value="' + esc(state.from) + '" max="' + todayCairo() +
      '"></label><label>إلى<input type="date" id="to" value="' + esc(state.to) + '" max="' + todayCairo() + '"></label><button class="btn-primary" data-action="apply">تطبيق</button></div>' : "";

    let body;
    if (!state.data) {
      body = state.error
        ? '<div class="card error"><strong>تعذر تحميل البيانات</strong><p>' + esc(state.error) + '</p><button class="btn-primary" data-action="refresh">حاول تاني</button></div>'
        : '<div class="kpis">' + '<div class="kpi skeleton"></div>'.repeat(4) + '</div><div class="grid-2"><div class="card skeleton tall"></div><div class="card skeleton tall"></div></div>';
    } else {
      body = (state.error ? '<div class="banner">' + esc(state.error) + "</div>" : "") +
        (state.view === "campaigns" ? campaigns() : state.view === "orders" ? orders() : state.view === "products" ? products() : overview());
    }
    const drawerHtml = state.data ? (state.selectedOrder ? orderDrawer() : state.selectedProduct ? productDrawer() : "") : "";

    const active = document.activeElement && document.activeElement.id;
    const caret = active && document.activeElement.selectionStart;

    root.innerHTML = '<div class="app">' +
      '<header class="top"><div class="brand"><div class="logo">UT</div><div><h1>UTM Track</h1><span>' + esc(rangeLabel()) +
      (state.refreshedAt ? " · آخر تحديث " + esc(fmtTime(state.refreshedAt)) : "") + "</span></div></div>" +
      '<div class="top-actions"><div class="seg presets">' + presets + '</div><button class="icon-btn' + (state.busy ? " spin" : "") +
      '" data-action="refresh" aria-label="تحديث"' + (state.busy ? " disabled" : "") + ">↻</button></div></header>" + custom +
      '<nav class="tabs">' + tabs + "</nav>" + (state.busy ? '<div class="loading-bar"></div>' : "") +
      '<main class="content">' + body + "</main>" +
      '<footer class="foot">الأوقات بتوقيت القاهرة · قيمة الأوردرات مش بالضرورة المبلغ المحصّل</footer></div>' + drawerHtml;

    if (active) {
      const el = document.getElementById(active);
      if (el) { el.focus(); if (caret != null && el.setSelectionRange) try { el.setSelectionRange(caret, caret); } catch {} }
    }
  }

  // ---------- CSV ----------
  function exportCsv() {
    const rows = [["Source", "Campaign", "Content", "Orders", "Order Value", "Paid Orders", "Units"]];
    aggregate(filteredOrders(), state.level).forEach((g) =>
      rows.push([g.source, g.campaign, state.level === "content" ? g.content : "", g.orders, g.value.toFixed(2), g.paid, g.units]));
    const text = "﻿" + rows.map((r) => r.map((v) => '"' + String(v).replace(/"/g, '""') + '"').join(",")).join("\r\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
    a.download = "utm-" + state.level + "-" + state.from + "-to-" + state.to + ".csv";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  // ---------- Events ----------
  let searchTimer;
  document.addEventListener("click", (e) => {
    const el = e.target.closest("[data-action],[data-view],[data-preset],[data-level],[data-sort],[data-product],[data-order],[data-page]");
    if (!el) return;
    const ds = el.dataset;
    if (ds.view) { state.view = ds.view; state.page = 0; state.selectedOrder = state.selectedProduct = null; render(); window.scrollTo(0, 0); return; }
    if (ds.preset) { state.preset = ds.preset; state.customOpen = false; [state.from, state.to] = PRESETS[ds.preset].range(); load(); return; }
    if (ds.level) { state.level = ds.level; state.page = 0; render(); return; }
    if (ds.sort) { state.productSort = ds.sort; state.page = 0; render(); return; }
    if (ds.page) { state.page = Math.max(0, state.page + Number(ds.page)); render(); return; }
    if (ds.order) { state.selectedOrder = ds.order; state.selectedProduct = null; render(); return; }
    if (ds.product) { state.selectedProduct = ds.product; state.selectedOrder = null; render(); return; }
    switch (ds.action) {
      case "refresh": load(); break;
      case "custom": state.customOpen = !state.customOpen; render(); break;
      case "apply": {
        const f = document.getElementById("from").value, t = document.getElementById("to").value;
        if (!f || !t || f > t) { state.error = "تاريخ البداية لازم يكون قبل تاريخ النهاية."; render(); return; }
        state.from = f; state.to = t; state.preset = ""; state.customOpen = false; load(); break;
      }
      case "reset-filters": state.source = state.campaign = state.search = ""; state.page = 0; render(); break;
      case "export": exportCsv(); break;
      case "close": state.selectedOrder = state.selectedProduct = null; render(); break;
    }
  });
  document.addEventListener("change", (e) => {
    const k = e.target.dataset && e.target.dataset.filter;
    if (k) { state[k] = e.target.value; state.page = 0; render(); }
  });
  document.addEventListener("input", (e) => {
    const id = e.target.id;
    if (id !== "search" && id !== "product-search") return;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      if (id === "search") state.search = e.target.value; else state.productSearch = e.target.value;
      state.page = 0; render();
    }, 200);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && (state.selectedOrder || state.selectedProduct)) { state.selectedOrder = state.selectedProduct = null; render(); }
  });

  render();
  load();
})();
