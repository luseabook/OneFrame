import "reflect-metadata";
import { randomUUID } from "node:crypto";
import cookie from "@fastify/cookie";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { AppModule } from "./app.module";
import { AllExceptionsFilter } from "./common/http/exception.filter";
import { EnvelopeInterceptor } from "./common/http/envelope.interceptor";
import { env } from "./config/env";

async function bootstrap(): Promise<void> {
  const adapter = new FastifyAdapter({
    trustProxy: true,
    genReqId: () => randomUUID(), // request_id：日志/排障/响应头回传（observability §1）
  });

  const app = await NestFactory.create<NestFastifyApplication>(AppModule, adapter, {
    logger: ["log", "warn", "error"],
  });

  await app.register(cookie as unknown as Parameters<typeof app.register>[0]);

  app.setGlobalPrefix("v1");
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalInterceptors(new EnvelopeInterceptor());
  app.enableShutdownHooks();

  await app.listen(env.PORT, "0.0.0.0");
  console.log(`[api] listening on :${env.PORT} (${env.NODE_ENV})`);
}

void bootstrap();
