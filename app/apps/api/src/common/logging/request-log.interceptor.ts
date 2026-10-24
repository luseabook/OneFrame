import {
  type CallHandler,
  type ExecutionContext,
  HttpException,
  Injectable,
  type NestInterceptor,
} from "@nestjs/common";
import { catchError, throwError, type Observable } from "rxjs";
import { isAppError } from "@app/shared";
import { getLogContext, statusToErrorCode } from "./request-log";

/** 鉴权后由 AuthGuard 挂到 fastify request 上的字段（common/auth.types.ts） */
interface AuthenticatedRequest {
  auth?: { userId?: string; spaceId?: string };
  raw?: unknown;
}

/** 只接受雪花 id / uuid 级别的字符，防止任何外部可控串污染日志字段 */
const SAFE_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * 请求日志上下文补充器（pass-through）。
 *
 * 为什么需要它：Nest+Fastify 下中间件拿到的是 Node 原生 req，而 AuthGuard 把鉴权信息挂在
 * **Fastify request** 上，两者只在 `request.raw` 处相通。于是在 guard 之后运行的 interceptor 里
 * 把 `auth.user_id/space_id` 与错误码补进 raw 上的日志上下文，finish 时即可输出完整日志。
 *
 * 三条硬约束（否则会破坏现有 70 项测试）：
 * 1) **不改响应**：返回值原样透传，绝不 map 响应体（信封由 EnvelopeInterceptor 负责）；
 * 2) **不吞异常**：catchError 里注解完立刻原样重抛，异常仍由 AllExceptionsFilter 处理；
 * 3) **不抛异常**：所有注解逻辑 try/catch 包裹，观测代码不得成为故障源。
 */
@Injectable()
export class RequestLogContextInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();

    this.annotateAuth(request);

    return next.handle().pipe(
      catchError((error: unknown) => {
        this.annotateError(request, error);
        // 原样重抛：异常语义与堆栈保持不变
        return throwError(() => error);
      }),
    );
  }

  private annotateAuth(request: AuthenticatedRequest): void {
    try {
      const logContext = getLogContext(carrierOf(request));
      const auth = request.auth;
      if (!logContext || !auth) return;
      if (typeof auth.userId === "string" && SAFE_ID_RE.test(auth.userId)) {
        logContext.userId = auth.userId;
      }
      if (typeof auth.spaceId === "string" && SAFE_ID_RE.test(auth.spaceId)) {
        logContext.spaceId = auth.spaceId;
      }
    } catch {
      // 观测失败不影响鉴权结果
    }
  }

  private annotateError(request: AuthenticatedRequest, error: unknown): void {
    try {
      const logContext = getLogContext(carrierOf(request));
      if (!logContext) return;
      const status = error instanceof HttpException ? error.getStatus() : 0;
      const code = isAppError(error) ? error.code : statusToErrorCode(status);
      if (typeof code === "number") logContext.errorCode = code;
    } catch {
      // 观测失败不影响错误响应
    }
  }
}

/**
 * 归一化请求载体：fastify request 用 `raw` 取中间件写入的上下文；
 * 兼容直接传 Node 原生 req 的场景（单测/其他适配器）。
 */
function carrierOf(request: AuthenticatedRequest): unknown {
  const raw = request.raw;
  return raw && typeof raw === "object" ? raw : request;
}
