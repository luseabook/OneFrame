/**
 * 团队池入账验证：团队空间能否走现有 billing 下单 + 支付回填
 * 结论用于判断"团队充值"是否还需要新代码。
 */
const BASE = "http://127.0.0.1:3000/v1";

async function call(method, path, body, token, spaceId) {
  const headers = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  if (spaceId) headers["x-space-id"] = spaceId;
  const res = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 200) }; }
  return { status: res.status, ...json };
}

(async () => {
  const stamp = String(Date.now()).slice(-8);
  const phone = `1${stamp}11`;
  const sms = await call("POST", "/auth/sms-code", { phone });
  const login = await call("POST", "/auth/login", { phone, code: sms.data?.debug_code, age_confirmed: true });
  const token = login.data?.access_token;
  if (!token) { console.error("login failed", JSON.stringify(login).slice(0, 200)); process.exit(1); }

  const created = await call("POST", "/cam/team", { name: "入账测试团队" }, token);
  const teamSpaceId = created.data?.space_id;
  console.log("team space =", teamSpaceId);

  // 1) 团队空间当前池
  const before = await call("GET", "/cam/team/info", undefined, token, teamSpaceId);
  console.log("pool before =", before.data?.credit_total);

  // 2) 可用 SKU（billing/skus 是公开契约的一部分）
  const skus = await call("GET", "/billing/skus", undefined, token, teamSpaceId);
  const sku = (skus.data?.list ?? [])[0] ?? (Array.isArray(skus.data) ? skus.data[0] : null);
  console.log("sku =", sku ? `${sku.sku}/${sku.credits}积分/${sku.price_cents}分` : "NONE", "code=", skus.code);

  // 3) 在团队空间下单（PAYMENT_LIVE=false 时允许 mock 渠道）
  const order = await call("POST", "/billing/orders", { sku: sku?.sku, channel: "mock" }, token, teamSpaceId);
  console.log("order ->", order.code, order.data?.order_id ?? order.data?.id ?? JSON.stringify(order.data ?? {}).slice(0, 120));
  const orderId = order.data?.order_id ?? order.data?.id;

  // 4) mock 支付回填
  const pay = await call("POST", `/billing/orders/${orderId}/mock-pay`, {}, token, teamSpaceId);
  console.log("mock-pay ->", pay.code, pay.msg ?? "");

  // 5) 再看团队池
  const after = await call("GET", "/cam/team/info", undefined, token, teamSpaceId);
  console.log("pool after  =", after.data?.credit_total);

  // 6) 个人空间池应不受影响（新用户有 80 赠送积分，故这里比较的是"未因团队下单而增加"）
  const personal = await call("GET", "/cam/team/info", undefined, token);
  console.log("personal pool =", personal.data?.credit_total, "（新用户赠送 80 属既有逻辑）");

  const pass = order.code === 0 && pay.code === 0 && after.data.credit_total === before.data.credit_total + (sku?.credits ?? 0)
    && (personal.data.credit_total ?? 0) < (after.data.credit_total ?? 0);
  console.log(pass ? "\n✅ 团队池可直接用现有 billing 入账（无需新后端代码）" : "\n❌ 需要补代码");
  process.exit(pass ? 0 : 1);
})().catch((e) => { console.error("FATAL", e.message); process.exit(1); });
