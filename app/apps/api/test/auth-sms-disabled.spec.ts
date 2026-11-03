import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import cookie from "@fastify/cookie";
import { AllExceptionsFilter } from "../src/common/http/exception.filter";
import { EnvelopeInterceptor } from "../src/common/http/envelope.interceptor";
import { AppModule } from "../src/app.module";
import { env } from "../src/config/env";

/**
 * 短信登录关闭后的入口行为（2026-11-04 产品决策：**不接短信网关**）。
 *
 * 锁两件事：
 * 1. 关闭时 `/auth/sms-code` 与手机号 `/auth/login` 都回 400101 并**明确指引邮箱 + 密码**，
 *    而不是「回 200 成功、但永远不会发码」——后者会让用户等一分钟再点重发，客服也无法定位。
 * 2. 显式开启（非生产）时行为不变，测试/验收仍可用 `debug_code` 跑通登录链路。
 */
describe("短信登录关闭后的入口行为", () => {
  let app: NestFastifyApplication;
  const original = env.AUTH_SMS_ENABLED;
  const phone = `139${String(Date.now()).slice(-8)}`;

  beforeAll(async () => {
    app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), {
      logger: false,
    });
    await app.register(cookie as never);
    app.setGlobalPrefix("v1");
    app.useGlobalInterceptors(new EnvelopeInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  }, 60_000);

  afterAll(async () => {
    env.AUTH_SMS_ENABLED = original;
    await app.close();
  });

  it("关闭后发码回 400101 并指引邮箱密码", async () => {
    env.AUTH_SMS_ENABLED = false;
    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/sms-code",
      payload: { phone },
    });
    const body = res.json() as { code: number; msg: string };
    expect(body.code).toBe(400101);
    expect(body.msg).toContain("邮箱");
  });

  it("关闭后手机号登录同样被拒（不静默回落到短信路径）", async () => {
    env.AUTH_SMS_ENABLED = false;
    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: { phone, code: "123456" },
    });
    const body = res.json() as { code: number; msg: string };
    expect(body.code).toBe(400101);
    expect(body.msg).toContain("邮箱");
  });

  it("显式开启（非生产）时仍返回 debug_code", async () => {
    env.AUTH_SMS_ENABLED = true;
    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/sms-code",
      payload: { phone: `138${String(Date.now() + 7).slice(-8)}` },
    });
    const body = res.json() as { code: number; data?: { debug_code?: string } };
    expect(body.code).toBe(0);
    expect(body.data?.debug_code).toMatch(/^\d{6}$/);
  });
});