import { existsSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { BUSINESS_CODE_MAP, EXIT, KIND_EXIT, type CliErrorKind } from "./exit-codes";
import { COMMANDS, GROUP_ORDER, type CommandSpec } from "./registry";
import { BIN_NAME, CLI_VERSION } from "./version";

/**
 * 随包分发的 Agent Skill 包（第 61 批）。
 *
 * 契约来源（竞品 CLI 文档包，`rea-reelmate/reelmate_cli_skill.zip` 解包件）：
 * - `INSTALL.md:17` / `INSTALL.md:44`：`<binary> skill-path` 打印**已安装 npm 包内**的
 *   Skill 目录；分发方式是「把该目录整份拷到宿主 Skill 目录」，且「不要与旧文件合并」。
 * - `SKILL.md:8`：「发布态只依赖当前二进制帮助、本 Skill 和随包命令文档」。
 * - `SKILL.md:41`：升级时「用 `skill-path` 整目录替换当前宿主 Skill」。
 *
 * 因此 Skill 包必须**随包**（`package.json` 的 `files` 含 `skills`），并且不能手写第二份
 * 命令清单——那必然与 `registry.ts` 漂移。这里的做法是：`commands/*.md` 与 `VERSION`
 * 全部由 `registry.ts` + `version.ts` 渲染（`scripts/gen-skill.cjs` 在 build 尾部执行），
 * 单测 `test/skill.spec.ts` 把「渲染结果」与「磁盘上的文件」逐字节比对，漂移即红。
 *
 * 只有两处是手写的：`SKILL.md` 的 `<HARD-GATE>` 段与路由表里「我方尚未落地」的说明，
 * 以及 `manual/user-guide.md`——这两处是**行为约束**而不是命令清单，生成不出来。
 */

export const SKILL_PKG_NAME = "oneframe-cli-skill";

/** 相对包根目录的 Skill 目录（`dist/skill.js` → `../skills/oneframe-cli-skill`） */
export const SKILL_DIR_FROM_DIST = join("skills", SKILL_PKG_NAME);

export function skillRootDir(): string {
  return join(__dirname, "..", SKILL_DIR_FROM_DIST);
}

/** 递归列出目录下所有文件（相对路径用 `/` 分隔，跨平台稳定）。 */
export function listFilesRecursive(root: string): string[] {
  if (!existsSync(root)) return [];
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else out.push(relative(root, full).split(sep).join("/"));
    }
  };
  walk(root);
  return out.sort();
}

// ── 语法与标识 ────────────────────────────────────────────────────────────

/** 命令标识：`oneframe <group> <cmd>`（cmd 为空时只有组名） */
export function commandId(spec: CommandSpec): string {
  return spec.cmd ? `${spec.group} ${spec.cmd}` : spec.group;
}

/** 一行语法（与 `--help` 的口径一致：位置参数必填用 `<>`，可选用 `[]`） */
export function commandSyntax(spec: CommandSpec): string {
  const parts: string[] = [BIN_NAME];
  if (spec.group) parts.push(spec.group);
  if (spec.cmd) parts.push(spec.cmd);
  for (const positional of spec.positionals ?? []) {
    parts.push(positional.required ? `<${positional.display}>` : `[${positional.display}]`);
  }
  if (spec.queryKeys?.length) parts.push("[--set KEY=VALUE]...");
  if (spec.write) {
    parts.push("[--set KEY=VALUE]...");
    parts.push("[--dry-run]");
    parts.push("[--idempotency-key KEY]");
  }
  parts.push("[--json]");
  return parts.join(" ");
}

function statusWord(spec: CommandSpec): string {
  if (!spec.ready) return "骨架（执行会明确报未接入，不伪造成功）";
  if (spec.impl) return "可用（纯客户端，不发请求）";
  return "可用（HTTP 端点已存在）";
}

// ── commands/<group>.md ──────────────────────────────────────────────────

