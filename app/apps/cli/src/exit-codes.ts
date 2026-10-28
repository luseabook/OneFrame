/**
 * 进程退出码（0..10 全套）。
 *
 * 契约来源：`_acceptance/_gap/cli-skill/reelmate-cli-skill/manual/error-codes.md:5-19`
 * ——退出码表示「脚本应采取的动作」，`error.kind` 表示错误类别，两者都不是后端业务码
 * 本身；后端业务码以响应里的 `code` 为准。
 *
 * 三条容易写错的规则（都有证据）：
 * 1. **permission 不是 3**。竞品明确 `error.kind=permission` 属于退出码 1，
 *    不是「未登录」（`manual/error-codes.md:21`）。所以 403 走 1。
 * 2. **未知错误与输出失败都是 1**（`manual/error-codes.md:19`）。
 * 3. **Ctrl-C 按取消处理，退出码 5**（`manual/error-codes.md:19`）。
 */
export const EXIT = {
  OK: 0,
  FAILURE: 1,
  USAGE: 2,
  AUTH: 3,
  TASK_FAILED: 4,
  CANCELED: 5,
  TIMEOUT: 6,
  INSUFFICIENT_CREDITS: 7,
  MODERATION_REJECTED: 8,
  VERSION_CONFLICT: 9,
  NODE_LOCKED: 10,
} as const;

export type ExitCode = (typeof EXIT)[keyof typeof EXIT];

/** 错误类别（envelope 的 `error.kind`）。竞品用到其中一个：`kind=usage`（deeplink.md:105） */
export type CliErrorKind =
  | "usage"
  | "auth"
  | "permission"
  | "not_found"
  | "task_failed"
  | "canceled"
  | "timeout"
  | "credits"
  | "moderation"
  | "version_conflict"
  | "node_locked"
  | "network"
  | "server"
  | "unsupported"
  | "internal";

export interface CodeMapping {
  kind: CliErrorKind;
  exit: ExitCode;
}

/**
 * 后端业务码 → (kind, 退出码) 的**唯一**映射表。
 *
 * 为什么不写成散落的 if-else：这张表是 CLI 与 API 的契约面，新增/调整一个业务码时
 * 必须只改这里一处；单测 `exit-codes.spec.ts` 逐条断言，避免「某个码忘了映射就默默
 * 变成 1」这种线上事故。业务码定义见 `packages/shared/src/errors.ts:4-42`。
 */
export const BUSINESS_CODE_MAP: Readonly<Record<number, CodeMapping>> = {
  // ── 400 参数 ──
  400100: { kind: "usage", exit: EXIT.USAGE },
  400101: { kind: "usage", exit: EXIT.USAGE },
  400102: { kind: "not_found", exit: EXIT.FAILURE },
  400103: { kind: "canceled", exit: EXIT.FAILURE }, // 终态任务不可取消：不是「已取消」
  400104: { kind: "usage", exit: EXIT.USAGE },
  400105: { kind: "task_failed", exit: EXIT.TASK_FAILED }, // 引用资产未定稿
  400106: { kind: "task_failed", exit: EXIT.TASK_FAILED }, // 成功镜不足拒绝导出
  400107: { kind: "usage", exit: EXIT.USAGE },
  400108: { kind: "permission", exit: EXIT.FAILURE },
  // ── 401 鉴权 ──
  401101: { kind: "auth", exit: EXIT.AUTH },
  401102: { kind: "auth", exit: EXIT.AUTH },
  // ── 403 权限：竞品明确不是 3（error-codes.md:21）──
  403101: { kind: "permission", exit: EXIT.FAILURE },
  // ── 429 频控 ──
  429100: { kind: "network", exit: EXIT.FAILURE },
  429101: { kind: "auth", exit: EXIT.AUTH },
  // ── 7457 计费 ──
  745701: { kind: "credits", exit: EXIT.INSUFFICIENT_CREDITS },
  745702: { kind: "usage", exit: EXIT.USAGE },
  745703: { kind: "credits", exit: EXIT.INSUFFICIENT_CREDITS },
  // ── 7458 内容安全 ──
  745801: { kind: "moderation", exit: EXIT.MODERATION_REJECTED },
  745802: { kind: "moderation", exit: EXIT.MODERATION_REJECTED },
  // ── 7459 供应商 ──
  745900: { kind: "task_failed", exit: EXIT.TASK_FAILED },
  745901: { kind: "timeout", exit: EXIT.TIMEOUT },
  // ── 7470 知识库 ──
  // 同名实体（迁移 0038 起：目录/标签按 scene 隔离后，同场景同名才算重名）。
  // 竞品码表里这是唯一一个「重名」专用码（`B9INZ4se.js`：`Number(r.code)===747007`），
  // 属调用方参数问题 → usage/2，不能落进 internal/1（那样脚本会当服务故障重试）。
  747007: { kind: "usage", exit: EXIT.USAGE },
  // ── 7460 冲突 ──
  746001: { kind: "internal", exit: EXIT.FAILURE }, // 幂等重放标记（正常路径不会到这里）
  746002: { kind: "version_conflict", exit: EXIT.VERSION_CONFLICT },
  746003: { kind: "node_locked", exit: EXIT.NODE_LOCKED },
  746004: { kind: "timeout", exit: EXIT.TIMEOUT },
  746005: { kind: "task_failed", exit: EXIT.TASK_FAILED },
  // ── 500 ──
  500000: { kind: "server", exit: EXIT.FAILURE },
};

/** 客户端错误类别 → 退出码（HTTP 层与本地错误走这张表） */
export const KIND_EXIT: Readonly<Record<CliErrorKind, ExitCode>> = {
  usage: EXIT.USAGE,
  auth: EXIT.AUTH,
  permission: EXIT.FAILURE,
  not_found: EXIT.FAILURE,
  task_failed: EXIT.TASK_FAILED,
  canceled: EXIT.CANCELED,
  timeout: EXIT.TIMEOUT,
  credits: EXIT.INSUFFICIENT_CREDITS,
  moderation: EXIT.MODERATION_REJECTED,
  version_conflict: EXIT.VERSION_CONFLICT,
  node_locked: EXIT.NODE_LOCKED,
  network: EXIT.FAILURE,
  server: EXIT.FAILURE,
  unsupported: EXIT.FAILURE,
  internal: EXIT.FAILURE,
};

/** HTTP 状态码 → (kind, 退出码)；业务码缺失时的兜底 */
export function mapHttpStatus(status: number): CodeMapping {
  if (status === 401) return { kind: "auth", exit: EXIT.AUTH };
  if (status === 403) return { kind: "permission", exit: EXIT.FAILURE };
  if (status === 404) return { kind: "not_found", exit: EXIT.FAILURE };
  if (status === 408) return { kind: "timeout", exit: EXIT.TIMEOUT };
  if (status === 429) return { kind: "network", exit: EXIT.FAILURE };
  if (status >= 500) return { kind: "server", exit: EXIT.FAILURE };
  if (status >= 400) return { kind: "usage", exit: EXIT.USAGE };
  return { kind: "internal", exit: EXIT.FAILURE };
}

/** 业务码 → 映射（未登记的码统一按「一般失败」处理，绝不静默成功） */
export function mapBusinessCode(code: number): CodeMapping {
  return BUSINESS_CODE_MAP[code] ?? { kind: "internal", exit: EXIT.FAILURE };
}
