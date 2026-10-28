/**
 * 3D 导演台（模块 #19）**多用户协同**端到端验收 —— 两个真实浏览器上下文 + 两个真实账号。
 *
 * 为什么单独写这一支：
 *   既有的 `e2e-director.cjs`（17 项）全是**单浏览器**跑完的：冲突场景是用 API 在服务端
 *   把版本推到 v2、看见"别人"在线是直接往 Redis 里写一条心跳（造出来的第二人）。
 *   这能证明乐观锁与心跳接口「各自能跑」，但证明不了**两个浏览器、两个账号、同一个空间、
 *   同一个场景**时它真的工作——那一条链路上还压着：成员加入、活动空间切换（X-Space-Id）、
 *   A 的心跳能不能看见 B、B 的保存能不能让 A 看见冲突、A 覆盖之后版本号是不是真的 +1。
 *   本次验收就是把这条链路走一遍，每一段都同时用 UI 与 API 交叉核对。
 *
 * 覆盖：
 *   S1 两个隔离 context 各自登录（两个真账号，token/用户/空间都不同）
 *   S2 A 建项目 → A 把 B 拉进自己的团队空间 → B 能读 A 的项目（API 级 + 浏览器级）
 *   S3 A 打开导演台并保存 → 服务端 v1
 *   S4 B 打开同一场景（读到 v1）→ B 的心跳看见 A → A 重开后 UI 出现「👥 1 人在编辑」
 *   S5 B 保存推到 v2 → A 用 v1 保存触发冲突条（提示 v2）→ 点「覆盖服务端」→ v3（API 核对）
 *   S6 两个页面都无未预期控制台错误
 *
 * 用法：
 *   pwsh _acceptance/start-wanxing-stack.ps1      # api:3002 / web:3003
 *   node _acceptance/e2e-director-collab.cjs
 */
const { chromium } = require("playwright-core");
const fs = require("node:fs");
const path = require("node:path");

const API = process.env.API || "http://127.0.0.1:3002/v1";
const WEB = process.env.WEB || "http://127.0.0.1:3003";
const CHROME =
  process.env.CHROME ||
  "C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe";
const SHOT_DIR = path.join(__dirname, "director-collab-e2e");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "  ✅" : "  ❌"} ${name}${detail ? ` — ${detail}` : ""}`);
  return ok;
}

async function api(method, p, body, token, spaceId) {
  const res = await fetch(API + p, {
    method,
    headers: {
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(spaceId ? { "x-space-id": spaceId } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text.slice(0, 200) };
  }
}

/** 只发短信验证码，把一次性码留给浏览器登录（与 e2e-director.cjs 同款） */
async function prepareUser(tag) {
  const phone = `13${String(Date.now()).slice(-7)}${String(Math.floor(Math.random() * 90) + 10)}`;
  const sms = await api("POST", "/auth/sms-code", { phone });
  if (sms.code !== 0) throw new Error(`${tag} sms-code: ${JSON.stringify(sms)}`);
  return { tag, phone, code: String(sms.data.debug_code) };
}

function watchConsole(page, sink, tag) {
  page.on("console", (m) => {
    if (m.type() === "error") sink.push(`${tag}: ${m.text().slice(0, 200)}`);
  });
  page.on("pageerror", (e) => sink.push(`${tag}: pageerror ${e.message.slice(0, 200)}`));
}

async function login(page, user) {
  await page.goto(`${WEB}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('input[placeholder="请输入手机号码"]', { timeout: 25_000 });
  await sleep(600);
  await page.fill('input[placeholder="请输入手机号码"]', user.phone);
  await page.fill('input[placeholder="请输入验证码"]', user.code);
  await sleep(200);
  await page.locator(".agree-row input[type=checkbox]").check().catch(() => {});
  await page.locator("button.submit").click();
  await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 40_000 });
  return page.evaluate(async () => {
    try {
      const r = await fetch("/v1/auth/refresh", { method: "POST", credentials: "include" });
      const j = await r.json();
      return j.data?.access_token ?? "";
    } catch {
      return "";
    }
  });
}

const statusText = (page) => page.locator(".d3-sync__text").innerText().catch(() => "").then((s) => s.trim());

async function waitStatus(page, re, timeout = 20_000) {
  await page
    .waitForFunction(
      (src) => new RegExp(src).test(document.querySelector(".d3-sync__text")?.textContent || ""),
      re.source,
      { timeout },
    )
    .catch(() => {});
  return statusText(page);
}

