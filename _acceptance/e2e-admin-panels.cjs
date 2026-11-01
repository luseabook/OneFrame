/**
 * 运营后台面板浏览器 E2E（第 107 批）
 *
 * 背景：`docs/README.md` 的 P1 清单里一直挂着"9 个后台面板无浏览器 E2E"。
 * 面板本身已经有后端单测与 static guard，但没有任何用例证明**它们真的能在浏览器里打开**：
 * 拉数据、渲染标题、点按钮、出错时给出可读提示。第 106 批把后台拆成 10 个独立面板后，
 * 这类"整体能 build、单页却是白屏"的风险只会变高（v-if 漏挂、endpoint 写错、
 * composable 未导入、表单绑错字段，都过得了 typecheck）。
 *
 * 这个脚本做的是**真浏览器 + 真栈**的冒烟，而不是替代后端测试：
 *   - 登录：走 `/v1/ops/admin/login` 拿 admin token，写进 `localStorage.admin_token`
 *     （`composables/useAdminApi.ts` 只认这一个键；用户域 token 与它完全隔离）；
 *   - 10 个面板逐个打开：断言侧栏高亮 + 顶部 `.page-title` + 面板 h2 文案，
 *     并断言首屏列表请求是真实发出且 `code === 0`（不是"页面打开了但数据没回来"）；
 *   - 每个面板点一次**只读**交互按钮（刷新 / 重置），断言第二次列表请求同样成功；
 *   - 两个**可逆**写操作：邀请码"生成 → 停用 → 删除"、配置"新建 → 搜索 → 删除"，
 *     用于证明表单绑定、window.confirm、写后端与列表刷新这条链路是通的；
 *   - 未登录直访 `/admin?tab=...` 必须被中间件弹回 `/admin/login`；
 *   - 收集 `console.error` / `pageerror`，任何一个未被白名单放行的错误都算失败。
 *
 * 明确**不做**的事（见 `_acceptance/_team/report-admin-panels.md`）：
 *   - 不点封禁 / 退款 / 真实数据删除等不可逆操作；
 *   - 不验证多管理员角色权限矩阵（需要第二个账号，且属于权限测试而非面板冒烟）；
 *   - 邀请码只删**从未核销**的码（后端对已核销的码回 400101，需改用停用）；
 *     E2E 建的码从未核销，所以跑完会把自己建的那条删掉，不再在开发库里留记录。
 *
 * 用法：先起栈（`_acceptance/start-wanxing-stack.ps1`），再
 *   node _acceptance/e2e-admin-panels.cjs
 * 环境变量：API（默认 http://127.0.0.1:3002/v1）、WEB（http://127.0.0.1:3003）、
 *           CHROME（playwright-core 的 chromium 可执行文件）、
 *           ADMIN_USERNAME / ADMIN_PASSWORD（默认取本机 bootstrap 的 admin / admin12345）。
 */
const { chromium } = require("playwright-core");
const fs = require("node:fs");
const path = require("node:path");

const API = process.env.API || "http://127.0.0.1:3002/v1";
const WEB = process.env.WEB || "http://127.0.0.1:3003";

/**
 * 解析 chromium：ms-playwright 的目录名带版本号（chromium-1208、chromium-1243…），
 * playwright 升级一次，写死的路径就失效 —— 而失效的表现是"用例一条都没跑就退出 0"，
 * 比失败更危险。所以按版本号从高到低扫，找不到再退回系统 Chrome。
 */
function resolveChrome() {
  if (process.env.CHROME) return process.env.CHROME;
  const root = "C:/Users/Administrator/AppData/Local/ms-playwright";
  try {
    const candidates = fs
      .readdirSync(root)
      .filter((d) => /^chromium-\d+$/.test(d))
      .sort((a, b) => Number(b.slice("chromium-".length)) - Number(a.slice("chromium-".length)));
    for (const dir of candidates) {
      const exe = path.join(root, dir, "chrome-win64", "chrome.exe");
      if (fs.existsSync(exe)) return exe;
    }
  } catch {
    /* ms-playwright 目录不存在 */
  }
  return "C:/Program Files/Google/Chrome/Application/chrome.exe";
}

