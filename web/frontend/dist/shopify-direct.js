/* Embedded Shopify Direct Admin API. Requires direct API access enabled on the app. */
(function(){
"use strict";
const ORDER_QUERY = [
'query Orders($cursor:String,$search:String!){ orders(first:20,after:$cursor,query:$search,sortKey:CREATED_AT,reverse:true){',
'pageInfo{hasNextPage endCursor} nodes{ id legacyResourceId name createdAt displayFinancialStatus',
'totalPriceSet{shopMoney{amount}} customer{firstName lastName} shippingAddress{city country}',
'customAttributes{key value} customerJourneySummary{lastVisit{landingPage utmParameters{source medium campaign content term}}}',
'lineItems(first:10){pageInfo{hasNextPage endCursor} nodes{ id title quantity',
'product{legacyResourceId} variant{legacyResourceId} originalUnitPriceSet{shopMoney{amount}}',
'}} } } }'
].join(" ");
const ITEMS_QUERY = [
'query Items($id:ID!,$cursor:String){node(id:$id){... on Order{',
'lineItems(first:20,after:$cursor){pageInfo{hasNextPage endCursor}',
'nodes{id title quantity product{legacyResourceId} variant{legacyResourceId}',
'originalUnitPriceSet{shopMoney{amount}}}}}}}'
].join(" ");
async function gql(query,variables){
 if(!window.shopify || typeof window.shopify.idToken!=="function")
   throw new Error("SHOPIFY_ADMIN_ONLY: افتح UTM Track من داخل Shopify Admin.");
 let res;
 try{res=await fetch("shopify:admin/api/graphql.json",{
  method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({query,variables}),cache:"no-store"
 });}catch{throw new Error("DIRECT_API_UNAVAILABLE: تعذر الاتصال بـShopify Direct API.")}
 let body;
 try{body=await res.json();}catch{throw new Error("DIRECT_API_UNAVAILABLE: استجابة Shopify غير متوقعة.")}
 const messages=(body.errors||[]).map(x=>String(x.message||"")).join(" | ");
 if(!res.ok || body.errors?.length){
  if([401,403,404].includes(res.status)||/direct api|not enabled|not allowed|unauthorized|forbidden|access denied|permission|scope/i.test(messages))
    throw new Error("DIRECT_API_DISABLED: فعّل Shopify Direct API Access وأصدر نسخة إعدادات التطبيق.");
  throw new Error("Shopify API: "+(messages.slice(0,200)||"فشل تحميل البيانات"));
 }
 if(!body.data)throw new Error("Shopify API: لم ترجع بيانات");
 return body.data;
}
function decode(v){try{return decodeURIComponent(String(v||"").replace(/\+/g," "));}catch{return String(v||"");}}
function extractUTM(o){
 const u={source:"",medium:"",campaign:"",content:"",term:""};
 for(const a of o.customAttributes||[]){
  const k=String(a.key||"").toLowerCase();
  if(k.startsWith("utm_") && Object.hasOwn(u,k.slice(4)))u[k.slice(4)]=decode(a.value);
 }
 const visit=o.customerJourneySummary?.lastVisit;
 const params=visit?.utmParameters||{};
 for(const k of Object.keys(u))u[k] ||= decode(params[k]);
 if(visit?.landingPage){try{
  const url=new URL(visit.landingPage,"https://example.myshopify.com");
  for(const k of Object.keys(u))u[k] ||= decode(url.searchParams.get("utm_"+k));
 }catch{}}
 return u;
}
async function getItems(order){
 const all=[...(order.lineItems?.nodes||[])];let info=order.lineItems?.pageInfo,attempt=0;
 while(info?.hasNextPage){
  if(++attempt>100)throw new Error("عدد منتجات الأوردر كبير جدًا");
  const data=await gql(ITEMS_QUERY,{id:order.id,cursor:info.endCursor});
  if(!data.node?.lineItems)throw new Error("Shopify لم يرجع باقي منتجات الأوردر");
  all.push(...data.node.lineItems.nodes);info=data.node.lineItems.pageInfo;
 }
 return all;
}
function mapLine(i,id){
 const product=i.product?.legacyResourceId,variant=i.variant?.legacyResourceId;
 return {key:product!=null?"product:"+product:variant!=null?"variant:"+variant:"line:"+(i.id||id),
 title:i.title,quantity:Number(i.quantity||0),price:Number(i.originalUnitPriceSet?.shopMoney?.amount||0)};
}
function aggregate(orders,from,to){
 orders.sort((a,b)=>new Date(b.date)-new Date(a.date));
 const products=new Map(),src=new Map(),camp=new Map();
 let total=0,paid=0,paidValue=0,tracked=0;
 for(const o of orders){
  total+=o.total;if(o.status==="paid"){paid++;paidValue+=o.total;}
  if(Object.values(o.utm).some(Boolean))tracked++;
  const source=o.utm.source||"(غير محدد)",campaign=o.utm.campaign||"(غير محدد)";
  src.set(source,(src.get(source)||0)+1);camp.set(campaign,(camp.get(campaign)||0)+1);
  const seen=new Set();
  for(const p of o.products){
   const item=products.get(p.key)||{key:p.key,name:p.title,orders:0,units:0,revenue:0};
   if(!seen.has(p.key)){item.orders++;seen.add(p.key);}
   item.units+=p.quantity;item.revenue+=p.price*p.quantity;products.set(p.key,item);
  }
 }
 return {date:from+" → "+to,dateFrom:from,dateTo:to,totalOrders:orders.length,
 totalRevenue:total.toFixed(2),paidOrders:paid,paidOrderValue:paidValue.toFixed(2),
 utmCoverage:{tracked,total:orders.length},orders,
 products:[...products.values()].sort((a,b)=>b.orders-a.orders||b.units-a.units),
 utmSources:[...src.entries()].map(([source,count])=>({source,count})).sort((a,b)=>b.count-a.count),
 utmCampaigns:[...camp.entries()].map(([campaign,count])=>({campaign,count})).sort((a,b)=>b.count-a.count)};
}
async function loadOrders(from,to){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(from)||!/^\d{4}-\d{2}-\d{2}$/.test(to)||from>to)
   throw new Error("نطاق التاريخ غير صحيح.");
 // Same +03:00 date boundaries as existing dashboard.
 const search="created_at:>='"+from+"T00:00:00+03:00' created_at:<='"+to+"T23:59:59+03:00'";
 let cursor=null,hasNext=true,count=0;const seen=new Set(),raw=[];
 while(hasNext){
  if(++count>300)throw new Error("عدد أوردرات كبير جدًا، اختار فترة أقصر.");
  const data=await gql(ORDER_QUERY,{cursor,search});
  if(!data.orders)throw new Error("Shopify لم يرجع الأوردرات.");
  for(const o of data.orders.nodes||[])if(!seen.has(o.id)){seen.add(o.id);raw.push(o);}
  hasNext=!!data.orders.pageInfo?.hasNextPage;
  cursor=data.orders.pageInfo?.endCursor||null;
  if(hasNext&&!cursor)throw new Error("خطأ في Pagination أوردرات Shopify.");
 }
 const orders=[];
 for(const o of raw){
  const lines=await getItems(o);
  const name=o.customer?[o.customer.firstName,o.customer.lastName].filter(Boolean).join(" "):"—";
  orders.push({id:o.legacyResourceId||o.id,shortId:o.name,date:o.createdAt,
   status:String(o.displayFinancialStatus||"").toLowerCase(),
   total:Number(o.totalPriceSet?.shopMoney?.amount||0),customer:name,
   city:o.shippingAddress?.city||"—",country:o.shippingAddress?.country||"—",
   products:lines.map(line=>mapLine(line,o.id)),utm:extractUTM(o)});
 }
 return aggregate(orders,from,to);
}
window.utmDirectApi=Object.freeze({loadOrders});
})();