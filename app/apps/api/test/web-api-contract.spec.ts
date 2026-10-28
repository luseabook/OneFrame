import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * 第 66 批回归测试：`apps/web` 里手写的 API 路径必须对应后端真实路由。
 *
 * 为什么需要它：第 65 批用同一套机械比对查出 CLI 侧 36 条 ready 命令的 path 缺
 * `canvas/` 前缀（对外宣称可用、实际全 404）。第 66 批把同一方法用到 web 侧，
 * 立刻抓到 `pages/works.vue` 的 `GET /team/groups` —— 后端是 `TeamController`
 * 的 `@Controller("cam")` + `@Get("team/groups")`，真实路径 `/cam/team/groups`。
 * 这个 404 被页面里的 `catch` 静默吞成"没有团队分组"，于是分组下拉从来没出现过，
 * 类型检查、构建、lint、总闸都不会红。
 *
 * 做法：只读扫描（不启动服务、不连库）——
 *   1. 读 `apps/api/src/**\/*.controller.ts` 建路由表（按 `@Controller` 切段，
 *      一个文件可以有多个控制器类：admin / agent-stt / novel-variant / op / task-share）；
 *   2. 读 `apps/web` 的 `.ts` / `.vue`，抓 `api.<verb>(<字面量>)` 的首参；
 *   3. 两侧占位符都归一成 `{}` 且互为通配（web 的 `${kind}` 常是
 *      `"buy" | "preorder"` 这种字面量联合，静态拿不到值）。
 *
 * 故意不扫的部分：首参是变量/拼接出来的调用（共 133 处，集中在 useCanvasApi.ts
 * 这类以 `canvasBase()` 拼前缀的 composable）——静态无法解析，扫了只会制造假红。
 * 这个测试保证"路径形状对得上"，不校验 query / body 语义。
 */

const WEB_ROOT = join(__dirname, "..", "..", "web");
const API_SRC = join(__dirname, "..", "src");
const WILDCARD = "{}";

function walk(dir: string, accept: (name: string) => boolean, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === "node_modules" || name === "dist" || name === ".nuxt" || name === ".output") continue;
      walk(full, accept, out);
    } else if (accept(name)) {
      out.push(full);
    }
  }
  return out;
}

function normalize(path: string): string {
  let p = path.trim().split("?")[0]!.split("#")[0]!;
  p = p.replace(/^https?:\/\/[^/]+/, "");
  // 紧跟在非 `/` 字符后的 `${...}` 是 query 拼接（如 `/dirs${qs}`），从那里截断
  p = p.replace(/([^/])\$\{[^}]*\}.*$/, "$1");
  p = p.replace(/\$\{[^}]*\}/g, WILDCARD);
  p = `/${p}`.replace(/^\/+/, "/");
  p = p.replace(/:([A-Za-z0-9_]+)/g, WILDCARD).replace(/\{[^}]*\}/g, WILDCARD);
  p = p.replace(/\/\d+(?=\/|$)/g, `/${WILDCARD}`);
  p = p.replace(/\/{2,}/g, "/").replace(/\/+$/, "");
  return p || "/";
}

function segments(path: string): string[] {
  return path.split("/").filter(Boolean);
}

function backendRoutes(): { method: string; path: string }[] {
  const routes: { method: string; path: string }[] = [];
  const controllerRe = /@Controller\(\s*(?:"([^"]*)"\s*)?\)/g;
  const methodRe = /@(Get|Post|Put|Patch|Delete)\(\s*(?:"([^"]*)")?\s*\)/g;
  for (const file of walk(API_SRC, (name) => name.endsWith(".controller.ts"))) {
    const text = readFileSync(file, "utf8");
    const marks = [...text.matchAll(controllerRe)];
    for (let i = 0; i < marks.length; i += 1) {
      const base = marks[i]![1] ?? "";
      const from = (marks[i]!.index ?? 0) + marks[i]![0].length;
      const to = i + 1 < marks.length ? (marks[i + 1]!.index ?? text.length) : text.length;
      for (const m of text.slice(from, to).matchAll(methodRe)) {
        const sub = m[2] ?? "";
        routes.push({ method: m[1]!.toUpperCase(), path: normalize(sub ? `/${base}/${sub}` : `/${base}`) });
      }
    }
  }
  return routes;
}