const CHROME = resolveChrome();
const SHOT_DIR = path.join(__dirname, "admin-panels-e2e");
const LOCALE = require(path.join(__dirname, "..", "app", "apps", "web", "i18n", "locales", "zh-CN.json"));
const Z = LOCALE;

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "✅" : "❌"} ${name}${detail ? ` — ${detail}` : ""}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(method, p, body, token) {
  const headers = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(`${API}${p}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, ...(json || {}) };
}

/** 面板清单：tab / 文案命名空间 / 首屏列表端点 / 只读交互按钮（取自 i18n，不写死中文字面量） */
const MENU_LABEL = {
  prices: "价格管理",
  market: "剧本广场",
  skills: "Skill 推荐位",
  audit: "操作日志",
  admins: "管理员",
  config: "配置中心",
  users: "用户管理",
  waitlist: "等待名单",
  invites: "邀请码",
  aiLabels: "AI 标识审计",
};

const PANELS = [
  { tab: "prices", ns: "adminPrices", mount: /\/v1\/ops\/admin\/model-prices(\?|$)/, action: "refresh" },
  { tab: "market", ns: "adminMarket", mount: /\/v1\/ops\/market\/scripts\/list(\?|$)/, action: "reset" },
  { tab: "skills", ns: "adminSkills", mount: /\/v1\/ops\/agent-skills(\?|$)/, action: "refresh" },
  { tab: "audit", ns: "adminAudit", mount: /\/v1\/ops\/admin\/audit-logs(\?|$)/, action: "reset" },
  { tab: "admins", ns: "adminAdmins", mount: /\/v1\/ops\/admin\/admins(\?|$)/, action: null },
  { tab: "config", ns: "adminConfig", mount: /\/v1\/ops\/admin\/configs(\?|$)/, action: "reset" },
  { tab: "users", ns: "adminUsers", mount: /\/v1\/ops\/admin\/users(\?|$)/, action: "reset" },
  { tab: "waitlist", ns: "adminWaitlist", mount: /\/v1\/ops\/admin\/waitlist(\?|$)/, action: "refresh" },
  { tab: "invites", ns: "adminInvites", mount: /\/v1\/ops\/admin\/invite-codes(\?|$)/, action: "refresh" },
  { tab: "aiLabels", ns: "adminAiLabel", mount: /\/v1\/ops\/admin\/ai-labels(\?|$)/, action: "reset" },
];

/** console / pageerror 白名单：只放行与面板无关的资源级噪音 */
const NOISE = [/favicon/i, /\[vite\]/, /Download the Vue Devtools/i];

function isNoise(text) {
  return NOISE.some((re) => re.test(text));
}

async function envelopeOf(res) {
  try {
    const body = await res.json();
    return body && typeof body.code === "number" ? body : null;
  } catch {
    return null;
  }
}

async function waitEnvelope(page, predicate, timeout = 20000) {
  const res = await page.waitForResponse(predicate, { timeout }).catch(() => null);
  if (!res) return { res: null, body: null };
  return { res, body: await envelopeOf(res) };
}

async function main() {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  if (!fs.existsSync(CHROME)) {
    check("chromium 可执行文件存在", false, CHROME);
    // 必须显式置非零：否则"一条用例都没跑"会以退出码 0 混进门禁（本轮真踩过）
    process.exitCode = 1;
    return;
  }

  // ── 登录：拿 admin token（独立 realm，不复用用户 token） ──────────────────
  const username = process.env.ADMIN_USERNAME || "admin";
  const password = process.env.ADMIN_PASSWORD || "admin12345";
  const login = await api("POST", "/ops/admin/login", { username, password });
  const token = login.data && login.data.token;
  check(
    "管理员登录 /v1/ops/admin/login 返回 token",
    login.code === 0 && typeof token === "string" && token.length > 20,
    `code=${login.code} msg=${login.msg || ""}`,
  );
  if (!token) {
    console.log("\n无法登录，后续用例无法进行。请确认本机栈的管理员账号与 ADMIN_USERNAME/ADMIN_PASSWORD 一致。");
    process.exitCode = 1;
    return;
  }

  const browser = await chromium.launch({ executablePath: CHROME, headless: true });

  // ── 未登录：直访后台必须被中间件弹回登录页 ────────────────────────────────
  {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(`${WEB}/admin?tab=prices`, { waitUntil: "domcontentloaded" });
    await page.waitForURL(/\/admin\/login$/, { timeout: 20000 }).catch(() => {});
    const onLogin = /\/admin\/login$/.test(page.url());
    const formVisible = await page
      .locator("section.auth-card h1")
      .first()
      .isVisible()
      .catch(() => false);
    check("未登录直访 /admin?tab=prices 弹回 /admin/login", onLogin, page.url());
    check("登录页渲染出表单（不是白屏 / 404）", formVisible);
    await page.screenshot({ path: path.join(SHOT_DIR, "guard-login.png") }).catch(() => {});
    await ctx.close();
  }

  // ── 已登录上下文：token 在每次导航前写入 localStorage ──────────────────────
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.addInitScript((t) => {
    try {
      localStorage.setItem("admin_token", t);
    } catch {
      /* about:blank 等没有 origin 的上下文，忽略 */
    }
  }, token);

  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const text = `console: ${msg.text()}`;
    if (!isNoise(text)) consoleErrors.push(text);
  });
  page.on("pageerror", (err) => {
    const text = `pageerror: ${err.message}`;
    if (!isNoise(text)) consoleErrors.push(text);
  });
  // 可逆写操作会触发 window.confirm（停用 / 删除）：一律确认，避免用例悬挂
  page.on("dialog", (d) => void d.accept());

  // ── 10 个面板逐个打开 ────────────────────────────────────────────────────
  for (const panel of PANELS) {
    const title = Z[panel.ns].title;
    const menuLabel = MENU_LABEL[panel.tab];
    const errorsBefore = consoleErrors.length;
    try {
      const mountWait = waitEnvelope(page, (r) => panel.mount.test(r.url()) && r.status() === 200);
      await page.goto(`${WEB}/admin?tab=${panel.tab}`, { waitUntil: "domcontentloaded" });
      const mount = await mountWait;

      const h2 = page.locator("h2", { hasText: title }).first();
      const h2Visible = await h2
        .waitFor({ state: "visible", timeout: 20000 })
        .then(() => true)
        .catch(() => false);
      check(`[${panel.tab}] 面板标题「${title}」渲染`, h2Visible);
      if (!h2Visible) {
        await page.screenshot({ path: path.join(SHOT_DIR, `panel-${panel.tab}.png`) }).catch(() => {});
        continue;
      }

      const pageTitle = (await page.locator(".page-title").first().innerText()).trim();
      check(`[${panel.tab}] 顶部标题 =「${menuLabel}」`, pageTitle === menuLabel, pageTitle);

      const activeNav = (await page.locator("nav.admin-nav a.nav-item.active").first().innerText()).trim();
      check(
        `[${panel.tab}] 侧栏高亮「${menuLabel}」`,
        activeNav.startsWith(menuLabel),
        activeNav.replace(/\s+/g, " ").slice(0, 60),
      );

      check(
        `[${panel.tab}] 首屏列表请求成功（code=0）`,
        mount.res !== null && mount.body !== null && mount.body.code === 0,
        mount.res
          ? `${mount.res.request().method()} ${new URL(mount.res.url()).pathname} code=${mount.body ? mount.body.code : "?"}`
          : "20s 内没有发出列表请求",
      );

      if (panel.action) {
        const label = panel.action === "refresh" ? Z[panel.ns].refresh : Z[panel.ns].reset;
        const button = page.locator("button", { hasText: label }).first();
        const enabled = await button.isEnabled().catch(() => false);
        check(`[${panel.tab}] 只读按钮「${label}」存在且可用`, enabled);
        if (enabled) {
          const reloadWait = waitEnvelope(page, (r) => panel.mount.test(r.url()) && r.status() === 200);
          await button.click();
          const reload = await reloadWait;
          check(
            `[${panel.tab}] 点击「${label}」后列表重新加载成功`,
            reload.res !== null && reload.body !== null && reload.body.code === 0,
            reload.res ? `code=${reload.body ? reload.body.code : "?"}` : "20s 内没有重新请求",
          );
        }
      }

      if (panel.tab === "admins") {
        const adminRows = await page.locator("div.row:not(.head-row)").count();
        const bootstrapRow = await page.locator("div.row", { hasText: username }).count();
        check("[admins] 账号列表至少 1 行且含当前登录账号", adminRows >= 1 && bootstrapRow >= 1, `rows=${adminRows}`);
      }

      await page.screenshot({ path: path.join(SHOT_DIR, `panel-${panel.tab}.png`) }).catch(() => {});
      check(`[${panel.tab}] 无未预期 console/page 错误`, consoleErrors.length === errorsBefore, consoleErrors.slice(errorsBefore).join(" | "));
    } catch (err) {
      check(`[${panel.tab}] 打开面板`, false, String(err && err.message ? err.message : err));
      await page.screenshot({ path: path.join(SHOT_DIR, `panel-${panel.tab}.png`) }).catch(() => {});
    }
  }

  // ── 可逆写 1：邀请码 生成 → 停用 → 删除 ───────────────────────────────────
  try {
    await page.goto(`${WEB}/admin?tab=invites`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".create-form .create-btn", { timeout: 20000 });
    // 四个字段顺序：credits / maxUses / expiresAt(datetime) / count —— 只填 credits 与 count，其余走后端默认
    const numberInputs = page.locator('.create-form input[type="number"]');
    await numberInputs.nth(0).fill("0");
    await numberInputs.nth(2).fill("1");

    const createWait = waitEnvelope(
      page,
      (r) =>
        /\/v1\/ops\/admin\/invite-codes$/.test(new URL(r.url()).pathname) &&
        r.request().method() === "POST" &&
        // NestJS 的 POST 默认 201 Created（不是 200）—— 只认 200 会让"已经成功建码"
        // 也判成超时（第 107 批：面板修好后 POST 打出 201，这里仍报 code=?）。
        r.status() >= 200 &&
        r.status() < 300,
    );
    await page.locator(".create-form .create-btn").click();
    const created = await createWait;
    const codes = created.body && created.body.data && created.body.data.codes;
    const code = Array.isArray(codes) && codes[0] && codes[0].code;
    check("邀请码：生成 1 个码（POST code=0）", created.body !== null && created.body.code === 0 && !!code, `code=${code || "?"}`);
    if (code) {
      const chip = page.locator(".created .chip .mono", { hasText: code }).first();
      check("邀请码：新码出现在「本次生成」区且可复制", await chip.isVisible().catch(() => false));

      const row = page.locator("div.row", { hasText: code }).first();
      const rowVisible = await row
        .waitFor({ state: "visible", timeout: 20000 })
        .then(() => true)
        .catch(() => false);
      check("邀请码：新行出现在列表中", rowVisible);

      if (rowVisible) {
        const disable = row.locator("button", { hasText: Z.adminInvites.disable }).first();
        const disableWait = waitEnvelope(
          page,
          (r) => /\/v1\/ops\/admin\/invite-codes\/[^/]+$/.test(new URL(r.url()).pathname) && r.request().method() === "PATCH",
        );
        await disable.click();
        const disabled = await disableWait;
        check("邀请码：停用 PATCH code=0", disabled.body !== null && disabled.body.code === 0, `code=${disabled.body ? disabled.body.code : "?"}`);
        const offText = await row.locator(".state-off").first().innerText().catch(() => "");
        check(`邀请码：行状态变为「${Z.adminInvites.statusDisabled}」`, offText.trim() === Z.adminInvites.statusDisabled, offText.trim());
        const banner = await page.locator("p.banner.ok").first().innerText().catch(() => "");
        check("邀请码：成功提示包含码值", banner.includes(code), banner.trim());

        // 删除：只接受从未核销的码 —— 本流程刚建的码没被核销过，应删得掉。
        // 全局 dialog 监听在页面加载时就已 accept（见文件顶部），`window.confirm` 不会卡住。
        const del = row.locator("button", { hasText: Z.adminInvites.delete }).first();
        const deleteWait = waitEnvelope(
          page,
          (r) =>
            /\/v1\/ops\/admin\/invite-codes\/[^/]+$/.test(new URL(r.url()).pathname) &&
            r.request().method() === "DELETE",
        );
        await del.click();
        const removed = await deleteWait;
        check("邀请码：删除未核销码 DELETE code=0", removed.body !== null && removed.body.code === 0, `code=${removed.body ? removed.body.code : "?"}`);
        const rowGone = await row
          .waitFor({ state: "detached", timeout: 20000 })
          .then(() => true)
          .catch(() => false);
        check("邀请码：删除后行从列表消失", rowGone);
      }
    }
    await page.screenshot({ path: path.join(SHOT_DIR, "write-invites.png") }).catch(() => {});
  } catch (err) {
    check("邀请码：生成 → 停用 → 删除", false, String(err && err.message ? err.message : err));
    await page.screenshot({ path: path.join(SHOT_DIR, "write-invites.png") }).catch(() => {});
  }

  // ── 可逆写 2：配置中心 新建 → 搜索 → 删除 ─────────────────────────────────
  try {
    const key = `e2e_admin107_${Date.now()}`;
    await page.goto(`${WEB}/admin?tab=config`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("h2", { timeout: 20000 });
    await page.locator("button", { hasText: Z.adminConfig.new }).first().click();
    await page.waitForSelector(".form .form-grid input", { timeout: 20000 });

    const formInputs = page.locator(".form .form-grid input");
    await formInputs.nth(0).fill(key);
    await formInputs.nth(1).fill("e2e");
    await formInputs.nth(2).fill("第 107 批面板冒烟临时配置，用例结束即删除");
    await page.locator(".form textarea.value").fill('{"ok":true}');

    const saveWait = waitEnvelope(
      page,
      (r) => r.url().includes(`/v1/ops/admin/config/${key}`) && r.request().method() === "PUT",
    );
    await page.locator(".form-actions button", { hasText: Z.adminConfig.save }).first().click();
    const saved = await saveWait;
    check("配置中心：新建并保存（PUT code=0）", saved.body !== null && saved.body.code === 0, `key=${key}`);
    const okText = await page.locator("p.ok").first().innerText().catch(() => "");
    check("配置中心：保存成功提示包含 key", okText.includes(key), okText.trim());

    // 搜索：证明 filters.q 真的带到了列表请求，而不是只改了输入框
    const searchInput = page.locator('input[aria-label="' + Z.adminConfig.fQ + '"]');
    await searchInput.fill(key);
    const searchWait = waitEnvelope(
      page,
      (r) => /\/v1\/ops\/admin\/configs(\?|$)/.test(r.url()) && r.url().includes(encodeURIComponent(key)),
    );
    await page.locator("button", { hasText: Z.adminConfig.search }).first().click();
    await searchWait;
    const row = page.locator("div.row", { hasText: key }).first();
    check("配置中心：按 key 搜索能查到新建的配置", await row.isVisible().catch(() => false));

    const deleteWait = waitEnvelope(
      page,
      (r) =>
        r.url().includes(`/v1/ops/admin/config/${encodeURIComponent(key)}`) &&
        r.request().method() === "DELETE",
    );
    await row.locator("button.danger").first().click();
    const deleted = await deleteWait;
    check("配置中心：删除（DELETE code=0）", deleted.body !== null && deleted.body.code === 0, `code=${deleted.body ? deleted.body.code : "?"}`);
    await row.waitFor({ state: "detached", timeout: 20000 }).catch(() => {});
    check("配置中心：删除后行从列表消失", (await page.locator("div.row", { hasText: key }).count()) === 0);
    await page.screenshot({ path: path.join(SHOT_DIR, "write-config.png") }).catch(() => {});
  } catch (err) {
    check("配置中心：新建 → 搜索 → 删除", false, String(err && err.message ? err.message : err));
    await page.screenshot({ path: path.join(SHOT_DIR, "write-config.png") }).catch(() => {});
  }

  // ── 汇总 ────────────────────────────────────────────────────────────────
  await context.close();
  await browser.close();

  const failed = results.filter((r) => !r.ok);
  const panelFailures = failed.filter((r) => r.name.startsWith("["));
  const writeFailures = failed.filter((r) => !r.name.startsWith("["));
  console.log("\n────────────────────────────────────────────");
  console.log(`共 ${results.length} 项：通过 ${results.length - failed.length}，失败 ${failed.length}`);
  if (failed.length) {
    console.log("失败项：");
    for (const f of failed) console.log(`  ❌ ${f.name}${f.detail ? ` — ${f.detail}` : ""}`);
  }
  console.log(`截图目录：${SHOT_DIR}`);
  console.log(`RESULT panels=${PANELS.length} panelFailures=${panelFailures.length} writeFailures=${writeFailures.length}`);
  process.exitCode = failed.length ? 1 : 0;
}

main().catch((err) => {
  console.error("FATAL", err);
  process.exitCode = 1;
});