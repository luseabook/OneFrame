import { flagString, type ParsedArgs } from "./args";
import { CliError, usageError } from "./errors";
import { commandsOfGroup, GROUP_ORDER, isKnownGroup, type CommandSpec } from "./registry";
import { BIN_NAME, CLI_VERSION } from "./version";

/** 组的一句话说明（`--help` 顶层用） */
const GROUP_SUMMARY: Record<string, string> = {
  login: "登录并保存凭据",
  logout: "注销并删除本地凭据",
  account: "账号与空间",
  env: "环境与作用域诊断",
  cache: "本地可重建缓存",
  version: "版本",
  workflow: "阶段探测与断点续跑",
  model: "模型目录",
  task: "异步任务",
  credits: "积分余额/流水/试算",
  workspace: "工作区（我方 = 项目）",
  episode: "剧集",
  storyboard: "分镜",
  upload: "上传剧本",
  resource: "资产（asset-core 批次）",
  subject: "主体（subject 批次）",
  "asset-lib": "资产库",
  file: "文件",
  canvas: "画布",
  node: "画布节点/连线",
  group: "画布组",
  "pin-group": "固定组",
  material: "画布素材",
  script: "画布脚本链路",
  export: "导出成片",
  deeplink: "网页深链（离线）",
  ledger: "本地幂等账本",
  team: "团队",
  agent: "智能体会话",
  novel: "小说改写（novel 批次）",
  market: "市场（market 批次）",
  ad: "广告（ad 批次）",
  redraw: "重绘（redraw 批次）",
  ai: "AI 工具（ai 批次）",
  clip: "剪辑（clip 批次）",
  voice: "音色（voice 批次）",
  "sync-fm": "同步 Filmora（外部集成）",
};

const statusTag = (spec: CommandSpec): string => (spec.ready ? "" : "  [骨架]");

function positionalHint(spec: CommandSpec): string {
  const parts = (spec.positionals ?? []).map((p) =>
    p.required ? `<${p.display}>` : `[${p.display}]`,
  );
  return parts.length > 0 ? ` ${parts.join(" ")}` : "";
}

function commandLine(spec: CommandSpec): string {
  const head = spec.cmd ? `${spec.group} ${spec.cmd}` : spec.group;
  return `${head}${positionalHint(spec)}`;
}

export function topLevelHelp(): string {
  const lines: string[] = [
    `${BIN_NAME} ${CLI_VERSION} —— OneFrame CLI（API 的薄壳，不新增业务逻辑）`,
    "",
    "用法：",
    `  ${BIN_NAME} <命令组> <子命令> [参数] [--json] [--dry-run] [--idempotency-key KEY]`,
    `  ${BIN_NAME} <命令组> --help`,
    "",
    "全局选项：",
    "  --json               stdout 只输出一个可 JSON.parse 的 envelope",
    "  --dry-run            写命令只打印将发送的请求，不发请求（退出码 0）",
    "  --idempotency-key K  写命令透传 Idempotency-Key 头（同键重放受本地账本保护）",
    "  --space ID           指定空间（默认取当前凭据空间）",
    "  --workspace ID       指定工作区/项目（= 竞品 --workspace）",
    "  --canvas ID          指定画布",
    "  --api-url URL        覆盖 API 根地址",
    "",
    "命令组：",
  ];
  for (const group of GROUP_ORDER) {
    const specs = commandsOfGroup(group);
    if (specs.length === 0) continue;
    const ready = specs.filter((s) => s.ready).length;
    const tag = ready === 0 ? "全部骨架" : ready === specs.length ? `${specs.length} 条` : `${ready}/${specs.length} 条可用`;
    lines.push(`  ${group.padEnd(12)} ${(GROUP_SUMMARY[group] ?? "").padEnd(24)} ${tag}`);
  }
  lines.push(
    "",
    "退出码（manual/error-codes.md:5-19）：",
    "  0 成功 · 1 一般失败 · 2 参数错 · 3 鉴权 · 4 任务失败 · 5 任务取消",
    "  6 等待超时 · 7 积分不足 · 8 审核未通过 · 9 画布版本冲突 · 10 节点锁竞争",
    "",
    "MCP：竞品只有宣传无工具清单（证据缺口），本批不做臆造实现，见 README「待取证」。",
  );
  return `${lines.join("\n")}\n`;
}

