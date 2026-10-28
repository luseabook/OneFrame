import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { COMMANDS } from "../src/registry";

/**
 * 第 65 批回归测试：CLI 的 ready 命令必须指向后端真实存在的路由。
 *
 * 为什么需要这个测试：第 65 批查出 36 条 ready 命令的 path 少了 `canvas/` 模块前缀
 * （registry 写 `canvases/...`，后端 `@Controller("canvas")` 下真实路径是
 * `/canvas/canvases/...`），实测 `GET /v1/canvases` 返回 404、`GET /v1/canvas/canvases`
 * 返回 401101（路由存在）。这类缺陷单测发现不了——原有的 CLI 测试只校验参数解析与
 * 转换，不校验 URL 是否真的对应后端路由，于是"命令对外宣称可用、实际 404"能一路活下来。
 *
 * 做法：直接读 apps/api 的 controller 源码建路由表（同仓库、纯静态、只读），
 * 与 registry 的 `method + path` 逐条比对。占位符两侧都归一成 `{}`（后端用 `:id`、
 * registry 用 `{id}`）。
 *
 * 边界：这是跨包源码读取，只在 monorepo 内有效；找不到 api 源码时跳过（发布态的
 * 独立包没有这个测试的意义）。它保证的是"路径形状一致"，不校验 query/body 语义。
 */

const API_SRC = join(__dirname, "..", "..", "api", "src");

function walkControllers(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === "node_modules" || name === "dist") continue;
      walkControllers(full, out);
    } else if (name.endsWith(".controller.ts")) {
      out.push(full);
    }
  }
  return out;
}

function normalize(path: string, method: string): string {
  const collapsed = ("/" + path.trim().replace(/^\/+/, "").replace(/\/+$/, ""))
    .replace(/\/{2,}/g, "/")
    .replace(/:([A-Za-z0-9_]+)/g, "{}")
    .replace(/\{[^}]*\}/g, "{}");
  return `${method.toUpperCase()} ${collapsed}`;
}

function backendRoutes(): Set<string> {
  const routes = new Set<string>();
  for (const file of walkControllers(API_SRC)) {
    const text = readFileSync(file, "utf8");
    const ctrl = /@Controller\(\s*(?:"([^"]*)"\s*)?\)/.exec(text);
    if (!ctrl) continue;
    const base = ctrl[1] ?? "";
    const rest = text.slice(ctrl.index + ctrl[0].length);
    for (const m of rest.matchAll(/@(Get|Post|Put|Patch|Delete)\(\s*(?:"([^"]*)")?\s*\)/g)) {
      const sub = m[2] ?? "";
      const path = sub ? `/${base}/${sub}` : `/${base}`;
      routes.add(normalize(path, m[1]));
    }
  }
  return routes;
}

describe("registry 的路径必须对应后端真实路由", () => {
  const available = existsSync(API_SRC);
  const skip = available ? undefined : "未找到 apps/api 源码，跳过";

  it.skipIf(skip)("所有 ready 且走 HTTP 的命令都能在后端路由表里找到", () => {
    const routes = backendRoutes();
    expect(routes.size).toBeGreaterThan(600); // 防解析失败导致集合为空时假绿

    const missing: string[] = [];
    for (const spec of COMMANDS) {
      if (!spec.ready || !spec.path || !spec.method) continue;
      const key = normalize(spec.path, spec.method);
      if (!routes.has(key)) missing.push(`${spec.group} ${spec.cmd} → ${key}`);
    }
    expect(missing, `以下命令的 path 在后端路由表里不存在：\n${missing.join("\n")}`).toEqual([]);
  });

  it.skipIf(skip)("canvas 家族命令必须带 canvas/ 模块前缀（第 65 批的 36 条缺陷）", () => {
    const canvasFamily = new Set(["canvas", "node", "group", "pin-group", "material", "script"]);
    const offenders = COMMANDS.filter(
      (spec) =>
        spec.ready &&
        canvasFamily.has(spec.group) &&
        spec.path &&
        !spec.path.startsWith("canvas/"),
    ).map((spec) => `${spec.group} ${spec.cmd} → ${spec.method} ${spec.path}`);
    expect(offenders).toEqual([]);
  });
});
