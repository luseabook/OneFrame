import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * 门禁：`apps/web` 里手写的 API 路径必须对应后端真实路由。
 *
 * 为什么需要它：第 65 批用机械比对查出 CLI 侧 36 条 ready 命令的 path 缺 `canvas/`
 * 前缀（对外宣称可用、实际全 404）。第 66 批把同一方法用到 web 侧，立刻抓到
 * `pages/works.vue` 的 `GET /team/groups` —— 后端是 `TeamController` 的
 * `@Controller("cam")` + `@Get("team/groups")`，真实路径 `/cam/team/groups`。
 * 这个 404 被页面里的 `catch` 静默吞成"没有团队分组"，于是分组下拉从来没出现过，
 * 类型检查、构建、lint、总闸都不会红。
 *
 * 第 67 批扩了覆盖（408 → **544** 条调用、未解析 0 条）：
 *   - `useCanvasApi.ts` 这类 composable 用 `const base = (id) => \`/canvas/canvases/${id}\``
 *     拼前缀，调用侧写成 `api.get(\`${base(id)}/nodes\`)`。第 66 批把这类整片跳过，
 *     正好把「路径拼错」风险最高的那部分排除在门禁之外（第 66 批的缺陷就在另一条
 *     拼接路径上，只是恰好被静态解析到）。
 *   - 现在解析三类前缀：① `helper(...)` / `helper.value` 展开其声明里的模板字面量；
 *     ② 首参是局部变量时，取该变量声明里所有以 `/` 开头的字面量（覆盖三元两分支、
 *     `??` 兜底）；③ 首参是带 `??` 的表达式时，取表达式内所有字面量。
 *
 * 做法：只读扫描（不启动服务、不连库）——
 *   1. 读 `apps/api/src/**\/*.controller.ts` 建路由表（按 `@Controller` 切段，
 *      一个文件可以有多个控制器类：admin / agent-stt / novel-variant / op / task-share）；
 *   2. 读 `apps/web` 的 `.ts` / `.vue`，抓 `api.<verb>(<首参>)` 并静态展开；
 *   3. 两侧占位符都归一成 `{}` 且互为通配（web 的 `${kind}` 常是
 *      `"buy" | "preorder"` 这种字面量联合，静态拿不到值）。
 *
 * 覆盖边界（诚实说明）：第 67 批之后 web 侧 544 条 `api.*` 调用**全部**静态可解析，
 * 未解析数为 0（由 `UNRESOLVED_MAX` 与 `UNRESOLVED_ALLOWLIST` 卡住：将来若出现首参前缀
 * 来自运行时数据的调用，本测试会变红，逼作者改成静态可解析形式或显式登记）。
 * 本测试只保证"路径形状对得上"，不校验 query / body 语义，也不校验方法语义
 * （`POST /x` 与 `GET /x` 各算各的，不会互相顶替）。
 */

const WEB_ROOT = join(__dirname, "..", "..", "web");
const API_SRC = join(__dirname, "..", "src");
const WILDCARD = "{}";

/** 允许静态解析不出来的调用上限；新增会让门禁红，逼显式登记。 */
const UNRESOLVED_MAX = 0;
/**
 * 已知不可静态解析的调用（首参前缀来自运行时数据）。
 * 第 67 批清空：原本卡的 4 处（activities.vue 的 `path` 三元、creator-center 的三元、
 * knowledge/index.vue 的 `path`、AgentVoiceRecorder 的 `?? "/agent/stt/transcribe"`）
 * 都被「取局部变量语句内字面量 / 取表达式内字面量」两类解析收进静态覆盖。
 * 将来若真出现运行时才定的前缀，把文件名登记到这里并在本注释说明原因。
 */
const UNRESOLVED_ALLOWLIST: string[] = [];

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
/** 首参是局部变量：`api.post(path, {...})` */
const IDENT_ARG_RE = /^(?:<(?:[^<>]|<(?:[^<>]|<[^<>]*>)*>)*>)?\s*\(\s*([A-Za-z_$][\w$]*)\s*[,)]/;
/** 首参是 helper 调用：`api.get(base(canvasId))` / `api.post(`${base(id)}/commit`)` 之外的形态 */
const IDENT_CALL_RE = /^(?:<(?:[^<>]|<(?:[^<>]|<[^<>]*>)*>)*>)?\s*\(\s*([A-Za-z_$][\w$]*)\s*\(([^()]*)\)([^,)]*)/;
/** 以 `/` 或 `${` 开头的字面量（模板字面量允许含 `${}`）。 */
const PATH_LITERAL_RE = /"(\/(?:[^"\\\n]|\\.)*)"|'(\/(?:[^'\\\n]|\\.)*)'|`(\/(?:[^`\\]|\\.)*)`/g;

