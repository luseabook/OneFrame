import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Logger,
} from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { ErrorCode, fail, isAppError } from "@app/shared";

// 业务错误(AppError) → HTTP 200 + 信封非 0 code（对齐竞品信封行为，api-spec §1）
// 框架异常(401/403/404/429) → 对应 HTTP 状态码 + 映射后的信封
// 未知异常 → 500 + INTERNAL（记日志，不泄露内部信息）
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger("http");

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<FastifyReply>();

    if (isAppError(exception)) {
      void res.status(200).send(fail(exception.code, exception.message));
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const code =
        status === 401
          ? ErrorCode.UNAUTHORIZED
          : status === 403
            ? ErrorCode.FORBIDDEN
            : status === 404
              ? ErrorCode.NOT_FOUND
              : status === 429
                ? ErrorCode.RATE_LIMITED
                : ErrorCode.BAD_REQUEST;
      void res.status(status).send(fail(code, exception.message));
      return;
    }

    this.logger.error(
      exception instanceof Error ? (exception.stack ?? exception.message) : String(exception),
    );
    void res.status(500).send(fail(ErrorCode.INTERNAL, "Internal Server Error"));
  }
}
