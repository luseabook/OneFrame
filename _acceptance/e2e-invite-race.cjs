/**
 * 邀请码：多管理员并发删除 + 陈旧快照 浏览器 E2E（第 111 批）
 *
 * 背景：docs/README.md v6.68 的「仍未做」写着「后台 E2E 仍是单进程单浏览器，
 * 不覆盖多管理员同时操作同一条码」。第 110 批补了服务层 delete × redeem 的
 * 真事务并发单测，但单测证明的是 SQL 语义，**没有证明两个已经打开同一张列表的
 * 浏览器会话**在同一条码上会得到什么：谁成功、输的一方看到什么、列表会不会自己
 * 纠正。这恰好是运营最常见的现场（两个人同时清理同一批码）。
 *
 * 本脚本用两个**隔离浏览器上下文**（各自 localStorage.admin_token，互不共享
 * 缓存与页面状态）打开同一个后台邀请码面板，覆盖三幕：
 *   S1 两个会话拿着同一行、同时点删除 → 后端恰好一个成功；输的一方收到
 *      400101/400102，页面保留陈旧行并给出错误条；点刷新后行消失。
 *   S2 后台列表仍是 0/1 时，真实短信用户在前台核销该码；后台点删除被后端
 *      以 400101「已核销，请改用停用」拒绝；刷新后用量变 1/1、状态变「已耗尽」、
 *      删除按钮禁用且 title 说明原因。
 *   S3 码被管理员删除后，用户在前台补填 → 收到「邀请码不存在」错误 toast。
 *
 * 诚实边界（不要从这份脚本里读出比它更多的结论）：
 *   - 两个上下文是**同一个 bootstrap 管理员的两个会话**，不是两个 admin_users。
 *     admin_users 不支持物理删除（审计外键），造第二个账号会在开发库永久留痕；
 *     角色矩阵（viewer 只读、写 403101）由 `apps/api/test/admin-ops-p1.spec.ts`
 *     与各面板单测覆盖，本脚本不重复。
 *   - 仍是单 API 进程、单 PG 实例；证明的是「并发提交同一条码不会双删/双改」，
 *     不是多副本下的分布式一致性，也不证明赢家分布的稳定性（谁赢取决于调度）。
 *   - S1 输家的文案可能是「已核销」而不是「不存在」：条件删除返回 0 行时复用
 *     同一句业务错误。这是**已知且安全**的措辞不精确，不视为缺陷。
 *   - 脚本自己建的码在 finally 里按 id 直连开发库清理（先删核销行，再删码）；
 *     每次运行会留下一个短信测试用户（与其它 E2E 同口径，README 已登记）。
 *
 * 用法：先起栈（_acceptance/start-wanxing-stack.ps1），再
 *   node _acceptance/e2e-invite-race.cjs
 * 环境变量：API / WEB / CHROME / ADMIN_USERNAME / ADMIN_PASSWORD / DATABASE_URL
 */
"use strict";

const { chromium } = require("playwright-core");
const fs = require("node:fs");
const path = require("node:path");

const API = process.env.API || "http://127.0.0.1:3002/v1";
const WEB = process.env.WEB || "http://127.0.0.1:3003";
const DB_URL = process.env.DATABASE_URL || "postgres://app:app@127.0.0.1:55432/app";
const SHOT_DIR = path.join(__dirname, "invite-race-e2e");
const Z = require(path.join(__dirname, "..", "app", "apps", "web", "i18n", "locales", "zh-CN.json"));

/** Playwright 的浏览器不在 PATH 里：按版本倒序找 ms-playwright 缓存，再退到系统 Chrome */
function resolveChrome() {
  if (process.env.CHROME && fs.existsSync(process.env.CHROME)) return process.env.CHROME;
  const root = "C:/Users/Administrator/AppData/Local/ms-playwright";
  try {
    const dirs = fs
      .readdirSync(root)
      .filter((d) => /^chromium-\d+$/.test(d))
      .sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]));
    for (const d of dirs) {
      const exe = path.join(root, d, "chrome-win64", "chrome.exe");
      if (fs.existsSync(exe)) return exe;
    }
  } catch {
    /* 缓存目录不存在就走下面的系统 Chrome */
  }
  return "C:/Program Files/Google/Chrome/Application/chrome.exe";
}

