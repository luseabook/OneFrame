/**
 * /canvas 编辑器探针（DOM 度量，不依赖人眼看图）
 *
 * 用途：给 canvas 前端改造提供"改造前/改造后"的可比对基线。
 * 输出：控制台打印结构度量 + _acceptance/canvas-probe-<tag>.json + 截图
 *
 * 用法：node canvas-probe.cjs [tag] [route]
 *   tag   产物后缀（默认 now）
 *   route 目标路由（默认 /canvas；可传 /canvas/<id> 直接看编辑器）
 *
 * 注意：发码接口对同一手机号有 1 次/分钟 频控，所以只发一次码，
 * 并用这一次码在浏览器里走真实 UI 登录（拿到 HttpOnly refresh cookie）。
 */
const { chromium } = require("playwright-core");
const fs = require("node:fs");
const path = require("node:path");

const API = "http://127.0.0.1:3002/v1";
const WEB = "http://127.0.0.1:3003";
const CDP = process.env.CDP || "http://127.0.0.1:9222";
const TAG = process.argv[2] || "now";
const ROUTE = process.argv[3] || "/canvas";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(method, p, body) {
  const res = await fetch(API + p, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return res.json();
}

(async () => {
  // 每个手机号每天 5 次发码额度；本次只发 1 次，一次运行不撞频控
  const tail = String(Date.now()).slice(-8);
  const phone = `1${tail}77`;
  const sms = await api("POST", "/auth/sms-code", { phone });
  if (sms.code !== 0) throw new Error(`sms-code failed: ${JSON.stringify(sms)}`);
  const code = String(sms.data.debug_code);

  const browser = await chromium.connectOverCDP(CDP);
  const ctx = browser.contexts()[0] || (await browser.newContext());
  const page = await ctx.newPage();
  page.setDefaultTimeout(20_000);
  await page.setViewportSize({ width: 1440, height: 900 });

  // 真实 UI 登录，让 HttpOnly refresh cookie 落到这个浏览器上下文。
  // 注意 auth.login() 会先 await /me 再跳转，必须等到离开 /login 才算拿到 cookie。
  await page.goto(`${WEB}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('input[placeholder="请输入手机号码"]', { timeout: 20_000 });
  await page.fill('input[placeholder="请输入手机号码"]', phone);
  await page.fill('input[placeholder="请输入验证码"]', code);
  await page.locator(".agree-row input[type=checkbox]").check().catch(() => {});
  await page.locator("button.submit").click();
  await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 30_000 }).catch(() => {});
  await sleep(800);
  const loggedIn = !page.url().includes("/login");

  await page.goto(`${WEB}${ROUTE}`, { waitUntil: "domcontentloaded" });
  await sleep(3000);

  const measure = await page.evaluate(() => {
    const rect = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
    };
    const count = (sel) => document.querySelectorAll(sel).length;
    const cs = (sel, prop) => {
      const el = document.querySelector(sel);
      return el ? getComputedStyle(el).getPropertyValue(prop) : null;
    };
    return {
      url: location.pathname,
      title: document.title,
      bodyText: (document.body.innerText || "").replace(/\s+/g, " ").slice(0, 800),
      counts: {
        sidebar: count(".sidebar"),
        node: count(".node"),
        edge: count(".edge"),
        paletteItem: count(".palette-item"),
        button: count("button"),
        input: count("input"),
        textarea: count("textarea"),
        svg: count("svg"),
      },
      rects: {
        sidebar: rect(".sidebar"),
        stage: rect(".stage"),
        canvasView: rect(".cv"),
        palette: rect(".palette"),
        inspector: rect(".inspector"),
        topbar: rect(".bar"),
      },
      styles: {
        bodyBg: cs("body", "background-color"),
        stageBg: cs(".stage", "background-image"),
      },
      hasSidebarNav: !!document.querySelector(".sidebar .nav-item, .sidebar nav"),
      horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    };
  });

  const out = { tag: TAG, route: ROUTE, loggedIn, measuredAt: new Date().toISOString(), ...measure };
  const file = path.join(__dirname, `canvas-probe-${TAG}.json`);
  fs.writeFileSync(file, JSON.stringify(out, null, 2));
  await page.screenshot({ path: path.join(__dirname, `canvas-probe-${TAG}.png`), fullPage: false });

  console.log(JSON.stringify(out, null, 2));
  console.log(`\n产物：${file}`);
  await page.close();
  process.exit(0);
})().catch((e) => {
  console.error("PROBE ERROR:", e.message);
  process.exit(1);
});

