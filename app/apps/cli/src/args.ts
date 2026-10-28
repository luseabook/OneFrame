import { usageError } from "./errors";

/**
 * 参数解析。
 *
 * 竞品 CLI 的参数面只有四种形态（证据见各 `commands/*.md` 的「用法」块）：
 * 1. 位置参数：`workspace info WORKSPACE_ID`（`commands/workspace.md:10`）
 * 2. 取值选项：`--workspace SP_ID` / `--timeout 2h`（`commands/task.md:85`）
 * 3. 布尔选项：`--json` / `--dry-run` / `--open`（`commands/deeplink.md:49`）
 * 4. 键值对选项：`--set key=value`，可重复，值可以是 JSON（`commands/storyboard.md:33`）；
 *    另有 `--update k=v`（`commands/node.md:12`）与批量文件形式 `--set @file.json`
 *    （`commands/episode.md:22`）
 *
 * 设计取舍：**不猜**。未知 `--flag` 一律报 usage 错误（退出码 2），而不是当成位置参数
 * 吞掉——CLI 里静默吞参数会让 `--dry-run` 拼错时真扣费。
 */

/** 需要取值的选项（与 `commands/*.md` 中出现的形态一一对应） */
export const VALUE_FLAGS: ReadonlySet<string> = new Set([
  "space",
  "workspace",
  "canvas",
  "episode",
  "node",
  "name",
  "from",
  "scope",
  "type",
  "sp-type",
  "timeout",
  "idempotency-key",
  "account",
  "credential-store",
  "token-file",
  "code",
  "phone",
  "asset-id",
  "export-id",
  "storyboard",
  "group",
  "data-center",
  "navigation-source",
  "task-id",
  "left",
  "right",
  "left-add",
  "left-rm",
  "sheet",
  "material-type",
  "source",
  "require",
  "force-replay",
  "output",
  "api-url",
  "config-dir",
  "mode",
  "capability",
  "status",
  "limit",
  "path",
  "slot",
  "template-id",
  "session-id",
  "key",
  "node-type",
]);

/** 布尔选项 */
export const BOOLEAN_FLAGS: ReadonlySet<string> = new Set([
  "json",
  "ndjson",
  "help",
  "version",
  "dry-run",
  "handoff",
  "no-browser",
  "open",
  "global",
  "in-doubt",
  "follow",
  "offline-models",
  "all",
  "yes",
  "force",
  "no-idempotency-guard",
  "quiet",
  "verbose",
]);

export interface ParsedArgs {
  /** 非选项参数（命令组/子命令/业务 ID） */
  positionals: string[];
  /** 单值选项；布尔选项为 true，`--xxx=false` 记为 false */
  flags: Record<string, string | boolean>;
  /** `--set k=v` 累积结果；值经过标量/JSON 强转 */
  sets: Record<string, unknown>;
  /** `--update k=v` 累积结果（语义与 --set 相同，仅竞品命名不同） */
  updates: Record<string, unknown>;
  /** `--set @file.json`：批量载荷文件（相对 cwd） */
  batchFile?: string;
  help: boolean;
  json: boolean;
}

/**
 * 超 `Number.MAX_SAFE_INTEGER` 的裸整数（我方 id 是 18 位雪花）先加引号，再交给
 * `JSON.parse`。
 *
 * 为什么必须这样：`JSON.parse("108760122495598592")` 会**静默把尾数改掉**
 * （→ `108760122495598590`），因为 IEEE-754 双精度只有 53 位有效整数；而服务端
 * 对 id 一律用 `z.string()`，拿到数字还会直接 400101 `Expected string, received
 * number`（第 70 批跑 `ad script --set brief_id=<真实 id>` 时实测命中）。
 *
 * 两条约束共同的效果是：`--set` 里的 id **只能是字符串**。与其要求在帮助里写
 * "id 记得加引号"，不如在解析层按「能否被 JS 精确表示」自动判定——短数字
 * （`count=2`、`duration_s=5`）仍是数字，安全整数（`9007199254740991`）也仍是数字，
 * 只有真正表示不了的才变字符串。
 */
const BIG_INT_RUN = /(?<![\w."-])(\d{16,})(?![\d."])/g;
const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);