const CHROME = resolveChrome();

// ── 断言与通用小工具 ─────────────────────────────────────────

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? "  ok " : " FAIL"}  ${name}${detail ? `  ·  ${detail}` : ""}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function resolvePg() {
  // `pg` 只装在工作区里（app/node_modules/.pnpm/...）。脚本在仓库根的 _acceptance 下
  // 运行，直接 require("pg") 找不到 —— 用 api 包的真实 node_modules 作为解析根。
  return require(require.resolve("pg", { paths: [path.join(__dirname, "..", "app", "apps", "api", "node_modules")] }));
}

async function dbCleanup(ids) {
  const unique = [...new Set(ids.map(String))];
  if (unique.length === 0) return { ids: 0, redemptions: 0, codes: 0, leftCodes: 0, leftRedemptions: 0 };
  const { Client } = resolvePg();
  const client = new Client({ connectionString: DB_URL });
  await client.connect();
  try {
    // 先删核销行再删码：invite_redemptions.code_id 外键指向 invite_codes.id。
    // id 是 bigint 雪花（>2^53），必须按十进制字符串传并在 SQL 里 cast，绝不能走 Number。
    const red = await client.query("delete from invite_redemptions where code_id = any($1::bigint[])", [unique]);
    const codes = await client.query("delete from invite_codes where id = any($1::bigint[])", [unique]);
    const leftCodes = await client.query("select count(*)::int as n from invite_codes where id = any($1::bigint[])", [unique]);
    const leftRed = await client.query("select count(*)::int as n from invite_redemptions where code_id = any($1::bigint[])", [unique]);
    return {
      ids: unique.length,
      redemptions: red.rowCount,
      codes: codes.rowCount,
      leftCodes: leftCodes.rows[0].n,
      leftRedemptions: leftRed.rows[0].n,
    };
  } finally {
    await client.end().catch(() => {});
  }
}

// ── HTTP（走真实 API，不绕过鉴权/校验） ──────────────────────