export function renderCommandDoc(group: string, specs: readonly CommandSpec[]): string {
  const lines: string[] = [];
  lines.push(`# \`${group}\` 命令组`);
  lines.push("");
  lines.push(
    `> 本文件由 \`apps/cli/scripts/gen-skill.cjs\` 从 \`src/registry.ts\` 生成，**不要手改**；` +
      `改命令请改 registry 后重跑 \`pnpm --filter @app/cli build\`。`,
  );
  lines.push("");
  const ready = specs.filter((s) => s.ready).length;
  lines.push(`共 ${specs.length} 条命令：可用 ${ready} 条、骨架 ${specs.length - ready} 条。`);
  lines.push("");
  for (const spec of specs) {
    lines.push(`## \`${commandId(spec)}\``);
    lines.push("");
    lines.push(spec.summary);
    lines.push("");
    lines.push("```text");
    lines.push(commandSyntax(spec));
    lines.push("```");
    lines.push("");
    lines.push(`- 状态：${statusWord(spec)}`);
    if (!spec.ready && spec.reason) lines.push(`- 未接入原因：${spec.reason}`);
    if (spec.method && spec.path) lines.push(`- 端点：\`${spec.method} ${spec.path}\``);
    if (spec.queryKeys?.length) lines.push(`- \`--set\` 进 query 的白名单键：${spec.queryKeys.map((k) => `\`${k}\``).join("、")}`);
    if (spec.paid) lines.push("- 付费命令：先 `--dry-run` 看将发送的请求，再正式执行");
    lines.push(`- 契约证据：\`${spec.evidence}\``);
    lines.push("");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

// ── manual/error-codes.md ────────────────────────────────────────────────

const KIND_HINT: Readonly<Record<CliErrorKind, string>> = {
  usage: "参数写错或后端判为参数问题；看 `error.message` 改参数后重试",
  auth: "未登录或 token 失效；先 `oneframe login`",
  permission: "已登录但无权限（注意：退出码是 1 不是 3）",
  not_found: "对象不存在或已被删",
  task_failed: "任务失败（生成失败/资产未定稿/闸门拒绝），不是网络问题",
  canceled: "任务已取消或终态不可取消",
  timeout: "超时或游标过期；可重试，先看 `error.retryable`",
  credits: "积分不足或超预算；充值或调小批量后重试",
  moderation: "内容安全拒绝；换素材而不是重试",
  version_conflict: "版本冲突；重新拉取最新版本再改",
  node_locked: "节点被锁；等锁释放或换节点",
  network: "网络或频控问题；退避后重试",
  server: "服务端错误；先看是否可重试",
  unsupported: "该命令在我方尚未接入（骨架），不要当失败重试",
  internal: "未知错误；按一般失败处理，收集 stderr 报障",
};

export function renderErrorCodesMd(): string {
  const lines: string[] = [];
  lines.push("# 退出码与错误码");
  lines.push("");
  lines.push(
    `> 本文件由 \`gen-skill.cjs\` 从 \`src/exit-codes.ts\` 生成，**不要手改**；` +
      `改映射请改源码后重跑 \`pnpm --filter @app/cli build\`。`,
  );
  lines.push("");
  lines.push("## 两种码，别混");
  lines.push("");
  lines.push("- **退出码（0..10）** 表示「脚本下一步该做什么」。");
  lines.push("- **`error.kind`** 表示错误类别。");
  lines.push("- **后端业务码** 以响应 envelope 里的 `code` 为准（业务错误是 HTTP 200 + 非零 code）。");
  lines.push("");
  lines.push("## 退出码全集");
  lines.push("");
  lines.push("| 码 | 名称 | 含义 |");
  lines.push("| --- | --- | --- |");
  const exitNames: [string, number, string][] = [
    ["OK", EXIT.OK, "成功"],
    ["FAILURE", EXIT.FAILURE, "一般失败（未知错误、权限拒绝、not_found 也是 1）"],
    ["USAGE", EXIT.USAGE, "参数/用法错误"],
    ["AUTH", EXIT.AUTH, "未登录或凭据失效"],
    ["TASK_FAILED", EXIT.TASK_FAILED, "任务失败（不是网络问题）"],
    ["CANCELED", EXIT.CANCELED, "取消（含 Ctrl-C）"],
    ["TIMEOUT", EXIT.TIMEOUT, "超时/游标过期"],
    ["INSUFFICIENT_CREDITS", EXIT.INSUFFICIENT_CREDITS, "积分不足或超预算"],
    ["MODERATION_REJECTED", EXIT.MODERATION_REJECTED, "内容安全拒绝"],
    ["VERSION_CONFLICT", EXIT.VERSION_CONFLICT, "版本冲突"],
    ["NODE_LOCKED", EXIT.NODE_LOCKED, "节点被锁"],
  ];
  for (const [name, code, desc] of exitNames) lines.push(`| ${code} | \`${name}\` | ${desc} |`);
  lines.push("");
  lines.push("## `error.kind` → 退出码");
  lines.push("");
  lines.push("| kind | 退出码 | 处理建议 |");
  lines.push("| --- | --- | --- |");
  for (const [kind, exit] of Object.entries(KIND_EXIT) as [CliErrorKind, number][]) {
    lines.push(`| \`${kind}\` | ${exit} | ${KIND_HINT[kind]} |`);
  }
  lines.push("");
  lines.push("## 后端业务码 → 退出码");
  lines.push("");
  lines.push("| 业务码 | kind | 退出码 |");
  lines.push("| --- | --- | --- |");
  for (const code of Object.keys(BUSINESS_CODE_MAP)
    .map(Number)
    .sort((a, b) => a - b)) {
    const mapped = BUSINESS_CODE_MAP[code]!;
    lines.push(`| ${code} | \`${mapped.kind}\` | ${mapped.exit} |`);
  }
  lines.push("");
  lines.push("未登记的业务码按 `internal` / 退出码 1 处理，**绝不静默成功**。");
  return `${lines.join("\n").trimEnd()}\n`;
}

