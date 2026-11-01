import { randomUUID } from "node:crypto";
import { FastifyAdapter } from "@nestjs/platform-fastify";

/**
 * HTTP 入站侧的三道闸（第 122 批）。
 *
 * ## 为什么必须显式写
 * Fastify 5.12.7 的 `defaultInitOptions`（`lib/config-validator.js:1265`）把
 * `requestTimeout` / `connectionTimeout` / `handlerTimeout` 三项都定成 `0`，而
 * `lib/server.js:339-341` 又把这几个 0 **原样写到** `server.requestTimeout` 与
 * `server.setTimeout(0)` 上。于是 Node 24 自己那层保护被一起抹掉了：Node 的
 * `requestTimeout` 默认 300s —— 收不全的请求本该被收回，经 Fastify 之后变成「永远等」。
 * 实测（`_acceptance/d122`）：`{requestTimeout: 0, connectionTimeout: 0}` 下，请求体
 * 发一半停住、1.2s 后再补完，照样拿到 200 —— 这 1.2s（或任意长）里，连接、解析器
 * 与已收字节一直占着。语法完全合法，类型检查 / lint / 构建 / 总闸都不会红。
 *
 * ## 三个数分别管哪一段等待（都是实测，不是文档推断）
 * - `requestMs` → `requestTimeout`：**收请求**（header + body）的上限。
 *   实测它**不**掐 handler：400ms 的 requestTimeout 下，body 已收全、handler 静默
 *   900ms，仍在 905ms 回了 200；请求收全后的流式响应跑了 13 个 chunk、1.6s 时连接
 *   仍开着 —— 所以它不会误杀 SSE。它按 Node 的定时扫描生效（默认
 *   `connectionsCheckingInterval` 30s），触发形状是 `HTTP/1.1 408 Request Timeout`。
 * - `idleMs` → `connectionTimeout`（= `server.setTimeout`）：**socket 静默**的上限。
 *   这是三道里唯一实测能回收「body 已收全、handler 一直不回」的那道：400ms 下静默的
 *   handler 在 409ms 被断，且**没有响应**（裸 close）。「写」会重置它 —— 每 100ms
 *   写一次活过 1.6s、每 300ms 写一次活过 2.6s，所以 15s 心跳的 SSE
 *   （`share-stream.service.ts` / `agent-stream.service.ts`）不受影响。
 *   但它**不**回收空转的 keep-alive 连接（1.6s 观察窗内没回收，`keepAliveTimeout: 400`
 *   也没有），「空闲连接回收」不算在它头上。
 * - `handlerMs` → `handlerTimeout`：**恒为 0**。Fastify 的 handler 超时一旦 > 0，
 *   到点就抛 `FST_ERR_HANDLER_TIMEOUT`；而本仓库 4 个 SSE 端点的 handler 要等客户端
 *   断开才 settle（`pipeSession` / `pipeTask` / `stream.pipe`），任何非 0 值都会把正常的
 *   长连接判成超时。且 `route.js:636` 的 `validateHandlerTimeoutOption` 只接受正整数，
 *   **无法按路由关掉**（传 0 直接抛）。所以这一项写死为 0，并由下方 resolver 拒绝其它值。
 *
 * ## 三个值的来历
 * - `requestMs = 120_000`：`bodyLimit` 是 48MB（文件走 base64 JSON），120s 意味着
 *   ≥400KB/s 就能把上限塞满；同时必须 > 60s —— Node 取
 *   `headersTimeout = min(60_000, requestTimeout)`，且两者都 > 0 时 headersTimeout
 *   不得大于 requestTimeout（否则构造即抛 `ERR_OUT_OF_RANGE`）。Fastify **没有**
 *   `headersTimeout` 选项（传了会被静默忽略），只能由 Node 这样推导。
 * - `idleMs = 600_000`：handler 可能合法地长时间不说话 —— 出站下载的闸是 300s
 *   （`packages/shared/src/http-bounded.ts` 的 `DEFAULT_DOWNLOAD_TIMEOUT_MS`），入站
 *   静默上限必须比它宽，否则「等一个合法下载」会被当成死连接掐掉。
 * - `handlerMs = 0`：见上。
 *
 * ## 诚实边界
 * - 触发都在 socket 层：requestTimeout / headersTimeout 是 Node 的裸
 *   `408 Request Timeout`，connectionTimeout 是裸 close。都不经过
 *   `AllExceptionsFilter`，拿不到 `{code,msg,data}` 信封，也不新增对外错误码
 *   （那是契约变更）。
 * - requestTimeout 是「上限 + 最多一个扫描间隔」而非精确计时：默认间隔下 3.2s 内
 *   什么都没发生，把间隔调成 100ms 才在 427ms 收到 408。
 * - 这是进程级常量，不按请求 / 路由调整；需要不同口径时用 `createHttpAdapter(overrides)`。
 */
