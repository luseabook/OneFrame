/**
 * 最终交付巡检：全站页面渲染 + 多视口 + 控制台洁净度
 */
const { chromium } = require("playwright-core");
const fs = require("node:fs");
const path = require("node:path");
const { execSync } = require("node:child_process");

const OUT = path.join(__dirname, "shots-final");
fs.mkdirSync(OUT, { recursive: true });
const WEB = "http://127.0.0.1:3001";
const PHONE = "1384444" + String(Date.now()).slice(-4);

function code(phone) {
  const raw = execSync(`redis-cli -p 6380 --raw get sms:code:${phone}`, { encoding: "utf8" }).trim();
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

  // ── 未登录：公共页 ──
  const pub = [
    ["/", "landing"],
    ["/login", "login"],
    ["/terms", "terms"],
    ["/privacy", "privacy"],
    ["/report", "report"],
  ];
  console.log("--- 未登录公共页 ---");
  for (const [p, name] of pub) {
    const pg = await ctx.newPage();
    const errs = [];
    pg.on("console", (m) => {
      if (m.type() === "error") errs.push(m.text().slice(0, 70));
    });
    await pg.goto(`${WEB}${p}`, { waitUntil: "networkidle" });
    await pg.waitForTimeout(1300);
    const ov = await pg.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    const txt = ((await pg.textContent("body")) || "").replace(/\s+/g, " ").trim().length;
    console.log(`${p.padEnd(12)} len=${String(txt).padEnd(5)} overflow=${ov} ${errs.length ? "ERR:" + errs[0] : "clean"}`);
    await pg.screenshot({ path: path.join(OUT, `pub-${name}.png`), fullPage: true });
    await pg.close();
  }

  // ── 登录 ──
  const p = await ctx.newPage();
  execSync("redis-cli -p 6380 FLUSHALL", { encoding: "utf8" });
  await p.goto(`${WEB}/login`, { waitUntil: "networkidle" });
  await p.waitForTimeout(800);
  await p.fill('input[placeholder*="11 位手机号"]', PHONE);
  await p.waitForTimeout(400);
  await p.getByRole("button", { name: /获取验证码/ }).click();
  await p.waitForTimeout(1800);
  await p.fill('input[placeholder="6 位数字"]', String(code(PHONE)));
  await p.locator('input[type="checkbox"]').first().check();
  await p.getByRole("button", { name: "登录", exact: true }).click();
  await p.waitForTimeout(3200);
  console.log(`\n登录 -> ${p.url().replace(WEB, "")}`);

  // ── 登录：工作台页 ──
  const priv = [
    ["/home", "home"],
    ["/works", "works"],
    ["/projects", "projects"],
    ["/tasks", "tasks"],
    ["/assets", "assets"],
    ["/credits", "credits"],
    ["/tools", "tools"],
    ["/settings", "settings"],
    ["/pricing", "pricing"],
    ["/create/text-to-video", "t2v"],
    ["/create/image-to-video", "i2v"],
  ];
  console.log("--- 登录后工作台页 ---");
  for (const [pth, name] of priv) {
    const pg = await ctx.newPage();
    const errs = [];
    pg.on("console", (m) => {
      if (m.type() === "error") errs.push(m.text().slice(0, 70));
    });
    await pg.goto(`${WEB}${pth}`, { waitUntil: "networkidle" });
    await pg.waitForTimeout(1300);
    const ov = await pg.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    const txt = ((await pg.textContent("body")) || "").replace(/\s+/g, " ").trim().length;
    console.log(`${pth.padEnd(24)} len=${String(txt).padEnd(5)} overflow=${ov} ${errs.length ? "ERR:" + errs[0] : "clean"}`);
    await pg.screenshot({ path: path.join(OUT, `app-${name}.png`), fullPage: true });
    await pg.close();
  }

  // ── 多视口 ──
  console.log("--- 多视口巡检 ---");
  for (const [w, h, tag] of [
    [1920, 1080, "1920"],
    [1440, 900, "1440"],
    [1024, 768, "1024"],
    [390, 844, "390"],
  ]) {
    await p.setViewportSize({ width: w, height: h });
    let worst = 0;
    for (const pth of ["/home", "/works", "/projects", "/tasks", "/credits", "/"]) {
      await p.goto(`${WEB}${pth}`, { waitUntil: "networkidle" });
      await p.waitForTimeout(700);
      const ov = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      if (ov > worst) worst = ov;
    }
    console.log(`${w}x${h} 最大溢出 = ${worst}px ${worst <= 2 ? "✓" : "✗"}`);
    if (tag === "390") await p.screenshot({ path: path.join(OUT, "mobile-390-home.png") });
  }

  await b.close();
  console.log("\n=== 巡检完成 ===");
})();
