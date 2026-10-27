import "reflect-metadata";
import { randomUUID } from "node:crypto";
import cookie from "@fastify/cookie";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { AppModule } from "./app.module";
import { AllExceptionsFilter } from "./common/http/exception.filter";
import { EnvelopeInterceptor } from "./common/http/envelope.interceptor";
import { IdempotencyInterceptor } from "./common/http/idempotency.interceptor";
import { env } from "./config/env";

/** 优雅停机等待上限：超过则强制退出，避免容器停不下来（deployment.md §5） */
const SHUTDOWN_TIMEOUT_MS = Number(process.env.SHUTDOWN_TIMEOUT_MS ?? 25_000);

async function bootstrap(): Promise<void> {
  const adapter = new FastifyAdapter({
    trustProxy: true,
    genReqId: () => randomUUID(), // request_id：日志/排障/响应头回传（observability §1）
    /**
     * 请求体上限 48MB。
     *
     * 为什么必须显式抬：Fastify 默认 1MB，而本项目有若干"文件走 base64 JSON"的
     * 上传路径（`POST /projects/parse-script`、`POST /canvas/.../table/import`、
     * `POST /assets/upload`），解码上限（8MB 文档 / 32MB 视频）转成 base64 会再涨 1/3。
     * 默认值下真实文件会先被 413 拒掉，接口文档里写的上限形同虚设（实测发现过一次）。
     *
     * 48MB = 32MB(视频) × 4/3 + 余量。**这是 MVP 的临时方案**：视频也走 base64 会把
     * 单请求内存抬到几十 MB，真实生产应换 OSS 预签名直传（api-spec §9 已登记该偏离）。
     */
    bodyLimit: 48 * 1024 * 1024,
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
  // 顺序有意义：幂等账本必须在信封**外层**（重放时缓存的是裸 data，
  // 仍要让 EnvelopeInterceptor 包一次，否则重放响应形状与首次不一致）。
  app.useGlobalInterceptors(new IdempotencyInterceptor(), new EnvelopeInterceptor());
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
