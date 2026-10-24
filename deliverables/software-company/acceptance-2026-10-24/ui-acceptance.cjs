const { chromium } = require("playwright-core");
const fs = require("node:fs");
const path = require("node:path");
const { execSync } = require("node:child_process");

const OUT = path.join(__dirname, "shots");
fs.mkdirSync(OUT, { recursive: true });
const BASE = "http://127.0.0.1:8080";
const API = `${BASE}/v1`;
const results = [];
const consoleErrors = [];

function log(step, ok, detail) {
  results.push({ step, ok, detail: detail || "" });
  console.log(`${ok ? "PASS" : "FAIL"} | ${step}${detail ? " | " + detail : ""}`);
}

function redisGet(key) {
  const out = execSync(
    `docker compose -f docker-compose.prod.yml exec -T redis redis-cli --raw get ${key}`,
    { cwd: "E:\\wanxing\\app", encoding: "utf8" },
  );
  try {
    return JSON.parse(out).code;
  } catch {
    return out.trim();
  }
}

async function api(method, url, body, token) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (body) headers["content-type"] = "application/json";
  const res = await fetch(`${API}${url}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  return { status: res.status, body: json };
}

(async () => {
  const browser = await chromium.launch({
    executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    headless: true,
  });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "zh-CN" });
  const page = await ctx.newPage();

  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning") {
      consoleErrors.push({ url: page.url(), type: m.type(), text: m.text().slice(0, 300) });
    }
  });
  page.on("pageerror", (e) => {
    consoleErrors.push({ url: page.url(), type: "pageerror", text: String(e).slice(0, 300) });
  });

  const shot = async (name) => {
    await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: false });
  };

  // ── 登录页渲染 + 交互 ──────────────────────────────
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await shot("01-login-desktop");
  const hasPhone = await page.locator("input").count();
  log("登录页渲染（手机号/验证码/邀请码/年龄勾选）", hasPhone >= 3, `inputs=${hasPhone}`);
  const ageBox = await page.locator('input[type="checkbox"]').count();
  log("登录页存在 18 岁勾选框", ageBox >= 1, `checkbox=${ageBox}`);

  // 未勾选年龄 → 应提示
  await page.fill('input[placeholder*="11 位手机号"]', "13711110001");
  await page.fill('input[placeholder="6 位数字"]', "123456");
  const sendBtn = page.getByRole("button", { name: "获取验证码" });
  if (await sendBtn.count()) await sendBtn.first().click();
  await page.waitForTimeout(1200);
  await page.getByRole("button", { name: "登录", exact: true }).first().click();
  await page.waitForTimeout(800);
  const bodyText1 = await page.textContent("body");
  log(
    "未勾选 18 岁时阻止登录并提示",
    /18|周岁/.test(bodyText1 || "") && page.url().includes("/login"),
    (bodyText1 || "").match(/[^\n]*18[^\n]*/)?.[0]?.trim()?.slice(0, 60) || "",
  );
  await shot("02-login-age-required");

  // 正确登录
  const code = redisGet("sms:code:13711110001");
  await page.fill('input[placeholder="6 位数字"]', String(code));
  await page.locator('input[type="checkbox"]').first().check();
  await page.getByRole("button", { name: "登录", exact: true }).first().click();
  await page.waitForTimeout(2500);
  log("验证码登录成功跳转", !page.url().includes("/login"), page.url());
  await shot("03-after-login");

  const token = await page.evaluate(() => localStorage.getItem("access_token") || "");

  // ── 各页面渲染 ─────────────────────────────────────
  const pages = [
    ["/", "04-home"],
    ["/create/text-to-video", "05-text2video"],
    ["/create/image-to-video", "06-image2video"],
    ["/projects", "07-projects"],
    ["/assets", "08-assets"],
    ["/tasks", "09-tasks"],
    ["/credits", "10-credits"],
    ["/pricing", "11-pricing"],
    ["/settings", "12-settings"],
    ["/terms", "13-terms"],
    ["/privacy", "14-privacy"],
    ["/report", "15-report"],
  ];
  for (const [p, name] of pages) {
    const before = consoleErrors.length;
    await page.goto(`${BASE}${p}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(500);
    await shot(name);
    const txt = (await page.textContent("body")) || "";
    const bad = consoleErrors.length - before;
    log(`页面渲染 ${p}`, txt.trim().length > 10 && bad === 0, `len=${txt.trim().length} consoleIssue=${bad}`);
  }

  // ── 关键交互：文生视频提交（余额不足/正常） ────────
  await page.goto(`${BASE}/create/text-to-video`, { waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  const ta = page.locator("textarea").first();
  if (await ta.count()) {
    await ta.fill("验收：雨夜霓虹街道，镜头缓慢推进");
  }
  const submit = page.getByRole("button", { name: /提交|生成|开始生成/ });
  if (await submit.count()) {
    await submit.first().click();
    await page.waitForTimeout(3000);
    await shot("16-text2video-submitted");
    const t = (await page.textContent("body")) || "";
    const toastOk = /积分|任务|失败|不足|提交|排队|生成中/.test(t);
    const err = await page.locator("main .error").count();
    log("文生视频提交后有状态反馈", toastOk, `errorBlocks=${err}`);
  } else {
    log("文生视频提交按钮存在", false, "未找到提交按钮");
  }

  // ── 任务页交互：取消/重试按钮存在性 ───────────────
  await page.goto(`${BASE}/tasks`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  const taskBody = (await page.textContent("main")) || "";
  if (taskBody.includes("登录 / 注册")) {
    log("任务列表渲染出任务行", false, "会话丢失，未进入任务页");
  } else {
    await shot("17-tasks-list");
    const taskRows = await page.locator("main .row").count();
    const taskTable = await page.locator("main .table").count();
    log("任务列表渲染出任务行", taskRows > 0 && taskTable > 0, `rows=${taskRows} tables=${taskTable}`);

    const rowBtns = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll("main .table .row")).slice(1);
      return rows.slice(0, 3).map((r) => {
        // .link 是任务号链接（打开详情），不计入操作按钮
        const btns = Array.from(r.querySelectorAll(".ops button")).map((b) => ({
          t: (b.innerText || "").trim(),
          disabled: b.disabled,
        }));
        const idLink = r.querySelector("button.link");
        return {
          status: (r.querySelector(".badge")?.innerText || "").trim(),
          idLinkText: (idLink?.innerText || "").trim(),
          btns,
        };
      });
    });
    log(
      "任务行：状态标签 + 任务号链接 + 操作按钮（已完成→取消禁用/下载可用）",
      rowBtns.length > 0 &&
        rowBtns.every(
          (r) =>
            r.btns.find((b) => b.t === "取消")?.disabled === true &&
            r.btns.find((b) => b.t === "下载")?.disabled === false &&
            /^\d+$/.test(r.idLinkText),
        ),
      JSON.stringify(rowBtns[0] || {}),
    );

    const statusSel = page.locator("main select").first();
    if (await statusSel.count()) {
      await statusSel.selectOption("3");
      await page.waitForTimeout(1200);
      const txt = (await page.textContent("main")) || "";
      log("任务页状态筛选可用（已完成）", /已完成/.test(txt), "");
      await statusSel.selectOption("");
      await page.waitForTimeout(600);
    }
  }

  // ── 管理台 ───────────────────────────────────────
  await page.goto(`${BASE}/admin`, { waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  await shot("18-admin-login");
  const adminUser = page.locator('input').first();
  await adminUser.fill("admin");
  await page.locator('input[type="password"]').fill("admin12345");
  await page.getByRole("button", { name: /登录/ }).first().click();
  await page.waitForTimeout(2500);
  await shot("19-admin-dashboard");
  const adminTxt = (await page.textContent("body")) || "";
  log("管理台登录并进入概览", /概览|用户|任务总数|漏斗/.test(adminTxt), "");

  for (const [tab, name] of [
    ["模型/价格", "20-admin-models"],
    ["任务审计", "21-admin-tasks"],
    ["分享管理", "22-admin-shares"],
    ["举报处置", "23-admin-reports"],
    ["流水线漏斗", "24-admin-funnel"],
  ]) {
    const b = page.getByRole("button", { name: tab });
    if (await b.count()) {
      await b.first().click();
      await page.waitForTimeout(700);
      await shot(name);
      const txt = (await page.textContent("body")) || "";
      log(`管理台页签「${tab}」渲染`, txt.trim().length > 20, "");
    } else {
      log(`管理台页签「${tab}」存在`, false, "未找到页签按钮");
    }
  }

  // ── 交互：项目创建 ──────────────────────────────
  await page.goto(`${BASE}/projects`, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  const projBody = (await page.textContent("main")) || "";
  if (projBody.includes("登录 / 注册")) {
    log("项目创建（未登录被重定向）", false, "会话丢失，未进入项目页");
  } else {
    const titleInput = page
      .locator('input[placeholder*="雨夜"], input[placeholder*="标题"], input[placeholder*="项目名"]')
      .first();
    if (await titleInput.count()) {
      await titleInput.fill("验收UI项目");
      const createBtn = page.getByRole("button", { name: /创建并进入流水线|创建/ }).first();
      await createBtn.click();
      await page.waitForTimeout(2500);
      await shot("26-project-created");
      const inProject = /验收UI项目|大纲|角色/.test((await page.textContent("body")) || "");
      log("项目创建后进入流水线页", inProject, page.url());
    } else {
      const inputs = await page.evaluate(() =>
        Array.from(document.querySelectorAll("main input")).map((e) => e.placeholder || e.type),
      );
      log("项目创建输入框存在", false, `inputs=${JSON.stringify(inputs)}`);
    }
  }

  // ── 交互：资产页回收站切换 ───────────────────────
  await page.goto(`${BASE}/assets`, { waitUntil: "networkidle" });
  await page.waitForTimeout(900);
  const recycleBtn = page.getByRole("button", { name: "回收站" });
  if (await recycleBtn.count()) {
    await recycleBtn.first().click();
    await page.waitForTimeout(1200);
    await shot("27-assets-recycle");
    const t = (await page.textContent("main")) || "";
    log("资产页回收站切换可用", /返回资产库|恢复/.test(t), "");
  } else {
    log("资产页回收站按钮存在", false, "");
  }

  // ── 交互：积分页流水渲染 ────────────────────────
  await page.goto(`${BASE}/credits`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1000);
  const flowRows = await page.locator("main .row").count();
  log("积分页流水行渲染", flowRows > 0, `rows=${flowRows}`);

  // ── 交互：注销二次确认 ─────────────────────────
  await page.goto(`${BASE}/settings`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1000);
  const delBtn = page.getByRole("button", { name: /注销账号|确认注销/ });
  if (await delBtn.count()) {
    await delBtn.first().click();
    await page.waitForTimeout(800);
    const t = (await page.textContent("main")) || "";
    const stillOnSettings = page.url().includes("/settings");
    log(
      "注销需二次确认（首次点击不注销）",
      stillOnSettings && /确认注销|再次点击/.test(t),
      "",
    );
    await shot("28-settings-delete-confirm");
  } else {
    log("注销按钮存在", false, "");
  }

  // ── 交互：分享页举报表单 ───────────────────────
  await page.goto(`${BASE}/report`, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  const tokenInput = page.locator('input[placeholder*="token"]').first();
  if (await tokenInput.count()) {
    await tokenInput.fill("not-a-real-token");
    const rpBtn = page.getByRole("button", { name: "提交举报" });
    await rpBtn.click();
    await page.waitForTimeout(1500);
    const t = (await page.textContent("main")) || "";
    log("举报表单对无效 token 给出错误提示", /token|不存在|失败|缺少/.test(t), "");
    await shot("29-report-invalid-token");
  } else {
    log("举报页 token 输入框存在", false, "");
  }

  // ── 多视口一致性 ─────────────────────────────────
  for (const [w, h, tag] of [
    [1920, 1080, "desktop-1920"],
    [1280, 800, "laptop-1280"],
    [820, 1180, "tablet-820"],
    [390, 844, "mobile-390"],
  ]) {
    await page.setViewportSize({ width: w, height: h });
    for (const [p, nm] of [
      ["/login", "login"],
      ["/create/text-to-video", "create"],
      ["/projects", "projects"],
      ["/tasks", "tasks"],
      ["/admin", "admin"],
    ]) {
      await page.goto(`${BASE}${p}`, { waitUntil: "networkidle" });
      await page.waitForTimeout(400);
      await shot(`vp-${tag}-${nm}`);
      // 横向溢出检测
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      log(`视口 ${w}x${h} 页面 ${p} 无横向溢出`, overflow <= 2, `overflow=${overflow}px`);
    }
  }

  fs.writeFileSync(
    path.join(__dirname, "ui-results.json"),
    JSON.stringify({ results, consoleErrors }, null, 2),
  );
  console.log(`\n=== console issues: ${consoleErrors.length} ===`);
  for (const c of consoleErrors.slice(0, 25)) {
    console.log(`[${c.type}] ${c.url} :: ${c.text}`);
  }
  await browser.close();
})().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