/** 取某标识符声明处的模板字面量前缀（`const base = (id) => \`/canvas/canvases/${id}\``）。 */
function helperTemplate(text: string, name: string, before: number): string | null {
  const declRe = new RegExp(`(?:const|let|var|function)\\s+${name}\\b`, "g");
  let hit: string | null = null;
  for (const m of text.matchAll(declRe)) {
    if ((m.index ?? 0) > before) continue;
    const body = text.slice(m.index ?? 0, (m.index ?? 0) + 500);
    // 模板字面量（`/canvas/canvases/${id}`）优先，其次普通字符串（`"/agent/sessions"`）
    const tpl = /`(\/(?:[^`\\]|\\.)*)`/.exec(body) ?? /"(\/(?:[^"\\\n]|\\.)*)"/.exec(body);
    if (tpl) hit = tpl[1]!;
  }
  return hit;
}

/** 把首参首段的 `${helper(...)}` 用 helper 的模板字面量展开。 */
function expandHelperPrefix(raw: string, text: string, before: number): string | null {
  const lead = /^\$\{([A-Za-z_$][\w$]*)(?:\.value)?\s*(?:\(|\})/.exec(raw);
  if (!lead) return raw;
  const tpl = helperTemplate(text, lead[1]!, before);
  if (!tpl) return null;
  const rest = raw.replace(new RegExp(`^\\$\\{${lead[1]}(?:[^}]*)\\}`), "");
  return `${tpl}${rest}`;
}

/** 从一个表达式片段里收集所有以 `/` 开头的字面量候选。 */
function literalCandidates(fragment: string): string[] {
  const out: string[] = [];
  for (const m of fragment.matchAll(PATH_LITERAL_RE)) {
    const raw = m[1] ?? m[2] ?? m[3];
    if (raw) out.push(raw.replace(/\\`/g, "`"));
  }
  return out;
}

interface WebCall {
  method: string;
  path: string;
  where: string;
}

