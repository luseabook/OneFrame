// 错误码分段（api-spec §1）。段规划：400 参数 / 401 鉴权 / 403 权限 / 429 频控
// 7457 计费 / 7458 内容安全 / 7459 供应商 / 7460 冲突 / 7470 知识库（第 60 批）
// 注意：完整码表以 docs/02-architecture/api-spec.md §1 为唯一权威，本文件保持同步。
export const ErrorCode = {
  OK: 0,

  BAD_REQUEST: 400100,
  INVALID_PARAM: 400101,
  NOT_FOUND: 400102,
  CANCEL_NOT_ALLOWED: 400103, // 终态任务不可取消
  SOURCE_TOO_LONG: 400104, // 小说/剧本原文超 5 万字
  ASSET_NOT_READY: 400105, // 引用资产未定稿
  EXPORT_INCOMPLETE: 400106, // 成功镜 <80%，拒绝全集导出
  QUOTE_REQUIRED: 400107, // 批量投递缺批量报价（预算来源）
  TEAM_SEAT_EXCEEDED: 400108, // 团队席位数已满（邀请/绑定成员时）

  UNAUTHORIZED: 401101,
  TOKEN_EXPIRED: 401102,

  FORBIDDEN: 403101,

  RATE_LIMITED: 429100,
  CAPTCHA_REQUIRED: 429101,

  INSUFFICIENT_BALANCE: 745701, // 与竞品同义码对齐，便于对照排查
  QUOTE_MISMATCH: 745702,
  BUDGET_EXCEEDED: 745703, // 自造码：预算触顶（逐镜部分成功，与 745701 区分）

  INPUT_REJECTED: 745801,
  OUTPUT_REJECTED: 745802,

  VENDOR_ERROR: 745900,
  VENDOR_TIMEOUT: 745901,

  // 7462xx：机队 / 自带算力（BYOC）。设计见 docs/02-architecture/autodl-integration.md §2.6
  FLEET_TOKEN_INVALID: 746201, // Token 失效/无权限，需重新绑定
  FLEET_TOKEN_REQUIRED: 746202, // 选了自带算力档但未绑定账号
  FLEET_QUOTA_EXCEEDED: 746203, // 平台配额/库存不足
  FLEET_PROVISION_FAILED: 746204, // 创建/开机失败
  FLEET_NODE_TIMEOUT: 746205, // 节点无法在时限内就绪
  FLEET_BUDGET_EXCEEDED: 746206, // 用户自设预算触顶
  FLEET_IMAGE_NOT_READY: 746207, // 运行环境未构建（首次需 build + save_image）
  FLEET_PROVIDER_ERROR: 746208, // 云平台返回非 Success

  IDEMPOTENT_REPLAY: 746001,
  VERSION_CONFLICT: 746002, // Ph3 画布；对应 RE CLI exit 9
  NODE_LOCKED: 746003, // Ph3 画布；对应 RE CLI exit 10
  STREAM_CURSOR_EXPIRED: 746004, // SSE 续传游标失效，客户端须全量重建后重连
  AGENT_TURN_IN_FLIGHT: 746005, // 同会话已有在途轮次（仅在显式 ?wait=1 时返回）

  // 7470xx：知识库（第 60 批）。码值取自竞品前端 bundle 原文：
  // `return Number(r.code)===747007?!0:\`${r.message||""} ${r.msg||""}\`.toLowerCase().includes("knowledge name already exists")`
  // —— 竞品对"知识库模板重名"既有专用码，又保留文案兜底，说明该码在服务端就是这一语义。
  KNOWLEDGE_NAME_EXISTS: 747007,

  INTERNAL: 500000,
} as const;

export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode];

export class AppError extends Error {
  constructor(
    readonly code: ErrorCodeValue,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const isAppError = (e: unknown): e is AppError => e instanceof AppError;
