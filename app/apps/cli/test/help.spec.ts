import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { commandHelp, groupHelp, resolveCommand, topLevelHelp } from "../src/help";
import { parseArgv } from "../src/args";
import { COMMANDS, GROUP_ORDER, commandsOfGroup } from "../src/registry";
import { CLI_VERSION } from "../src/version";
import { harness } from "./helpers";

/**
 * `--help` 覆盖度。
 *
 * brief 要求「`--help` 覆盖全部命令组」。这类断言的价值在于：新增组忘了登记、
 * 或把骨架命令悄悄删掉，都会在这里暴露。同时断言骨架命令**必须**带未落地原因，
 * 防止「静默把骨架当可用」。
 */
describe("--help 覆盖", () => {
  it("顶层帮助列出全部命令组与退出码全集", async () => {
    const help = topLevelHelp();
    for (const group of GROUP_ORDER) {
      if (commandsOfGroup(group).length === 0) continue;
      expect(help).toContain(group);
    }
    expect(help).toContain("--dry-run");
    expect(help).toContain("--idempotency-key");
    expect(help).toContain("10 节点锁竞争");
    // MCP 缺口必须显式写在帮助里，而不是悄悄没有
    expect(help).toContain("MCP");
  });

  it("每个命令组都有可用的组帮助，且逐条列出子命令", () => {
    for (const group of GROUP_ORDER) {
      const specs = commandsOfGroup(group);
      if (specs.length === 0) continue;
      const help = groupHelp(group);
      expect(help).toContain(`oneframe ${group}`);
      for (const spec of specs) {
        if (!spec.cmd) continue;
        expect(help).toContain(spec.cmd);
      }
    }
  });

  it("骨架命令必须写明未落地原因（不许假装可用）", () => {
    const skeletons = COMMANDS.filter((c) => !c.ready);
    expect(skeletons.length).toBeGreaterThan(20);
    for (const spec of skeletons) {
      expect(spec.reason, `${spec.group} ${spec.cmd} 缺 reason`).toBeTruthy();
      expect(spec.reason).not.toBe("placeholder");
    }
  });

  it("可用命令必须有 method 或 impl（否则执行会走进空路径）", () => {
    for (const spec of COMMANDS.filter((c) => c.ready)) {
      expect(Boolean(spec.method) || Boolean(spec.impl), `${spec.group} ${spec.cmd}`).toBe(true);
    }
  });

  it("单条命令帮助区分「可用」与「骨架」", () => {
    const ready = COMMANDS.find((c) => c.group === "task" && c.cmd === "cancel");
    expect(ready).toBeDefined();
    const readyHelp = commandHelp(ready!);
    expect(readyHelp).toContain("POST tasks/{task_id}/cancel");
    expect(readyHelp).toContain("--idempotency-key");
    expect(readyHelp).toContain("commands/task.md:99");

    const skeleton = COMMANDS.find((c) => c.group === "novel" && c.cmd === "config");
    expect(skeleton).toBeDefined();
    const skeletonHelp = commandHelp(skeleton!);
    expect(skeletonHelp).toContain("骨架");
    expect(skeletonHelp).toContain("novel 批次");
  });

  it("`--help` 三种层级都能跑通且退出 0", async () => {
    const top = await harness(["--help"]);
    expect(top.code).toBe(0);
    expect(top.stdout).toContain("命令组");

    const group = await harness(["workflow", "--help"]);
    expect(group.code).toBe(0);
    expect(group.stdout).toContain("detect");

    const one = await harness(["workflow", "detect", "--help"]);
    expect(one.code).toBe(0);
    expect(one.stdout).toContain("GET /workflow/detect");
  });

  it("`--version` 与 `version` 组命令版本一致，且与 package.json 同步", async () => {
    const flag = await harness(["--version"]);
    expect(flag.stdout.trim()).toBe(CLI_VERSION);

    const group = await harness(["version", "--json"]);
    expect(group.code).toBe(0);
    expect((group.output.data as { version: string }).version).toBe(CLI_VERSION);

    const pkg = JSON.parse(readFileSync(join(__dirname, "..", "package.json"), "utf8")) as {
      version: string;
    };
    expect(pkg.version).toBe(CLI_VERSION);
  });

  it("组/子命令解析：三级语法压平与两条特例", () => {
    const parsed = parseArgv(["canvas", "template-publish", "--canvas", "1"]);
    expect(resolveCommand(parsed.positionals, parsed).spec.cmd).toBe("template-publish");

    const exportLevel = parseArgv(["export", "55", "--workspace", "1"]);
    const resolvedExport = resolveCommand(exportLevel.positionals, exportLevel);
    expect(resolvedExport.spec.cmd).toBe("");
    expect(resolvedExport.args).toEqual(["55"]);

    // node 无子命令 + --left/--right → node edge（edge.md:8）
    const edge = parseArgv(["node", "--canvas", "1", "--left", "a", "--right", "b"]);
    expect(resolveCommand(edge.positionals, edge).spec.cmd).toBe("edge");
  });

  it("未知组/未知子命令报 usage 且列出已知项", () => {
    const bad = parseArgv(["nope", "x"]);
    expect(() => resolveCommand(bad.positionals, bad)).toThrowError(/未知命令组/);

    const bad2 = parseArgv(["model", "nope"]);
    let message = "";
    try {
      resolveCommand(bad2.positionals, bad2);
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain("未知子命令");
  });
});
