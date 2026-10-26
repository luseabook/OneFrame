/**
 * 工具箱（F2 单点工具）端到端验收 —— 真实浏览器 + 真实 API
 *
 * 为什么要有这个脚本：
 * 工具页是"参数面板 + 任务脊柱"的组合，typecheck 只能证明能编译；必须证明
 * 「选模型 → 报价 → 提交 → 任务真的建出来」这条链在浏览器里能用，
 * 并且提交的任务 mode / 参数与界面选择一致（API 交叉核对）。
 *
 * 覆盖 5 个场景：
 *   S1 工具箱页：Tab 文案（AI视频/AI图片/AI音频）、卡片集、图片 Tab、点卡进文生图
 *   S2 文生图：模型来自目录、报价出现、提交后任务 mode=text2image
 *   S3 图生图：上传参考图 → 提交后任务 mode=image2image 且 reference_uris 非空
 *   S4 参考生视频：工作台进入「参考生视频」模式且目录里有支持 universal_reference 的模型
 *   S5 收尾：控制台零错误
 *
 * 用法：
 *   pwsh _acceptance/start-wanxing-stack.ps1     # api:3002 / web:3003
 *   node _acceptance/e2e-tools.cjs
 */
const { chromium } = require("playwright-core");
const fs = require("node:fs");
const path = require("node:path");

const API = process.env.API || "http://127.0.0.1:3002/v1";
const WEB = process.env.WEB || "http://127.0.0.1:3003";
const CHROME =
  process.env.CHROME ||
  "C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe";
const SHOT_DIR = path.join(__dirname, "tools-e2e");

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
 * 只发码、不 API 登录：验证码是一次性的，必须留给浏览器 UI 登录
 * （先 API 登录一次再让 UI 登录会报"验证码不存在或已过期"，canvas E2E 已踩过）。
 */
async function prepareUser() {
  const phone = `13${String(Date.now()).slice(-9)}`;
  const sms = await api("POST", "/auth/sms-code", { phone });
  if (sms.code !== 0) throw new Error(`sms-code: ${JSON.stringify(sms)}`);
  return { phone, code: String(sms.data.debug_code) };
}

