/**
 * 支付闭环验收（B 型可商用）：SKU → 下单 → 支付 → 入账 → 幂等 → 流水 → 消费
 */
const { execSync } = require("node:child_process");

const API = "http://127.0.0.1:3000/v1";
const PHONE = "1385555" + String(Date.now()).slice(-4);
const results = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function ok(name, cond, detail = "") {
  results.push({ name, pass: !!cond });
  console.log(`${cond ? "PASS" : "FAIL"} | ${name}${detail ? " | " + String(detail).slice(0, 100) : ""}`);
}
function rg(k) {
  const raw = execSync(`redis-cli -p 6380 --raw get ${k}`, { encoding: "utf8" }).trim();
  try {
    return JSON.parse(raw).code;
  } catch {
    return raw;
  }
}
async function api(m, p, b, t) {
  const h = {};
  if (t) h.authorization = `Bearer ${t}`;
  if (b !== undefined) h["content-type"] = "application/json";
  const r = await fetch(`${API}${p}`, { method: m, headers: h, body: b === undefined ? undefined : JSON.stringify(b) });
  const x = await r.text();
  try {
    return { status: r.status, ...JSON.parse(x) };
  } catch {
    return { status: r.status, code: "EXC", raw: x };
  }
}

(async () => {
  console.log(`\n=== 支付闭环验收 (phone=${PHONE}) ===\n`);

  // ── 1. SKU 目录（公开） ──
  const skus = await api("GET", "/billing/skus");
  ok("1. SKU 目录公开可读", skus.code === 0 && skus.data.length >= 4, `count=${skus.data?.length}`);
  const sku500 = skus.data.find((s) => s.sku === "credits-500");
  ok("1b. SKU 含价格与积分", sku500?.price_cents === 5000 && sku500?.credits === 500, `${sku500?.price_cents}分/${sku500?.credits}积分`);

  // ── 2. 登录 ──
  await api("POST", "/auth/sms-code", { phone: PHONE });
  await sleep(1200);
  const login = await api("POST", "/auth/login", { phone: PHONE, code: rg(`sms:code:${PHONE}`), age_confirmed: true });
  const t = login.data?.access_token;
  const me0 = await api("GET", "/me", undefined, t);
  const bal0 = me0.data.credits.balance;
  ok("2. 登录（初始余额 80）", login.code === 0 && bal0 === 80, `balance=${bal0}`);

  // ── 3. 真实渠道未配置时应拒绝（防假支付） ──
  const wechatOrder = await api("POST", "/billing/orders", { sku: "credits-500", channel: "wechat" }, t);
  ok(
    "3. PAYMENT_LIVE=false 时拒绝真实渠道（防假支付）",
    wechatOrder.code === 400101,
    `code=${wechatOrder.code} msg=${String(wechatOrder.msg).slice(0, 40)}`,
  );

  // ── 4. mock 渠道下单 ──
  const order = await api("POST", "/billing/orders", { sku: "credits-500", channel: "mock" }, t);
  ok("4. mock 渠道下单成功", order.code === 0 && !!order.data?.order_id, `order=${order.data?.order_id}`);
  const orderId = order.data.order_id;
  ok("4b. 订单快照金额与积分", order.data.amount_cents === 5000 && order.data.credits === 500, `${order.data.amount_cents}/${order.data.credits}`);
  ok("4c. 订单状态为待支付", order.data.status === 1, `status=${order.data.status}`);

  // ── 5. 60s 内重复下单复用同一订单（防双击） ──
  const dup = await api("POST", "/billing/orders", { sku: "credits-500", channel: "mock" }, t);
  ok("5. 60s 内重复下单复用同一订单", dup.data?.order_id === orderId, `dup=${dup.data?.order_id === orderId}`);

  // ── 6. 支付前余额不变 ──
  const me1 = await api("GET", "/me", undefined, t);
  ok("6. 支付前余额未变", me1.data.credits.balance === bal0, `balance=${me1.data.credits.balance}`);

  // ── 7. 标记支付 → 入账 ──
  const pay = await api("POST", `/billing/orders/${orderId}/mock-pay`, {}, t);
  ok("7. 标记支付成功并入账", pay.code === 0 && pay.data?.credited === true, JSON.stringify(pay.data).slice(0, 80));
  const me2 = await api("GET", "/me", undefined, t);
  ok("7b. 余额 +500", me2.data.credits.balance === bal0 + 500, `${bal0} → ${me2.data.credits.balance}`);

  // ── 8. 幂等：重复支付不重复入账 ──
  const pay2 = await api("POST", `/billing/orders/${orderId}/mock-pay`, {}, t);
  const me3 = await api("GET", "/me", undefined, t);
  ok(
    "8. 重复支付幂等（不重复入账）",
    pay2.code === 0 && pay2.data?.credited === false && me3.data.credits.balance === me2.data.credits.balance,
    `credited=${pay2.data?.credited} balance=${me3.data.credits.balance}`,
  );

  // ── 9. 重复回调（notify）也幂等 ──
  const notify1 = await api("POST", "/billing/notify/mock", { order_id: orderId, channel_order_id: "cb-1", amount_cents: 5000 });
  const notify2 = await api("POST", "/billing/notify/mock", { order_id: orderId, channel_order_id: "cb-2", amount_cents: 5000 });
  const me4 = await api("GET", "/me", undefined, t);
  ok(
    "9. 支付回调重复到达不重复入账",
    notify1.code === 0 && notify2.code === 0 && me4.data.credits.balance === me3.data.credits.balance,
    `balance=${me4.data.credits.balance}`,
  );

  // ── 10. 金额篡改应被拒绝 ──
  const order2 = await api("POST", "/billing/orders", { sku: "credits-1000", channel: "mock" }, t);
  const tampered = await api("POST", "/billing/notify/mock", {
    order_id: order2.data.order_id,
    channel_order_id: "cb-bad",
    amount_cents: 1,
  });
  ok("10. 回调金额与订单不符时拒绝入账", tampered.code === 400101, `code=${tampered.code}`);

  // ── 11. 订单状态查询 ──
  const detail = await api("GET", `/billing/orders/${orderId}`, undefined, t);
  ok("11. 订单查询显示已支付", detail.code === 0 && detail.data.status === 2, `status=${detail.data.status} label=${detail.data.status_label}`);

  // ── 12. 订单历史 ──
  const hist = await api("GET", "/billing/orders?page=1&page_size=10", undefined, t);
  ok("12. 订单历史可查", hist.code === 0 && hist.data.total >= 2, `total=${hist.data.total}`);

  // ── 13. 积分流水含 recharge 且带 order 引用 ──
  const flows = await api("GET", "/credits/flows?page=1&page_size=50", undefined, t);
  const recharge = flows.data.list.find((f) => f.kind === "recharge" && f.delta === 500);
  ok("13. 流水记录 recharge +500", !!recharge, recharge ? `kind=${recharge.kind} delta=${recharge.delta}` : "未找到");

  // ── 14. 充值后可用于消费（余额足够投递） ──
  const quote = await api("POST", "/credits/quote", {
    mode: "text2video",
    model: "sky-media-2.0",
    input: { prompt: "充值后消费验证" },
    options: { ratio: "9:16", resolution: "720p", duration: 5, count: 1 },
  }, t);
  ok("14. 充值后正常报价", quote.code === 0 && quote.data.balance_after_estimate >= 0, `credits=${quote.data?.credits}`);

  // ── 15. 关闭未支付订单 ──
  const close = await api("POST", `/billing/orders/${order2.data.order_id}/close`, {}, t);
  ok("15. 关闭未支付订单", close.code === 0 && close.data.closed === true, `closed=${close.data?.closed}`);
  const order2Detail = await api("GET", `/billing/orders/${order2.data.order_id}`, undefined, t);
  ok("15b. 关闭后状态为已关闭(3)", order2Detail.data.status === 3, `status=${order2Detail.data.status}`);

  // ── 16. 已关闭订单不可支付 ──
  const payClosed = await api("POST", "/billing/notify/mock", {
    order_id: order2.data.order_id,
    channel_order_id: "cb-closed",
    amount_cents: 10000,
  });
  ok("16. 已关闭订单不可支付", payClosed.code === 400101, `code=${payClosed.code}`);

  // ── 17. ledger 不变式仍成立 ──
  const flows2 = await api("GET", "/credits/flows?page=1&page_size=100", undefined, t);
  const sum = flows2.data.list.reduce((a, f) => a + f.delta, 0);
  const me5 = await api("GET", "/me", undefined, t);
  ok("17. 积分 ledger 不变式（含充值）", sum === me5.data.credits.balance, `Σdelta=${sum} balance=${me5.data.credits.balance}`);

  // ── 18. 跨空间隔离：他人订单不可查 ──
  const otherPhone = "1385556" + String(Date.now()).slice(-4);
  await api("POST", "/auth/sms-code", { phone: otherPhone });
  await sleep(1200);
  const login2 = await api("POST", "/auth/login", { phone: otherPhone, code: rg(`sms:code:${otherPhone}`), age_confirmed: true });
  const t2 = login2.data?.access_token;
  const crossOrder = await api("GET", `/billing/orders/${orderId}`, undefined, t2);
  ok("18. 跨空间订单隔离", crossOrder.code === 400102, `code=${crossOrder.code}`);

  const passed = results.filter((r) => r.pass).length;
  console.log(`\n=== 结果：${passed}/${results.length} 通过 ===`);
  const failed = results.filter((r) => !r.pass);
  if (failed.length) failed.forEach((f) => console.log(`  - ${f.name}`));
  process.exitCode = failed.length ? 1 : 0;
})();