export interface InboundLimits {
  /** 收请求（header + body）的上限 */
  requestMs: number;
  /** socket 静默（含 handler 一直不回）的上限 */
  idleMs: number;
  /** Fastify handler 超时；必须为 0（4 个 SSE 端点要等客户端断开） */
  handlerMs: number;
}

export const INBOUND_LIMITS: Readonly<InboundLimits> = Object.freeze({
  requestMs: 120_000,
  idleMs: 600_000,
  handlerMs: 0,
});

/**
 * 请求体上限 48MB。
 *
 * 为什么必须显式抬：Fastify 默认 1MB，而本项目有若干「文件走 base64 JSON」的
 * 上传路径（`POST /projects/parse-script`、`POST /canvas/.../table/import`、
 * `POST /assets/upload`），解码上限（8MB 文档 / 32MB 视频）转成 base64 会再涨 1/3。
 * 默认值下真实文件会先被 413 拒掉，接口文档里写的上限形同虚设（实测发现过一次）。
 *
 * 48MB = 32MB(视频) × 4/3 + 余量。**这是 MVP 的临时方案**：视频也走 base64 会把
 * 单请求内存抬到几十 MB，真实生产应换 OSS 预签名直传（api-spec §9 已登记该偏离）。
 */
export const BODY_LIMIT_BYTES = 48 * 1024 * 1024;

const POSITIVE_KEYS = ["requestMs", "idleMs"] as const satisfies readonly (keyof InboundLimits)[];

const LIMIT_KEYS = ["requestMs", "idleMs", "handlerMs"] as const satisfies readonly (keyof InboundLimits)[];

/**
 * 合并默认值与覆盖值，并拒绝任何「等于无限」或会误杀长连接的取值。
 *
 * `0` 在 Node 里恰好是「不设上限」——正是这批要消掉的语义，所以 `requestMs` /
 * `idleMs` 的 0、负数、NaN、Infinity、小数一律抛 `RangeError`，而不是悄悄回落默认值。
 * 键名拼错也抛（`requestTimeout` 之类会静默保留默认值，是最难发现的一种漏）。
 */
export function resolveInboundLimits(overrides: Partial<InboundLimits> = {}): InboundLimits {
  for (const key of Object.keys(overrides)) {
    if (!(LIMIT_KEYS as readonly string[]).includes(key)) {
      throw new RangeError(`unknown inbound limit ${key}`);
    }
  }
  const merged: InboundLimits = { ...INBOUND_LIMITS, ...overrides };
  for (const key of POSITIVE_KEYS) {
    const value = merged[key];
    if (!Number.isInteger(value) || value <= 0) {
      throw new RangeError(
        `invalid inbound limit ${key}: ${String(value)} (must be a positive integer; 0 = wait forever)`,
      );
    }
  }
  if (merged.handlerMs !== 0) {
    throw new RangeError(
      `invalid inbound limit handlerMs: ${String(merged.handlerMs)} (must be 0: 4 SSE handlers settle only on disconnect)`,
    );
  }
  if (merged.idleMs <= merged.requestMs) {
    throw new RangeError(
      `invalid inbound limits: idleMs (${merged.idleMs}) must exceed requestMs (${merged.requestMs})`,
    );
  }
  return merged;
}

/** 把三道闸映射成 Fastify 的选项名（纯函数，便于不启服务就断言接线）。 */
export function inboundServerOptions(overrides: Partial<InboundLimits> = {}): {
  requestTimeout: number;
  connectionTimeout: number;
  handlerTimeout: number;
} {
  const limits = resolveInboundLimits(overrides);
  return {
    requestTimeout: limits.requestMs,
    connectionTimeout: limits.idleMs,
    handlerTimeout: limits.handlerMs,
  };
}

/**
 * 全仓唯一的 `new FastifyAdapter(`（有静态守卫盯着）。把入站三道闸与既有的
 * `trustProxy` / `genReqId` / `bodyLimit` 收在一处，让「改一个上限」只有一个落点。
 */
export function createHttpAdapter(overrides: Partial<InboundLimits> = {}): FastifyAdapter {
  return new FastifyAdapter({
    ...inboundServerOptions(overrides),
    trustProxy: true,
    genReqId: () => randomUUID(), // request_id：日志/排障/响应头回传（observability §1）
    bodyLimit: BODY_LIMIT_BYTES,
  });
}