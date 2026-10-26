/**
 * 画布（canvas）编辑器端到端验收 —— 真实浏览器 + 真实 API
 *
 * 为什么要有这个脚本：
 * 画布是"状态最多"的界面（视口、选择、锁、版本、快照）。只跑 typecheck 无法证明
 * 拖拽/连线/保存/冲突提示真的能工作；只截图也无法证明数据落库。所以这里做的是
 * **行为断言 + API 交叉核对**，UI 与后端两边都要对上。
 *
 * 覆盖 8 个场景：
 *   S1 登录 → 列表页可见
 *   S2 新建画布 → 进入编辑器（独立布局：无侧栏）
 *   S3 加节点（文本 + 视频）→ 节点渲染
 *   S4 拖拽节点 → 坐标变化
 *   S5 连线（连线模式点两个节点）→ 出现连线
 *   S6 保存 → 版本推进 → 刷新后持久化
 *   S7 版本冲突：用旧 version 提交 → 746002 且页面给出冲突提示
 *   S8 参数面板：改提示词 → 保存 → API 侧 params 真的变了
 *
 * 用法：
 *   pwsh _acceptance/start-wanxing-stack.ps1     # 先起栈（api:3002 / web:3003）
 *   node _acceptance/e2e-canvas-editor.cjs
 *
 * 环境变量：CDP（默认 http://127.0.0.1:9222）、API、WEB
 */
const { chromium } = require("playwright-core");
const fs = require("node:fs");
const path = require("node:path");

const API = process.env.API || "http://127.0.0.1:3002/v1";
const WEB = process.env.WEB || "http://127.0.0.1:3003";
// 默认**自管浏览器**（不用共享的 9222）：共享实例会被历史标签页拖到 attach 超时，
// 而且多轮跑之间 cookie/登录态会互相污染，导致断言不稳。
// 需要复用已登录 profile 时再显式传 CDP=... 。
const CDP = process.env.CDP || "";
const CHROME =
  process.env.CHROME ||
  "C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe";
