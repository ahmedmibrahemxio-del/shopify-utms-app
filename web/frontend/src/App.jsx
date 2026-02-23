import React, { useState, useEffect, useCallback } from "react";
import {
  AppProvider, Page, Card, DataTable, Badge,
  Spinner, Tabs, Box, BlockStack, Banner,
} from "@shopify/polaris";
import arTranslations from "@shopify/polaris/locales/en.json";

// ─────────────────────────────────────────────
const today = () => new Date().toISOString().split("T")[0];
const fmt   = n  => Number(n).toLocaleString("ar-EG", { minimumFractionDigits: 0 });

function StatusBadge({ status }) {
  const tones  = { paid:"success", pending:"warning", refunded:"critical", partially_paid:"attention", voided:"critical" };
  const labels = { paid:"مدفوع",   pending:"معلق",    refunded:"مسترد",    partially_paid:"جزئي",      voided:"ملغي" };
  return <Badge tone={tones[status]||"default"}>{labels[status]||status}</Badge>;
}

// ─────────────────────────────────────────────
function StatCard({ icon, title, value, sub, color }) {
  const [hov, setHov] = useState(false);
  return (
    <div
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        flex:1, minWidth:160, background:"#fff", borderRadius:14,
        padding:"18px 20px", boxShadow:"0 2px 8px rgba(0,0,0,.07)",
        borderTop:`4px solid ${color}`,
        transform: hov ? "translateY(-3px)" : "none",
        transition:"transform .15s",
      }}
    >
      <div style={{fontSize:22,marginBottom:4}}>{icon}</div>
      <div style={{fontSize:12,color:"#888",marginBottom:4}}>{title}</div>
      <div style={{fontSize:26,fontWeight:800,color}}>{value}</div>
      {sub && <div style={{fontSize:11,color:"#bbb",marginTop:2}}>{sub}</div>}
    </div>
  );
}