const METHOD_MAP: Record<string, string> = {
  get: "GET",
  post: "POST",
  put: "PUT",
  patch: "PATCH",
  del: "DELETE",
  delete: "DELETE",
};
const VERB_RE = /\bapi\s*\.\s*(get|post|put|patch|del|delete)\b/g;
// 必须**紧接**在动词之后：可选泛型（允许两层嵌套）+ `(` + 首个字面量参数。
// 早先写成不带 `^` 的搜索式正则，会向后跳过 `api.post(path, {...})` 这种首参是变量的调用，
// 把**下一条**调用的字面量错配给上一条动词语句（曾把 `api.get("/crc/assets/me")` 报成 POST）。
const FIRST_ARG_RE = /^(?:<(?:[^<>]|<(?:[^<>]|<[^<>]*>)*>)*>)?\s*\(\s*(?:"([^"]*)"|'([^']*)'|`([^`]*)`)/;

function webCalls(): { method: string; path: string; where: string }[] {
  const calls: { method: string; path: string; where: string }[] = [];
  const files = walk(WEB_ROOT, (name) => name.endsWith(".ts") || name.endsWith(".vue"));
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(VERB_RE)) {
      const method = METHOD_MAP[m[1]!.toLowerCase()]!;
      const lit = FIRST_ARG_RE.exec(text.slice((m.index ?? 0) + m[0].length));
      if (!lit) continue;
      const raw = lit[1] ?? lit[2] ?? lit[3] ?? "";
      if (!raw.startsWith("/")) continue; // 变量/拼接前缀，静态无法解析
      const line = text.slice(0, m.index ?? 0).split("\n").length;
      calls.push({ method, path: normalize(raw), where: `${relative(WEB_ROOT, file)}:${line} raw=${raw}` });
    }
  }
  return calls;
}

function hits(routes: { method: string; path: string }[], method: string, path: string): boolean {
  const want = segments(path);
  return routes.some((route) => {
    if (route.method !== method) return false;
    const have = segments(route.path);
    if (have.length !== want.length) return false;
    return have.every((h, i) => h === want[i] || h === WILDCARD || want[i] === WILDCARD);
  });
}

const available = existsSync(WEB_ROOT) && existsSync(API_SRC);
const skip = available ? undefined : "未找到 apps/web 或 apps/api 源码，跳过";

describe("apps/web 的 API 路径必须对应后端真实路由", () => {
  it.skipIf(skip)("解析出的后端路由数量合理（防解析失败导致假绿）", () => {
    expect(backendRoutes().length).toBeGreaterThan(600);
  });

  it.skipIf(skip)("抓到的 web 静态调用数量合理（防正则失效导致假绿）", () => {
    expect(webCalls().length).toBeGreaterThan(300);
  });

  it.skipIf(skip)("所有静态字面量路径都能在后端路由表里找到", () => {
    const routes = backendRoutes();
    const calls = webCalls();
    const missing = calls
      .filter((call) => !hits(routes, call.method, call.path) && !hits(routes, call.method, `/v1${call.path}`))
      .map((call) => `${call.method} ${call.path} ← ${call.where}`);
    expect(missing, `以下 web 调用在后端路由表里不存在：\n${missing.join("\n")}`).toEqual([]);
  });

  it.skipIf(skip)("历史上真出过 404 的两条路径仍在路由表里（回归锚点）", () => {
    const routes = backendRoutes();
    // 第 66 批：works.vue 少写 `cam/`；同批曾把 /redeem-code/redeem 误判成缺陷，
    // 实际由 op.controller.ts 下半部分的 RedeemCodeController 提供。
    expect(hits(routes, "GET", "/cam/team/groups")).toBe(true);
    expect(hits(routes, "POST", "/redeem-code/redeem")).toBe(true);
    expect(hits(routes, "GET", "/team/groups")).toBe(false);
  });
});
