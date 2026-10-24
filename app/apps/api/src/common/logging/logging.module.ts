import { Module } from "@nestjs/common";
import { APP_INTERCEPTOR } from "@nestjs/core";
import { REQUEST_LOG_CLOCK, REQUEST_LOG_SINK, stdoutJsonSink } from "./log-sink";
import { RequestLogContextInterceptor } from "./request-log.interceptor";
import { RequestLoggingMiddleware } from "./request-logging.middleware";

/**
 * 请求日志模块（observability.md §1）。
 *
 * - `RequestLoggingMiddleware`：在 AppModule 的 `configure(consumer)` 里注册（全路由），
 *   负责 request_id 生成/回传 + 单行 JSON 请求日志；
 * - `RequestLogContextInterceptor`：APP_INTERCEPTOR，guard 之后补 user_id/space_id/error_code；
 * - sink 与 clock 通过令牌注入，测试可替换为内存 sink 与假时钟（验证慢请求告警）。
 */
@Module({
  providers: [
    { provide: REQUEST_LOG_SINK, useValue: stdoutJsonSink },
    { provide: REQUEST_LOG_CLOCK, useValue: (): number => Date.now() },
    RequestLoggingMiddleware,
    { provide: APP_INTERCEPTOR, useClass: RequestLogContextInterceptor },
  ],
  // 中间件在 AppModule 的 configure() 里注册，Nest 从**宿主模块**解析其构造参数，
  // 因此 sink/clock 令牌必须一并导出，否则中间件依赖解析失败。
  exports: [RequestLoggingMiddleware, REQUEST_LOG_SINK, REQUEST_LOG_CLOCK],
})
export class LoggingModule {}