// ── manual/user-guide.md ─────────────────────────────────────────────────

export function renderUserGuideMd(): string {
  const total = COMMANDS.length;
  const ready = COMMANDS.filter((c) => c.ready).length;
  const lines: string[] = [];
  lines.push("# OneFrame CLI 使用指南");
  lines.push("");
  lines.push(`版本 ${CLI_VERSION}，共 ${GROUP_ORDER.length} 个命令组、${total} 条命令（可用 ${ready} 条）。`);
  lines.push("");
  lines.push("## 一次典型流程");
  lines.push("");
  lines.push("```text");
  lines.push(`${BIN_NAME} login                      # 手机号验证码登录（可 --token-file / stdin）`);
  lines.push(`${BIN_NAME} workspace create --set name=我的项目`);
  lines.push(`${BIN_NAME} workspace use <PROJECT_ID>`);
  lines.push(`${BIN_NAME} upload <剧本文件>`);
  lines.push(`${BIN_NAME} episode list --workspace <PROJECT_ID>`);
  lines.push(`${BIN_NAME} storyboard batch-generate <EPISODE_ID> --workspace <PROJECT_ID>`);
  lines.push(`${BIN_NAME} task wait <TASK_ID>`);
  lines.push("```");
  lines.push("");
  lines.push("## 三条硬规则");
  lines.push("");
  lines.push("1. **stdout 只读业务数据**：成功是 `{ok:true,data,links}`，失败是 `{ok:false,error}`；");
  lines.push("   进度与人类可读摘要一律写 stderr。脚本请一律加 `--json`。");
  lines.push("2. **付费写操作先 `--dry-run`**：dry-run 不发任何请求，只打印将发送的方法/路径/体。");
  lines.push("3. **写操作可带 `--idempotency-key`**：同键重放会短路返回上次结果，不会重复扣费。");
  lines.push("");
  lines.push("## 想看某条命令");
  lines.push("");
  lines.push("```text");
  lines.push(`${BIN_NAME} --help`);
  lines.push(`${BIN_NAME} <group> --help`);
  lines.push(`${BIN_NAME} <group> <cmd> --help`);
  lines.push("```");
  lines.push("");
  lines.push("骨架命令（执行会返回 `kind=unsupported` 并说明缺什么）不是「暂时没跑通」，");
  lines.push("它们对应的后端端点我方还没有，**不要重试**。");
  return `${lines.join("\n").trimEnd()}\n`;
}

// ── SKILL.md（手写骨架 + 生成的命令总览）────────────────────────────────

function renderGroupOverview(): string[] {
  const lines: string[] = [];
  lines.push("| 命令组 | 命令数 | 可用 | 骨架 | 读这条 |");
  lines.push("| --- | --- | --- | --- | --- |");
  for (const group of GROUP_ORDER) {
    const specs = COMMANDS.filter((c) => c.group === group);
    if (specs.length === 0) continue;
    const ready = specs.filter((s) => s.ready).length;
    lines.push(`| \`${group}\` | ${specs.length} | ${ready} | ${specs.length - ready} | \`commands/${group}.md\` |`);
  }
  return lines;
}

