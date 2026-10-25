/**
 * 探测登录态 v2：用真实的键名 tomoviee.token-info / _user_id
 * 只读；不打印任何 token 值，只报长度与 API 返回码。
 */
const { chromium } = require("playwright-core");

(async () => {
  const b = await chromium.connectOverCDP("http://127.0.0.1:9223");
  const ctx = b.contexts()[0];
  const page = ctx.pages().find((p) => p.url().includes("reelmate.cn")) || ctx.pages()[0];
  await page.bringToFront().catch(() => {});
  await new Promise((r) => setTimeout(r, 2500));

  const r = await page.evaluate(async () => {
    const readJson = (k) => { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch { return null; } };
    const ti = readJson("tomoviee.token-info") || {};
    const ui = readJson("tomoviee.user-info") || {};
    const tok = ti.access_token || ti.accessToken || "";
    const out = {
      tokenKeys: Object.keys(ti),
      accessTokenLen: tok ? String(tok).length : 0,
      uid: ti.uid ?? null,
      spaceId: ti.space_id ?? null,
      expiresIn: ti.expires_in ?? null,
      masterTokenLen: ti.master_access_token ? String(ti.master_access_token).length : 0,
      userInfoKeys: Object.keys(ui).slice(0, 20),
      userNickname: ui.nickname ?? null,
      userVipFeature: ui.vip_info?.feature_code ?? null,
      region: ui.region ?? null,
      dataCenter: ui.data_center ?? null,
      spaceIdFromUserInfo: ui.space_id ?? null,
    };
    const probes = {};
    for (const [name, url] of [
      ["renew", "https://app.reelmate.cn/web/v1/renew"],
      ["user-info", "https://app.reelmate.cn/web/v1/user-info"],
      ["task-list", "https://app.reelmate.cn/web/v1/task?page=1&page_size=1&request_type=task_list"],
      ["cam-permission", "https://app.reelmate.cn/web/v1/cam/permission/user"],
    ]) {
      try {
        const res = await fetch(url, { headers: tok ? { Authorization: tok, "X-Prod-Id": "20438" } : {}, credentials: "include" });
        const t = await res.text();
        let code = null, keys = null;
        try { const j = JSON.parse(t); code = j.code; keys = j.data ? Object.keys(j.data).slice(0, 12) : null; } catch {}
        probes[name] = { status: res.status, code, dataKeys: keys, len: t.length };
      } catch (e) { probes[name] = { error: String(e).slice(0, 100) }; }
    }
    return { ...out, probes };
  });
  console.log(JSON.stringify(r, null, 2));
  process.exit(0);
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });
