/**
 * 文档声称 vs 代码实际：静态核对（不依赖运行时）
 */
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..", "app", "apps", "web");
const API_ROOT = path.join(__dirname, "..", "app", "apps", "api", "src");
const results = [];
const ok = (n, c, d = "") => {
  results.push({ n, c: !!c });
  console.log(`${c ? "PASS" : "FAIL"} | ${n}${d ? " | " + d : ""}`);
};
const exists = (p) => fs.existsSync(p);
const read = (p) => (exists(p) ? fs.readFileSync(p, "utf8") : "");

console.log("\n=== 文档声称 vs 代码实际 ===\n");

// conventions.md 声称的 layouts
for (const f of ["default.vue", "app.vue", "tool.vue"]) {
  ok(`layout ${f} 存在`, exists(path.join(ROOT, "layouts", f)));
}
// conventions.md 声称的 pages
for (const f of [
  "index.vue",
  "home.vue",
  "works.vue",
  "projects/index.vue",
  "projects/[id].vue",
  "tools.vue",
  "tasks.vue",
  "assets.vue",
  "credits.vue",
  "pricing.vue",
  "settings.vue",
  "login.vue",
  "terms.vue",
  "privacy.vue",
  "report.vue",
  "share/[token].vue",
  "admin.vue",
]) {
  ok(`page ${f} 存在`, exists(path.join(ROOT, "pages", f)));
}
// conventions.md 声称的基础组件（平铺）
for (const c of [
  "Button.vue",
  "Modal.vue",
  "TextField.vue",
  "TextAreaField.vue",
  "SelectField.vue",
  "TabBar.vue",
  "Card.vue",
  "Tag.vue",
  "Progress.vue",
  "EmptyState.vue",
  "Skeleton.vue",
  "ToastHost.vue",
  "OnboardingBar.vue",
]) {
  ok(`component ${c} 存在`, exists(path.join(ROOT, "components", c)));
}
// conventions.md 声称的 composables
for (const c of ["useAuth.ts", "useApi.ts", "useToast.ts"]) {
  ok(`composable ${c} 存在`, exists(path.join(ROOT, "composables", c)));
}

// 设计令牌：三层关键令牌是否真的存在于 tokens.css
const tokens = read(path.join(ROOT, "assets", "css", "tokens.css"));
for (const t of [
  "--brand-500",
  "--dark-base",
  "--bg-app",
  "--text-inverse",
  "--radius-3xl",
  "--shadow-xl",
  "--text-5xl",
  "--space-20",
  "--duration-slow",
  "--z-toast",
  "--header-h",
  "--sidebar-w",
]) {
  ok(`token ${t} 已定义`, tokens.includes(t));
}

// nuxt.config 声称的 routeRules ssr:false
const nuxtCfg = read(path.join(ROOT, "nuxt.config.ts"));
for (const r of ["/works", "/projects", "/tasks", "/assets", "/credits", "/home"]) {
  ok(`routeRules ${r} ssr:false`, new RegExp(`"${r}":\\s*\\{\\s*ssr:\\s*false`).test(nuxtCfg));
}

// api-spec §8.1 声称的端点
const scriptCtl = read(path.join(API_ROOT, "modules", "script", "script.controller.ts"));
const authCtl = read(path.join(API_ROOT, "modules", "auth", "auth.controller.ts"));
ok("端点 GET /works", /@Get\("works"\)/.test(scriptCtl));
ok("端点 POST /projects/:id/archive", /projects\/:id\/archive/.test(scriptCtl));
ok("端点 POST /projects/:id/episodes", /@Post\("projects\/:id\/episodes"\)/.test(scriptCtl));
ok("端点 POST /projects/:id/duplicate", /projects\/:id\/duplicate/.test(scriptCtl));
ok("端点 POST /me/onboarded", /me\/onboarded/.test(authCtl));

// PRD F9 声称的四态
const scriptSvc = read(path.join(API_ROOT, "modules", "script", "script.service.ts"));
for (const s of ["archived", "draft", "ready", "producing"]) {
  ok(`work_state 含 "${s}"`, scriptSvc.includes(`"${s}"`));
}
// PRD F10 声称的字段
ok("users.onboarded_at 字段", read(path.join(__dirname, "..", "app", "packages", "db", "src", "schema.ts")).includes("onboardedAt"));
ok("script_projects.is_sample 字段", read(path.join(__dirname, "..", "app", "packages", "db", "src", "schema.ts")).includes("isSample"));

const passed = results.filter((r) => r.c).length;
console.log(`\n=== 结果：${passed}/${results.length} 通过 ===`);
const failed = results.filter((r) => !r.c);
if (failed.length) failed.forEach((f) => console.log(`  - ${f.n}`));
process.exitCode = failed.length ? 1 : 0;
