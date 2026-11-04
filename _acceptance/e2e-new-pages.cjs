/**
 * 新页面真实浏览器验收（第 134 批）。
 *
 * 覆盖：`/tutorial`、`/user-language`、`/user-update`（保存后刷新仍生效）、
 * `/refer-video`（真实上传一段视频后出现在列表）、`/adjust`（→ /settings）、
 * `/implement`（→ /cli）。
 *
 * 前提前提：本地栈 api:3002 / web:3003 已启动（`_acceptance/start-wanxing-stack.ps1`
 * 或手工 `node dist/main.js` + `pnpm dev --port 3003`）。
 *
 * 用法：
 *   node _acceptance/e2e-new-pages.cjs
 *   HEADED=1 node _acceptance/e2e-new-pages.cjs
 *
 * 视频素材：默认读 `_acceptance/.tmp-e2e-ref.mp4`。生成命令（1 秒黑帧，足够上传）：
 *   ffmpeg -f lavfi -i color=c=black:s=160x90:d=1 -pix_fmt yuv420p -y _acceptance/.tmp-e2e-ref.mp4
 */
const { chromium } = require("playwright-core");
const fs = require("node:fs");
const path = require("node:path");

const API = process.env.API || "http://127.0.0.1:3002/v1";
const WEB = process.env.WEB || "http://127.0.0.1:3003";
const CHROME =
  process.env.CHROME ||
  "C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe";
const HEADED = process.env.HEADED === "1";
const SHOT_DIR = path.join(__dirname, "e2e-new-pages");
const VIDEO = process.env.VIDEO || path.join(__dirname, ".tmp-e2e-ref.mp4");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
function record(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  - ${detail}` : ""}`);
}

async function api(pathname, options = {}) {
  const res = await fetch(`${API}${pathname}`, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(options.headers || {}),
    },
  });
  return res.json();
}

