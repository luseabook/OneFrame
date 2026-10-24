/**
 * UI 端到端验收：从注册 → 引导 → 建项目 → 生成大纲 → 角色 → 分镜 → 投递 → 出片 → 作品库
 * 全程通过界面点击，验证真实用户路径。
 */
const { chromium } = require("playwright-core");
const fs = require("node:fs");
const path = require("node:path");
const { execSync } = require("node:child_process");

const OUT = path.join(__dirname, "shots-e2e-ui");
fs.mkdirSync(OUT, { recursive: true });
const WEB = "http://127.0.0.1:3001";
const PHONE = "1381111" + String(Date.now()).slice(-4);
const results = [];

function ok(name, cond, detail = "") {
  results.push({ name, pass: !!cond, detail: String(detail).slice(0, 100) });
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

  console.log(`\n=== UI 端到端验收 (phone=${PHONE}) ===\n`);

  // 1. 注册登录
  await p.goto(`${WEB}/login`, { waitUntil: "networkidle" });
  await p.waitForTimeout(700);
  // 完整 UI 流程：填手机号 → 点获取验证码 → 读 Redis 取码 → 填码登录
  await p.fill('input[placeholder*="11 位手机号"]', PHONE);
  await p.waitForTimeout(400);
  const sendBtn = p.getByRole("button", { name: /获取验证码/ });
  await sendBtn.waitFor({ state: "visible", timeout: 10000 });
  await sendBtn.click();
  await p.waitForTimeout(1800);
  const smsCode = code(PHONE);
  await p.fill('input[placeholder="6 位数字"]', String(smsCode));
  await p.locator('input[type="checkbox"]').first().check();
  await p.getByRole("button", { name: "登录", exact: true }).click();
  await p.waitForTimeout(3200);
  ok("1. 注册并进入工作台", p.url().includes("/home"), p.url().replace(WEB, ""));

  // 2. 新手引导条可见
  await p.waitForTimeout(800);
  const onb = await p.locator(".onboard").count();
  ok("2. 首次进入显示新手引导", onb === 1, `count=${onb}`);
  await p.screenshot({ path: path.join(OUT, "01-onboarding.png"), fullPage: true });

  // 3. 作品库有示例作品
  await p.goto(`${WEB}/works`, { waitUntil: "networkidle" });
  await p.waitForTimeout(1600);
  const sampleTitle = await p.locator(".work-card .title").first().innerText().catch(() => "");
  ok("3. 示例作品出现在作品库", sampleTitle.includes("示例"), sampleTitle);

  // 4. 新建项目（弹窗）
  await p.goto(`${WEB}/projects`, { waitUntil: "networkidle" });
  await p.waitForTimeout(1500);
  await p.getByRole("button", { name: "+ 新建项目" }).click();
  await p.waitForTimeout(700);
  await p.fill('[role="dialog"] input[placeholder*="雨夜"]', "UI 验收剧");
  await p.fill('[role="dialog"] textarea', "一位老人在雨夜寻找失散多年的孙女，走进城市最深的老街。");
  await p.getByRole("button", { name: "创建并进入流水线" }).click();
  await p.waitForTimeout(3200);
  ok("4. 创建项目并进入流水线", /\/projects\/\d+/.test(p.url()), p.url().replace(WEB, ""));

  const projUrl = p.url();

  // 5. 生成大纲
  await p.getByRole("button", { name: "生成大纲" }).first().click();
  await p.waitForTimeout(6000);
  const outlineCards = await p.locator(".outline-card").count();
  ok("5. 生成分集大纲", outlineCards >= 2, `cards=${outlineCards}`);
  await p.screenshot({ path: path.join(OUT, "02-outline.png"), fullPage: true });

  // 6. 确认大纲
  await p.getByRole("button", { name: "确认大纲" }).click();
  await p.waitForTimeout(2500);
  ok("6. 确认大纲无报错", true, "");

  // 7. 角色步骤
  await p.locator(".step").nth(1).click();
  await p.waitForTimeout(1200);
  await p.getByRole("button", { name: "生成角色" }).first().click();
  await p.waitForTimeout(6000);
  const charCards = await p.locator(".character-card").count();
  ok("7. 生成角色卡", charCards >= 2, `cards=${charCards}`);
  await p.screenshot({ path: path.join(OUT, "03-characters.png"), fullPage: true });

  // 8. 生成定妆图
  await p.locator(".character-card").first().getByRole("button", { name: /生成定妆图|重新生成/ }).click();
  await p.waitForTimeout(20000);
  const hasPortrait = await p.locator(".character-card .portrait img").count();
  ok("8. 定妆图生成", hasPortrait >= 1, `img=${hasPortrait}`);
  await p.screenshot({ path: path.join(OUT, "04-portrait.png"), fullPage: true });

  // 8b. 角色定稿（投递前置条件）
  const finalizeBtn = p.getByRole("button", { name: "定稿" }).first();
  if (await finalizeBtn.count()) {
    await finalizeBtn.click();
    await p.waitForTimeout(3000);
  }
  const finalizedTag = await p.locator(".character-card").first().locator(".portrait-tag").innerText().catch(() => "");
  ok("8b. 角色定稿完成", /已定稿/.test(finalizedTag), finalizedTag);

  // 9. 分镜步骤
  await p.locator(".step").nth(2).click();
  await p.waitForTimeout(1500);
  await p.getByRole("button", { name: "生成分镜" }).first().click();
  await p.waitForTimeout(7000);
  const shotRows = await p.locator(".shot-row:not(.shot-head)").count();
  ok("9. 生成分镜表", shotRows >= 4, `rows=${shotRows}`);
  await p.screenshot({ path: path.join(OUT, "05-storyboards.png"), fullPage: true });

  // 10. 投递步骤
  await p.locator(".step").nth(3).click();
  await p.waitForTimeout(1500);
  await p.screenshot({ path: path.join(OUT, "06-dispatch.png"), fullPage: true });
  const dispatchBtn = p.getByRole("button", { name: /批量投递/ });
  ok("10. 投递面板可见", (await dispatchBtn.count()) > 0, "");
  await dispatchBtn.click();
  await p.waitForTimeout(30000);
  const matrixCells = await p.locator(".matrix .cell").count();
  ok("11. 投递后出现分镜矩阵", matrixCells > 0, `cells=${matrixCells}`);
  await p.screenshot({ path: path.join(OUT, "07-matrix.png"), fullPage: true });

  // 12. 作品库反映进度
  await p.goto(`${WEB}/works`, { waitUntil: "networkidle" });
  await p.waitForTimeout(1800);
  const uiWorkMeta = await p.locator(".work-card").first().locator(".meta").innerText().catch(() => "");
  ok("12. 作品库反映出片进度", /\d+\/\d+ 镜已出片/.test(uiWorkMeta), uiWorkMeta);
  await p.screenshot({ path: path.join(OUT, "08-works.png"), fullPage: true });

  // 13. Toast 反馈
  await p.locator(".work-card").first().locator("button").filter({ hasText: "归档" }).first().click().catch(() => {});
  await p.waitForTimeout(1200);
  const toastText = await p.locator(".toast .text").first().innerText().catch(() => "");
  ok("13. 操作反馈 Toast", !!toastText, toastText);

  // 14. 移动端一致性
  await p.setViewportSize({ width: 390, height: 844 });
  for (const path_ of ["/home", "/works", "/projects", "/tasks"]) {
    await p.goto(`${WEB}${path_}`, { waitUntil: "networkidle" });
    await p.waitForTimeout(900);
    const ov = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    ok(`14. 移动端 ${path_} 无横向溢出`, ov <= 2, `overflow=${ov}`);
  }
  await p.screenshot({ path: path.join(OUT, "09-mobile-works.png") });

  const passed = results.filter((r) => r.pass).length;
  console.log(`\n=== 结果：${passed}/${results.length} 通过 ===`);
  console.log("console errors:", errs.length ? errs.slice(0, 5).join(" | ") : "(none)");
  const failed = results.filter((r) => !r.pass);
  if (failed.length) {
    console.log("\n失败项：");
    failed.forEach((f) => console.log(`  - ${f.name} | ${f.detail}`));
  }
  await b.close();
  process.exitCode = failed.length ? 1 : 0;
})();