export function renderSkillMd(): string {
  const total = COMMANDS.length;
  const ready = COMMANDS.filter((c) => c.ready).length;
  const lines: string[] = [];
  lines.push("---");
  lines.push(`name: ${SKILL_PKG_NAME}`);
  lines.push(
    "description: 调用 oneframe 写入 OneFrame 项目或无限画布，或询问 OneFrame / oneframe CLI " +
      "怎么用、有哪些功能、使用教程、能做什么、新手引导时使用：绑定或建项、导入剧本、拆分镜、" +
      "生成与重跑图视频、查积分流水、导出成片。只要文案或方案、不跑 CLI、也不是使用咨询时不使用。",
  );
  lines.push("---");
  lines.push("");
  lines.push("# OneFrame CLI Skill");
  lines.push("");
  lines.push(
    `发布态只依赖三样东西：当前二进制的 \`--help\`、本文件、以及随包文档（\`manual/\`、\`commands/\`）。` +
      `不要引用任何外部文档站或截图。`,
  );
  lines.push("");
  lines.push(`本包版本 **${CLI_VERSION}**（\`VERSION\`），命令 ${total} 条、可用 ${ready} 条。`);
  lines.push("");
  lines.push("## <HARD-GATE>");
  lines.push("");
  lines.push("1. **纯咨询不要执行命令**：只读 `manual/user-guide.md` 并原样转述，不要跑 CLI、不要伪造输出。");
  lines.push("2. **执行前先定一个场景文档**：按下面「路由」表选定**恰好一个**，读它，再读它引用的 `commands/*.md`。");
  lines.push("3. **执行契约只读 `manual/error-codes.md` 与 `--help` 的实际输出**，不要凭记忆补参数名。");
  lines.push("4. **进度分母来自 `commands/*.md` 里写死的命令，不要临场发明步数**；`<HARD-GATE>` 里没写的步骤不要加。");
  lines.push("5. **骨架命令不是失败**：`kind=unsupported` 表示我方还没有该端点。如实说明缺口，不要换个写法硬凑。");
  lines.push("6. **Agent 的本地中间文件只写 `./outputs/`**，不要污染仓库工作区。");
  lines.push("7. **积分不足/超预算只报「余额不足」**：不要把 `workspace_id`/`canvas_id`/`node_id`/`task_id` 这类内部常量贴给用户。");
  lines.push("8. **付费写操作先 `--dry-run`**：dry-run 不发请求；确认无误后去掉再执行。");
  lines.push("");
  lines.push("## 路由（选一个，不要全读）");
  lines.push("");
  lines.push("| 用户想要 | 读这个 |");
  lines.push("| --- | --- |");
  lines.push("| 「怎么用 / 能做什么」纯咨询 | `manual/user-guide.md` |");
  lines.push("| 建项目、导剧本、拆集 | `commands/workspace.md` → `commands/upload.md` → `commands/episode.md` |");
  lines.push("| AI 拆分镜 / 改分镜 | `commands/storyboard.md` |");
  lines.push("| 资产提取、资产匹配、主体 | `commands/resource.md`、`commands/subject.md` |");
  lines.push("| 生成图片 / 视频 | `commands/node.md`、`commands/task.md` |");
  lines.push("| 画布与节点编排 | `commands/canvas.md`、`commands/node.md`、`commands/edge.md` |");
  lines.push("| 查积分与流水 | `commands/credits.md` |");
  lines.push("| 导出成片 | `commands/export.md` |");
  lines.push("| 报错排障 | `manual/error-codes.md` |");
  lines.push("| 安装 / 升级 / 让某个 Agent 用上本 Skill | `INSTALL.md` |");
  lines.push("");
  lines.push("## 命令组总览（自动生成）");
  lines.push("");
  lines.push(...renderGroupOverview());
  lines.push("");
  lines.push("## stdout / stderr 契约");
  lines.push("");
  lines.push("- 一律加 `--json`：stdout 只有**一个** envelope，`{ok:true,data,links}` 或 `{ok:false,error}`。");
  lines.push("- 进度、人类可读摘要、`[warn]` 全部走 stderr。");
  lines.push("- 退出码见 `manual/error-codes.md`：脚本分支只看退出码，不要再解析文案。");
  lines.push("");
  lines.push("## 升级");
  lines.push("");
  lines.push(
    `发现新版本时：先完成本轮付费写操作，再按 \`INSTALL.md\` 钉死版本重装，然后执行 ` +
      `\`${BIN_NAME} skill-path\` 得到新目录，**整目录替换**宿主里的 \`${SKILL_PKG_NAME}\`（先删后拷，` +
      "不要与旧文件合并）。",
  );
  return `${lines.join("\n").trimEnd()}\n`;
}

