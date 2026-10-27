import { afterAll, beforeAll, describe, expect, it } from "vitest";
import cookie from "@fastify/cookie";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { AppModule } from "../src/app.module";
import { AllExceptionsFilter } from "../src/common/http/exception.filter";
import { EnvelopeInterceptor } from "../src/common/http/envelope.interceptor";

/**
 * 验证码"接入业务入口"的开关式闸门（模块 #25 收尾）。
 *
 * 背景：`/moderation/captcha/*` 与本地算术题早就有了，但**登录/发码入口没接**——
 * 也就是"验证码能生成、能验证，但没人用它挡任何东西"。直接把校验做成默认开启会打断
 * 现有 13 套 e2e 与真机验收（它们全走无码路径），所以这里做成 **`CAPTCHA_ENFORCE` 开关**：
 * - 默认 0 = 关闭（零回归，本次改动对所有既有调用方无感）
 * - 置 1 = 发码与登录都要带 `captcha_ticket`（+ `captcha_answer`），缺失/答错都 400101
 *
 * 服务在**调用时**读 `process.env.CAPTCHA_ENFORCE`（与 OAuth 同口径），因此本用例可以在
 * 同一进程里切"开/关"两态，不必重启。
 */
describe("auth captcha gate (CAPTCHA_ENFORCE)", () => {
  let app: NestFastifyApplication;
  let phone = "";

  const inject = async (method: string, url: string, payload?: unknown) => {
    const headers: Record<string, string> = {};
    if (payload !== undefined) headers["content-type"] = "application/json";
    const res = await app.inject({
      method,
      url: `/v1${url}`,
      headers,
      payload: payload === undefined ? undefined : JSON.stringify(payload),
    });
    let body: Record<string, unknown> = {};
    try {
      body = JSON.parse(res.body) as Record<string, unknown>;
    } catch {
      body = { raw: res.body };
    }
    return {
      status: res.statusCode,
      code: (body as { code?: number }).code ?? -1,
      msg: (body as { msg?: string }).msg ?? "",
      data: (body as { data?: unknown }).data,
    };
  };

  beforeAll(async () => {
    const appInstance = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), {
      logger: false,
    });
    await appInstance.register(cookie as never);
    appInstance.setGlobalPrefix("v1");
    appInstance.useGlobalFilters(new AllExceptionsFilter());
    appInstance.useGlobalInterceptors(new EnvelopeInterceptor());
    await appInstance.init();
    app = appInstance;
    // 手机号必须 11 位（^1\d{10}$）：1 + 10 位数字
    phone = `13${String(Date.now()).slice(-9)}`;
  });

  afterAll(async () => {
    delete process.env.CAPTCHA_ENFORCE;
    await app.close();
  });

  it("默认关闭：不带验证码也能发码（对既有调用方零回归）", async () => {
    delete process.env.CAPTCHA_ENFORCE;
    const res = await inject("POST", "/auth/sms-code", { phone });
    expect(res.code).toBe(0);
    expect((res.data as { debug_code?: string } | undefined)?.debug_code).toBeTruthy();
  });

  it("开启后：缺 captcha_ticket → 400101 captcha_required（并指出缺失字段）", async () => {
    process.env.CAPTCHA_ENFORCE = "1";
    const res = await inject("POST", "/auth/sms-code", { phone });
    expect(res.code).toBe(400101);
    expect(res.msg).toContain("captcha_required");
    delete process.env.CAPTCHA_ENFORCE;
  });

  it("开启后：答错 → 400101 captcha failed(wrong_answer)，且票据被消耗（同票不能再用）", async () => {
    process.env.CAPTCHA_ENFORCE = "1";
    const ticketRes = await inject("POST", "/moderation/captcha/ticket", {});
    expect(ticketRes.code).toBe(0);
    const ticketData = ticketRes.data as { ticket: string; challenge: { a: number; b: number } };
    const wrong = ticketData.challenge.a + ticketData.challenge.b + 1;

    const bad = await inject("POST", "/auth/sms-code", {
      phone,
      captcha_ticket: ticketData.ticket,
      captcha_answer: wrong,
    });
    expect(bad.code).toBe(400101);
    expect(bad.msg).toContain("wrong_answer");

    // 答错也消耗票据：同一张票再答对也不行（防枚举）
    const retry = await inject("POST", "/auth/sms-code", {
      phone,
      captcha_ticket: ticketData.ticket,
      captcha_answer: ticketData.challenge.a + ticketData.challenge.b,
    });
    expect(retry.code).toBe(400101);
    delete process.env.CAPTCHA_ENFORCE;
  });

  it("开启后：答对 → 发码成功（证明闸门是通的，不是只有拒绝路径）", async () => {
    process.env.CAPTCHA_ENFORCE = "1";
    const ticketRes = await inject("POST", "/moderation/captcha/ticket", {});
    const ticketData = ticketRes.data as { ticket: string; challenge: { a: number; b: number } };
    // 用新手机号：同一手机号发码有 60s 冷却（429100），不能复用上面的 phone
    const freshPhone = `13${String(Date.now()).slice(-6)}${String(Math.floor(Math.random() * 1000)).padStart(3, "0")}`;
    const res = await inject("POST", "/auth/sms-code", {
      phone: freshPhone,
      captcha_ticket: ticketData.ticket,
      captcha_answer: ticketData.challenge.a + ticketData.challenge.b,
    });
    expect(res.code).toBe(0);
    expect((res.data as { debug_code?: string } | undefined)?.debug_code).toBeTruthy();
    delete process.env.CAPTCHA_ENFORCE;
  });

  it("登录入口同样受开关保护（发码防住但登录不防是半吊子状态）", async () => {
    process.env.CAPTCHA_ENFORCE = "1";
    const res = await inject("POST", "/auth/login", { phone, code: "000000", age_confirmed: true });
    expect(res.code).toBe(400101);
    expect(res.msg).toContain("captcha_required");
    delete process.env.CAPTCHA_ENFORCE;
  });
});
