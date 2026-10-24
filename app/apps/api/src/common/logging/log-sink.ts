import type { RequestLogRecord } from "./request-log";

/**
 * 请求日志输出端（可替换）。
 *
 * 默认实现写 stdout 单行 JSON——容器化部署下由日志采集器统一收口（deployment.md §3）；
 * 测试可注入内存 sink 断言字段，无需 spy 全局 console。
 */
export interface LogSink {
  write(record: RequestLogRecord): void;
}

/** DI 令牌：日志输出端 */
export const REQUEST_LOG_SINK = "REQUEST_LOG_SINK";

/** DI 令牌：单调时钟（便于测试注入假时间验证慢请求告警） */
export const REQUEST_LOG_CLOCK = "REQUEST_LOG_CLOCK";

/** 默认 sink：stdout 单行 JSON（info/warn 同一流，靠 level 字段分流告警） */
export const stdoutJsonSink: LogSink = {
  write(record: RequestLogRecord): void {
    process.stdout.write(`${JSON.stringify(record)}\n`);
  },
};