async function api(method, p, body, token) {
  const headers = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(`${API}${p}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  return { status: res.status, code: json ? json.code : null, msg: json ? json.msg : null, data: json ? json.data : null };
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
  const res = await page.waitForResponse(
    (r) => {
      try {
        return predicate(r);
      } catch {
        return false;
      }
    },
    { timeout },
  ).catch(() => null);
  if (!res) return { status: 0, body: null };
  return { status: res.status(), body: await envelopeOf(res) };
}

// ── 浏览器会话 ──────────────────────────────────────────────

const NOISE = [/favicon/i, /\[vite\]/, /Download the Vue Devtools/i, /WebSocket connection .* failed/i];

/** 故意制造的业务拒绝会让 Chromium 记一条资源级 error（fetch 4xx）；只按精确 URL 放行这两个端点 */
function isExpectedHttpNoise(msg) {
  if (!/Failed to load resource/i.test(msg.text())) return false;
  const loc = msg.location && msg.location();
  const raw = (loc && loc.url) || "";
  try {
    return /\/v1\/(ops\/admin\/invite-codes\/[^/]+|op\/invite-code\/verify)$/.test(new URL(raw).pathname);
  } catch {
    return false;
  }
}

function watchSink(page, sinks, tag) {
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    if (NOISE.some((re) => re.test(msg.text()))) return;
    if (isExpectedHttpNoise(msg)) return;
    sinks.push(`${tag} console: ${msg.text()}`);
  });
  page.on("pageerror", (err) => {
    const text = String(err && err.message ? err.message : err);
    if (NOISE.some((re) => re.test(text))) return;
    sinks.push(`${tag} pageerror: ${text}`);
  });
}

async function newAdminPage(browser, token, sinks, tag) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await ctx.addInitScript((t) => {
    try {
      localStorage.setItem("admin_token", t);
    } catch {
      /* 无痕上下文里不应失败，失败就让后面的鉴权检查暴露 */
    }
  }, token);
  const page = await ctx.newPage();
  watchSink(page, sinks, tag);
  page.on("dialog", (d) => d.accept().catch(() => {}));
  return { ctx, page };
}

// ── 邀请码：API 造码 + 面板行定位 ───────────────────────────

async function createCode(token, { credits = 0, maxUses = 1 } = {}) {
  const res = await api("POST", "/ops/admin/invite-codes", { credits, max_uses: maxUses, count: 1 }, token);
  const code = res.data && res.data.codes && res.data.codes[0];
  return { res, code };
}

const listCodes = (token) => api("GET", "/ops/admin/invite-codes?page=1&page_size=100", undefined, token);

const isAdminList = (r) => r.request().method() === "GET" && /\/v1\/ops\/admin\/invite-codes(\?|$)/.test(r.url());
const isDeleteCode = (r) =>
  r.request().method() === "DELETE" && /\/v1\/ops\/admin\/invite-codes\/[^/?]+$/.test(new URL(r.url()).pathname);
const isVerify = (r) => r.request().method() === "POST" && /\/v1\/op\/invite-code\/verify$/.test(new URL(r.url()).pathname);

const rowFor = (page, code) => page.locator("div.row", { hasText: code }).first();
// 行内第一个 span.muted 是 credits，第二个才是 used/max
const usageOf = (row) => row.locator("span.muted").nth(1).innerText().then((s) => s.trim()).catch(() => "");
const deleteBtnOf = (row) => row.locator("button.mini.danger").first();

async function clickDelete(page, row) {
  // 先挂响应等待再点：DELETE 可能在同一 tick 返回，晚挂会丢
  const wait = waitEnvelope(page, isDeleteCode);
  await deleteBtnOf(row).click();
  return wait;
}

async function waitText(locator, timeout = 15000) {
  const end = Date.now() + timeout;
  let text = "";
  while (Date.now() < end) {
    text = await locator.innerText().catch(() => "");
    if (text.trim()) return text.trim();
    await sleep(120);
  }
  return text.trim();
}

async function waitMatch(locator, re, timeout = 15000) {
  const end = Date.now() + timeout;
  let text = "";
  while (Date.now() < end) {
    text = await locator.innerText().catch(() => "");
    if (re.test(text.trim())) return text.trim();
    await sleep(120);
  }
  return text.trim();
}

async function waitCount(locator, expected, timeout = 15000) {
  const end = Date.now() + timeout;
  let n = -1;
  while (Date.now() < end) {
    n = await locator.count().catch(() => -1);
    if (n === expected) return n;
    await sleep(120);
  }
  return n;
}

function waitToast(page, type, expected, timeout = 20000) {
  return page
    .waitForFunction(
      ({ type, expected }) =>
        Array.from(document.querySelectorAll(`.toasts .toast.${type} .text`)).some((el) =>
          String(el.textContent || "").includes(expected),
        ),
      { type, expected },
      { timeout },
    )
    .then(() => true)
    .catch(() => false);
}

// ── 真实短信登录（复用 e2e-director-collab.cjs 的做法） ─────

function newPhone() {
  return `13${String(Date.now()).slice(-7)}${String(Math.floor(Math.random() * 100)).padStart(2, "0")}`;
}

async function prepareUser(tag) {
  const phone = newPhone();
  const res = await api("POST", "/auth/sms-code", { phone });
  if (res.code !== 0) throw new Error(`${tag}: 发短信验证码失败 code=${res.code} msg=${res.msg}`);
  // 开发栈把验证码回显在 data.debug_code 里（生产不发）；拿不到就直接失败，不猜
  const code = res.data && (res.data.debug_code || res.data.code || res.data.sms_code || res.data.dev_code);
  if (!code) throw new Error(`${tag}: 开发栈未回显短信验证码，无法登录（data=${JSON.stringify(res.data)}）`);
  return { phone, code: String(code) };
}

async function loginUser(page, user) {
  await page.goto(`${WEB}/login`, { waitUntil: "domcontentloaded" });
  await page.locator('input[placeholder="请输入手机号码"]').fill(user.phone);
  await page.locator('input[placeholder="请输入验证码"]').fill(user.code);
  await page.locator(".agree-row input[type=checkbox]").check();
  await page.locator("button.submit").click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 40000 });
  // access token 在内存里：用页面自身的 fetch 走 refresh（带 httpOnly cookie）拿一份给断言用
  const token = await page.evaluate(async () => {
    const r = await fetch("/v1/auth/refresh", { method: "POST", credentials: "include" });
    const j = await r.json().catch(() => null);
    return j && j.data ? j.data.access_token : null;
  });
  return token;
}

// ── 主流程 ─────────────────────────────────────────────────

async function main() {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  if (!fs.existsSync(CHROME)) {
    check("找到 Chromium/Chrome 可执行文件", false, CHROME);
    process.exitCode = 1;
    return;
  }

  const username = process.env.ADMIN_USERNAME || "admin";
  const password = process.env.ADMIN_PASSWORD || "admin12345";
  const loginRes = await api("POST", "/ops/admin/login", { username, password });
  const token = loginRes.data && loginRes.data.token;
  check(
    "管理员登录 /v1/ops/admin/login 返回 token",
    loginRes.code === 0 && typeof token === "string" && token.length > 20,
    `code=${loginRes.code} msg=${loginRes.msg || ""}`,
  );
  if (!token) {
    console.log("\n登录失败，后续无法开始；先确认栈已起来。");
    process.exitCode = 1;
    return;
  }

  const createdIds = [];
  const sinks = [];
  let browser;
  let cleanup = null;

  try {
    browser = await chromium.launch({ executablePath: CHROME, headless: true });

    // ── S1：两个管理员会话同时删除同一条未核销码 ──────────────
    {
      const { res, code } = await createCode(token);
      const created = res.code === 0 && !!code;
      check("S1 通过 API 生成未核销邀请码", created, created ? `${code.code} id=${code.id}` : JSON.stringify(res));
      if (created) {
        createdIds.push(code.id);
        const a = await newAdminPage(browser, token, sinks, "admin-A");
        const b = await newAdminPage(browser, token, sinks, "admin-B");

        const waitA = waitEnvelope(a.page, isAdminList);
        await a.page.goto(`${WEB}/admin?tab=invites`, { waitUntil: "domcontentloaded" });
        const mountA = await waitA;
        const waitB = waitEnvelope(b.page, isAdminList);
        await b.page.goto(`${WEB}/admin?tab=invites`, { waitUntil: "domcontentloaded" });
        const mountB = await waitB;
        check(
          "S1 两个隔离会话都加载到邀请码列表",
          mountA.body?.code === 0 && mountB.body?.code === 0,
          `A=${mountA.body?.code ?? "?"} B=${mountB.body?.code ?? "?"}`,
        );

        const rowA = rowFor(a.page, code.code);
        const rowB = rowFor(b.page, code.code);
        const seenA = await rowA.waitFor({ state: "visible", timeout: 20000 }).then(() => true).catch(() => false);
        const seenB = await rowB.waitFor({ state: "visible", timeout: 20000 }).then(() => true).catch(() => false);
        const initialOk =
          seenA &&
          seenB &&
          (await usageOf(rowA)) === "0/1" &&
          (await usageOf(rowB)) === "0/1" &&
          (await deleteBtnOf(rowA).isEnabled()) &&
          (await deleteBtnOf(rowB).isEnabled());
        check("S1 两个会话看到同一行（0/1、删除可用）", initialOk, `A=${seenA} B=${seenB}`);

        const [raceA, raceB] = await Promise.all([clickDelete(a.page, rowA), clickDelete(b.page, rowB)]);
        const outcomes = [raceA, raceB];
        const winners = outcomes.filter((o) => o.body && o.body.code === 0);
        check(
          "S1 两个会话同时删除：恰好一个成功",
          winners.length === 1,
          outcomes.map((o) => `code=${o.body ? o.body.code : "no-response"}`).join(" / "),
        );

        if (winners.length === 1) {
          const winnerIndex = outcomes.indexOf(winners[0]);
          const winner = winnerIndex === 0 ? a : b;
          const loser = winnerIndex === 0 ? b : a;
          const winnerRow = winnerIndex === 0 ? rowA : rowB;
          const loserRow = winnerIndex === 0 ? rowB : rowA;
          const lost = outcomes[1 - winnerIndex];

          check(
            "S1 输家得到业务错误 400101/400102",
            !!lost.body && [400101, 400102].includes(lost.body.code),
            lost.body ? `code=${lost.body.code} msg=${lost.body.msg}` : "无响应",
          );

          const winBanner = await waitText(winner.page.locator(".banner.ok").first());
          check("S1 赢家看到「已删除」成功条并含码值", winBanner.includes(code.code), winBanner.slice(0, 120));
          const winGone = (await waitCount(winnerRow, 0)) === 0;
          check("S1 赢家行从列表移除", winGone);

          const loseBanner = await waitText(loser.page.locator(".banner.error").first());
          check(
            "S1 输家看到错误条（已核销 / 不存在）",
            /not found|redeemed/i.test(loseBanner),
            loseBanner.slice(0, 160),
          );
          check("S1 输家页面保留陈旧行且删除仍可点", (await loserRow.count()) === 1 && (await deleteBtnOf(loserRow).isEnabled()));

          const refreshWait = waitEnvelope(loser.page, isAdminList);
          await loser.page.locator(".filters button", { hasText: Z.adminInvites.refresh }).first().click();
          const refreshed = await refreshWait;
          const loserGone = (await waitCount(loserRow, 0)) === 0;
          check(
            "S1 输家点刷新后陈旧行消失",
            refreshed.body?.code === 0 && loserGone,
            `code=${refreshed.body?.code ?? "?"} rows=${loserGone ? 0 : "仍可见"}`,
          );

          const after = await listCodes(token);
          const stillListed = (after.data?.list || []).some((r) => r.id === code.id);
          check("S1 后端列表不再包含该码", after.code === 0 && !stillListed, `listed=${stillListed}`);

          await winner.page.screenshot({ path: path.join(SHOT_DIR, "s1-race-winner.png"), fullPage: false });
          await loser.page.screenshot({ path: path.join(SHOT_DIR, "s1-race-loser.png"), fullPage: false });
        }

        await a.ctx.close().catch(() => {});
        await b.ctx.close().catch(() => {});
      }
    }

    // ── S2 + S3：核销后的陈旧后台快照 / 已删除码的用户侧表现 ──
    {
      const { res, code } = await createCode(token);
      const created = res.code === 0 && !!code;
      check("S2 通过 API 生成未核销邀请码", created, created ? `${code.code} id=${code.id}` : JSON.stringify(res));
      if (created) {
        createdIds.push(code.id);
        const admin = await newAdminPage(browser, token, sinks, "admin-S2");
        const mountWait = waitEnvelope(admin.page, isAdminList);
        await admin.page.goto(`${WEB}/admin?tab=invites`, { waitUntil: "domcontentloaded" });
        const mount = await mountWait;
        const row = rowFor(admin.page, code.code);
        await row.waitFor({ state: "visible", timeout: 20000 }).catch(() => {});
        const initialSnapshot = (await usageOf(row)) === "0/1" && (await deleteBtnOf(row).isEnabled());
        check("S2 后台初始快照 0/1 且删除可用", mount.body?.code === 0 && initialSnapshot, `usage=${await usageOf(row)}`);

        // 真实短信用户走完整登录 + 前台补填，不直接打 API
        const userCtx = await browser.newContext({ viewport: { width: 430, height: 900 } });
        const userPage = await userCtx.newPage();
        watchSink(userPage, sinks, "user");
        userPage.on("dialog", (d) => d.accept().catch(() => {}));
        const user = await prepareUser("S2");
        const access = await loginUser(userPage, user);
        check("S2 真实短信用户登录成功", typeof access === "string" && access.length > 20, user.phone);

        await userPage.goto(`${WEB}/invite`, { waitUntil: "domcontentloaded" });
        // `.inv-btn.primary` 在复制链接/每日领取等卡片里也有，必须按「补填邀请码」这张卡定位
        const fillCard = userPage.locator("section.inv-card", { hasText: Z.invite.fillCode }).first();
        const cardVisible = await fillCard.waitFor({ state: "visible", timeout: 30000 }).then(() => true).catch(() => false);
        check("S2 用户端「补填邀请码」卡片渲染", cardVisible);

        if (cardVisible) {
          const verifyToast = waitToast(userPage, "success", Z.invite.toastCodeApplied);
          const verifyWait = waitEnvelope(userPage, isVerify);
          await fillCard.locator("input.inv-input").fill(code.code);
          await fillCard.locator("button.inv-btn.primary").click();
          const verified = await verifyWait;
          const toastSeen = await verifyToast;
          check(
            "S2 用户核销成功（业务成功 + 成功 toast）",
            verified.body?.code === 0 && toastSeen,
            `code=${verified.body?.code ?? "?"} msg=${verified.body?.msg ?? ""} toast=${toastSeen}`,
          );

          // 后台页面没有轮询/推送：此刻仍是核销前的快照，这正是要证明的现场
          const staleUsage = await usageOf(row);
          const staleEnabled = await deleteBtnOf(row).isEnabled().catch(() => false);
          check(
            "S2 用户核销后后台仍是陈旧快照（0/1、删除仍可点）",
            staleUsage === "0/1" && staleEnabled,
            `usage=${staleUsage} enabled=${staleEnabled}`,
          );

          const del = await clickDelete(admin.page, row);
          check(
            "S2 陈旧快照下删除被后端拒绝（400101 已核销）",
            del.body?.code === 400101,
            `code=${del.body?.code ?? "?"} msg=${del.body?.msg ?? ""}`,
          );
          const banner = await waitText(admin.page.locator(".banner.error").first());
          check(
            "S2 后台错误条给出「已核销，请改用停用」",
            /redeemed|停用|核销/i.test(banner),
            banner.slice(0, 160),
          );
          check("S2 删除失败后陈旧行仍在（前端未擅自移除）", (await row.count()) === 1);
          await admin.page.screenshot({ path: path.join(SHOT_DIR, "s2-stale-admin.png"), fullPage: false });

          const refreshWait = waitEnvelope(admin.page, isAdminList);
          await admin.page.locator(".filters button", { hasText: Z.adminInvites.refresh }).first().click();
          const refreshed = await refreshWait;
          const usageAfter = await waitMatch(row.locator("span.muted").nth(1), /^1\/1$/);
          const statusAfter = await row
            .locator("span.state-on, span.state-off")
            .first()
            .innerText()
            .then((s) => s.trim())
            .catch(() => "");
          check(
            "S2 刷新后用量变 1/1、状态变「已耗尽」",
            refreshed.body?.code === 0 && usageAfter === "1/1" && statusAfter === Z.adminInvites.statusExhausted,
            `usage=${usageAfter} status=${statusAfter}`,
          );
          const delDisabled = !(await deleteBtnOf(row).isEnabled().catch(() => true));
          const delTitle = await deleteBtnOf(row).getAttribute("title").catch(() => null);
          check(
            "S2 刷新后删除按钮禁用且 title 说明原因",
            delDisabled && delTitle === Z.adminInvites.deleteUsedHint,
            `disabled=${delDisabled} title=${delTitle}`,
          );
          await admin.page.screenshot({ path: path.join(SHOT_DIR, "s2-after-reload.png"), fullPage: false });

          const after = await listCodes(token);
          const dto = (after.data?.list || []).find((r) => r.id === code.id);
          check(
            "S2 后端行 used_count=1、status=3（耗尽）",
            !!dto && dto.used_count === 1 && dto.status === 3,
            dto ? `used=${dto.used_count} status=${dto.status}` : "列表里找不到",
          );

          // ── S3：码被管理员删掉后，用户补填会看到什么 ──────────
          // 等 S2 的成功 toast 自己消失（2600ms 后销毁），避免误判 S3 的 error toast
          await userPage.locator(".toasts .toast").first().waitFor({ state: "detached", timeout: 12000 }).catch(() => {});

          const third = await createCode(token);
          if (third.res.code === 0 && third.code) {
            createdIds.push(third.code.id);
            const deleted = await api("DELETE", `/ops/admin/invite-codes/${third.code.id}`, undefined, token);
            check(
              "S3 管理员删除未核销码",
              deleted.code === 0 && deleted.data && deleted.data.deleted === true,
              `code=${deleted.code} msg=${deleted.msg || ""}`,
            );

            const errorToast = waitToast(userPage, "error", "邀请码不存在");
            const verifyWait2 = waitEnvelope(userPage, isVerify);
            await fillCard.locator("input.inv-input").fill(third.code.code);
            await fillCard.locator("button.inv-btn.primary").click();
            const again = await verifyWait2;
            const errSeen = await errorToast;
            check(
              "S3 用户补填已删除的码 → 400101「邀请码不存在」+ 错误 toast",
              again.body?.code === 400101 && /邀请码不存在/.test(again.body?.msg || "") && errSeen,
              `code=${again.body?.code ?? "?"} msg=${again.body?.msg ?? ""} toast=${errSeen}`,
            );
            await userPage.screenshot({ path: path.join(SHOT_DIR, "s3-deleted-code.png"), fullPage: false });
          } else {
            check("S3 通过 API 生成待删除邀请码", false, JSON.stringify(third.res));
          }
        }

        await userCtx.close().catch(() => {});
        await admin.ctx.close().catch(() => {});
      }
    }

    check("全流程无未预期 console / pageerror", sinks.length === 0, sinks.slice(0, 3).join(" | "));
  } catch (err) {
    const detail = String(err && err.stack ? err.stack.split("\n").slice(0, 4).join(" | ") : err);
    check("E2E 主流程未抛异常", false, detail);
  } finally {
    if (browser) await browser.close().catch(() => {});
    try {
      cleanup = await dbCleanup(createdIds);
      check(
        "清理本脚本创建的邀请码与核销记录",
        cleanup.leftCodes === 0 && cleanup.leftRedemptions === 0,
        JSON.stringify(cleanup),
      );
    } catch (err) {
      check("清理本脚本创建的邀请码与核销记录", false, String(err && err.message ? err.message : err));
    }
  }

  const failed = results.filter((r) => !r.ok);
  fs.writeFileSync(
    path.join(SHOT_DIR, "result.json"),
    JSON.stringify({ at: new Date().toISOString(), api: API, web: WEB, results, cleanup }, null, 2),
  );
  console.log(
    `\nRESULT ${failed.length ? "FAIL" : "PASS"} ${results.length - failed.length}/${results.length} checks · web=${WEB} · ${new Date().toISOString()}`,
  );
  process.exitCode = failed.length ? 1 : 0;
}

main().catch((err) => {
  console.error("E2E 脚本自身崩溃：", err);
  process.exitCode = 1;
});