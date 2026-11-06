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

  /**
   * 安全响应头（SEC 审查 H-6）：nginx 已设置一套（deploy/nginx.conf.template），
   * 但直连 API 的场景（内网调试、健康检查、绕过反代）拿不到。这里做纵深防御：
   * 不依赖任何插件，onRequest 钩子对**所有**响应生效（含异常信封）。
   *
   * 为什么不加 CORS：本项目 API 与 Web 同源（nginx 反代 /v1），无跨域消费方 ——
   * 「不设 Access-Control-*」是安全默认值（浏览器跨源直接拒绝）。将来若确有跨域
   * 客户端，必须用**显式白名单**，绝不可 `*` + credentials。
   */
  app
    .getHttpAdapter()
    .getInstance()
    .addHook("onRequest", (req, reply, done) => {
      reply.header("X-Content-Type-Options", "nosniff");
      reply.header("X-Frame-Options", "DENY");
      reply.header("Referrer-Policy", "no-referrer");
      reply.header("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
      // API 只返回 JSON/文件字节，不需要加载任何子资源；frame-ancestors 防点击劫持
      reply.header("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
      // 资源只允许同站引用（图片/视频直链被第三方页面嵌入时由浏览器拦截）
      reply.header("Cross-Origin-Resource-Policy", "same-site");
      // HSTS 只对 HTTPS 请求发：内网 HTTP 部署发了它反而会把浏览器锁死
      if (req.protocol === "https") {
        reply.header("Strict-Transport-Security", "max-age=15552000; includeSubDomains");
      }
      done();
    });

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
