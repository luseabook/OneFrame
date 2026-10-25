/**
 * F0.4 登录态证据补抓（复用 10-24 的 chrome-profile 会话）
 *
 * 关键点：页面导航靠 cookie 会话（有效），API 调用需要 renew 换出的 access_token。
 * 每页独立 page、硬超时、逐页 finally；只写证据文件，不改任何代码。
 *
 * 用法: node capture-authed.cjs [批次名]
 * 产物: _acceptance/ref-authed/<name>.png / -bottom.png / .html / capture-report.json
 */
const { chromium } = require("playwright-core");
const fs = require("node:fs");
const path = require("node:path");

const OUT = path.join(__dirname, "ref-authed");
const CDP = process.env.CDP || "http://127.0.0.1:9223";
const ORIGIN = "https://www.reelmate.cn";
const PAGE_BUDGET = Number(process.env.PAGE_BUDGET_MS || 60_000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function race(p, ms, label) {
  let t;
  const timeout = new Promise((_, rej) => { t = setTimeout(() => rej(new Error(`timeout ${ms}ms @${label}`)), ms); });
  try { return await Promise.race([p, timeout]); } finally { clearTimeout(t); }
}

// F0.4 Top5 优先 + 证据审计列出的登录态页面
const ROUTES = [
  ["task", "/task"],
  ["user-center", "/user-center"],
  ["settings", "/setting"],
  ["profile", "/profile"],
  ["team", "/team"],
  ["team-dashboard", "/team/dashboard"],
  ["team-kb", "/team/knowledge-base"],
  ["script-manage", "/script-manage"],
  ["episode-list", "/episode-list"],
  ["series-manage", "/series-manage"],
  ["canvas", "/canvas"],
  ["workflow-canvas", "/workflow-canvas"],
  ["pricing", "/pricing"],
  ["mcp", "/mcp"],
  ["cli", "/cli"],
  ["film-creation", "/film-creation"],
  ["film", "/film"],
  ["novel-market", "/novel-market/1"],
  ["creator-center", "/creator-center"],
  ["creation-agent", "/creation-agent"],
  ["assets", "/asset"],
  ["reelflow-list", "/reelflow/list"],
];

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.connectOverCDP(CDP);
  const ctx = browser.contexts()[0] || (await browser.newContext());
  const report = { capturedAt: new Date().toISOString(), cdp: CDP, pages: {} };

  // 1) 用 renew 换新 token（仅用于 API 侧；页面靠 cookie）
  //    注意：必须在站内 origin 下 fetch，空白页会因跨域失败（v1 踩过）
  const boot = await ctx.newPage();
  const auth = await (async () => {
    try {
      await boot.goto(ORIGIN + "/", { waitUntil: "domcontentloaded", timeout: 30_000 });
      await sleep(2500);
      return await boot.evaluate(async () => {
        try {
          const r = await fetch("https://app.reelmate.cn/web/v1/renew", { credentials: "include" });
          const j = await r.json();
          return { ok: j.code === 0, hasToken: !!j.data?.access_token, spaceId: j.data?.space_id ?? null, uid: j.data?.uid ?? null };
        } catch (e) { return { ok: false, error: String(e).slice(0, 120) }; }
      });
    } catch (e) {
      return { ok: false, error: String(e).slice(0, 120) };
    } finally {
      await boot.close().catch(() => {});
    }
  })();
  report.auth = auth;
  console.log("AUTH:", JSON.stringify(auth));
  if (!auth.ok) {
    // 不再直接退出：cookie 会话仍可能有效，先跑页面采集，由每页的 finalUrl/textLen 判定
    console.warn("⚠ renew 探测失败，继续尝试页面采集（若全是登录页则需 Owner 登录）");
  }

  for (const [name, route] of ROUTES) {
    const started = Date.now();
    let page;
    const rec = { route, url: ORIGIN + route };
    try {
      page = await ctx.newPage();
      page.setDefaultTimeout(20_000);
      await page.setViewportSize({ width: 1600, height: 1000 });

      const resp = await race(page.goto(ORIGIN + route, { waitUntil: "commit", timeout: 30_000 }), 35_000, "goto");
      rec.status = resp ? resp.status() : null;
      rec.finalUrl = page.url();          // 是否被重定向（未登录/无权限的信号）

      await race(
        page.waitForFunction(() => document.body && document.body.innerText.replace(/\s+/g, "").length > 150, null, { timeout: 22_000, polling: 400 }),
        26_000, "render",
      ).catch(() => { rec.renderWarn = "正文渲染等待超时"; });
      await sleep(2000);

      rec.title = await race(page.title(), 8_000, "title").catch(() => null);
      const top = path.join(OUT, `${name}.png`);
      await race(page.screenshot({ path: top, fullPage: false }), 20_000, "shot-top").catch(() => { rec.shotWarn = "截图超时"; });
      if (fs.existsSync(top)) { rec.png = path.relative(path.join(__dirname, ".."), top); rec.pngBytes = fs.statSync(top).size; }

      // 滚到底再截一张（FAQ/页脚/长表格）
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => {});
      await sleep(1200);
      const bot = path.join(OUT, `${name}-bottom.png`);
      await race(page.screenshot({ path: bot, fullPage: false }), 20_000, "shot-bottom").catch(() => {});
      if (fs.existsSync(bot)) { rec.pngBottom = path.relative(path.join(__dirname, ".."), bot); }

      const meta = await page.evaluate(() => {
        const txt = (document.body.innerText || "").replace(/\s+/g, " ");
        const vis = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 1 && r.height > 1 && cs.display !== "none" && cs.visibility !== "hidden"; };
        const uniq = (a) => Array.from(new Set(a.filter(Boolean)));
        return {
          textLen: txt.replace(/\s/g, "").length,
          textHead: txt.slice(0, 400),
          headings: uniq(Array.from(document.querySelectorAll("h1,h2,h3,h4")).filter(vis).map((e) => (e.innerText || "").replace(/\s+/g, " ").trim())).slice(0, 20),
          tabs: uniq(Array.from(document.querySelectorAll('[role="tab"],[class*="tab"]')).filter(vis).map((e) => (e.innerText || "").replace(/\s+/g, " ").trim())).filter((t) => t.length < 24).slice(0, 25),
          buttons: uniq(Array.from(document.querySelectorAll("button,[role=button]")).filter(vis).map((e) => (e.innerText || "").replace(/\s+/g, " ").trim())).filter((t) => t && t.length < 24).slice(0, 30),
          tables: document.querySelectorAll("table").length,
          rows: document.querySelectorAll("tr").length,
          hasEmpty: /暂无|没有数据|空|去创建|新建/.test(txt.slice(0, 1200)),
        };
      }).catch(() => ({}));
      Object.assign(rec, meta);
      fs.writeFileSync(path.join(OUT, `${name}.html`), await race(page.content(), 12_000, "html").catch(() => ""), "utf8");
      rec.elapsedMs = Date.now() - started;
      console.log(`OK  ${name.padEnd(16)} ${rec.status ?? "-"} text=${rec.textLen ?? "?"} h=${(rec.headings || []).length} ${rec.elapsedMs}ms ${rec.finalUrl === ORIGIN + route ? "" : "→ " + rec.finalUrl}`);
    } catch (e) {
      rec.error = e.message;
      rec.elapsedMs = Date.now() - started;
      console.log(`ERR ${name.padEnd(16)} ${e.message}`);
    } finally {
      report.pages[name] = rec;
      if (page) await page.close().catch(() => {});
    }
    if (Date.now() - started > PAGE_BUDGET) rec.budgetExceeded = true;
  }

  fs.writeFileSync(path.join(OUT, "capture-report.json"), JSON.stringify(report, null, 2), "utf8");
  console.log("\nreport ->", path.join(OUT, "capture-report.json"));
  process.exit(0);
})().catch((e) => { console.error("FATAL", e.message); process.exit(1); });