// ── INSTALL.md ──────────────────────────────────────────────────────────

export function renderInstallMd(): string {
  const lines: string[] = [];
  lines.push("# 安装 OneFrame CLI Skill");
  lines.push("");
  lines.push(
    `CLI 与配套 Skill 都在同一个 npm 包里（\`@app/cli\`，当前版本 **${CLI_VERSION}**）。` +
      "Skill **不要**从别处下载或手动拼装——它必须与二进制同版本，否则命令清单会对不上。",
  );
  lines.push("");
  lines.push("## Agent 步骤");
  lines.push("");
  lines.push("1. 确认本机有 `npm` 与 Node.js 18+；否则停止并请用户先安装。");
  lines.push(`2. 安装 CLI（此包当前为私有包，用 workspace 内 \`pnpm --filter @app/cli build\` 得到 \`dist/\`）。`);
  lines.push(`3. 执行 \`${BIN_NAME} skill-path\`，得到**已安装包内**的 Skill 目录。`);
  lines.push("4. 按**当前宿主**的规则定位用户 Skill 目录。不要扫描其他工具的配置目录。");
  lines.push(
    `5. 若已有同名 \`${SKILL_PKG_NAME}\`，先**整目录删除**再把 \`skill-path\` 指出的目录拷入。` +
      "**禁止与旧文件合并**（旧文件残留会让命令清单漂移）。",
  );
  lines.push(`6. 执行 \`${BIN_NAME} --version\` 与 \`${BIN_NAME} --help\`，版本必须与拷贝来的 \`VERSION\` 一致。`);
  lines.push("7. 报告 CLI 版本、二进制路径、Skill 安装路径。");
  lines.push("8. **登录由 Agent 亲自执行**，不要甩给用户：");
  lines.push(`   - 先探测 \`${BIN_NAME} account info --json\`；stdout 已含 \`credentialStore\` 则跳过。`);
  lines.push(`   - 否则在**可交互、能开浏览器并回调本机 loopback** 的终端执行 \`${BIN_NAME} login\`。`);
  lines.push("   - 宿主沙箱拦截 loopback 或浏览器时申请提权后重试；**禁止**把「请用户自己跑 login」当安装完成。");
  lines.push("");
  lines.push("当前宿主不支持 Skills 时：仍安装 CLI 并按需完成登录，并明确报告 Skill 未落地。");
  lines.push("");
  lines.push("## 人手工安装");
  lines.push("");
  lines.push("```text");
  lines.push(`pnpm --filter @app/cli build`);
  lines.push(`node apps/cli/dist/index.js skill-path`);
  lines.push(`node apps/cli/dist/index.js --version`);
  lines.push("```");
  lines.push("");
  lines.push("## 重复执行即升级");
  lines.push("");
  lines.push(
    `已装过也必须重跑安装，再用 \`${BIN_NAME} skill-path\` **整目录替换**当前宿主 Skill。` +
      "「本机已有旧版」不是跳过理由；升级后凭据仍在时不必重复 login。",
  );
  return `${lines.join("\n").trimEnd()}\n`;
}

// ── 全量渲染（供生成脚本与漂移测试共用）───────────────────────────────────

export function renderAllFiles(): Map<string, string> {
  const files = new Map<string, string>();
  files.set("SKILL.md", renderSkillMd());
  files.set("INSTALL.md", renderInstallMd());
  files.set("VERSION", `${CLI_VERSION}\n`);
  files.set("manual/user-guide.md", renderUserGuideMd());
  files.set("manual/error-codes.md", renderErrorCodesMd());
  for (const group of GROUP_ORDER) {
    const specs = COMMANDS.filter((c) => c.group === group);
    if (specs.length === 0) continue;
    files.set(`commands/${group}.md`, renderCommandDoc(group, specs));
  }
  return files;
}
