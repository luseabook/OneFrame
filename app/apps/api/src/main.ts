import "reflect-metadata";
import cookie from "@fastify/cookie";
import { NestFactory } from "@nestjs/core";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { AppModule } from "./app.module";
import { AllExceptionsFilter } from "./common/http/exception.filter";
import { EnvelopeInterceptor } from "./common/http/envelope.interceptor";
import { IdempotencyInterceptor } from "./common/http/idempotency.interceptor";
import { readEnvNumber } from "@app/shared";
import { env } from "./config/env";
import { createHttpAdapter } from "./config/inbound-limits";

/**
 * 优雅停机等待上限：超过则强制退出，避免容器停不下来（deployment.md §5）。
 *
 * 第 123 批：走 `readEnvNumber` —— 空白是「没配置」（25s），不是 0；`30s` 这种写成
 * 人类时间的坏值启动即抛，而不是等到停机那一刻才变成 NaN（强制退出 0ms 开火）。
 */
const SHUTDOWN_TIMEOUT_MS = readEnvNumber("SHUTDOWN_TIMEOUT_MS", { default: 25_000, min: 0, integer: true });

async function bootstrap(): Promise<void> {
  // 入站三道闸（收请求 120s / socket 静默 600s / handler 不设超时）与
  // trustProxy / genReqId / bodyLimit 都在 createHttpAdapter 里，理由见该文件头注释。
  const adapter = createHttpAdapter();

  const app = await NestFactory.create<NestFastifyApplication>(AppModule, adapter, {
    logger: ["log", "warn", "error"],
    // 支付回调验签需要原始请求体字节（微信 APIv3 签名串包含 body 原文）。
    // rawBody: true 让 Nest 的 content-type parser 把原始 Buffer 挂到 req.rawBody，
    // 用 JSON.stringify(解析后对象) 验签会因空白/键序差异在生产环境必然失败。
    rawBody: true,
  });

  await app.register(cookie as unknown as Parameters<typeof app.register>[0]);

  app.setGlobalPrefix("v1");
  app.useGlobalFilters(new AllExceptionsFilter());
  // 顺序有意义：幂等账本必须在信封**外层**（重放时缓存的是裸 data，
  // 仍要让 EnvelopeInterceptor 包一次，否则重放响应形状与首次不一致）。
  app.useGlobalInterceptors(new IdempotencyInterceptor(), new EnvelopeInterceptor());
  app.enableShutdownHooks();

  // 监听地址：默认 loopback（env.HOST），只有部署者显式写 HOST=0.0.0.0 才对外监听。
  await app.listen(env.PORT, env.HOST);
  console.log(`[api] listening on ${env.HOST}:${env.PORT} (${env.NODE_ENV})`);

  // ── 优雅停机 ──
  // 收到 SIGTERM/SIGINT：先标记 not-ready（readiness 开始返回 503，让 LB 摘流），
  // 再等待在途请求完成，最后关闭连接池。超过上限强制退出。
  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[api] ${signal} received, draining (timeout ${SHUTDOWN_TIMEOUT_MS}ms)`);

    (globalThis as { __of_shutting_down?: boolean }).__of_shutting_down = true;

    const forceTimer = setTimeout(() => {
      console.error("[api] shutdown timeout, forcing exit");
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    forceTimer.unref();

    try {
      // close() 会停止接收新连接并等待在途请求
      await app.close();
      console.log("[api] closed cleanly");
      clearTimeout(forceTimer);
      process.exit(0);
    } catch (err) {
      console.error("[api] shutdown error:", err);
      clearTimeout(forceTimer);
      process.exit(1);
    }
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

void bootstrap();
