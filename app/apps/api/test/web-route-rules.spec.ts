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
 * ## 判据（2026-11-03 定稿，口径见 docs/03-frontend/conventions.md §8）
 *
 * 原判据是一刀切「每个顶层路由 ssr:false」。它把 `/terms /privacy /report` 三类
 * **法律义务展示页**也关掉了服务端渲染：爬虫与审核拿到 SPA 空壳，而 `sitemap.xml`
 * 又把它们列进去了（声明与实际不一致）。这三页已实测无 SSR 障碍（无 `window`/
 * `document`/`onMounted`/`localStorage`/`useAuthStore`），必须可抓取。
 *
 * 现行判据是**两份显式清单 + 全集闭合**：
 * 1. `SSR_REQUIRED_ROUTES`（/terms /privacy /report）：**不得**声明 `ssr:false`
 *    （显式 `ssr:true` 或不写皆可——不写就是 Nuxt 默认的服务端渲染）；
 * 2. `SSR_PERMITTED_ROUTES`（/pricing，`requiresAuth:true`，靠客户端鉴权，不强制 SSR，
 *    但允许打开）；
 * 3. 其余一切顶层路由：必须**显式**声明 `ssr:false`（静默省略 = 历史事故形态）；
 * 4. 清单里的名字必须都是真实存在的顶层路由（页面删了名字还在 = 永不命中的假绿）；
 * 5. 同一路由的 `/x` 与 `/x/**` 两处声明不得互相矛盾。
 */
const WEB_ROOT = join(__dirname, "..", "..", "web");
const PAGES_DIR = join(WEB_ROOT, "pages");
const CONFIG = join(WEB_ROOT, "nuxt.config.ts");

/** 必须服务端渲染：法律义务展示页，必须可抓取、可审计 */
const SSR_REQUIRED_ROUTES: readonly string[] = ["terms", "privacy", "report"];

/**
 * 允许服务端渲染但不强制：`/pricing` 的 `definePageMeta` 带 `requiresAuth:true`，
 * 首帧依赖登录态，客户端鉴权；打开 SSR 不报错，但不作为上线义务。
 */
const SSR_PERMITTED_ROUTES: readonly string[] = ["pricing"];

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

/**
 * 读出该路由在 routeRules 里声明的所有 `ssr` 值（`/x` 与 `/x/**` 两种形态都算）。
 * 返回空数组 = 没有声明；多于一个元素 = 两处都写了，交给调用方判冲突。
 */
function declaredSsrValues(config: string, route: string): boolean[] {
  const escaped = route.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`"\\/${escaped}"\\s*:\\s*\\{[^}]*?ssr\\s*:\\s*(true|false)`),
    new RegExp(`"\\/${escaped}\\/\\*\\*"\\s*:\\s*\\{[^}]*?ssr\\s*:\\s*(true|false)`),
  ];
  const values: boolean[] = [];
  for (const re of patterns) {
    const m = config.match(re);
    if (m) values.push(m[1] === "true");
  }
  return values;
}

describe("前端路由规则（conventions.md §8：两份显式清单 + 全集闭合）", () => {
  const config = readFileSync(CONFIG, "utf8");
  const routes = topLevelRoutes();
  const isRequired = (r: string) => SSR_REQUIRED_ROUTES.includes(r);
  const isPermitted = (r: string) => SSR_PERMITTED_ROUTES.includes(r);

  it("pages/ 至少能解析出路由（防止守卫自身空跑成假绿）", () => {
    expect(routes.length).toBeGreaterThanOrEqual(10);
    expect(routes).toContain("share");
    expect(routes).toContain("terms");
  });

  it("强制清单不得声明 ssr:false（法律义务展示页必须可服务端抓取）", () => {
    const broken = SSR_REQUIRED_ROUTES.filter((r) => declaredSsrValues(config, r).includes(false));
    expect(
      broken,
      `以下合规页被关掉了服务端渲染（爬虫/审核会拿到 SPA 空壳）：${broken.map((b) => `/${b}`).join(", ")}`,
    ).toEqual([]);
  });

  it("强制清单必须真的存在（防删除页面后留下假绿）", () => {
    const ghosts = SSR_REQUIRED_ROUTES.filter((r) => !routes.includes(r));
    expect(ghosts, `SSR_REQUIRED_ROUTES 里有过期名字：${ghosts.map((g) => `/${g}`).join(", ")}`).toEqual([]);
  });

  it("允许清单必须真的存在（防过期名字）", () => {
    const ghosts = SSR_PERMITTED_ROUTES.filter((r) => !routes.includes(r));
    expect(ghosts, `SSR_PERMITTED_ROUTES 里有过期名字：${ghosts.map((g) => `/${g}`).join(", ")}`).toEqual([]);
  });

  it("强制清单与允许清单不得重叠（同一页只能有一个口径）", () => {
    const both = SSR_REQUIRED_ROUTES.filter((r) => isPermitted(r));
    expect(both, `以下路由同时出现在两份清单里：${both.map((b) => `/${b}`).join(", ")}`).toEqual([]);
  });

  it("清单外的一切路由必须显式声明 ssr:false（静默省略即历史事故形态）", () => {
    const illegal = routes.filter((r) => {
      if (isRequired(r) || isPermitted(r)) return false;
      const values = declaredSsrValues(config, r);
      if (values.length === 0) return true; // 漏配
      return values.some((v) => v === true); // 被擅自打开 SSR
    });
    expect(
      illegal,
      `以下路由必须是 ssr:false（首帧依赖客户端数据，放开即整页空白）或未归入清单：${illegal
        .map((m) => `/${m}`)
        .join(", ")}`,
    ).toEqual([]);
  });

  it("允许清单（/pricing）必须显式声明 ssr（true/false 皆可，但不许省略）", () => {
    const undeclared = SSR_PERMITTED_ROUTES.filter((r) => declaredSsrValues(config, r).length === 0);
    expect(undeclared, `以下允许清单路由没有显式声明 ssr：${undeclared.map((u) => `/${u}`).join(", ")}`).toEqual(
      [],
    );
  });

  it("同一路由的 /x 与 /x/** 两处声明不得互相矛盾", () => {
    const conflicts = routes.filter((r) => new Set(declaredSsrValues(config, r)).size > 1);
    expect(conflicts, `以下路由的 ssr 声明自相矛盾：${conflicts.map((c) => `/${c}`).join(", ")}`).toEqual([]);
  });

  it("share 分享页必须 ssr:false（匿名直开，首帧不一致即整页空白）", () => {
    const values = declaredSsrValues(config, "share");
    expect(values.length).toBeGreaterThan(0);
    expect(values.every((v) => v === false)).toBe(true);
  });

  it("站点根路由保持服务端渲染（SEO 入口，不能一刀切成 ssr:false）", () => {
    expect(declaredSsrValues(config, "").some((v) => v === false)).toBe(false);
  });
});
