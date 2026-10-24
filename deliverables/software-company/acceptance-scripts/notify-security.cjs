const { execSync } = require("node:child_process");
const API = "http://127.0.0.1:3000/v1";
const PHONE = "1387777" + String(Date.now()).slice(-4);
const sleep = ms => new Promise(r => setTimeout(r, ms));
function rg(k){ const raw=execSync(`redis-cli -p 6380 --raw get ${k}`,{encoding:"utf8"}).trim(); try{return JSON.parse(raw).code}catch{return raw} }
async function api(m,p,b,t){ const h={}; if(t)h.authorization=`Bearer ${t}`; if(b!==undefined)h["content-type"]="application/json";
  const r=await fetch(API+p,{method:m,headers:h,body:b===undefined?undefined:JSON.stringify(b)}); const x=await r.text();
  try{return {status:r.status,...JSON.parse(x)}}catch{return {status:r.status,code:"EXC",raw:x}} }
(async()=>{
  const R=[]; const ok=(n,c,d="")=>{R.push(c); console.log(`${c?"PASS":"FAIL"} | ${n}${d?" | "+String(d).slice(0,80):""}`)};
  await api("POST","/auth/sms-code",{phone:PHONE}); await sleep(1200);
  const t=(await api("POST","/auth/login",{phone:PHONE,code:rg(`sms:code:${PHONE}`),age_confirmed:true})).data.access_token;

  // 下单（mock）
  const o = await api("POST","/billing/orders",{sku:"credits-500",channel:"mock"},t);
  ok("前置：mock 订单创建", o.code===0, `order=${o.data?.order_id}`);
  const orderId = o.data.order_id;
  const balBefore = (await api("GET","/me",undefined,t)).data.credits.balance;

  // 1) 微信回调：未配置平台公钥 → 必须拒绝
  const w = await api("POST","/billing/notify/wechat",{id:"evt",resource:{ciphertext:"x",nonce:"y"}});
  ok("1. 微信回调未配置公钥时拒绝（防伪造入账）", w.code===401101, `code=${w.code} msg=${String(w.msg).slice(0,40)}`);

  // 2) 支付宝回调：未配置公钥 → 必须拒绝
  const a = await api("POST","/billing/notify/alipay",{out_trade_no:orderId,trade_no:"ali-1",trade_status:"TRADE_SUCCESS",total_amount:"50.00",sign:"fake"});
  ok("2. 支付宝回调未配置公钥时拒绝", a.code===401101, `code=${a.code}`);

  // 3) 伪造签名也不放行（即使未来配置了公钥，错误签名必须失败）——当前无公钥已覆盖，验证余额未变
  const balAfter = (await api("GET","/me",undefined,t)).data.credits.balance;
  ok("3. 伪造回调未导致入账（余额不变）", balAfter===balBefore, `${balBefore} → ${balAfter}`);

  // 4) mock-pay 在 PAYMENT_LIVE=false 时可用（联调路径）
  const mp = await api("POST",`/billing/orders/${orderId}/mock-pay`,{},t);
  ok("4. mock-pay 在非生产模式下可用", mp.code===0 && mp.data?.credited===true, `credited=${mp.data?.credited}`);

  // 5) 金额篡改仍被拒（已有测试，回归一次）
  const o2 = await api("POST","/billing/orders",{sku:"credits-1000",channel:"mock"},t);
  const tamper = await api("POST","/billing/notify/mock",{order_id:o2.data.order_id,channel_order_id:"cb-x",amount_cents:1});
  ok("5. 金额篡改被拒（回归）", tamper.code===400101, `code=${tamper.code}`);

  const p=R.filter(Boolean).length;
  console.log(`\n=== 结果：${p}/${R.length} 通过 ===`);
  process.exitCode = p===R.length?0:1;
})();