/** 打开导演台：点按钮 → 等遮罩 → 等状态条出现版本或「尚未保存」 */
async function openDirector(page) {
  const btn = page.locator("button", { hasText: "3D 导演台" }).first();
  await btn.click();
  await page.waitForSelector(".d3", { timeout: 20_000 });
  await waitStatus(page, /尚未保存|已载入/);
  await sleep(1200);
  return btn;
}

async function closeDirector(page) {
  await page.locator('.d3-icon[title="关闭"]').click();
  await sleep(700);
}

async function saveAndWait(page, re) {
  await page.locator(".d3-sync__save").click();
  return waitStatus(page, re);
}

(async () => {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  const userA = await prepareUser("A");
  const userB = await prepareUser("B");
  console.log(`\n两个用户：A=${userA.phone}  B=${userB.phone}（验证码留给浏览器登录）\n`);

  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const consoleErrors = [];

  let pass = 0;
  let total = 0;
  const record = (name, ok, detail) => {
    total++;
    if (check(name, ok, detail)) pass++;
  };

  try {
    // 两个**隔离**的上下文：cookie/localStorage 完全分开，等价于两台机器
    const ctxA = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const ctxB = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const pageA = await ctxA.newPage();
    const pageB = await ctxB.newPage();
    pageA.setDefaultTimeout(30_000);
    pageB.setDefaultTimeout(30_000);
    watchConsole(pageA, consoleErrors, "A");
    watchConsole(pageB, consoleErrors, "B");

    // ══ S1 两个隔离上下文各自登录 ═══════════════════════════
    console.log("[S1] 两个隔离上下文各自登录");
    const [tokenA, tokenB] = await Promise.all([login(pageA, userA), login(pageB, userB)]);
    record("S1.1 两个用户各自登录成功（两套隔离上下文）", !!tokenA && !!tokenB, `A=${!!tokenA} B=${!!tokenB}`);

    // 注意路径：AuthController 是 `@Controller()` 无前缀、方法上写全路径，`@Get("me")` → `/v1/me`
    const meA = await api("GET", "/me", undefined, tokenA);
    const meB = await api("GET", "/me", undefined, tokenB);
    record(
      "S1.2 是两个不同账号、初始各在自己的个人空间",
      meA.code === 0 &&
        meB.code === 0 &&
        !!meA.data?.user?.id &&
        meA.data.user.id !== meB.data?.user?.id &&
        meA.data.space.id !== meB.data?.space.id,
      `A user=${meA.data?.user?.id} space=${meA.data?.space?.id} | B user=${meB.data?.user?.id} space=${meB.data?.space?.id}`,
    );
    const spaceA = String(meA.data.space.id);
    const spaceB = String(meB.data.space.id);
    consoleErrors.length = 0;

    // ══ S2 建项目 + 把 B 拉进 A 的团队空间 ═════════════════
    console.log("[S2] A 建项目 → 拉 B 进空间 → B 能访问");
    const project = await api(
      "POST",
      "/projects",
      { title: `E2E协同 ${Date.now()}`, source_type: 1, source_text: "第一章：夜戏，两人对坐。" },
      tokenA,
    );
    const projectId = String(project.data?.id ?? "");
    record("S2.1 A 建项目成功", project.code === 0 && !!projectId, `project=${projectId}`);

    const added = await api(
      "POST",
      "/cam/team/member/batch",
      { members: [{ user_id: String(meB.data.user.id) }] },
      tokenA,
    );
    record(
      "S2.2 A 把 B 拉进自己的空间（批量加成员）",
      added.code === 0 && added.data?.added === 1 && added.data?.items?.[0]?.ok === true,
      `added=${added.data?.added} failed=${added.data?.failed}`,
    );

    const bReads = await api("GET", `/projects/${projectId}`, undefined, tokenB, spaceA);
    record(
      "S2.3 B 带 x-space-id 能读到 A 的项目（服务端成员校验通过）",
      bReads.code === 0 && String(bReads.data?.project?.title ?? "").startsWith("E2E协同"),
      `code=${bReads.code} title=${bReads.data?.project?.title ?? "-"}`,
    );
    // 反向锚点：不带该头时 B 仍在自己的空间，同一个项目读不到 —— 证明上面那次真的是"切空间"
    const bReadsOwn = await api("GET", `/projects/${projectId}`, undefined, tokenB);
    record(
      "S2.4 反证：B 不切空间时读不到该项目（400102/403）",
      bReadsOwn.code !== 0,
      `code=${bReadsOwn.code}`,
    );

    // 浏览器侧：B 把活动空间写进 localStorage（前端 useApi 会据此注入 X-Space-Id）
    await pageB.goto(`${WEB}/works`, { waitUntil: "domcontentloaded" });
    await pageB.evaluate((sid) => localStorage.setItem("active_space_id", sid), spaceA);
    console.log("[S2b] B 浏览器切到 A 的空间并打开同一项目页");
    await pageB.goto(`${WEB}/projects/${projectId}`, { waitUntil: "domcontentloaded" });
    await pageB.waitForSelector(".ep-head", { timeout: 40_000 }).catch(() => {});
    record(
      "S2.5 B 的浏览器切空间后能打开 A 的项目页（前端链路）",
      (await pageB.locator(".ep-head").count()) > 0,
      pageB.url(),
    );

    // ══ S3 A 打开导演台并保存 v1 ═══════════════════════════
    console.log("[S3] A 打开导演台 → 保存 v1");
    await pageA.goto(`${WEB}/projects/${projectId}`, { waitUntil: "domcontentloaded" });
    await pageA.waitForSelector(".ep-head", { timeout: 30_000 });
    await sleep(1200);
    await openDirector(pageA);
    record("S3.1 A 打开导演台遮罩（.d3 出现）", (await pageA.locator(".d3").count()) === 1);

    const aStatus0 = await statusText(pageA);
    record("S3.2 A 首次打开是未保存/已载入态", /尚未保存|已载入/.test(aStatus0), aStatus0);
    const aSaved1 = await saveAndWait(pageA, /已保存 v1/);
    record("S3.3 A 保存后状态条为 v1", /已保存 v1/.test(aSaved1), aSaved1);

    const scenes = await api("GET", `/director/scenes?project_id=${projectId}`, undefined, tokenA);
    const scene = scenes.data?.list?.[0];
    const sceneId = String(scene?.id ?? "");
    record(
      "S3.4 API 核对：场景存在、版本 1、快照形状正确",
      scenes.code === 0 && !!sceneId && scene.version === 1 && !!scene.payload?.camPos,
      `scene=${sceneId} v=${scene?.version}`,
    );
    await pageA.screenshot({ path: path.join(SHOT_DIR, "01-a-saved-v1.png") });

    // ══ S4 B 打开同一场景 + 心跳互见 ═══════════════════════
    console.log("[S4] B 打开同一场景 → 双向心跳可见");
    await openDirector(pageB);
    const bStatus = await waitStatus(pageB, /v\d+/);
    record("S4.1 B 打开导演台读到同一个场景 v1", /v1/.test(bStatus), bStatus);

    // A 关闭再打开：打开动作会立刻发一跳心跳（Director3D.syncFromServer → heartbeat）。
    // 这一步是刻意的：A 第一次打开时场景还不存在，heartbeat 会因 sceneId 为空提前返回，
    // 所以"A 在线"的最早可靠时刻是保存 v1 之后的下一次打开 / 下一跳 30s 定时器。
    await closeDirector(pageA);
    await openDirector(pageA);
    const peers = pageA.locator(".d3-sync__peers");
    const peersShown = await peers
      .waitFor({ state: "visible", timeout: 25_000 })
      .then(() => true)
      .catch(() => false);
    const peersText = (await peers.innerText().catch(() => "")).trim();
    const peersTitle = await peers.getAttribute("title").catch(() => null);
    record("S4.2 A 的 UI 出现协作者提示（「👥 1 人在编辑」）", peersShown && /1 人在编辑/.test(peersText), peersText);
    record(
      "S4.3 协作者浮层写明是谁、多久前（last_seen_ms → 秒）",
      !!peersTitle && /s 前/.test(peersTitle),
      String(peersTitle ?? "").replace(/\s+/g, " ").slice(0, 60),
    );

    const aHeart = await api("POST", "/director/heartbeat", { scene_id: sceneId }, tokenA, spaceA);
    const peersOfA = aHeart.data?.collaborators ?? [];
    record(
      "S4.4 API 交叉核对：A 的心跳里 collaborators 正是 B",
      aHeart.code === 0 && peersOfA.length === 1 && String(peersOfA[0].user_id) === String(meB.data.user.id),
      `collaborators=${JSON.stringify(peersOfA.map((c) => ({ u: c.user_id, ms: c.last_seen_ms })))}`,
    );
    // 反向：B 的心跳里应当正好是 A —— 一次"谁能看见谁"的双向核对，而不是单向自证
    const bHeart = await api("POST", "/director/heartbeat", { scene_id: sceneId }, tokenB, spaceA);
    const peersOfB = bHeart.data?.collaborators ?? [];
    record(
      "S4.5 反向核对：B 的心跳里 collaborators 正是 A",
      bHeart.code === 0 && peersOfB.length === 1 && String(peersOfB[0].user_id) === String(meA.data.user.id),
      `collaborators=${JSON.stringify(peersOfB.map((c) => ({ u: c.user_id, ms: c.last_seen_ms })))}`,
    );
    await pageA.screenshot({ path: path.join(SHOT_DIR, "02-a-sees-b.png") });

    // ══ S5 并发保存：B 推 v2 → A 撞冲突 → 覆盖为 v3 ═════════
    console.log("[S5] B 保存 v2 → A 保存撞冲突 → 覆盖服务端 v3");
    await pageB.locator('.d3-panel--left .d3-range input[type="range"]').first().fill("160");
    await sleep(400);
    const bSaved2 = await saveAndWait(pageB, /已保存 v2/);
    record("S5.1 B 保存成功并推到 v2", /已保存 v2/.test(bSaved2), bSaved2);
    const afterB = await api("GET", `/director/scenes/${sceneId}`, undefined, tokenA);
    record("S5.2 API 核对服务端已是 v2", afterB.code === 0 && afterB.data?.version === 2, `v=${afterB.data?.version}`);

    // A 手里仍是 v1（重开时载入的），改一下状态再保存 → 应拿到 746002 并显示冲突条
    await pageA.locator('.d3-panel--left .d3-range input[type="range"]').first().fill("120");
    await sleep(400);
    await pageA.locator(".d3-sync__save").click();
    await pageA.waitForSelector(".d3-conflict", { timeout: 20_000 }).catch(() => {});
    const conflictText = (await pageA.locator(".d3-conflict").innerText().catch(() => "")).trim();
    record(
      "S5.3 A 用旧版本保存 → 出现冲突条并提示服务端 v2",
      /v2/.test(conflictText),
      conflictText.replace(/\s+/g, " ").slice(0, 70),
    );
    await pageA.screenshot({ path: path.join(SHOT_DIR, "03-a-conflict.png") });

    await pageA.locator(".d3-conflict button", { hasText: "覆盖服务端" }).click();
    const aSaved3 = await waitStatus(pageA, /已保存 v3/, 25_000);
    record("S5.4 A 点「覆盖服务端」后保存成功（v3）", /已保存 v3/.test(aSaved3), aSaved3);
    record("S5.5 覆盖后冲突条消失", (await pageA.locator(".d3-conflict").count()) === 0);

    const afterA = await api("GET", `/director/scenes/${sceneId}`, undefined, tokenA);
    record(
      "S5.6 API 核对：服务端版本 3，且冲突期间没有被静默覆盖成 v2 的数据",
      afterA.code === 0 && afterA.data?.version === 3,
      `v=${afterA.data?.version}`,
    );
    await pageA.screenshot({ path: path.join(SHOT_DIR, "04-a-overwrote-v3.png") });

    // ══ S6 收尾 ════════════════════════════════════════════
    const realErrors = consoleErrors.filter(
      (e) => !/favicon|Failed to load resource.*404|ResizeObserver loop|net::ERR_ABORTED|WebGL|GPU stall/i.test(e),
    );
    record("S6.1 两个页面都无未预期控制台错误", realErrors.length === 0, realErrors.slice(0, 3).join(" | ") || "clean");
  } catch (e) {
    console.error("\nE2E 异常：", e);
    record("S0.1 脚本执行未抛异常", false, String(e && e.message ? e.message : e).slice(0, 240));
  } finally {
    await browser.close?.().catch?.(() => {});
    const failed = results.filter((r) => !r.ok);
    console.log(`\n${"─".repeat(56)}`);
    console.log(`导演台多用户协同 E2E：${pass}/${total} 通过`);
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
})().catch(async (e) => {
  console.error("E2E 异常：", e);
  process.exit(1);
});
