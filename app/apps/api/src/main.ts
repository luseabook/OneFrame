import "reflect-metadata";
import { randomUUID } from "node:crypto";
import cookie from "@fastify/cookie";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { AppModule } from "./app.module";
import { AllExceptionsFilter } from "./common/http/exception.filter";
import { EnvelopeInterceptor } from "./common/http/envelope.interceptor";
import { env } from "./config/env";

/** 优雅停机等待上限：超过则强制退出，避免容器停不下来（deployment.md §5） */
const SHUTDOWN_TIMEOUT_MS = Number(process.env.SHUTDOWN_TIMEOUT_MS ?? 25_000);

async function bootstrap(): Promise<void> {
  const adapter = new FastifyAdapter({
    trustProxy: true,
    genReqId: () => randomUUID(), // request_id：日志/排障/响应头回传（observability §1）
  });

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
  app.useGlobalInterceptors(new EnvelopeInterceptor());
  app.enableShutdownHooks();

  await app.listen(env.PORT, "0.0.0.0");
  console.log(`[api] listening on :${env.PORT} (${env.NODE_ENV})`);

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