// ─────────────────────────────────────────────
function UTMBar({ label, count, total, color }) {
  const pct = total ? Math.round(count / total * 100) : 0;
  return (
    <div style={{marginBottom:12}}>
      <div style={{display:"flex",justifyContent:"space-between",marginBottom:3}}>
        <span style={{fontSize:13,fontWeight:600}}>{label}</span>
        <span style={{fontSize:12,color:"#555"}}>{count} أوردر &nbsp;({pct}%)</span>
      </div>
      <div style={{background:"#f0f0f0",borderRadius:6,height:9,overflow:"hidden"}}>
        <div style={{background:color,height:"100%",borderRadius:6,width:`${pct}%`,transition:"width .5s ease"}} />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
const BAR = ["#1a73e8","#34a853","#ff6d00","#9c27b0","#00acc1","#e91e63","#f9a825"];

function ProductModal({ product, orders, onClose }) {
  const filtered = orders.filter(o => o.products.some(p => p.title === product));
  const srcMap = {}, camMap = {};
  filtered.forEach(o => {
    const src = o.utm.source   || "(غير محدد)";
    const cam = o.utm.campaign || "(غير محدد)";
    srcMap[src] = (srcMap[src]||0) + 1;
    camMap[cam] = (camMap[cam]||0) + 1;
  });
  const sources   = Object.entries(srcMap).sort((a,b)=>b[1]-a[1]);
  const campaigns = Object.entries(camMap).sort((a,b)=>b[1]-a[1]);
  const totalUnits = filtered.reduce((s,o)=>s+o.products.filter(p=>p.title===product).reduce((ss,p)=>ss+p.quantity,0),0);
  const totalRev   = filtered.reduce((s,o)=>s+o.products.filter(p=>p.title===product).reduce((ss,p)=>ss+p.price*p.quantity,0),0);

  return (
    <div onClick={onClose} style={{
      position:"fixed",inset:0,background:"rgba(0,0,0,.5)",
      zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center",padding:20,
    }}>
      <div onClick={e=>e.stopPropagation()} style={{
        background:"#fff",borderRadius:16,maxWidth:640,width:"100%",
        maxHeight:"85vh",overflowY:"auto",padding:28,
        boxShadow:"0 20px 60px rgba(0,0,0,.2)",
      }}>
        {/* Header */}
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:20}}>
          <div>
            <div style={{fontSize:11,color:"#888",marginBottom:4}}>تحليل المنتج</div>
            <div style={{fontSize:17,fontWeight:800,color:"#222",maxWidth:420}}>{product}</div>
          </div>
          <button onClick={onClose} style={{
            border:"none",background:"#f5f5f5",borderRadius:8,
            width:32,height:32,cursor:"pointer",fontSize:16,color:"#555",
          }}>✕</button>
        </div>

        {/* Mini Stats */}
        <div style={{display:"flex",gap:12,marginBottom:24,flexWrap:"wrap"}}>
          {[
            {label:"عدد الأوردرات",  val:filtered.length,          color:"#1a73e8"},
            {label:"الوحدات المباعة", val:totalUnits,               color:"#34a853"},
            {label:"الإيراد",         val:`${fmt(totalRev)} EGP`,   color:"#ff6d00"},
          ].map((s,i)=>(
            <div key={i} style={{
              flex:1,minWidth:130,background:"#f8f9ff",borderRadius:10,
              padding:"12px 16px",borderRight:`4px solid ${s.color}`,
            }}>
              <div style={{fontSize:11,color:"#888"}}>{s.label}</div>
              <div style={{fontSize:22,fontWeight:800,color:s.color}}>{s.val}</div>
            </div>
          ))}
        </div>

        {/* UTM Source */}
        <div style={{marginBottom:20}}>
          <div style={{fontWeight:700,marginBottom:12,fontSize:14,color:"#333"}}>📡 UTM Source</div>
          {sources.length ? sources.map(([src,cnt],i)=>(
            <UTMBar key={src} label={src} count={cnt} total={filtered.length} color={BAR[i%BAR.length]} />
          )) : <div style={{color:"#bbb",fontSize:13}}>لا توجد بيانات</div>}
        </div>

        {/* UTM Campaign */}
        <div style={{marginBottom:20}}>
          <div style={{fontWeight:700,marginBottom:12,fontSize:14,color:"#333"}}>🎯 UTM Campaign</div>
          {campaigns.length ? campaigns.map(([cam,cnt],i)=>(
            <UTMBar key={cam} label={cam} count={cnt} total={filtered.length} color={BAR[(i+3)%BAR.length]} />
          )) : <div style={{color:"#bbb",fontSize:13}}>لا توجد بيانات</div>}
        </div>

        {/* Orders list */}
        <div style={{borderTop:"1px solid #f0f0f0",paddingTop:16}}>
          <div style={{fontWeight:700,marginBottom:10,fontSize:14,color:"#333"}}>
            📋 الأوردرات ({filtered.length})
          </div>
          <div style={{maxHeight:200,overflowY:"auto"}}>
            {filtered.map(o=>(
              <div key={o.id} style={{
                display:"flex",justifyContent:"space-between",alignItems:"center",
                padding:"8px 0",borderBottom:"1px solid #f8f8f8",fontSize:13,
              }}>
                <div>
                  <span style={{fontWeight:700,color:"#1a73e8"}}>{o.shortId}</span>
                  <span style={{color:"#aaa",marginRight:8,fontSize:12}}>
                    {new Date(o.date).toLocaleString("ar-EG")}
                  </span>
                </div>
                <div style={{textAlign:"left"}}>
                  <div style={{fontWeight:600}}>{fmt(o.total)} EGP</div>
                  <div style={{fontSize:11,color:"#999"}}>
                    {o.utm.source||"—"} / {o.utm.campaign||"—"}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// MAIN APP
// ─────────────────────────────────────────────
export default function App() {
  const [data,            setData]            = useState(null);
  const [loading,         setLoading]         = useState(false);
  const [error,           setError]           = useState(null);
  const [tabIndex,        setTabIndex]        = useState(0);
  const [dateFrom,        setDateFrom]        = useState(today());
  const [dateTo,          setDateTo]          = useState(today());
  const [selectedProduct, setSelectedProduct] = useState(null);

  const fetchData = useCallback(async (from, to) => {
    setLoading(true); setError(null);
    try {
      const res = await fetch(`/api/orders?date_from=${from}&date_to=${to}`);
      if (!res.ok) { const e = await res.json(); throw new Error(e.error||"فشل في جلب البيانات"); }
      setData(await res.json());
    } catch(e) { setError(e.message); }
    finally    { setLoading(false); }
  }, []);

  useEffect(() => { fetchData(dateFrom, dateTo); }, []);

  const setPreset = (days) => {
    const d = new Date(), from = new Date(d);
    from.setDate(d.getDate() - days + 1);
    const f = from.toISOString().split("T")[0];
    const t = d.toISOString().split("T")[0];
    setDateFrom(f); setDateTo(t);
    fetchData(f, t);
  };

  const tabs = [
    { id:"summary",  content:"📊 ملخص"     },
    { id:"orders",   content:"📦 الأوردرات" },
    { id:"products", content:"🛍️ المنتجات" },
    { id:"utm",      content:"🔗 UTM"       },
  ];

  return (
    <AppProvider i18n={arTranslations}>
      <div style={{direction:"rtl",fontFamily:"'Segoe UI',Tahoma,sans-serif",background:"#f4f6f9",minHeight:"100vh"}}>
        <Page
          title="📈 Orders Dashboard"
          subtitle={data ? `${data.totalOrders} أوردر — ${data.date}` : ""}
          primaryAction={{content:"🔄 تحديث",onAction:()=>fetchData(dateFrom,dateTo),loading}}
        >
          <BlockStack gap="400">

            {/* ── Date Filter ── */}
            <Card>
              <Box padding="300">
                <div style={{display:"flex",gap:12,alignItems:"flex-end",flexWrap:"wrap"}}>
                  <div>
                    <div style={{fontSize:12,color:"#666",marginBottom:4}}>من تاريخ</div>
                    <input type="date" value={dateFrom} onChange={e=>setDateFrom(e.target.value)} style={iStyle} />
                  </div>
                  <div>
                    <div style={{fontSize:12,color:"#666",marginBottom:4}}>إلى تاريخ</div>
                    <input type="date" value={dateTo} onChange={e=>setDateTo(e.target.value)} style={iStyle} />
                  </div>
                  <button onClick={()=>fetchData(dateFrom,dateTo)} disabled={loading} style={bPrimary}>
                    {loading ? "⏳ جاري..." : "🔍 بحث"}
                  </button>
                  <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                    {[{l:"النهارده",d:1},{l:"أمس",d:2},{l:"7 أيام",d:7},{l:"30 يوم",d:30}].map(p=>(
                      <button key={p.l} onClick={()=>setPreset(p.d)} style={bGhost}>{p.l}</button>
                    ))}
                  </div>
                </div>
              </Box>
            </Card>

            {error && <Banner tone="critical" title="خطأ"><p>{error}</p></Banner>}

            {loading && !data && (
              <div style={{textAlign:"center",padding:60}}>
                <Spinner size="large" />
                <p style={{marginTop:16,color:"#888"}}>جاري جلب الأوردرات...</p>
              </div>
            )}

            {data && (
              <>
                {/* Stat Cards */}
                <div style={{display:"flex",gap:14,flexWrap:"wrap"}}>
                  <StatCard icon="🛒" title="إجمالي الأوردرات"  value={data.totalOrders}            color="#1a73e8" sub={data.date} />
                  <StatCard icon="✅" title="أوردرات مدفوعة"   value={data.paidOrders}              color="#34a853"
                    sub={`${data.totalOrders?Math.round(data.paidOrders/data.totalOrders*100):0}%`} />
                  <StatCard icon="💰" title="إجمالي الإيراد"    value={`${fmt(data.totalRevenue)} EGP`} color="#ff6d00" />
                  <StatCard icon="📡" title="مصادر UTM"         value={data.utmSources.length}       color="#9c27b0" sub="مصدر" />
                </div>

                {/* Tabs */}
                <Card>
                  <Tabs tabs={tabs} selected={tabIndex} onSelect={setTabIndex}>
                    <Box padding="400">

                      {/* ══ SUMMARY ══ */}
                      {tabIndex === 0 && (
                        <div style={{display:"flex",gap:28,flexWrap:"wrap"}}>
                          {/* Products */}
                          <div style={{flex:1,minWidth:260}}>
                            <div style={{fontWeight:800,fontSize:15,marginBottom:14,color:"#222"}}>🏆 أكتر المنتجات مبيعاً</div>
                            {data.products.slice(0,6).map((p,i)=>(
                              <div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"10px 0",borderBottom:"1px solid #f2f2f2"}}>
                                <div style={{display:"flex",alignItems:"center",gap:10}}>
                                  <div style={{width:26,height:26,borderRadius:"50%",background:BAR[i%BAR.length],color:"#fff",display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,fontWeight:700}}>{i+1}</div>
                                  <span style={{fontSize:13,maxWidth:160,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{p.name}</span>
                                </div>
                                <div style={{textAlign:"left"}}>
                                  <div style={{fontWeight:700,color:"#1a73e8",fontSize:14}}>{p.units} وحدة</div>
                                  <div style={{fontSize:11,color:"#aaa"}}>{fmt(p.revenue)} EGP</div>
                                </div>
                              </div>
                            ))}
                          </div>
                          <div style={{width:1,background:"#ebebeb"}} />
                          {/* UTM */}
                          <div style={{flex:1,minWidth:260}}>
                            <div style={{fontWeight:800,fontSize:15,marginBottom:14,color:"#222"}}>📡 UTM Source</div>
                            {data.utmSources.length
                              ? data.utmSources.map((u,i)=><UTMBar key={u.source} label={u.source} count={u.count} total={data.totalOrders} color={BAR[i%BAR.length]} />)
                              : <div style={{color:"#bbb",fontSize:13}}>لا توجد بيانات UTM</div>
                            }
                            {data.utmCampaigns?.length > 0 && (
                              <>
                                <div style={{fontWeight:800,fontSize:15,margin:"20px 0 14px",color:"#222"}}>🎯 UTM Campaign</div>
                                {data.utmCampaigns.map((u,i)=><UTMBar key={u.campaign} label={u.campaign} count={u.count} total={data.totalOrders} color={BAR[(i+3)%BAR.length]} />)}
                              </>
                            )}
                          </div>
                        </div>
                      )}

                      {/* ══ ORDERS ══ */}
                      {tabIndex === 1 && (
                        <DataTable
                          columnContentTypes={["text","text","text","text","text","text","text","numeric"]}
                          headings={["رقم","التاريخ","العميل","المنتجات","الحالة","UTM Source","UTM Campaign","الإجمالي"]}
                          rows={data.orders.map(o=>[
                            <span style={{fontWeight:700,color:"#1a73e8"}}>{o.shortId}</span>,
                            new Date(o.date).toLocaleString("ar-EG"),
                            o.customer||"—",
                            o.products.map(p=>`${p.title} ×${p.quantity}`).join(" / "),
                            <StatusBadge status={o.status} />,
                            o.utm.source   ? <Badge tone="info">{o.utm.source}</Badge>      : <span style={{color:"#ccc"}}>—</span>,
                            o.utm.campaign ? <Badge tone="success">{o.utm.campaign}</Badge> : <span style={{color:"#ccc"}}>—</span>,
                            `${fmt(o.total)} EGP`,
                          ])}
                          footerContent={`${data.orders.length} أوردر`}
                        />
                      )}

                      {/* ══ PRODUCTS ══ */}
                      {tabIndex === 2 && (
                        <>
                          <div style={{marginBottom:14,color:"#888",fontSize:13}}>
                            👇 اضغط على أي منتج لتشوف تفاصيل UTM الخاصة بيه
                          </div>
                          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(260px,1fr))",gap:12}}>
                            {data.products.map((p,i)=>(
                              <ProductCard key={i} p={p} i={i} onClick={()=>setSelectedProduct(p.name)} />
                            ))}
                          </div>
                        </>
                      )}

                      {/* ══ UTM ══ */}
                      {tabIndex === 3 && (
                        <DataTable
                          columnContentTypes={["text","text","text","text","text","text","numeric"]}
                          headings={["أوردر","الوقت","Source","Medium","Campaign","Content","الإجمالي"]}
                          rows={data.orders.map(o=>[
                            <span style={{fontWeight:700,color:"#1a73e8"}}>{o.shortId}</span>,
                            new Date(o.date).toLocaleTimeString("ar-EG"),
                            o.utm.source   ? <Badge tone="info">{o.utm.source}</Badge>      : <span style={{color:"#ddd"}}>—</span>,
                            o.utm.medium   ? <Badge>{o.utm.medium}</Badge>                  : <span style={{color:"#ddd"}}>—</span>,
                            o.utm.campaign ? <Badge tone="success">{o.utm.campaign}</Badge> : <span style={{color:"#ddd"}}>—</span>,
                            o.utm.content  ? <Badge tone="warning">{o.utm.content}</Badge>  : <span style={{color:"#ddd"}}>—</span>,
                            `${fmt(o.total)} EGP`,
                          ])}
                          footerContent={`${data.orders.filter(o=>o.utm.source).length} أوردر عندهم UTM`}
                        />
                      )}

                    </Box>
                  </Tabs>
                </Card>

                <div style={{textAlign:"center",color:"#ccc",fontSize:11,paddingBottom:16}}>
                  آخر تحديث: {new Date().toLocaleString("ar-EG")}
                </div>
              </>
            )}
          </BlockStack>
        </Page>
      </div>

      {selectedProduct && data && (
        <ProductModal
          product={selectedProduct}
          orders={data.orders}
          onClose={()=>setSelectedProduct(null)}
        />
      )}
    </AppProvider>
  );
}

// ─────────────────────────────────────────────
function ProductCard({ p, i, onClick }) {
  const [hov, setHov] = useState(false);
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        background:"#fff", borderRadius:12, padding:"16px 18px",
        border:"2px solid #f0f0f0", cursor:"pointer",
        borderRight:`4px solid ${BAR[i%BAR.length]}`,
        transform: hov ? "translateY(-2px)" : "none",
        boxShadow: hov ? "0 4px 16px rgba(0,0,0,.08)" : "none",
        transition:"all .15s",
      }}
    >
      <div style={{fontSize:13,fontWeight:700,marginBottom:8,color:"#222"}}>{p.name}</div>
      <div style={{display:"flex",gap:16}}>
        <div>
          <div style={{fontSize:10,color:"#aaa"}}>وحدات</div>
          <div style={{fontSize:22,fontWeight:800,color:BAR[i%BAR.length]}}>{p.units}</div>
        </div>
        <div>
          <div style={{fontSize:10,color:"#aaa"}}>إيراد</div>
          <div style={{fontSize:14,fontWeight:700,color:"#555",marginTop:3}}>{fmt(p.revenue)} EGP</div>
        </div>
      </div>
      <div style={{marginTop:10,fontSize:11,color:"#1a73e8"}}>🔍 اضغط لتفاصيل UTM</div>
    </div>
  );
}

// Styles
const iStyle   = { border:"1.5px solid #ddd",borderRadius:8,padding:"8px 12px",fontSize:14,outline:"none",fontFamily:"inherit" };
const bPrimary = { background:"#1a73e8",color:"#fff",border:"none",borderRadius:8,padding:"9px 20px",fontSize:14,cursor:"pointer",fontWeight:700 };
const bGhost   = { background:"#f0f0f0",color:"#555",border:"none",borderRadius:8,padding:"9px 14px",fontSize:13,cursor:"pointer",fontWeight:600 };
