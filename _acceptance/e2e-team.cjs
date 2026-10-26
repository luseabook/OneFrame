/**
 * 团队管理（cam 域 v2.6 收口）端到端验收 —— 真实浏览器 + 真实 API
 *
 * 覆盖 6 个场景（16 条断言）：
 *   S1 登录 → 团队页 → 创建团队（切到团队空间）
 *   S2 团队设置：改名 / 改席位 → 抬头与 API 同时生效
 *   S3 新建分组 → 积分页「分组统计」出现该分组
 *   S4 批量分配（失败路径）：团队池为 0 时逐条失败、界面给出汇总；API 证明没有产生流水
 *   S5 流水导出（空态）：按钮存在且空流水时提示，不打开空白窗口；API 返回 row_count=0
 *   S6 收尾：控制台零错误
 *
 * 为什么成功路径放在 api 单测（`apps/api/test/team.spec.ts`）而不是这里：
 * 浏览器验收要造"团队池里有余额"的前提只能直接写库或走支付回调；这会让 E2E 变成
 * 一半靠 DB 夹具的假验收。所以这里的浏览器断言只覆盖**接线与守卫**，
 * 分配成功的成对记账/守恒由 team.spec 覆盖（那里直接调 service，能造余额）。
 *
 * 用法：
 *   pwsh _acceptance/start-wanxing-stack.ps1
 *   node _acceptance/e2e-team.cjs
 */
const { chromium } = require("playwright-core");
const fs = require("node:fs");
const path = require("node:path");

const API = process.env.API || "http://127.0.0.1:3002/v1";
const WEB = process.env.WEB || "http://127.0.0.1:3003";
const CHROME =
  process.env.CHROME ||
  "C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe";