/**
 * `--set` 的值强转：能按 JSON 解析就用 JSON，否则保留字符串。
 * 这样 `--set nums=[1]` 得到数组、`--set ratio=9:16` 得到字符串 `"9:16"`、
 * `--set qty=1` 得到数字 1——与竞品「值可以是 JSON」一致，且不需要为每个键写规则。
 * 例外见 {@link BIG_INT_RUN}：超 `Number.MAX_SAFE_INTEGER` 的整数字面量保持字符串。
 */
export function coerceScalar(raw: string): unknown {
  const text = raw.trim();
  if (text === "") return "";
  try {
    const guarded = text.replace(BIG_INT_RUN, (run) => (BigInt(run) > MAX_SAFE ? `"${run}"` : run));
    return JSON.parse(guarded) as unknown;
  } catch {
    return raw;
  }
}

function splitKv(token: string, flag: string): [string, string] {
  const at = token.indexOf("=");
  if (at <= 0) throw usageError(`${flag} expects key=value, got "${token}"`, { flag });
  const key = token.slice(0, at).trim();
  const value = token.slice(at + 1);
  if (!key) throw usageError(`${flag} expects a non-empty key`, { flag });
  return [key, value];
}

export function parseArgv(argv: readonly string[]): ParsedArgs {
  const parsed: ParsedArgs = {
    positionals: [],
    flags: {},
    sets: {},
    updates: {},
    help: false,
    json: false,
  };
  let i = 0;
  let literal = false;
  while (i < argv.length) {
    const token = argv[i];
    if (literal) {
      parsed.positionals.push(token);
      i += 1;
      continue;
    }
    if (token === "--") {
      literal = true;
      i += 1;
      continue;
    }
    if (token === "-h") {
      parsed.help = true;
      i += 1;
      continue;
    }
    if (!token.startsWith("--") || token === "--") {
      parsed.positionals.push(token);
      i += 1;
      continue;
    }

    // `--name=value` 与 `--name value` 两种写法等价
    const eq = token.indexOf("=");
    const name = (eq === -1 ? token.slice(2) : token.slice(2, eq)).trim();
    const inlineValue = eq === -1 ? undefined : token.slice(eq + 1);

    if (name === "set" || name === "update") {
      let pair = inlineValue;
      if (pair === undefined) {
        i += 1;
        if (i >= argv.length) throw usageError(`--${name} expects key=value`, { flag: name });
        pair = argv[i];
      }
      if (pair.startsWith("@")) {
        if (parsed.batchFile) throw usageError("only one --set @file is allowed", { flag: name });
        parsed.batchFile = pair.slice(1);
        i += 1;
        continue;
      }
      const [key, value] = splitKv(pair, `--${name}`);
      if (name === "set") parsed.sets[key] = coerceScalar(value);
      else parsed.updates[key] = coerceScalar(value);
      i += 1;
      continue;
    }

    if (VALUE_FLAGS.has(name)) {
      const value = inlineValue ?? argv[i + 1];
      if (value === undefined || (inlineValue === undefined && value.startsWith("--"))) {
        throw usageError(`--${name} expects a value`, { flag: name });
      }
      parsed.flags[name] = value;
      i += inlineValue === undefined ? 2 : 1;
      continue;
    }

    if (BOOLEAN_FLAGS.has(name)) {
      if (inlineValue !== undefined) {
        parsed.flags[name] = !/^(false|0|no)$/i.test(inlineValue);
      } else {
        parsed.flags[name] = true;
      }
      if (name === "json") parsed.json = Boolean(parsed.flags[name]);
      if (name === "ndjson") parsed.json = true; // ndjson 也是机器可读输出
      i += 1;
      continue;
    }

    // `--no-<bool>` 形态（如 --no-idempotency-guard 已在 BOOLEAN_FLAGS 中显式登记）
    throw usageError(`unknown option --${name}`, { flag: name });
  }

  if (parsed.flags.help === true) parsed.help = true;
  return parsed;
}

/** 取字符串选项（布尔或缺失时返回 undefined） */
export function flagString(parsed: ParsedArgs, name: string): string | undefined {
  const value = parsed.flags[name];
  return typeof value === "string" ? value : undefined;
}

export function flagBool(parsed: ParsedArgs, name: string): boolean {
  return parsed.flags[name] === true;
}