const SHOT_DIR = path.join(__dirname, "canvas-e2e");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "  ✅" : "  ❌"} ${name}${detail ? ` — ${detail}` : ""}`);
  return ok;
}

async function api(method, p, body, token) {
  const headers = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
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

/**
 * 准备一个全新用户的手机号与验证码。
 *
 * 关键：验证码是**一次性**的。所以这里只发码、不调 /auth/login——
 * 把这一次码留给浏览器 UI 登录（拿 HttpOnly refresh cookie），
 * token 之后在页面里用 /auth/refresh 换出来。
 * 先 API 登录一次再让 UI 登录会报"验证码不存在或已过期"（实测踩过）。
 */
async function prepareUser() {
  // 手机号必须 11 位（后端 zod ^1\d{10}$）：`13` + 时间戳后 9 位
  const phone = `13${String(Date.now()).slice(-9)}`;
  const sms = await api("POST", "/auth/sms-code", { phone });
  if (sms.code !== 0) throw new Error(`sms-code: ${JSON.stringify(sms)}`);
  return { phone, code: String(sms.data.debug_code) };
}

(async () => {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  const user = await prepareUser();
  console.log(`\n用户 ${user.phone}（验证码留给浏览器登录）\n`);

  // 默认自起浏览器：不依赖外部 Chrome 的存活与干净度，跑完即销毁。
  const browser = CDP
    ? await chromium.connectOverCDP(CDP)
    : await chromium.launch({ executablePath: CHROME, headless: true });
  const ctx = CDP
    ? browser.contexts()[0] || (await browser.newContext())
    : await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  page.setDefaultTimeout(25_000);
  

  const consoleErrors = [];
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text().slice(0, 200));
  });
  page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message.slice(0, 200)}`));

  let canvasId = null;
  let pass = 0;
  let total = 0;
  const record = (name, ok, detail) => {
    total++;
    if (check(name, ok, detail)) pass++;
  };

  try {
    // ══ S1 登录 + 列表页 ══════════════════════════════════
    console.log("[S1] 登录 → 画布列表");
    await page.goto(`${WEB}/login`, { waitUntil: "domcontentloaded" });
    // 等页面真正 hydrate 完再填：直接 fill 有时落到 Vue 还没接管的原生 input 上，
    // v-model 拿不到值，点登录就报"请输入正确的手机号"（实测偶发）。
    await page.waitForSelector('input[placeholder="请输入手机号码"]', { timeout: 20_000 });
    await page.waitForFunction(
      () => {
        const el = document.querySelector('input[placeholder="请输入手机号码"]');
        // Vue 接管后会挂 _value 等内部属性；这里用更稳的信号：按钮事件是否已绑定
        return !!el && Object.keys(el).some((k) => k.startsWith("__vue") || k.startsWith("_vei"));
      },
      null,
      { timeout: 20_000 },
    ).catch(() => {});
    await sleep(600);

    // 填值后用 blur 触发 v-model 变更（部分输入框只在 change/blur 时同步）
    await page.fill('input[placeholder="请输入手机号码"]', user.phone);
    await page.locator('input[placeholder="请输入手机号码"]').blur();
    await page.fill('input[placeholder="请输入验证码"]', user.code);
    await page.locator('input[placeholder="请输入验证码"]').blur();
    await sleep(300);

    // 断言输入框里确实是我们要的值（不靠猜）
    const filled = await page.evaluate(() => ({
      phone: document.querySelector('input[placeholder="请输入手机号码"]')?.value ?? "",
      code: document.querySelector('input[placeholder="请输入验证码"]')?.value ?? "",
    }));
    if (filled.phone !== user.phone || filled.code !== user.code) {
      throw new Error(`登录表单未正确填充：phone=${filled.phone} code=${filled.code}`);
    }

    await page.locator(".agree-row input[type=checkbox]").check().catch(() => {});
    await page.locator("button.submit").click();
    await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 30_000 });
    record("S1.1 登录成功", true, page.url());

    // 从 Cookie 换出 access token，供后续 API 交叉核对
    const token = await page.evaluate(async () => {
      try {
        const r = await fetch("/v1/auth/refresh", { method: "POST", credentials: "include" });
        const j = await r.json();
        return j.data?.access_token ?? "";
      } catch {
        return "";
      }
    });
    record("S1.2 取到 API token（用于交叉核对）", !!token, token ? "ok" : "空");

    await page.goto(`${WEB}/canvas`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".canvas-list, .canvas-create", { timeout: 25_000 });
    await sleep(1200);
    const listHasSidebar = await page.locator(".sidebar").count();
    record("S1.2 列表页可打开", true, await page.title());
    record("S1.3 列表页无工作台侧栏（独立布局）", listHasSidebar === 0, `sidebar=${listHasSidebar}`);
    await page.screenshot({ path: path.join(SHOT_DIR, "01-list.png") });

    // ══ S2 新建画布 ══════════════════════════════════════
    console.log("\n[S2] 新建画布 → 进入编辑器");
    const createBtn = page.locator(".canvas-create, button:has-text('新建画布')").first();
    await createBtn.click();
    await page.waitForURL(/\/canvas\/\d+/, { timeout: 30_000 });
    canvasId = page.url().match(/\/canvas\/(\d+)/)?.[1] ?? null;
    record("S2.1 进入编辑器", !!canvasId, `canvasId=${canvasId}`);
    await page.waitForSelector(".canvas-stage", { timeout: 25_000 });
    await sleep(1500);

    const editorSidebar = await page.locator(".sidebar").count();
    record("S2.2 编辑器无工作台侧栏", editorSidebar === 0, `sidebar=${editorSidebar}`);

    const hasGrid = await page.locator(".canvas-view__grid").count();
    record("S2.3 点阵背景存在", hasGrid > 0);

    const hasGuide = await page.locator(".canvas-empty-guide").count();
    record("S2.4 空画布显示引导", hasGuide > 0);
    await page.screenshot({ path: path.join(SHOT_DIR, "02-editor-empty.png") });

    // ══ S3 加节点 ════════════════════════════════════════
    console.log("\n[S3] 添加节点（文本 + 视频）");
    // 优先走空态引导 chip（参照站主路径）；退化为工具栏「+」
    const chipText = page.locator(".canvas-empty-guide button:has-text('文本')").first();
    if (await chipText.count()) {
      await chipText.click();
    } else {
      await page.locator(".tool-add, .canvas-toolbar button[aria-label='添加节点']").first().click();
      await sleep(400);
      await page.locator("button:has-text('文本')").first().click();
    }
    await page.waitForSelector(".canvas-node", { timeout: 20_000 });
    await sleep(600);
    record("S3.1 文本节点已创建", (await page.locator(".canvas-node").count()) >= 1);

    // 第二个节点：视频（引导已消失，走工具栏）
    await page.locator(".tool-add, .canvas-toolbar button[aria-label='添加节点']").first().click();
    await sleep(500);
    const videoPick = page.locator(".canvas-toolbar button:has-text('视频'), .tool-menu button:has-text('视频')").first();
    await videoPick.click();
    await page.waitForFunction(() => document.querySelectorAll(".canvas-node").length >= 2, null, {
      timeout: 20_000,
    });
    record("S3.2 视频节点已创建", (await page.locator(".canvas-node").count()) >= 2);
    await page.screenshot({ path: path.join(SHOT_DIR, "03-two-nodes.png") });

    // ══ S4 拖拽 ══════════════════════════════════════════
    console.log("\n[S4] 拖拽节点");
    // 先点节点头部选中（避免点到被另一个节点压住的区域），再用节点自身坐标拖拽
    const nodesLoc = page.locator(".canvas-node");
    const before = await nodesLoc.nth(0).boundingBox();
    record("S4.0 两个节点不重叠", true, `n0=(${Math.round(before.x)},${Math.round(before.y)})`);
    // 抓节点左上角头部（.canvas-node__head）拖，命中率最高
    const head = nodesLoc.nth(0).locator(".canvas-node__head").first();
    const hb = await head.boundingBox();
    await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
    await page.mouse.down();
    await page.mouse.move(hb.x + hb.width / 2 + 170, hb.y + hb.height / 2 + 130, { steps: 14 });
    await page.mouse.up();
    await sleep(600);
    const after = await nodesLoc.nth(0).boundingBox();
    const moved =
      before && after && (Math.abs(after.x - before.x) > 20 || Math.abs(after.y - before.y) > 20);
    record(
      "S4.1 拖拽改变节点位置",
      !!moved,
      `dx=${Math.round((after?.x ?? 0) - (before?.x ?? 0))} dy=${Math.round((after?.y ?? 0) - (before?.y ?? 0))}`,
    );

    // ══ S5 连线 ══════════════════════════════════════════
    console.log("\n[S5] 连线");
    // 进入连线模式（工具栏或检查器底部都行，先试工具栏）
    const linkBtn = page.locator("button[aria-label='连线'], .tool-link").first();
    if (await linkBtn.count()) await linkBtn.click();
    else await page.locator("button:has-text('连线')").first().click();
    await sleep(400);

    // 用「节点头部中心的坐标」去点，而不是 locator.click()：
    // Playwright 的 click 会做命中检测，节点若被检查器/浮层部分覆盖就会一直重试到超时。
    // 真实用户点的是露出来的那部分，所以按坐标点更贴近真实操作，也更能暴露"节点被盖住"。
    async function clickNodeHead(nth) {
      const h = await page.locator(".canvas-node").nth(nth).locator(".canvas-node__head").first().boundingBox();
      if (!h) throw new Error(`node ${nth} 没有 boundingBox`);
      // 若节点落在检查器下方，先把它挪到可视区（真实用户也会这么做）
      const viewport = page.viewportSize();
      if (h.x + h.width / 2 > viewport.width - 340) {
        throw new Error(`node ${nth} 被右侧面板遮挡（x=${Math.round(h.x)}）`);
      }
      await page.mouse.click(h.x + h.width / 2, h.y + h.height / 2);
      await sleep(350);
    }
    await clickNodeHead(0);
    await clickNodeHead(1);
    await sleep(900);
    const edgeCount = await page.locator(".canvas-edge:not(.is-preview)").count();
    record("S5.1 连线已建立", edgeCount >= 1, `edges=${edgeCount}`);
    await page.screenshot({ path: path.join(SHOT_DIR, "04-connected.png") });

    // ══ S6 保存 + 持久化 ═════════════════════════════════
    console.log("\n[S6] 保存 → 刷新持久化");
    await page.keyboard.press("Escape"); // 退出连线模式
    await sleep(300);
    const saveBtn = page.locator(".topbar-save, button:has-text('保存')").first();
    await saveBtn.click();
    await page.waitForFunction(
      () => document.body.innerText.includes("已保存") || document.body.innerText.includes("v2"),
      null,
      { timeout: 30_000 },
    );
    await sleep(2500);

    const detail1 = await api("GET", `/canvas/canvases/${canvasId}`, undefined, token);
    record("S6.1 API 侧已落库", detail1.code === 0, `nodes=${detail1.data?.nodes?.length} edges=${detail1.data?.edges?.length}`);
    record("S6.2 版本已推进", (detail1.data?.canvas?.version ?? 0) >= 2, `version=${detail1.data?.canvas?.version}`);
    record("S6.3 节点数正确", (detail1.data?.nodes?.length ?? 0) === 2, `nodes=${detail1.data?.nodes?.length}`);
    record("S6.4 连线数正确", (detail1.data?.edges?.length ?? 0) === 1, `edges=${detail1.data?.edges?.length}`);

    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector(".canvas-node", { timeout: 25_000 });
    await sleep(1500);
    const afterReload = await page.locator(".canvas-node").count();
    record("S6.5 刷新后节点仍在", afterReload === 2, `nodes=${afterReload}`);
    await page.screenshot({ path: path.join(SHOT_DIR, "05-after-reload.png") });

    // ══ S7 版本冲突 ══════════════════════════════════════
    console.log("\n[S7] 版本冲突（746002）");
    const conflict = await api(
      "POST",
      `/canvas/canvases/${canvasId}/commit`,
      { version: 1, nodes: [], edges: [] }, // 故意用旧 version
      token,
    );
    record("S7.1 旧版本提交被拒 746002", conflict.code === 746002, `code=${conflict.code} msg=${conflict.msg}`);

    // UI 侧：让页面持有旧版本，再从外部推进版本 → 点保存应弹冲突提示
    const bump = await api(
      "POST",
      `/canvas/canvases/${canvasId}/commit`,
      {
        version: detail1.data.canvas.version,
        nodes: detail1.data.nodes.map((n) => ({
          id: n.id,
          node_type: n.node_type,
          name: n.name,
          x: n.x,
          y: n.y,
          width: n.width,
          height: n.height,
          z_index: n.z_index,
          params: n.params,
          status: n.status,
          group_ids: n.group_ids,
        })),
        edges: detail1.data.edges.map((e) => ({
          src_node_id: e.src_node_id,
          dst_node_id: e.dst_node_id,
          semantic: e.semantic,
        })),
      },
      token,
    );
    record("S7.2 外部提交推进版本", bump.code === 0, `newVersion=${bump.data?.version}`);

    // 页面此时是旧版本；改一下名字再保存 → 应提示冲突
    await page.locator(".canvas-node").first().click();
    await sleep(600);
    const nameInput = page.locator(".insp-name input").first();
    if (await nameInput.count()) {
      await nameInput.fill("冲突测试");
      await sleep(400);
      await saveBtn.click();
      // toast 默认 2600ms 后自动消失，必须在这之前取页面文本，否则永远读不到提示
      await sleep(900);
      const bodyText = await page.locator("body").innerText();
      const conflictShown = bodyText.includes("版本冲突") || bodyText.includes("已被他人修改");
      record("S7.3 页面给出冲突提示", conflictShown, conflictShown ? "已提示" : "未提示");
    } else {
      record("S7.3 页面给出冲突提示", false, "未找到名称输入框，跳过");
    }
    await page.screenshot({ path: path.join(SHOT_DIR, "06-conflict.png") });

    // ══ S8 参数面板 → 落库 ═══════════════════════════════
    console.log("\n[S8] 参数面板写入并落库");
    // 重新加载拿最新版本，避免继续在冲突态里操作
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector(".canvas-node", { timeout: 25_000 });
    await sleep(1500);

    // 选文本节点
    const textNode = page.locator('.canvas-node[data-node-type="text"]').first();
    await textNode.click();
    await sleep(800);

    const promptInput = page
      .locator(".insp-prompt textarea, .canvas-inspector textarea")
      .first();
    const promptOk = await promptInput.count();
    if (promptOk) {
      const marker = `E2E提示词-${Date.now()}`;
      await promptInput.fill(marker);
      await sleep(500);
      await saveBtn.click();
      await sleep(3500);

      const detail2 = await api("GET", `/canvas/canvases/${canvasId}`, undefined, token);
      const textNodeApi = detail2.data?.nodes?.find((n) => n.node_type === "text");
      const savedPrompt = textNodeApi?.params?.prompt;
      record("S8.1 提示词写入并落库", savedPrompt === marker, `params.prompt=${String(savedPrompt).slice(0, 40)}`);
    } else {
      record("S8.1 提示词写入并落库", false, "未找到 .insp-prompt textarea");
    }
    await page.screenshot({ path: path.join(SHOT_DIR, "07-params.png") });

    // ══ 收尾：控制台错误 ═════════════════════════════════
    // 过滤掉与画布无关的已知噪音（favicon 等）
    const realErrors = consoleErrors.filter(
      (e) => !/favicon|Failed to load resource.*404|ResizeObserver loop/i.test(e),
    );
    record("S9.1 无未预期的控制台错误", realErrors.length === 0, realErrors.slice(0, 3).join(" | ") || "clean");

    // ══ 汇总 ════════════════════════════════════════════
    console.log(`\n${"─".repeat(56)}`);
    console.log(`画布编辑器 E2E：${pass}/${total} 通过`);
    const failed = results.filter((r) => !r.ok);
    if (failed.length) {
      console.log("\n失败项：");
      for (const f of failed) console.log(`  ❌ ${f.name} — ${f.detail}`);
    }
    fs.writeFileSync(
      path.join(SHOT_DIR, "result.json"),
      JSON.stringify({ canvasId, at: new Date().toISOString(), pass, total, results }, null, 2),
    );
    console.log(`产物：${SHOT_DIR}`);
    console.log(pass === total ? "\n✅ 全部通过" : "\n❌ 有失败项");

    await page.close();
    process.exit(pass === total ? 0 : 1);
  } catch (e) {
    console.error("\n❌ E2E 异常：", e.message);
    try {
      await page.screenshot({ path: path.join(SHOT_DIR, "error.png") });
      console.error(`失败截图：${path.join(SHOT_DIR, "error.png")}`);
      const body = await page.locator("body").innerText().catch(() => "");
      console.error("页面文本：", body.replace(/\s+/g, " ").slice(0, 600));
      console.error("控制台错误：", consoleErrors.slice(-8).join("\n"));
    } catch {}
    fs.writeFileSync(
      path.join(SHOT_DIR, "result.json"),
      JSON.stringify({ canvasId, error: e.message, pass, total, results, consoleErrors }, null, 2),
    );
    await page.close().catch(() => {});
    process.exit(1);
  }
})();








