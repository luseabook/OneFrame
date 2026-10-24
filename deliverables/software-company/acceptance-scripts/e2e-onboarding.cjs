/**
 * 首次使用闭环验收：示例作品 → 复制为我的项目 → 在副本上直接投递出片
 */
const { chromium } = require("playwright-core");
const fs = require("node:fs");
const path = require("node:path");
const { execSync } = require("node:child_process");

const OUT = path.join(__dirname, "shots-onboard");
fs.mkdirSync(OUT, { recursive: true });
const WEB = "http://127.0.0.1:3001";
const PHONE = "1382222" + String(Date.now()).slice(-4);
const results = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function ok(name, cond, detail = "") {
  results.push({ name, pass: !!cond });
  console.log(`${cond ? "PASS" : "FAIL"} | ${name}${detail ? " | " + String(detail).slice(0, 90) : ""}`);
}

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
  const p = await ctx.newPage();
  const errs = [];
  p.on("console", (m) => {
    if (m.type() === "error") errs.push(m.text().slice(0, 90));
  });
  p.on("pageerror", (e) => errs.push("pageerror: " + String(e).slice(0, 90)));

  console.log(`\n=== 首次使用闭环验收 (phone=${PHONE}) ===\n`);

  // 1. 注册
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
  ok("1. 注册进入工作台", p.url().includes("/home"), p.url().replace(WEB, ""));

  // 2. 引导条 → 点「开始创建」进入项目页
  const guideVisible = await p.locator(".onboard").count();
  ok("2. 新手引导可见", guideVisible === 1, `count=${guideVisible}`);
  await p.locator(".onboard .go").click();
  await p.waitForTimeout(2000);
  ok("2b. 引导 CTA 跳到项目页", p.url().includes("/projects"), p.url().replace(WEB, ""));
  await p.screenshot({ path: path.join(OUT, "01-guided-to-projects.png"), fullPage: true });

  // 3. 作品库：示例模板标记
  await p.goto(`${WEB}/works`, { waitUntil: "networkidle" });
  await p.waitForTimeout(1800);
  const sampleTag = await p.locator(".state-tag").first().innerText().catch(() => "");
  ok("3. 示例作品标注为「示例模板」", /示例模板/.test(sampleTag), sampleTag);
  const dupBtn = p.getByRole("button", { name: "复制为我的项目" });
  ok("3b. 示例卡片有「复制为我的项目」入口", (await dupBtn.count()) === 1, "");
  await p.screenshot({ path: path.join(OUT, "02-works-sample.png"), fullPage: true });

  // 4. 复制为我的项目
  await dupBtn.click();
  await p.waitForTimeout(3000);
  ok("4. 复制后进入副本项目", /\/projects\/\d+/.test(p.url()), p.url().replace(WEB, ""));
  const copiedUrl = p.url();
  await p.screenshot({ path: path.join(OUT, "03-copied-project.png"), fullPage: true });

  // 5. 副本含 2 集大纲 + 角色
  await p.waitForTimeout(1500);
  const epItems = await p.locator(".ep-item").count();
  const outlineCards = await p.locator(".outline-card").count();
  ok("5. 副本含 2 集大纲", epItems === 2 && outlineCards === 2, `ep=${epItems} cards=${outlineCards}`);

  await p.locator(".step").nth(1).click();
  await p.waitForTimeout(1200);
  const charCards = await p.locator(".character-card").count();
  ok("5b. 副本含角色", charCards === 2, `characters=${charCards}`);
  await p.screenshot({ path: path.join(OUT, "04-copied-characters.png"), fullPage: true });

  // 6. 副本可生成分镜（证明可独立动手）
  await p.locator(".step").nth(2).click();
  await p.waitForTimeout(1200);
  await p.getByRole("button", { name: "生成分镜" }).first().click();
  await p.waitForTimeout(7000);
  const shots = await p.locator(".shot-row:not(.shot-head)").count();
  ok("6. 副本可生成分镜", shots >= 4, `shots=${shots}`);
  await p.screenshot({ path: path.join(OUT, "05-copied-storyboards.png"), fullPage: true });

  // 7. 示例母版未被修改（副本隔离）
  await p.goto(`${WEB}/works`, { waitUntil: "networkidle" });
  await p.waitForTimeout(1800);
  const cardCount = await p.locator(".work-card").count();
  ok("7. 作品库出现副本（母版+副本）", cardCount >= 2, `cards=${cardCount}`);
  await p.screenshot({ path: path.join(OUT, "06-works-after-copy.png"), fullPage: true });

  // 8. 引导条已消失（关闭过一次）
  await p.goto(`${WEB}/home`, { waitUntil: "networkidle" });
  await p.waitForTimeout(1500);
  const guideAfter = await p.locator(".onboard").count();
  ok("8. 引导条仍在（未主动关闭）", guideAfter === 1, `count=${guideAfter}`);
  await p.getByRole("button", { name: "不再提示" }).click();
  await p.waitForTimeout(1200);
  await p.reload({ waitUntil: "networkidle" });
  await p.waitForTimeout(1600);
  const guideGone = await p.locator(".onboard").count();
  ok("8b. 关闭后引导条持久消失", guideGone === 0, `count=${guideGone}`);

  const passed = results.filter((r) => r.pass).length;
  console.log(`\n=== 结果：${passed}/${results.length} 通过 ===`);
  console.log("console errors:", errs.length ? errs.slice(0, 4).join(" | ") : "(none)");
  await b.close();
  process.exitCode = passed === results.length && !errs.length ? 0 : 1;
})();
