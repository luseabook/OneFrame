const { chromium } = require("playwright-core");
(async () => {
  const b = await chromium.connectOverCDP("http://127.0.0.1:9222");
  const ctx = b.contexts()[0];
  const p = await ctx.newPage();
  await p.setViewportSize({ width: 1440, height: 900 });
  const r = await p.goto("https://www.reelmate.cn/mcp", { waitUntil: "commit", timeout: 30000 });
  await new Promise((res) => setTimeout(res, 6000));
  console.log("status", r && r.status());
  console.log("final", p.url());
  const txt = await p.evaluate(() => document.body.innerText);
  console.log("textLen", txt.replace(/\s+/g, "").length);
  console.log("head:", txt.replace(/\s+/g, " ").slice(0, 500));
  await p.close();
  process.exit(0);
})().catch((e) => {
  console.error("ERR", e.message);
  process.exit(1);
});