const SHOT_DIR = path.join(__dirname, "team-e2e");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "  ✅" : "  ❌"} ${name}${detail ? ` — ${detail}` : ""}`);
  return ok;
}

async function api(method, p, body, token, spaceId) {
  const headers = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  if (spaceId) headers["x-space-id"] = spaceId;
  const res = await fetch(API + p, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text.slice(0, 200) };
  }
}

async function prepareUser() {
  const phone = `13${String(Date.now()).slice(-9)}`;
  const sms = await api("POST", "/auth/sms-code", { phone });
  if (sms.code !== 0) throw new Error(`sms-code: ${JSON.stringify(sms)}`);
  return { phone, code: String(sms.data.debug_code) };
}

(async () => {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  const user = await prepareUser();
  console.log(`\n用户 ${user.phone}（验证码留给浏览器登录）\n`);

  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  page.setDefaultTimeout(25_000);

  const consoleErrors = [];
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text().slice(0, 200));
  });
  page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message.slice(0, 200)}`));

  let pass = 0;
  let total = 0;
  const record = (name, ok, detail) => {
    total++;
    if (check(name, ok, detail)) pass++;
  };

  try {
    // ══ S1 登录 → 团队页 → 创建团队 ═════════════════════════
    console.log("[S1] 登录 → 团队页 → 创建团队");
    await page.goto(`${WEB}/login`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('input[placeholder="请输入手机号码"]', { timeout: 20_000 });
    await page.waitForFunction(
      () => {
        const el = document.querySelector('input[placeholder="请输入手机号码"]');
        return !!el && Object.keys(el).some((k) => k.startsWith("__vue") || k.startsWith("_vei"));
      },
      null,
      { timeout: 20_000 },
    ).catch(() => {});
    await sleep(500);
    await page.fill('input[placeholder="请输入手机号码"]', user.phone);
    await page.locator('input[placeholder="请输入手机号码"]').blur();
    await page.fill('input[placeholder="请输入验证码"]', user.code);
    await page.locator('input[placeholder="请输入验证码"]').blur();
    await sleep(300);
    await page.locator(".agree-row input[type=checkbox]").check().catch(() => {});
    await page.locator("button.submit").click();
    await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 30_000 });
    record("S1.1 登录成功", true, page.url());

    const token = await page.evaluate(async () => {
      try {
        const r = await fetch("/v1/auth/refresh", { method: "POST", credentials: "include" });
        const j = await r.json();
        return j.data?.access_token ?? "";
      } catch {
        return "";
      }
    });
    record("S1.2 取到 API token（交叉核对用）", !!token);

    // 登录跳转过程中的噪音不计入本批页面
    consoleErrors.length = 0;

    await page.goto(`${WEB}/team`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".tm-title", { timeout: 25_000 });
    await sleep(1200);

    const teamName = `E2E团队${String(Date.now()).slice(-6)}`;
    await page.locator("button", { hasText: "创建团队" }).first().click();
    await sleep(400);
    const createModalInput = page.locator(".mask .panel input").first();
    await createModalInput.fill(teamName);
    await page.locator("button", { hasText: "创建并进入" }).first().click();
    await sleep(2500);

    const subText = (await page.locator(".tm-sub").innerText()).replace(/\s+/g, " ");
    record("S1.3 已进入团队空间（抬头显示席位与积分池）", /席位 \d+\/\d+/.test(subText), subText.slice(0, 80));

    const mine = await api("GET", "/cam/teams/mine", undefined, token);
    const teamSpace = (mine.data?.list || []).find((t) => t.type === 2 && t.name === teamName);
    record("S1.4 团队已落库（spaces type=2）", !!teamSpace, teamSpace?.space_id ?? "无");
    const spaceId = teamSpace?.space_id ?? "";
    await page.screenshot({ path: path.join(SHOT_DIR, "01-team.png") });

    // ══ S2 团队设置：改名 / 改席位 ═══════════════════════════
    console.log("[S2] 团队设置：改名 / 改席位");
    await page.locator("button", { hasText: "团队设置" }).first().click();
    await sleep(500);
    record("S2.1 团队设置弹窗打开", (await page.locator(".tm-team-name input").count()) > 0);
    const renamed = `改${String(Date.now()).slice(-5)}`;
    await page.locator(".tm-team-name input").fill(renamed);
    await page.locator(".tm-team-seats input").fill("8");
    await page.locator("button", { hasText: "保存设置" }).first().click();
    await sleep(2000);

    const infoResp = await api("GET", "/cam/team/info", undefined, token, spaceId);
    record(
      "S2.2 改名与席位已写库",
      infoResp.data?.name === renamed && infoResp.data?.max_seats === 8,
      `${infoResp.data?.name}/${infoResp.data?.max_seats}`,
    );
    const sub2 = (await page.locator(".tm-sub").innerText()).replace(/\s+/g, " ");
    record("S2.3 抬头同步为新名称与新席位", sub2.includes(renamed) && sub2.includes("/8"), sub2.slice(0, 80));
    await page.screenshot({ path: path.join(SHOT_DIR, "02-team-settings.png") });

    // ══ S3 新建分组 → 分组统计 ══════════════════════════════
    console.log("[S3] 新建分组 → 积分页分组统计");
    await page.locator("button", { hasText: "新建分组" }).first().click();
    await sleep(400);
    await page.locator(".mask .panel input").first().fill("E2E声音组");
    // 必须限定在弹窗内点：页面头部还有「创建团队」，按文本找 first() 会点到被遮罩盖住的
    // 头部按钮，Playwright 会一直等 pointer 事件（实测 25s 超时）
    await page.locator(".mask .panel button", { hasText: "创建" }).first().click();
    await sleep(1500);

    await page.locator(".tab, .tabs button", { hasText: "积分管理" }).first().click();
    await sleep(2000);
    const statsText = (await page.locator(".tm-group-stats").innerText().catch(() => "")).replace(/\s+/g, " ");
    record("S3.1 分组统计出现新分组", statsText.includes("E2E声音组"), statsText.slice(0, 80));
    record("S3.2 分组统计展示四个指标", /成员/.test(statsText) && /已分配/.test(statsText));
    await page.screenshot({ path: path.join(SHOT_DIR, "03-group-stats.png") });

    // ══ S4 批量分配（失败路径：团队池为 0）══════════════════
    console.log("[S4] 批量分配：团队池为 0 时逐条失败、界面汇总");
    await page.locator(".tab, .tabs button", { hasText: "成员管理" }).first().click();
    await sleep(1200);
    const firstMemberCheckbox = page.locator(".tm-table tbody tr input[type=checkbox]").first();
    await firstMemberCheckbox.check();
    await sleep(400);
    record("S4.1 选中成员后出现「批量分配」入口", (await page.locator("button", { hasText: "批量分配" }).count()) > 0);
    await page.locator("button", { hasText: "批量分配" }).first().click();
    await sleep(400);
    await page.locator(".tm-batch-amount input").fill("5");
    await page.locator("button", { hasText: "确认分配" }).first().click();
    await sleep(2000);

    const alertText = `${await page.locator(".tm-alert--ok").innerText().catch(() => "")}${
      await page.locator(".tm-alert--err").innerText().catch(() => "")
    }`.trim();
    record(
      "S4.2 逐条失败被汇总（不整批静默成功）",
      /成功 0 人/.test(alertText) && /失败 1 人/.test(alertText),
      alertText.slice(0, 80),
    );

    // API 侧证明：没有产生任何团队流水（失败不该留下痕迹）
    const flows = await api("GET", "/cam/team/points-flow/list?page=1&page_size=5", undefined, token, spaceId);
    record("S4.3 失败没有产生流水", (flows.data?.total ?? 0) === 0, `total=${flows.data?.total}`);
    await page.screenshot({ path: path.join(SHOT_DIR, "04-batch-alloc-fail.png") });

    // ══ S5 流水导出（空态）═════════════════════════════════
    console.log("[S5] 流水导出：空流水时给出提示");
    await page.locator(".tab, .tabs button", { hasText: "积分管理" }).first().click();
    await sleep(1200);
    record("S5.1 流水区出现「导出流水」按钮", (await page.locator("button", { hasText: "导出流水" }).count()) > 0);
    await page.locator("button", { hasText: "导出流水" }).first().click();
    await sleep(1500);
    const exportAlert = `${await page.locator(".tm-alert--ok").innerText().catch(() => "")}${
      await page.locator(".tm-alert--err").innerText().catch(() => "")
    }`.trim();
    record("S5.2 空流水提示（不打开空白窗口）", /暂无可导出/.test(exportAlert), exportAlert.slice(0, 80));
    const exp = await api("GET", "/cam/team/points-flow/export", undefined, token, spaceId);
    record("S5.3 导出接口空数据时 row_count=0", exp.data?.row_count === 0, `row_count=${exp.data?.row_count}`);

    // ══ S6 收尾 ════════════════════════════════════════════
    const realErrors = consoleErrors.filter(
      (e) => !/favicon|Failed to load resource.*404|ResizeObserver loop/i.test(e),
    );
    record("S6.1 无未预期的控制台错误", realErrors.length === 0, realErrors.slice(0, 3).join(" | ") || "clean");
  } catch (e) {
    console.error("\nE2E 异常：", e);
    record("S0.1 脚本执行未抛异常", false, String(e && e.message ? e.message : e).slice(0, 240));
  } finally {
    await browser.close().catch(() => {});
    const failed = results.filter((r) => !r.ok);
    console.log(`\n${"─".repeat(56)}`);
    console.log(`团队管理 E2E：${pass}/${total} 通过`);
    if (failed.length) {
      console.log("\n失败项：");
      for (const f of failed) console.log(`  ❌ ${f.name} — ${f.detail}`);
    }
    fs.writeFileSync(
      path.join(SHOT_DIR, "result.json"),
      JSON.stringify({ at: new Date().toISOString(), pass, total, results }, null, 2),
    );
    process.exit(pass === total ? 0 : 1);
  }
})().catch((e) => {
  console.error("E2E 异常：", e);
  process.exit(1);
});