export function groupHelp(group: string): string {
  const specs = commandsOfGroup(group);
  if (specs.length === 0 || !isKnownGroup(group)) {
    throw usageError(`未知命令组：${group}（运行 ${BIN_NAME} --help 查看全部）`);
  }
  const lines = [`${BIN_NAME} ${group} —— ${GROUP_SUMMARY[group] ?? ""}`, "", "子命令："];
  for (const spec of specs) {
    lines.push(`  ${commandLine(spec)}${statusTag(spec)}`);
    lines.push(`      ${spec.summary}  ← ${spec.evidence}`);
    if (!spec.ready && spec.reason) lines.push(`      未落地原因：${spec.reason}`);
  }
  lines.push("", `运行 ${BIN_NAME} ${group} <子命令> --help 查看单条详情。`);
  return `${lines.join("\n")}\n`;
}

export function commandHelp(spec: CommandSpec): string {
  const lines = [
    `${BIN_NAME} ${commandLine(spec)}`,
    "",
    spec.summary,
    `证据：${spec.evidence}`,
    "",
  ];
  if (spec.positionals && spec.positionals.length > 0) {
    lines.push("位置参数：");
    for (const p of spec.positionals) {
      lines.push(`  ${p.display.padEnd(16)} ${p.desc}${p.required ? "（必填）" : ""}`);
    }
    lines.push("");
  }
  if (spec.ready) {
    if (spec.method) lines.push(`请求：${spec.method} ${spec.path ?? ""}`, "");
    lines.push(
      "选项：--json  --help" + (spec.write ? "  --dry-run  --idempotency-key KEY" : ""),
      spec.write ? "写命令：--set key=value 进请求体；--dry-run 只打印将发送的请求。" : "",
    );
  } else {
    lines.push(`状态：骨架（未落地）`, `原因：${spec.reason ?? "依赖批次未落地"}`, "");
  }
  return `${lines.filter((line) => line !== "").join("\n")}\n`;
}

export interface Resolved {
  spec: CommandSpec;
  args: string[];
}

/**
 * 组 + 子命令解析。
 *
 * 三级语法的压平规则见 registry.ts 文件头；另有两条竞品特例：
 * - `node --left A --right B`（无子命令）等价 `node edge`（commands/edge.md:8）
 * - `export EPISODE_ID` / `upload PATH` 走组级默认命令（cmd=""）
 */
export function resolveCommand(positionals: readonly string[], parsed: ParsedArgs): Resolved {
  const group = positionals[0];
  if (!group) throw usageError("缺少命令组（运行 oneframe --help）");
  const specs = commandsOfGroup(group);
  if (specs.length === 0) {
    throw usageError(`未知命令组：${group}（运行 ${BIN_NAME} --help 查看全部）`);
  }

  // 特例：node 无子命令且带 --left/--right → node edge
  if (group === "node" && positionals.length === 1) {
    const left = flagString(parsed, "left") ?? flagString(parsed, "left-add");
    if (left || flagString(parsed, "right")) {
      const edge = specs.find((s) => s.cmd === "edge");
      if (edge) return { spec: edge, args: [] };
    }
  }

  const candidate = positionals[1];
  const byName = candidate ? specs.find((s) => s.cmd === candidate) : undefined;
  if (byName) return { spec: byName, args: positionals.slice(2) };

  const groupDefault = specs.find((s) => s.cmd === "");
  if (groupDefault) return { spec: groupDefault, args: positionals.slice(1) };

  if (candidate === undefined) {
    throw new CliError("usage", `${group} 需要子命令：${specs.map((s) => s.cmd).join(" | ")}`, {
      raw: { group, subcommands: specs.map((s) => s.cmd) },
    });
  }
  throw new CliError("usage", `未知子命令：${group} ${candidate}`, {
    raw: { group, subcommand: candidate, known: specs.map((s) => s.cmd) },
  });
}

export { GROUP_SUMMARY, commandLine };
