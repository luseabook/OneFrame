import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { AllExceptionsFilter } from "../src/common/http/exception.filter";
import { EnvelopeInterceptor } from "../src/common/http/envelope.interceptor";
import { AppModule } from "../src/app.module";

/**
 * `GET /meta/capabilities`（公开只读运行时能力探测）。
 *
 * 为什么要有这个端点：有些能力由**部署环境**决定（典型 `ffmpeg`），不由产品开关决定。
 * 以前这类能力只体现在代码分支里——环境装了 ffmpeg 也要改代码才用得上（#20「真 ffmpeg 裁剪」
 * 就卡在这），运维也无法判断"这台机器到底走哪条路"。
 *
 * 本 spec 锁三件事：
 * 1. 无需登录可读（运维/CLI/前端都要用）；
 * 2. 返回结构稳定：`media.ffmpeg.{available,path,version,reason,checked_at}`；
 * 3. **不泄露敏感信息**：响应里不能出现绝对路径分隔符以外的内部信息、不能有密钥字段。
 */
describe("meta capabilities", () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), {
      logger: false,
    });
    app.setGlobalPrefix("v1");
    app.useGlobalInterceptors(new EnvelopeInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  }, 60_000);

  afterAll(async () => {
    await app.close();
  });

  it("公开可读，且返回 media.ffmpeg 的稳定结构", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/meta/capabilities" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      code: number;
      data: {
        media: { ffmpeg: { available: boolean; path: string; version: string | null; reason: string | null; checked_at: string } };
        sampled_at: string;
      };
    };
    expect(body.code).toBe(0);
    const ff = body.data.media.ffmpeg;
    expect(typeof ff.available).toBe("boolean");
    expect(typeof ff.path).toBe("string");
    expect(ff.path.length).toBeGreaterThan(0);
    expect(ff.checked_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(body.data.sampled_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    // 可用时必须给版本号；不可用必须给可读原因（二者不能都空——否则上层无从降级）
    if (ff.available) expect(ff.version).toBeTruthy();
    else expect(ff.reason).toBeTruthy();
  });

  it("不泄露敏感字段（无密钥/无内部地址/无 stack）", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/meta/capabilities" });
    const raw = res.body.toLowerCase();
    for (const banned of ["secret", "password", "token", "apikey", "api_key", "stack", "postgres://"]) {
      expect(raw.includes(banned)).toBe(false);
    }
  });
});
