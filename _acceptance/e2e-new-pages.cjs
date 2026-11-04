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

    // ── 上传一段视频素材（供 /refer-video 列表） ─────────
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

    // ── /refer-video ─────────────────────────────────────
    await page.goto(`${WEB}/refer-video`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".rv", { timeout: 30_000 });
    await page.waitForTimeout(1200);
    const refText = await page.locator(".rv").innerText();
    record("参考视频页渲染", /参考视频|Reference videos|参考動画/.test(refText), refText.split("\n")[0]);
    record("参考视频页出现上传的视频", refText.includes("e2e-ref.mp4"), refText.slice(0, 120));
    await page.screenshot({ path: path.join(SHOT_DIR, "01-refer-video.png") });

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

    // ── 别名承接 ─────────────────────────────────────────
    await page.goto(`${WEB}/adjust`, { waitUntil: "domcontentloaded" });
    await page.waitForURL(/\/settings$/, { timeout: 20_000 }).catch(() => {});
    record("/adjust → /settings", page.url().endsWith("/settings"), page.url());

    await page.goto(`${WEB}/implement`, { waitUntil: "domcontentloaded" });
    await page.waitForURL(/\/cli$/, { timeout: 20_000 }).catch(() => {});
    record("/implement → /cli", page.url().endsWith("/cli"), page.url());

    const serious = consoleErrors.filter((text) => !/favicon|ResizeObserver/i.test(text));
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