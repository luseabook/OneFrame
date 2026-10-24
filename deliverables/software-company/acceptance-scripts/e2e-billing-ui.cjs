/**
 * 支付 UI 闭环验收：定价页购买 → 余额增加 → 积分流水
 */
const { chromium } = require("playwright-core");
const fs = require("node:fs");
const path = require("node:path");
const { execSync } = require("node:child_process");

const OUT = path.join(__dirname, "shots-billing");
fs.mkdirSync(OUT, { recursive: true });
const WEB = "http://127.0.0.1:3001";
const PHONE = "1386666" + String(Date.now()).slice(-4);
const results = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function ok(name, cond, detail = "") {
  results.push({ name, pass: !!cond });
  console.log(`${cond ? "PASS" : "FAIL"} | ${name}${detail ? " | " + String(detail).slice(0, 90) : ""}`);
}
function rg(k) {
  const raw = execSync(`redis-cli -p 6380 --raw get ${k}`, { encoding: "utf8" }).trim();
  try {
    return JSON.parse(raw).code;
  } catch {
    return raw;
  }
}

(async () => {
  const b = await chromium.launch({
    executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    headless: true,
  });
  const ctx = await b.newContext({ viewport: { width: 1600, height: 1000 }, locale: "zh-CN" });
  const p = await ctx.newPage();
  const errs = [];
  p.on("console", (m) => {
    if (m.type() === "error") errs.push(m.text().slice(0, 90));
  });
  p.on("pageerror", (e) => errs.push("pageerror: " + String(e).slice(0, 90)));

  console.log(`\n=== 支付 UI 闭环验收 (phone=${PHONE}) ===\n`);

  // 登录
  execSync("redis-cli -p 6380 FLUSHALL", { encoding: "utf8" });
  await p.goto(`${WEB}/login`, { waitUntil: "networkidle" });
  await p.waitForTimeout(800);
  await p.fill('input[placeholder*="11 位手机号"]', PHONE);
  await p.waitForTimeout(400);
  await p.getByRole("button", { name: /获取验证码/ }).click();
  await p.waitForTimeout(1800);
  await p.fill('input[placeholder="6 位数字"]', String(rg(`sms:code:${PHONE}`)));
  await p.locator('input[type="checkbox"]').first().check();
  await p.getByRole("button", { name: "登录", exact: true }).click();
  await p.waitForTimeout(3200);
  ok("1. 登录进入工作台", p.url().includes("/home"), p.url().replace(WEB, ""));

  // 定价页
  await p.goto(`${WEB}/pricing`, { waitUntil: "networkidle" });
  await p.waitForTimeout(2000);
  await p.screenshot({ path: path.join(OUT, "01-pricing.png"), fullPage: true });

  const cardCount = await p.locator(".card").count();
  ok("2. 定价页展示 SKU 套餐", cardCount === 4, `cards=${cardCount}`);

  const prices = await p.locator(".price").allInnerTexts();
  ok("2b. 价格来自后端（¥50/100/300/600）", prices.join(",").includes("50"), prices.join(","));

  const balBefore = await p.locator(".balance-chip b").innerText().catch(() => "");
  ok("2c. 显示当前余额", balBefore === "80", `balance=${balBefore}`);

  // 购买前注入 MutationObserver 捕获 Toast（Toast 2.6s 自动消失，直接读可能错过）
  await p.evaluate(() => {
    window.__toasts = [];
    new MutationObserver(() => {
      document.querySelectorAll(".toast .text").forEach((el) => {
        if (el.innerText && !window.__toasts.includes(el.innerText)) window.__toasts.push(el.innerText);
      });
    }).observe(document.body, { childList: true, subtree: true });
  });

  // 购买
  const buyBtn = p.getByRole("button", { name: "立即购买" }).first();
  ok("3. 购买按钮可用", (await buyBtn.count()) === 1 && (await buyBtn.isEnabled()), "");
  await buyBtn.click();
  await p.waitForTimeout(3500);
  await p.screenshot({ path: path.join(OUT, "02-after-purchase.png"), fullPage: true });

  // Toast 确认
  const toasts = await p.evaluate(() => window.__toasts || []);
  const toastText = toasts.join(" | ");
  ok("4. 购买成功有 Toast 提示", /充值成功/.test(toastText), toastText);

  // 余额更新
  await p.waitForTimeout(1500);
  const balAfter = await p.locator(".balance-chip b").innerText().catch(() => "");
  ok("5. 余额从 80 增至 580", balAfter === "580", `${balBefore} → ${balAfter}`);

  // 积分流水页确认 recharge
  await p.goto(`${WEB}/credits`, { waitUntil: "networkidle" });
  await p.waitForTimeout(2000);
  const rows = await p.locator(".flow-row:not(.flow-head)").count();
  const flowText = (await p.textContent("main")) || "";
  ok("6. 积分流水含「充值」记录", /充值/.test(flowText) && rows >= 2, `rows=${rows}`);
  await p.screenshot({ path: path.join(OUT, "03-credits-after-recharge.png"), fullPage: true });

  // 充值后可用于投递（余额充足）
  const balNum = parseInt(balAfter, 10);
  ok("7. 充值后余额足够跑一整条流水线", balNum >= 88, `balance=${balNum} 需要≥88`);

  // 移动端
  await p.setViewportSize({ width: 390, height: 844 });
  await p.goto(`${WEB}/pricing`, { waitUntil: "networkidle" });
  await p.waitForTimeout(1200);
  const ov = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  ok("8. 移动端定价页无横向溢出", ov <= 2, `overflow=${ov}`);
  await p.screenshot({ path: path.join(OUT, "04-pricing-mobile.png") });

  const passed = results.filter((r) => r.pass).length;
  console.log(`\n=== 结果：${passed}/${results.length} 通过 ===`);
  console.log("console errors:", errs.length ? errs.slice(0, 4).join(" | ") : "(none)");
  await b.close();
  process.exitCode = passed === results.length && !errs.length ? 0 : 1;
})();
