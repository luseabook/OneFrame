import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { COMMANDS, GROUP_ORDER } from "../src/registry";
import { commandId, commandSyntax, listFilesRecursive, renderAllFiles, skillRootDir } from "../src/skill";
import { CLI_VERSION } from "../src/version";
import { harness } from "./helpers";

/**
 * 随包 Skill 包（第 61 批）。
 *
 * 契约来源：竞品 `INSTALL.md:17/44`（`skill-path` 打印已安装包内的 Skill 目录，
 * 「整目录拷贝、不要合并」）与 `SKILL.md:8/41`（发布态只依赖二进制帮助 + 本 Skill +
 * 随包命令文档；升级用 `skill-path` 整目录替换）。
 *
 * 这组断言的重点不是「文件存在」，而是**不许漂移**：
 * 命令文档由 registry 渲染，任何一条命令改了而没重新生成，或者生成脚本改了渲染格式
 * 却没提交产物，这里都会红。
 */
describe("随包 Skill 包", () => {
  const root = skillRootDir();

  it("磁盘产物与 registry 渲染结果逐字节一致（防漂移）", () => {
    const rendered = renderAllFiles();
    const onDisk = listFilesRecursive(root);
    // 双向比对：少了 = 没生成；多了 = 手写的野文件（旧版残留最危险的正是这一类）
    expect(onDisk).toEqual([...rendered.keys()].sort());
    for (const [rel, content] of rendered) {
      expect(readFileSync(join(root, rel), "utf8"), `${rel} 内容与 registry 不一致，请重跑 pnpm --filter @app/cli build`).toBe(content);
    }
  });

  it("SKILL.md 有 name/description frontmatter，且版本与 VERSION 一致", () => {
    const skill = readFileSync(join(root, "SKILL.md"), "utf8");
    expect(skill.startsWith("---\n")).toBe(true);
    expect(skill).toContain("name: oneframe-cli-skill");
    expect(skill).toMatch(/description: 调用 oneframe 写入/);
    expect(readFileSync(join(root, "VERSION"), "utf8").trim()).toBe(CLI_VERSION);
    expect(skill).toContain(`本包版本 **${CLI_VERSION}**`);
  });

  it("每条 registry 命令至少出现在一个 commands/<group>.md 里（覆盖不漏）", () => {
    const docs = GROUP_ORDER.filter((group) => existsSync(join(root, "commands", `${group}.md`)))
      .map((group) => readFileSync(join(root, "commands", `${group}.md`), "utf8"))
      .join("\n");
    const missing = COMMANDS.filter((spec) => !docs.includes(`## \`${commandId(spec)}\``)).map(commandId);
    expect(missing).toEqual([]);
    // 骨架命令必须写明「未接入」而不是只列语法，否则 Agent 会当成可用命令去执行
    const skeleton = COMMANDS.filter((c) => !c.ready);
    for (const spec of skeleton.slice(0, 12)) {
      expect(docs).toContain(spec.summary);
    }
  });

  it("manual/error-codes.md 覆盖退出码全集与新增的 747007 重名码", () => {
    const doc = readFileSync(join(root, "manual", "error-codes.md"), "utf8");
    for (const name of ["OK", "USAGE", "AUTH", "TASK_FAILED", "CANCELED", "TIMEOUT", "INSUFFICIENT_CREDITS", "MODERATION_REJECTED", "VERSION_CONFLICT", "NODE_LOCKED"]) {
      expect(doc).toContain(`\`${name}\``);
    }
    // 第 60 批新增的业务码必须在 CLI 侧有映射，否则会落进 internal/1 让脚本误判成服务故障
    expect(doc).toContain("747007");
    // 反直觉点必须有文档：权限拒绝是退出码 1 而不是 3
    expect(doc).toContain("退出码是 1 不是 3");
  });

  it("skill path --json 打印包内 Skill 目录，不改配置、不发请求", async () => {
    const { code, output, calls } = await harness(["skill", "path", "--json"]);
    expect(code).toBe(0);
    expect(calls).toEqual([]);
    const data = output.data as Record<string, unknown>;
    expect(data.skill).toBe("oneframe-cli-skill");
    expect(data.installed).toBe(true);
    expect(data.version).toBe(CLI_VERSION);
    expect(data.groups).toBe(GROUP_ORDER.length);
    expect(data.commands).toBe(COMMANDS.length);
    const path = String(data.path);
    expect(existsSync(join(path, "SKILL.md"))).toBe(true);
    expect(existsSync(join(path, "manual", "error-codes.md"))).toBe(true);
    // 目录必须是「包内」而不是用户配置目录——否则宿主拷走的是空壳
    expect(path).toContain(join("skills", "oneframe-cli-skill"));
  });

  it("--help 里能看到 skill path，且语法行正确", async () => {
    const spec = COMMANDS.find((c) => c.group === "skill" && c.cmd === "path");
    expect(spec).toBeDefined();
    expect(spec!.ready).toBe(true);
    expect(spec!.evidence).toBe("INSTALL.md:17");
    expect(commandSyntax(spec!)).toBe("oneframe skill path [--json]");
    const { code, output } = await harness(["skill", "--help", "--json"]);
    // --help 走纯文本分支，不进 envelope
    expect(code).toBe(0);
    expect(JSON.stringify(output)).toContain("parse_error");
  });
});
