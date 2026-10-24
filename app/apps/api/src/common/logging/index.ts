// 请求日志公共出口（observability.md §1）
export { LoggingModule } from "./logging.module";
export { RequestLoggingMiddleware } from "./request-logging.middleware";
export { RequestLogContextInterceptor } from "./request-log.interceptor";
export { REQUEST_LOG_CLOCK, REQUEST_LOG_SINK, stdoutJsonSink, type LogSink } from "./log-sink";
export {
  REQUEST_ID_HEADER,
  SLOW_REQUEST_MS,
  buildRequestLogRecord,
  getLogContext,
  maskPhoneLike,
  resolveLevel,
  resolveRequestId,
  sanitizePath,
  setLogContext,
  shouldSkipRequestLog,
  statusToErrorCode,
  type RequestLogContext,
  type RequestLogLevel,
  type RequestLogRecord,
} from "./request-log";
