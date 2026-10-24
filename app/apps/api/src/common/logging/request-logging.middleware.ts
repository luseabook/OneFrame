import { randomUUID } from "node:crypto";
import { Inject, Injectable, type NestMiddleware } from "@nestjs/common";
import { REQUEST_LOG_CLOCK, REQUEST_LOG_SINK, type LogSink } from "./log-sink";
import {
  REQUEST_ID_HEADER,
  buildRequestLogRecord,
  resolveRequestId,
  sanitizePath,
  setLogContext,
  shouldSkipRequestLog,
  type RequestLogContext,
} from "./request-log";

/**
 * 中间件拿到的对象形态。
 *
 * Nest + Fastify 平台下，Nest 中间件经 `@fastify/middie` 注入，参数是 **Node 原生**
 * `IncomingMessage` / `ServerResponse`（middie 会把 fastify 的 `id/query/ip/log` 挂到 raw 上）。
 * 这里按最小结构做类型声明，既不断言 fastify 类型，也让单测可以直接传假对象。
 */
interface NodeLikeRequest {
  id?: string | number;
  method?: string;
  url?: string;
  /** middie 会把挂载前缀从 url 剥掉，原始完整 URL 保留在这里（含查询串） */
  originalUrl?: string;
  headers?: Record<string, string | string[] | undefined>;
}

interface NodeLikeResponse {
  statusCode?: number;
  headersSent?: boolean;
  setHeader(name: string, value: string): unknown;
  on(event: "finish" | "close", listener: () => void): unknown;
}

/**
 * 请求级结构化日志中间件（observability.md §1）。
 *
 * 一次请求做两件事：
 * 1) `onRequest`：确定 request_id（沿用合法上游值 / Fastify genReqId / 兜底 uuid），
 *    写响应头 `x-request-id`，并把上下文挂到请求对象供 interceptor 补充鉴权信息；
 * 2) `onFinish`：输出单行 JSON——request_id/method/path/status/duration_ms/space_id/user_id/error_code；
 *    5xx 与 >2s 慢请求用 warn。
 *
 * 刻意不做的事：
 * - **不记录请求体、查询串、Authorization、Cookie**（合规要求：手机号/token/密码禁入日志）；
 * - **不包装响应**：不碰响应体，避免与 EnvelopeInterceptor 二次包装或多处 `@Res()` 直写冲突；
 * - 探针端点（healthz/metrics）不写日志（只回写响应头），防止把业务日志挤出保留窗口。
 */
@Injectable()
export class RequestLoggingMiddleware implements NestMiddleware {
  private readonly sink: LogSink;
  private readonly now: () => number;

  constructor(
    @Inject(REQUEST_LOG_SINK) sink: LogSink,
    @Inject(REQUEST_LOG_CLOCK) now: () => number,
  ) {
    this.sink = sink;
    this.now = now;
  }

  use(req: NodeLikeRequest, res: NodeLikeResponse, next: () => void): void {
    const startedAt = this.now();
    const fallbackId =
      typeof req.id === "string" && req.id.length > 0
        ? req.id
        : typeof req.id === "number"
          ? String(req.id)
          : randomUUID();
    const context: RequestLogContext = {
      requestId: resolveRequestId(req.headers?.[REQUEST_ID_HEADER], fallbackId),
      startedAt,
    };
    // 挂在 raw 请求上：guard 之后的 interceptor 能拿到同一个 raw 引用并补齐 user_id/space_id
    setLogContext(req, context);

    // 响应头必须无条件回写（探针端点也要，便于排障串联）；headers 已发出则跳过
    if (!res.headersSent) {
      try {
        res.setHeader(REQUEST_ID_HEADER, context.requestId);
      } catch {
        // 极端情况下（连接已断）写头失败不影响请求本身
      }
    }

    // middie 在进入中间件前会把挂载前缀从 req.url 剥掉（且只留相对路径），
    // originalUrl 才是原始完整路径——日志必须用完整路径才能与路由/网关日志对齐。
    const path = sanitizePath(req.originalUrl ?? req.url);
    const skip = shouldSkipRequestLog(path);
    let emitted = false;
    let finished = false;

    const emit = (aborted: boolean): void => {
      if (emitted || skip) return;
      emitted = true;
      try {
        this.sink.write(
          buildRequestLogRecord(context, {
            method: req.method ?? "GET",
            path,
            status: typeof res.statusCode === "number" ? res.statusCode : 0,
            durationMs: this.now() - startedAt,
            aborted,
          }),
        );
      } catch {
        // 日志失败绝不影响业务响应
      }
    };

    // finish：响应正常写完；close：连接结束（含客户端中断）。
    // 以 finish 事件为准判断是否正常完成——不同 ServerResponse 实现里 writableFinished 的时序不一致。
    res.on("finish", () => {
      finished = true;
      emit(false);
    });
    res.on("close", () => emit(!finished));

    next();
  }
}