async function main() {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  const phone = `1${String(Date.now()).slice(-10)}`;
  const nickname = `E2E-${String(Date.now()).slice(-6)}`;

  // 先拿开发态验证码（不在页面上点“发送”，避免 1 分钟频控）
  const sms = await api("/auth/sms-code", {
    method: "POST",
    body: JSON.stringify({ phone }),
  });
  const code = sms?.data?.debug_code;
  if (!code) throw new Error(`sms-code failed: ${JSON.stringify(sms).slice(0, 200)}`);

  const browser = await chromium.launch({ executablePath: CHROME, headless: !HEADED });
  const page = await browser.newPage({ viewport: { width: 1424, height: 805 } });
  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(`pageerror: ${err.message}`));

  try {
    // ── 登录（短信码） ───────────────────────────────────
    await page.goto(`${WEB}/login`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".card", { timeout: 30_000 });
    await page.fill("input[type=tel]", phone);
    await page.fill(".field--code input", String(code));
    await page.check(".agree-row input");
    await page.click(".submit");
    await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 30_000 });
    record("登录成功", true, page.url());

    // 用页面会话刷新 access token（access token 只在内存，不在 localStorage）
    const token = await page.evaluate(async () => {
      const res = await fetch("/v1/auth/refresh", { method: "POST", credentials: "include" });
      const json = await res.json();
      return json?.data?.access_token ?? "";
    });
    if (!token) throw new Error("refresh token flow failed");

    // ── 造项目 + 上传参考视频资源（/refer-video 现在按项目 resource_type=4 取） ──
    const project = await api("/projects", {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      body: JSON.stringify({ title: "E2E 资源项目", drama_type: 1, ratio: "9:16", source_type: 2, source_text: "" }),
    });
    const projectId = project?.data?.id;
    if (!projectId) throw new Error(`create project failed: ${JSON.stringify(project).slice(0, 200)}`);
    record("创建测试项目", true, String(projectId));

    const base64 = fs.readFileSync(VIDEO).toString("base64");
    const uploaded = await api("/assets/upload", {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      body: JSON.stringify({
        filename: "e2e-ref.mp4",
        content_type: "video/mp4",
        data_base64: base64,
      }),
    });
    record("上传视频资产", uploaded?.code === 0, uploaded?.msg ?? String(uploaded?.data?.id ?? ""));

    const resource = await api("/df/resources/add", {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      body: JSON.stringify({
        sp_id: String(projectId),
        resource_type: 4,
        name: "e2e-ref.mp4",
        file_uri: uploaded?.data?.uri,
        content_type: "video/mp4",
      }),
    });
    record("创建参考视频资源", resource?.code === 0, resource?.msg ?? String(resource?.data?.id ?? ""));

    // ── /refer-video ─────────────────────────────────────
    await page.goto(`${WEB}/refer-video`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".rv", { timeout: 30_000 });
    await page
      .waitForFunction(() => document.body.innerText.includes("e2e-ref.mp4"), { timeout: 15_000 })
      .catch(() => {});
    const refText = await page.locator(".rv").innerText();
    record("参考视频页渲染", /参考视频|Reference videos|参考動画/.test(refText), refText.split("\n")[0]);
    record("参考视频页出现上传的视频", refText.includes("e2e-ref.mp4"), refText.slice(0, 120));
    await page.screenshot({ path: path.join(SHOT_DIR, "01-refer-video.png") });

    // 删除动作（页面 confirm → batch-delete → 列表刷新）
    page.once("dialog", (dialog) => dialog.accept());
    await page.locator(".rv-card__del").first().click().catch(() => {});
    await page
      .waitForFunction(() => !document.body.innerText.includes("e2e-ref.mp4"), { timeout: 10_000 })
      .catch(() => {});
    const afterDelete = await page.locator(".rv").innerText().catch(() => "");
    record("删除参考视频资源", !afterDelete.includes("e2e-ref.mp4"), afterDelete.slice(0, 80));

    // ── /user-update：保存 + 刷新后仍生效 ─────────────────
    await page.goto(`${WEB}/user-update`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".uu-card", { timeout: 30_000 });
    await page.locator(".uu-input").nth(0).fill(nickname);
    await page.getByRole("button", { name: /保存|Save|Guardar|保存/ }).click();
    await page.waitForTimeout(800);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector(".uu-card", { timeout: 30_000 });
    await page.waitForTimeout(600);
    const savedNickname = await page.locator(".uu-input").nth(0).inputValue();
    record("资料保存后刷新仍生效", savedNickname === nickname, `${savedNickname} vs ${nickname}`);
    await page.screenshot({ path: path.join(SHOT_DIR, "02-user-update.png") });

    // ── /tutorial ────────────────────────────────────────
    await page.goto(`${WEB}/tutorial`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".tu", { timeout: 30_000 });
    const tuText = await page.locator(".tu").innerText();
    record("创作手册渲染", /创作手册|Creation guide|制作ガイド/.test(tuText), tuText.split("\n")[0]);
    record("创作手册有三步", (tuText.match(/0[123]/g) ?? []).length >= 3);
    await page.screenshot({ path: path.join(SHOT_DIR, "03-tutorial.png") });

    // ── /user-language：切 English 立即生效 ──────────────
    await page.goto(`${WEB}/user-language`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".ul", { timeout: 30_000 });
    await page.locator(".ul-item", { hasText: "English" }).click();
    await page.waitForTimeout(400);
    const langTitle = await page.locator(".ul-title").innerText();
    record("语言切换生效（English）", /Language settings/.test(langTitle), langTitle);
    await page.screenshot({ path: path.join(SHOT_DIR, "04-user-language.png") });

    // ── /implement（逆向修正：道具资源库，不是 CLI 别名） ──
    await page.goto(`${WEB}/implement`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".im", { timeout: 20_000 }).catch(() => {});
    const imTitle = await page.locator(".im-title").innerText().catch(() => "");
    record("/implement 道具资源库", /道具资源库|Prop library/.test(imTitle), imTitle);
    await page.screenshot({ path: path.join(SHOT_DIR, "05-implement.png") });

    // ── /adjust 经逆向确认为 App 下载跳转，D6 范围外 → 路由已移除 ──
    const adjustResp = await page.goto(`${WEB}/adjust`, { waitUntil: "domcontentloaded" }).catch(() => null);
    record("/adjust 已移出范围（404）", adjustResp?.status() === 404, String(adjustResp?.status()));

    const serious = consoleErrors.filter(
      (text) => !/favicon|ResizeObserver|Page not found: \/adjust/i.test(text),
    );
    record("无控制台错误", serious.length === 0, serious.slice(0, 2).join(" | "));
  } finally {
    await browser.close();
  }

  const passed = results.filter((r) => r.ok).length;
  console.log(`\n${passed}/${results.length} 通过`);
  if (passed !== results.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});