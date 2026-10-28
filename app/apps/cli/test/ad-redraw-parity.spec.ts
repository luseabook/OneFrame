import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { COMMANDS, type CommandSpec } from "../src/registry";

/**
 * ad / redraw 两个命令组的接线契约（第 70 批）。
 *
 * 为什么值得单独钉一遍：这两组的 5 条骨架从第 44 批起就写着「后端模块还没落地、
 * 当前无端点」，而后端 `apps/api/src/modules/ad/ad-drama.controller.ts` 与
 * `modules/redraw/redraw.controller.ts` **第 44 批就已经有 12 + 9 个端点**了。
 * 骨架命令不会报错（它明确说"未接入"），所以 typecheck / lint / 9 项门禁全绿，
 * 只有真正跑一遍才会发现"能力其实在，只是命令没接线"。
 *
 * 这里不重复 `registry-routes.spec.ts` 的"路径是否存在于后端"（那是全局守卫），
 * 只钉两件它会放过的事：
 * 1. 竞品 CLI 有 8 个 `ad` 动词（`commands/ad.md:22-31`），我方缺一个都算口径不全；
 * 2. 哪几条会扣费（`paid`）必须与后端的 `credits` 调用对得上，否则 `--dry-run`
 *    给出的预估是假的。
 */

const API_SRC = join(__dirname, "..", "..", "api", "src");
const byCmd = (group: string, cmd: string): CommandSpec => {
  const found = COMMANDS.find((c) => c.group === group && c.cmd === cmd);
  if (!found) throw new Error(`命令不存在：${group} ${cmd}`);
  return found;
};

const adVerbs = COMMANDS.filter((c) => c.group === "ad").map((c) => c.cmd);

describe("ad / redraw 命令组接线", () => {
  it("ad 组覆盖竞品 CLI 的 8 个动词，且没有一个是骨架", () => {
    expect([...adVerbs].sort()).toEqual(
      ["asset", "info", "plan", "plot", "reset", "save", "script", "selling-point"].sort(),
    );
    expect(COMMANDS.filter((c) => c.group === "ad" && !c.ready)).toEqual([]);
    // 竞品 redraw 只有 `info` 是可用流程，其余明写「流程待接入」（commands/redraw.md:21-24）
    expect(COMMANDS.filter((c) => c.group === "redraw" && !c.ready)).toEqual([]);
  });

  it("每条 ad/redraw 命令都指向 modules/ad、modules/redraw 的真实前缀", () => {
    const cases: Array<[string, string, string, string]> = [
      ["ad", "info", "GET", "ad-drama/projects/{project_id}"],
      ["ad", "save", "POST", "ad-drama/projects"],
      ["ad", "selling-point", "POST", "ad-drama/projects/{project_id}/selling-point/generate"],
      ["ad", "plot", "POST", "ad-drama/projects/{project_id}/brief/generate"],
      ["ad", "script", "POST", "ad-drama/projects/{project_id}/script/generate"],
      ["ad", "asset", "POST", "ad-drama/projects/{project_id}/asset/extract"],
      ["ad", "plan", "POST", "ad-drama/projects/{project_id}/storyboard/generate"],
      ["ad", "reset", "POST", "ad-drama/projects/{project_id}/script/reset"],
      ["redraw", "info", "GET", "video-redraw/projects/{project_id}"],
      ["redraw", "create", "POST", "video-redraw/projects"],
    ];
    for (const [group, cmd, method, path] of cases) {
      const spec = byCmd(group, cmd);
      expect(spec.ready).toBe(true);
      expect(spec.method).toBe(method);
      expect(spec.path).toBe(path);
    }
  });

  it("会扣费的 5 条生成命令标了 paid，只读与落库命令没标", () => {
    // 后端 `ad-drama.service.ts` 对这些动作逐个 `credits.price()` + 冻结/结算（`:225/:272/:340/:442/:515/:569`）
    for (const cmd of ["selling-point", "plot", "script", "asset", "plan"]) {
      expect(byCmd("ad", cmd).paid, `ad ${cmd} 应该标 paid`).toBe(true);
      expect(byCmd("ad", cmd).write, `ad ${cmd} 是写命令`).toBe(true);
    }
    for (const cmd of ["info", "save", "reset"]) {
      expect(byCmd("ad", cmd).paid, `ad ${cmd} 不该标 paid`).toBeFalsy();
    }
    expect(byCmd("redraw", "info").paid).toBeFalsy();
    expect(byCmd("redraw", "create").paid).toBeFalsy();
  });

  it("两个前缀在 api 源码里确实有 controller（防止路径拼对了但模块被删）", () => {
    const found: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === "node_modules" || entry.name === "dist") continue;
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith(".controller.ts")) found.push(readFileSync(full, "utf8"));
      }
    };
    if (!existsSync(API_SRC)) return;
    walk(API_SRC);
    const joined = found.join("\n");
    expect(joined).toContain('@Controller("ad-drama")');
    expect(joined).toContain('@Controller("video-redraw")');
  });
});
