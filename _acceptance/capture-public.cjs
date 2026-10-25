/**
 * F0 证据补抓（公开页，无需登录态）— v2 防御式版本
 *
 * v1 教训：Nuxt SPA 用 domcontentloaded + 固定 sleep 会拿到未渲染的壳（textLen=144），
 * 且 fullPage 截图在重页上可能长时间不返回。本版：
 *  - 每页独立 page，finally 关闭
 *  - goto(waitUntil:"commit") + 轮询等待正文渲染
 *  - 只截视口图 + 滚到底再截一张（不做 fullPage 拼图，避免超时）
 *  - 每页硬超时，绝不悬挂
 *
 * 用法：node capture-public.cjs
 * 产物：_acceptance/ref2/<name>.png / -bottom.png / .html / capture-report.json
 */
const { chromium } = require("playwright-core");
const fs = require("node:fs");
const path = require("node:path");

const OUT = path.join(__dirname, "ref2");
const CDP = process.env.RECAP_CDP || "http://127.0.0.1:9222";
const ORIGIN = "https://www.reelmate.cn";
const PAGE_BUDGET_MS = Number(process.env.PAGE_BUDGET_MS || 75_000);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timeout ${ms}ms @ ${label}`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

const ROUTES = [
  ["pricing-full", "/pricing"],
  ["mcp", "/mcp"],
  ["tools-recheck", "/tools"],
];

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.connectOverCDP(CDP);
  const ctx = browser.contexts()[0] || (await browser.newContext());
  const report = { capturedAt: new Date().toISOString(), cdp: CDP, pages: {} };

  for (const [name, route] of ROUTES) {
    const started = Date.now();
    let page;
    const rec = { route, url: ORIGIN + route };
    try {
      page = await ctx.newPage();
      page.setDefaultTimeout(20_000);
      await page.setViewportSize({ width: 1440, height: 900 });

      const resp = await withTimeout(
        page.goto(ORIGIN + route, { waitUntil: "commit", timeout: 30_000 }),
        35_000,
        "goto",
      );
      rec.status = resp ? resp.status() : null;

      // 轮询等待渲染：正文长度 > 400 或出现 h1/h2，最多 25s
      await withTimeout(
        page.waitForFunction(
          () => document.body && document.body.innerText.replace(/\s+/g, "").length > 400,
          null,
          { timeout: 25_000, polling: 500 },
        ),
        30_000,
        "render-wait",
      ).catch(() => {
        rec.renderWarn = "正文渲染等待超时（可能仍是壳）";
      });

      await sleep(1500);
      rec.finalUrl = page.url();
      rec.title = await withTimeout(page.title(), 10_000, "title");

      const topPng = path.join(OUT, `${name}.png`);
      await withTimeout(page.screenshot({ path: topPng, fullPage: false }), 25_000, "shot-top");
      rec.png = path.relative(path.join(__dirname, ".."), topPng);
      rec.pngBytes = fs.statSync(topPng).size;

      // 滚到底：FAQ / 页脚
      const scrollInfo = await withTimeout(
        page.evaluate(() => {
          window.scrollTo(0, document.body.scrollHeight);
          return { docHeight: document.body.scrollHeight, scrollY: window.scrollY };
        }),
        15_000,
        "scroll",
      ).catch(() => ({ docHeight: null, scrollY: null }));
      rec.docHeight = scrollInfo.docHeight;
      await sleep(1200);
      const bottomPng = path.join(OUT, `${name}-bottom.png`);
      await withTimeout(page.screenshot({ path: bottomPng, fullPage: false }), 25_000, "shot-bottom").catch(() => {
        rec.bottomWarn = "底部长截图超时";
      });
      if (fs.existsSync(bottomPng)) {
        rec.pngBottom = path.relative(path.join(__dirname, ".."), bottomPng);
        rec.pngBottomBytes = fs.statSync(bottomPng).size;
      }

      const meta = await withTimeout(
        page.evaluate(() => ({
          textLen: document.body.innerText.replace(/\s+/g, "").length,
          headings: Array.from(document.querySelectorAll("h1,h2,h3"))
            .map((e) => (e.innerText || "").replace(/\s+/g, " ").trim())
            .filter(Boolean)
            .slice(0, 25),
          hasFooter: !!document.querySelector("footer"),
        })),
        15_000,
        "meta",
      ).catch(() => ({}));
      Object.assign(rec, meta);

      fs.writeFileSync(path.join(OUT, `${name}.html`), await withTimeout(page.content(), 15_000, "html"), "utf8");
      rec.elapsedMs = Date.now() - started;
      console.log(
        `OK  ${name.padEnd(14)} ${rec.status ?? "-"}  text=${rec.textLen ?? "?"}  h=${rec.docHeight ?? "?"}  ${rec.elapsedMs}ms  ${rec.finalUrl}`,
      );
    } catch (e) {
      rec.error = e.message;
      rec.elapsedMs = Date.now() - started;
      console.log(`ERR ${name.padEnd(14)} ${e.message} (${rec.elapsedMs}ms)`);
    } finally {
      report.pages[name] = rec;
      if (page) await page.close().catch(() => {});
    }
    if (Date.now() - started > PAGE_BUDGET_MS) {
      rec.budgetExceeded = true;
    }
  }

  fs.writeFileSync(path.join(OUT, "capture-report.json"), JSON.stringify(report, null, 2), "utf8");
  // 连的是外部浏览器：不 close，避免关掉别人的 Chrome
  console.log("\nreport ->", path.join(OUT, "capture-report.json"));
  process.exit(0);
})().catch((e) => {
  console.error("FATAL", e.message);
  process.exit(1);
});