function webCalls(): { calls: WebCall[]; unresolved: string[] } {
  const calls: WebCall[] = [];
  const unresolved: string[] = [];
  const files = walk(WEB_ROOT, (name) => name.endsWith(".ts") || name.endsWith(".vue"));
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    const rel = relative(WEB_ROOT, file);
    for (const m of text.matchAll(VERB_RE)) {
      const method = METHOD_MAP[m[1]!.toLowerCase()]!;
      const start = (m.index ?? 0) + m[0].length;
      const line = text.slice(0, m.index ?? 0).split("\n").length;
      const where = `${rel}:${line}`;

      // ① 首参直接是字面量（可能是 `${helper(...)}` 开头）
      const lit = FIRST_ARG_RE.exec(text.slice(start));
      let raws: string[] = [];
      if (lit) {
        const raw = lit[1] ?? lit[2] ?? lit[3] ?? "";
        if (raw.startsWith("/")) raws = [raw];
        else if (raw.startsWith("${")) {
          // 可能是 helper 前缀，也可能是运行时数据前缀；只认能静态展开的
          const expanded = expandHelperPrefix(raw, text, m.index ?? 0);
          if (expanded?.startsWith("/")) raws = [expanded];
        }
      }

      // ② 首参是 helper 调用：`api.get(base(canvasId))` / `api.post(base(id) + "/x")`
      if (raws.length === 0) {
        const call = IDENT_CALL_RE.exec(text.slice(start));
        if (call) {
          const tpl = helperTemplate(text, call[1]!, m.index ?? 0);
          if (tpl) raws = [`${tpl}${(call[3] ?? "").trim()}`];
        }
      }

      // ③ 首参是局部变量：取该变量**同一个语句**里所有以 `/` 开头的字面量（覆盖三元 / `??`）
      if (raws.length === 0) {
        const ident = IDENT_ARG_RE.exec(text.slice(start));
        if (ident) {
          const declRe = new RegExp(`(?:const|let|var)\\s+${ident[1]}\\b`, "g");
          for (const dm of text.matchAll(declRe)) {
            if ((dm.index ?? 0) > (m.index ?? 0)) continue;
            // 必须截在同一语句内：早先取 400 字符，会把下一条调用的字面量也算进来，
            // 于是 `api.post(path, …)` 被错配成 `POST /crc/assets/me`。
            const fragment = text.slice(dm.index ?? 0, (dm.index ?? 0) + 400).split(";")[0]!;
            for (const raw of literalCandidates(fragment)) {
              const expanded = raw.startsWith("${") ? expandHelperPrefix(raw, text, dm.index ?? 0) : raw;
              if (expanded?.startsWith("/")) raws.push(expanded);
            }
          }
        }
      }

      // ④ 首参是表达式：取表达式片段里的字面量（`a?.b(...) ?? "/x"`）
      if (raws.length === 0) {
        const fragment = text.slice(start, start + 240).split(";")[0]!;
        for (const raw of literalCandidates(fragment)) {
          const expanded = raw.startsWith("${") ? expandHelperPrefix(raw, text, m.index ?? 0) : raw;
          if (expanded?.startsWith("/")) raws.push(expanded);
        }
      }

      if (raws.length === 0) {
        unresolved.push(where);
        continue;
      }
      for (const raw of new Set(raws)) calls.push({ method, path: normalize(raw), where: `${where} raw=${raw}` });
    }
  }
  return { calls, unresolved };
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

  it.skipIf(skip)("静态可解析的 web 调用数量合理（防正则失效导致假绿）", () => {
    // 第 67 批：408 → 537+，其中约 129 条靠 helper 前缀展开
    expect(webCalls().calls.length).toBeGreaterThan(500);
  });

  it.skipIf(skip)("静态解析不出来的调用不超过登记上限（防止覆盖悄悄退步）", () => {
    const { unresolved } = webCalls();
    expect(unresolved.length, `未解析：\n${unresolved.join("\n")}`).toBeLessThanOrEqual(UNRESOLVED_MAX);
    for (const where of unresolved) {
      const file = where.split(":")[0]!;
      expect(UNRESOLVED_ALLOWLIST, `新增了不可静态解析的调用 ${where}：请改写成静态可解析形式，或登记进白名单`)
        .toContain(file);
    }
  });

  it.skipIf(skip)("所有静态可解析路径都能在后端路由表里找到", () => {
    const routes = backendRoutes();
    const missing = webCalls()
      .calls.filter((call) => !hits(routes, call.method, call.path) && !hits(routes, call.method, `/v1${call.path}`))
      .map((call) => `${call.method} ${call.path} ← ${call.where}`);
    expect(missing, `以下 web 调用在后端路由表里不存在：\n${missing.join("\n")}`).toEqual([]);
  });

  it.skipIf(skip)("历史上真出过 404 的路径仍在路由表里（回归锚点）", () => {
    const routes = backendRoutes();
    // 第 66 批：works.vue 少写 `cam/`；同批曾把 /redeem-code/redeem 误判成缺陷，
    // 实际由 op.controller.ts 下半部分的 RedeemCodeController 提供。
    expect(hits(routes, "GET", "/cam/team/groups")).toBe(true);
    expect(hits(routes, "POST", "/redeem-code/redeem")).toBe(true);
    expect(hits(routes, "GET", "/team/groups")).toBe(false);
  });

  it.skipIf(skip)("helper 前缀（composable 拼出来的路径）也真的被解析了", () => {
    // 第 67 批的覆盖升级点：`api.get(\`${base(id)}/nodes\`)` 这类必须能被展开，
    // 否则「路径拼错」风险最高的 composable 又会被整片排除在门禁外。
    const { calls } = webCalls();
    const canvas = calls.filter((call) => call.path.startsWith(`/canvas/canvases/${WILDCARD}`));
    expect(canvas.length).toBeGreaterThan(20);
    expect(calls.some((call) => call.where.includes("useCanvasApi.ts"))).toBe(true);
  });
});