/** 1×1 PNG：用于图生图上传（不引二进制夹具，脚本自带可跑） */
const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PzWvWQAAAABJRU5ErkJggg==",
  "base64",
);

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
    // ══ 登录 ═══════════════════════════════════════════════
    console.log("[S1] 登录 → 工具箱");
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

    // 登录后落在 /home：把登录跳转过程中的控制台噪音清掉，
    // 让 S5.1 只对**本批页面**（工具箱/图片工具/视频工具）负责
    consoleErrors.length = 0;

    await page.goto(`${WEB}/tools`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".tool-card", { timeout: 25_000 });
    await sleep(800);

    const tabTexts = await page.locator(".tabs .tab").allInnerTexts();
    record(
      "S1.3 Tab 文案带 AI 前缀（AI视频/AI图片/AI音频）",
      ["AI视频", "AI图片", "AI音频"].every((t) => tabTexts.some((x) => x.trim() === t)),
      tabTexts.join("/"),
    );

    const totalCards = await page.locator(".tool-card").count();
    record("S1.4 卡片集与参照站对齐（≥17 张）", totalCards >= 17, `cards=${totalCards}`);
    // 工具箱是工作台内页：参照站有侧栏导航（`tools.png`），不是编辑器那种独立布局
    record("S1.5 工具页在工作台壳内（有侧栏，与参照一致）", (await page.locator(".sidebar").count()) >= 1);

    await page.locator(".tabs .tab", { hasText: "AI图片" }).first().click();
    await sleep(400);
    const imageCardTexts = await page.locator(".tool-card").allInnerTexts();
    record(
      "S1.6 AI图片 Tab 有 4 张卡（文生图/图生图已可用）",
      imageCardTexts.length >= 4 && ["文生图", "图生图"].every((t) => imageCardTexts.some((x) => x.includes(t))),
      imageCardTexts.map((x) => x.split("\n")[0]).join("/"),
    );

    await page.locator(".tabs .tab", { hasText: "AI音频" }).first().click();
    await sleep(400);
    record("S1.7 AI音频 Tab 不再是空态", (await page.locator(".tool-card").count()) >= 4);
    await page.screenshot({ path: path.join(SHOT_DIR, "01-tools.png") });

    // 点卡进入文生图
    await page.locator(".tabs .tab", { hasText: "AI图片" }).first().click();
    await sleep(300);
    await page.locator(".tool-card", { hasText: "文生图" }).first().click();
    await page.waitForURL(/\/create\/text-to-image/, { timeout: 20_000 });
    record("S1.8 点「文生图」进入工具页", true, page.url());

    // ══ S2 文生图 ═══════════════════════════════════════════
    console.log("[S2] 文生图：报价 → 提交 → 任务可查");
    await page.waitForSelector(".imgt-prompt", { timeout: 25_000 });
    await sleep(1200);
    const modelOptions = await page.locator(".imgt-model option").allInnerTexts();
    record("S2.1 模型来自目录（capability=image）", modelOptions.length >= 1, modelOptions.join("/"));

    const selectedModel = await page.locator(".imgt-model").inputValue();
    const modelsApi = await api("GET", "/models?capability=image&visible=true", undefined, token);
    const modelCfg = (modelsApi.data || []).find((m) => m.name === selectedModel);
    record(
      "S2.2 默认模型确实声明了 text2image",
      !!modelCfg && Object.prototype.hasOwnProperty.call(modelCfg.modes ?? {}, "text2image"),
      selectedModel,
    );

    const marker = `E2E文生图${Date.now()}`;
    await page.fill(".imgt-prompt", `${marker}：雨夜霓虹街道，少女撑伞，电影感`);
    await page.waitForFunction(
      () => {
        const el = document.querySelector(".imgt-quote");
        return !!el && /积分/.test(el.textContent || "") && !/—/.test(el.textContent || "");
      },
      null,
      { timeout: 12_000 },
    ).catch(() => {});
    const quoteText = (await page.locator(".imgt-quote").innerText()).trim();
    record("S2.3 出现预计消耗（报价来自 /credits/quote）", /积分/.test(quoteText) && !/—/.test(quoteText), quoteText);

    await page.locator(".imgt-submit").click();
    await sleep(3000);
    const statusText = await page.locator(".imgt-status").innerText().catch(() => "");
    record("S2.4 提交后进入排队/生成中", /排队|生成/.test(statusText), statusText);

    const list = await api("GET", "/tasks?page=1&page_size=10&capability=image", undefined, token);
    const created = (list.data?.list || []).find((t) => t.mode === "text2image");
    let detail = created ? await api("GET", `/tasks/${created.task_id}`, undefined, token) : null;
    record(
      "S2.5 任务 mode=text2image 且 prompt 与界面一致",
      !!detail && String(detail.data?.input?.prompt ?? "").includes(marker),
      detail?.data?.task_id ?? "无任务",
    );
    await page.screenshot({ path: path.join(SHOT_DIR, "02-text-to-image.png") });

    // ══ S3 图生图 ═══════════════════════════════════════════
    console.log("[S3] 图生图：上传参考图 → 提交 → reference_uris 非空");
    await page.goto(`${WEB}/create/image-to-image`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".imgt-prompt", { timeout: 25_000 });
    await sleep(1200);
    record(
      "S3.1 图生图页默认切到「图生图」模式",
      (await page.locator(".img-mode-tab.on").innerText()).includes("图生图"),
    );

    await page.setInputFiles(".imgt-upload", {
      name: "ref.png",
      mimeType: "image/png",
      buffer: PNG_1PX,
    });
    await sleep(2500);
    record("S3.2 参考图上传成功并出现缩略图", (await page.locator(".imgt-thumb").count()) >= 1);

    const marker2 = `E2E图生图${Date.now()}`;
    await page.fill(".imgt-prompt", `${marker2}：同一人物换成赛博朋克风格`);
    await sleep(1200);
    await page.locator(".imgt-submit").click();
    await sleep(3000);

    const list2 = await api("GET", "/tasks?page=1&page_size=10&capability=image", undefined, token);
    const img2img = (list2.data?.list || []).find((t) => t.mode === "image2image");
    let detail2 = img2img ? await api("GET", `/tasks/${img2img.task_id}`, undefined, token) : null;
    const refs = detail2?.data?.input?.reference_uris ?? [];
    record(
      "S3.3 任务 mode=image2image 且带参考图",
      !!detail2 && Array.isArray(refs) && refs.length >= 1,
      `refs=${refs.length}`,
    );
    await page.screenshot({ path: path.join(SHOT_DIR, "03-image-to-image.png") });

    // ══ S4 参考生视频 ═══════════════════════════════════════
    console.log("[S4] 参考生视频：工作台模式与模型目录");
    await page.goto(`${WEB}/create/reference-to-video`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".mode-tab", { timeout: 25_000 });
    await sleep(1500);
    // 用 evaluateAll 读类名+文本：`innerText()` 在迁移/编译过程中可能落在空节点上，
    // 断言会变成"看起来没选中"的假阴性
    const tabsInfo = await page.locator(".mode-tab").evaluateAll((els) =>
      els.map((e) => ({ text: (e.textContent || "").trim(), on: e.classList.contains("on") })),
    );
    const onTab = tabsInfo.find((t) => t.on)?.text ?? "";
    record("S4.1 默认模式为「参考生视频」", onTab.includes("参考生视频"), JSON.stringify(tabsInfo));

    const videoModels = await api("GET", "/models?capability=video&visible=true", undefined, token);
    const supportsRef = (videoModels.data || []).some((m) =>
      Object.prototype.hasOwnProperty.call(m.modes ?? {}, "universal_reference"),
    );
    record("S4.2 目录里有支持 universal_reference 的模型", supportsRef);
    record("S4.3 工具页无工作台侧栏（独立布局）", (await page.locator(".sidebar").count()) === 0);
    await page.screenshot({ path: path.join(SHOT_DIR, "04-reference-to-video.png") });

    // ══ S5 收尾 ════════════════════════════════════════════
    const realErrors = consoleErrors.filter(
      (e) => !/favicon|Failed to load resource.*404|ResizeObserver loop/i.test(e),
    );
    record("S5.1 无未预期的控制台错误", realErrors.length === 0, realErrors.slice(0, 3).join(" | ") || "clean");
  } catch (e) {
    // 不能把异常吞进 finally：否则 process.exit 会先执行，失败原因什么都不剩
    console.error("\nE2E 异常：", e);
    record("S0.1 脚本执行未抛异常", false, String(e && e.message ? e.message : e).slice(0, 240));
  } finally {
    await browser.close?.().catch?.(() => {});
    const failed = results.filter((r) => !r.ok);
    console.log(`\n${"─".repeat(56)}`);
    console.log(`工具箱 E2E：${pass}/${total} 通过`);
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
