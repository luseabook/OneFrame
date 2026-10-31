import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * 前端路由规则守卫（P1-14 的教训）。
 *
 * 背景：`pages/*.vue` 里写 `definePageMeta({ ssr: false })` **只影响该页组件的渲染方式**，
 * 不改变 Nuxt 在服务端对这一路由的渲染决策 —— 真正决定首帧的是 `nuxt.config.ts` 的
 * `routeRules`。第 105 批修 `/team/**`、第 106 批修 `/share/**`，**两次都是同一个缺陷**：
 * 页面自己声明了 ssr:false，routeRules 里却漏了，于是首帧与服务端结果不一致 → 整页空白。
 *
 * 这类缺陷有三个特点，所以必须做成守卫而不是靠人记：
 * 1. **typecheck / lint / build 全绿**（配置缺一项是合法的）；
 * 2. **只在真实浏览器直开时暴露**（导航过去是客户端渲染，看起来正常）；
 * 3. **越"匿名可达"的页面越危险**（分享/播放页的链接会被 IM、举报系统、爬虫直开）。
 *
 * 判据：`pages/` 下**每个顶层路由**（目录 → `/name`，文件 → `/name`）都必须在 `routeRules`
 * 里出现，且值为 `{ ssr: false }`。`index.vue`（站点首页）是唯一例外——它是 SEO 入口，
 * 应当保留服务端渲染。
 */
const WEB_ROOT = join(__dirname, "..", "..", "web");
const PAGES_DIR = join(WEB_ROOT, "pages");
const CONFIG = join(WEB_ROOT, "nuxt.config.ts");

/** 从 pages/ 推导顶层路由名（不含前导斜杠）；`index.vue` 是根路由，返回 "" */
function topLevelRoutes(): string[] {
  const routes: string[] = [];
  for (const name of readdirSync(PAGES_DIR)) {
    const p = join(PAGES_DIR, name);
    if (statSync(p).isDirectory()) {
      routes.push(name);
      continue;
    }
    if (!name.endsWith(".vue")) continue;
    const base = name.replace(/\.vue$/, "");
    routes.push(base === "index" ? "" : base);
  }
  return routes.filter((r) => r !== "");
}

/** 该路由在 routeRules 里是否声明了 ssr:false（允许 `/x` 或 `/x/**` 任一形态） */
function hasSsrFalseRule(config: string, route: string): boolean {
  const escaped = route.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`"\\/${escaped}"\\s*:\\s*\\{\\s*ssr:\\s*false\\s*\\}`),
    new RegExp(`"\\/${escaped}\\/\\*\\*"\\s*:\\s*\\{\\s*ssr:\\s*false\\s*\\}`),
  ];
  return patterns.some((re) => re.test(config));
}

describe("前端路由规则：每个 pages/ 顶层路由都必须声明 ssr:false", () => {
  const config = readFileSync(CONFIG, "utf8");
  const routes = topLevelRoutes();

  it("pages/ 至少能解析出路由（防止守卫自身空跑成假绿）", () => {
    expect(routes.length).toBeGreaterThanOrEqual(10);
    expect(routes).toContain("share");
  });

  it("没有任何顶层路由漏配 routeRules（新增页面必须同步 nuxt.config）", () => {
    const missing = routes.filter((r) => !hasSsrFalseRule(config, r));
    // 失败信息直接给出缺失的路由名与补法，别让人再去数配置
    expect(missing, `以下路由缺 routeRules ssr:false：${missing.map((m) => `/${m}`).join(", ")}`).toEqual([]);
  });

  it("share 分享页必须在列（匿名直开，首帧不一致即整页空白）", () => {
    expect(hasSsrFalseRule(config, "share")).toBe(true);
  });

  it("站点根路由保持服务端渲染（SEO 入口，不能一刀切成 ssr:false）", () => {
    expect(hasSsrFalseRule(config, "")).toBe(false);
  });
});
