import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import cookie from "@fastify/cookie";
import { AllExceptionsFilter } from "../src/common/http/exception.filter";
import { EnvelopeInterceptor } from "../src/common/http/envelope.interceptor";
import { AppModule } from "../src/app.module";
import { pool } from "../src/db/database";

/**
 * 账号级语言偏好（`users.preferred_locale` + `POST /me/locale`）契约测试。
 *
 * 为什么需要这个端点：i18n 原本只有 cookie（`of_lang`）——**换设备就丢**。
 * 产品要的是"跟随账号"，但又不能让账号偏好压掉本设备的显式选择，
 * 所以这里同时锁两件事：
 *   1. 端点能存、能在 `/me` 读回、幂等；
 *   2. 只接受 5 个受支持语言 + 空串（清除），其它值 → 400101，绝不静默存脏数据。
 *
 * 优先级（URL `?lang=` > 本设备 cookie > 账号偏好 > 浏览器 → zh-CN）在前端
 * `plugins/i18n.ts` 里实现，本 spec 只保证服务端语义。
 */
describe("account preferred_locale", () => {
  let app: NestFastifyApplication;
  let accessToken = "";
  let phone = "";

  const inject = async (
    method: "GET" | "POST",
    url: string,
    payload?: unknown,
    token?: string,
  ): Promise<{ code: number; msg?: string; data?: unknown }> => {
    const res = await app.inject({
      method,
      url: `/v1${url}`,
      ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });
    return res.json() as { code: number; msg?: string; data?: unknown };
  };

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

    phone = `13${String(Math.floor(Math.random() * 1e9)).padStart(9, "0")}`;
    const sms = await inject("POST", "/auth/sms-code", { phone });
    const code = (sms.data as { debug_code: string }).debug_code;
    const login = await inject("POST", "/auth/login", { phone, code, age_confirmed: true });
    accessToken = (login.data as { access_token: string }).access_token;
  }, 60_000);

  afterAll(async () => {
    // 与既有 auth/canvas 等 spec 一致：只关连接池，不删测试用户
    // （本仓没有 refresh_tokens 表——refresh 走 Redis，删表语句会直接报错）
    await app.close();
    await pool.end().catch(() => undefined);
  });

  it("默认是空串（未设置），/me 会带出来", async () => {
    const me = await inject("GET", "/me", undefined, accessToken);
    expect(me.code).toBe(0);
    const user = (me.data as { user: { preferred_locale?: string } }).user;
    expect(user.preferred_locale).toBe("");
  });

  it("保存后 /me 读回；重复保存幂等", async () => {
    const set1 = await inject("POST", "/me/locale", { locale: "ja" }, accessToken);
    expect(set1.code).toBe(0);
    expect((set1.data as { preferred_locale: string }).preferred_locale).toBe("ja");

    const me1 = await inject("GET", "/me", undefined, accessToken);
    expect((me1.data as { user: { preferred_locale: string } }).user.preferred_locale).toBe("ja");

    const set2 = await inject("POST", "/me/locale", { locale: "ja" }, accessToken);
    expect(set2.code).toBe(0);
    const me2 = await inject("GET", "/me", undefined, accessToken);
    expect((me2.data as { user: { preferred_locale: string } }).user.preferred_locale).toBe("ja");
  });

  it("空串 = 清除（回到跟随设备）", async () => {
    await inject("POST", "/me/locale", { locale: "en" }, accessToken);
    const cleared = await inject("POST", "/me/locale", { locale: "" }, accessToken);
    expect(cleared.code).toBe(0);
    const me = await inject("GET", "/me", undefined, accessToken);
    expect((me.data as { user: { preferred_locale: string } }).user.preferred_locale).toBe("");
  });

  it("不支持的语言 → 400101，且不落库（脏数据进不去）", async () => {
    await inject("POST", "/me/locale", { locale: "es" }, accessToken);
    const bad = await inject("POST", "/me/locale", { locale: "kr" }, accessToken);
    expect(bad.code).toBe(400101);
    const me = await inject("GET", "/me", undefined, accessToken);
    // 仍是上一次合法值（es），没被 "kr" 覆盖
    expect((me.data as { user: { preferred_locale: string } }).user.preferred_locale).toBe("es");
  });

  it("未登录调 /me/locale → 401101（前端因此可以 best-effort 吞掉）", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/me/locale", payload: { locale: "en" } });
    const body = res.json() as { code: number };
    expect(body.code).toBe(401101);
  });
});
