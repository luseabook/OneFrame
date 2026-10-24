import { afterAll, beforeAll, describe, expect, it } from "vitest";
import cookie from "@fastify/cookie";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { createStorage, type LocalStorage } from "@app/storage";
import { AppModule } from "../src/app.module";
import { AllExceptionsFilter } from "../src/common/http/exception.filter";
import { EnvelopeInterceptor } from "../src/common/http/envelope.interceptor";
import { env } from "../src/config/env";

let app: NestFastifyApplication;
let storage: LocalStorage;

beforeAll(async () => {
  app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), { logger: false });
  await app.register(cookie as never);
  app.setGlobalPrefix("v1");
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalInterceptors(new EnvelopeInterceptor());
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  storage = createStorage({
    driver: "local",
    rootDir: env.STORAGE_DIR,
    publicBaseUrl: env.STORAGE_PUBLIC_BASE,
    signSecret: env.STORAGE_SIGN_SECRET,
  }) as LocalStorage;
});

afterAll(async () => {
  await app.close();
});

describe("files/local signed download", () => {
  it("serves bytes with a valid signature", async () => {
    await storage.put("u/test/files/hello.txt", Buffer.from("hello"), "text/plain");
    const url = new URL(await storage.signDownload("u/test/files/hello.txt", 60));
    const res = await app.inject({ method: "GET", url: `${url.pathname}${url.search}` });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/plain");
    expect(res.body).toBe("hello");
  });

  it("rejects tampered signatures", async () => {
    await storage.put("u/test/files/bad.txt", Buffer.from("x"), "text/plain");
    const url = new URL(await storage.signDownload("u/test/files/bad.txt", 60));
    url.searchParams.set("sig", "deadbeef");
    const res = await app.inject({ method: "GET", url: `${url.pathname}${url.search}` });
    const body = res.json() as { code: number };
    expect(body.code).toBe(400102);
  });
});
