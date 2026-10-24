import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import cookie from "@fastify/cookie";
import { Test } from "@nestjs/testing";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { AppModule } from "../src/app.module";
import { AllExceptionsFilter } from "../src/common/http/exception.filter";
import { EnvelopeInterceptor } from "../src/common/http/envelope.interceptor";
import {
  REQUEST_ID_HEADER,
  REQUEST_LOG_SINK,
  RequestLoggingMiddleware,
  maskPhoneLike,
  resolveRequestId,
  sanitizePath,
  type LogSink,
  type RequestLogRecord,
} from "../src/common/logging";

/**
 * 可观测性契约测试（observability.md §1）。
 *
 * 覆盖：
 * 1) 响应头 `x-request-id` 存在，且与日志字段 `request_id` **同值**（用户报障可凭响应头查日志）；
 * 2) 上游传入的合法 request_id 被沿用；非法值（含空格/换行）被丢弃并回退；
 * 3) 敏感信息不落日志：查询串/请求体/Authorization/Cookie 一律不出现，手机号掩码；
 * 4) 5xx 与 >2000ms 慢请求用 warn；探针端点（healthz）只回写响应头不写日志；
 * 5) 鉴权后补 user_id/space_id（经 AuthGuard → interceptor 串联）。
 *
 * 说明：本文件刻意只用 ping/healthz/auth/me 这些不依赖 billing/orders 表的端点，
 * 避免与其它并行迁移（orders 加列）互相干扰。
 */

const records: RequestLogRecord[] = [];
const captureSink: LogSink = {
  write(record: RequestLogRecord): void {
    records.push(record);
  },
};

let app: NestFastifyApplication;
const phone = `13${String(Math.floor(Math.random() * 900000000) + 100000000)}`;

async function inject(
  method: "GET" | "POST",
  url: string,
  payload?: Record<string, unknown>,
  headers: Record<string, string> = {},
): Promise<{ status: number; headers: Record<string, unknown>; body: any }> {
  const res = await app.inject({ method, url: `/v1${url}`, payload, headers });
  const text = res.body;
  let body: any = undefined;
  try {
    body = JSON.parse(text);
  } catch {
    body = undefined;
  }
  return { status: res.statusCode, headers: res.headers, body };
}

/** 取最近一条请求日志（finish 在 inject resolve 前同步触发） */
function lastRecord(): RequestLogRecord {
  const record = records.at(-1);
  expect(record, "应当产生一条请求日志").toBeTruthy();
  return record!;
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(REQUEST_LOG_SINK)
    .useValue(captureSink)
    .compile();

  // 与 main.ts 一致：genReqId 生成 uuid（生产环境 request_id 形态）
  app = moduleRef.createNestApplication<NestFastifyApplication>(
    new FastifyAdapter({ genReqId: () => randomUUID() }),
  );
  await app.register(cookie as never);
  app.setGlobalPrefix("v1");
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalInterceptors(new EnvelopeInterceptor());
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});

afterAll(async () => {
  await app.close();
});

describe("request_id 串联", () => {
  it("回写 x-request-id 响应头，且与日志 request_id 同值", async () => {
    const res = await inject("GET", "/ping");
    expect(res.status).toBe(200);

    const headerId = res.headers[REQUEST_ID_HEADER];
    expect(headerId, "响应头必须含 x-request-id").toBeTruthy();
    expect(String(headerId)).toMatch(/^[A-Za-z0-9._:-]{8,128}$/);

    const record = lastRecord();
    expect(record.request_id).toBe(String(headerId));
    expect(record.method).toBe("GET");
    expect(record.path).toBe("/v1/ping");
    expect(record.status).toBe(200);
    expect(record.level).toBe("info");
    expect(typeof record.duration_ms).toBe("number");
    expect(record.duration_ms).toBeGreaterThanOrEqual(0);
    expect(record.msg).toBe("http_request");
    // 正常完成的响应不带 aborted 标记
    expect(record.aborted).toBeUndefined();
  });

  it("沿用上游传入的合法 request_id（网关/前端串联）", async () => {
    const res = await inject("GET", "/ping", undefined, { [REQUEST_ID_HEADER]: "gw-trace-000123" });
    expect(res.headers[REQUEST_ID_HEADER]).toBe("gw-trace-000123");
    expect(lastRecord().request_id).toBe("gw-trace-000123");
  });

  it("丢弃非法 request_id（空格/控制字符），回退为服务端生成值", async () => {
    const res = await inject("GET", "/ping", undefined, {
      [REQUEST_ID_HEADER]: "bad id with space\ninjected",
    });
    const headerId = String(res.headers[REQUEST_ID_HEADER]);
    expect(headerId).not.toContain("bad id");
    // 回退值来自 genReqId（uuid），与 main.ts 生产行为一致
    expect(headerId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(lastRecord().request_id).toBe(headerId);
  });

  it("鉴权后日志补 user_id / space_id", async () => {
    const sms = await inject("POST", "/auth/sms-code", { phone });
    expect(sms.body.code).toBe(0);
    const login = await inject("POST", "/auth/login", {
      phone,
      code: sms.body.data.debug_code,
      age_confirmed: true,
    });
    expect(login.body.code).toBe(0);
    const token = login.body.data.access_token as string;
    const spaceId = String(login.body.data.space_id);
    const userId = String(login.body.data.user.id);

    // 登录请求本身未鉴权（/auth/* 是 @Public），不应有 user_id
    expect(lastRecord().user_id).toBeUndefined();

    const me = await inject("GET", "/me", undefined, { authorization: `Bearer ${token}` });
    expect(me.body.code).toBe(0);

    const record = lastRecord();
    expect(record.path).toBe("/v1/me");
    expect(record.user_id).toBe(userId);
    expect(record.space_id).toBe(spaceId);
  });
});

describe("日志脱敏（合规：手机号/token/请求体禁入日志）", () => {
  it("不记录查询串、Authorization 与请求体", async () => {
    const before = records.length;
    const res = await inject(
      "POST",
      "/nope?phone=13800138000&token=supersecret&access_token=abc123",
      { phone: "13800138000", password: "super-secret-password", code: "123456" },
      { authorization: "Bearer super-secret-bearer-token", cookie: "of_rt=secret-cookie-value" },
    );
    expect(res.status).toBe(404);

    const fresh = records.slice(before);
    expect(fresh).toHaveLength(1);
    const line = JSON.stringify(fresh[0]);
    for (const secret of [
      "13800138000",
      "supersecret",
      "abc123",
      "super-secret-password",
      "super-secret-bearer-token",
      "secret-cookie-value",
      "123456",
    ]) {
      expect(line).not.toContain(secret);
    }
    // 字段白名单：不出现 body/query/authorization/cookie 之类字段
    const keys = Object.keys(fresh[0]!);
    for (const forbidden of ["body", "query", "authorization", "cookie", "headers", "password"]) {
      expect(keys).not.toContain(forbidden);
    }
    // 查询串被剥离，路径保留
    expect(fresh[0]!.path).toBe("/v1/nope");
    // 404 映射到信封错误码 400102（与 AllExceptionsFilter 一致）
    expect(fresh[0]!.status).toBe(404);
    expect(fresh[0]!.error_code).toBe(400102);
  });

  it("路径中的手机号被掩码，不透明 token 段被脱敏", async () => {
    const before = records.length;
    await inject("GET", `/users/13800138000/${"a".repeat(36)}`);
    const fresh = records.slice(before);
    expect(fresh).toHaveLength(1);
    expect(fresh[0]!.path).toBe("/v1/users/138****8000/:redacted");
    expect(JSON.stringify(fresh[0])).not.toContain("13800138000");
  });
});

describe("日志级别（5xx 与慢请求 WARN）", () => {
  it("探针端点只回写响应头，不写请求日志", async () => {
    const before = records.length;
    const res = await inject("GET", "/healthz/live");
    expect(res.status).toBe(200);
    expect(res.headers[REQUEST_ID_HEADER]).toBeTruthy();
    expect(records.length).toBe(before);
  });

  it("慢请求（>2000ms）与 5xx 使用 warn 级别", async () => {
    const sink = { written: [] as RequestLogRecord[] };
    let now = 1_000;
    const middleware = new RequestLoggingMiddleware(
      { write: (record) => void sink.written.push(record) },
      () => now,
    );

    // 慢请求：正常 200，但耗时 2500ms
    const slowRes = new FakeResponse(200, true);
    middleware.use(new FakeRequest("GET", "/v1/tasks"), slowRes, () => undefined);
    now = 3_500;
    slowRes.emit("finish");
    expect(sink.written).toHaveLength(1);
    expect(sink.written[0]).toMatchObject({ level: "warn", status: 200, duration_ms: 2_500 });
    expect(sink.written[0]!.error_code).toBeUndefined();

    // 5xx：即使很快，也必须是 warn
    now = 10_000;
    const errorRes = new FakeResponse(500, true);
    middleware.use(new FakeRequest("POST", "/v1/generations"), errorRes, () => undefined);
    now = 10_030;
    errorRes.emit("finish");
    expect(sink.written).toHaveLength(2);
    expect(sink.written[1]).toMatchObject({ level: "warn", status: 500, error_code: 500000 });

    // finish/close 重复触发只出一条（客户端断开场景）
    errorRes.emit("close");
    expect(sink.written).toHaveLength(2);
  });

  it("客户端中断（未 finish）补一条 aborted 日志", async () => {
    const sink: RequestLogRecord[] = [];
    const middleware = new RequestLoggingMiddleware(
      { write: (record) => void sink.push(record) },
      () => 0,
    );
    const res = new FakeResponse(200, false);
    middleware.use(new FakeRequest("GET", "/v1/tasks"), res, () => undefined);
    res.emit("close");
    expect(sink).toHaveLength(1);
    expect(sink[0]!.aborted).toBe(true);
  });
});

describe("工具函数边界", () => {
  it("sanitizePath 剥离查询串/保留 UUID/脱敏长 token", () => {
    const uuid = "3f2b8c1e-9a4d-4e21-8f6a-1b2c3d4e5f60";
    expect(sanitizePath(`/v1/tasks/${uuid}?phone=13800138000&token=x`)).toBe(`/v1/tasks/${uuid}`);
    expect(sanitizePath("/v1/share/AbCdEf0123456789AbCdEf0123456789")).toBe("/v1/share/:redacted");
    expect(sanitizePath(undefined)).toBe("/");
  });

  it("resolveRequestId 拒绝日志注入", () => {
    expect(resolveRequestId("ok-trace-id-1", "fallback-id")).toBe("ok-trace-id-1");
    expect(resolveRequestId("bad\nid", "fallback-id")).toBe("fallback-id");
    expect(resolveRequestId("a".repeat(200), "fallback-id")).toBe("fallback-id");
    expect(resolveRequestId(undefined, "fallback-id")).toBe("fallback-id");
  });

  it("maskPhoneLike 掩码 11 位手机号", () => {
    expect(maskPhoneLike("call 13800138000 now")).toBe("call 138****8000 now");
    expect(maskPhoneLike("no phone here")).toBe("no phone here");
  });
});

/** 中间件单测替身：Node 原生 res 的最小形状 */
class FakeResponse extends EventEmitter {
  headers: Record<string, string> = {};
  constructor(
    public statusCode: number,
    public writableFinished: boolean,
  ) {
    super();
  }
  setHeader(name: string, value: string): void {
    this.headers[name] = value;
  }
}

class FakeRequest {
  constructor(
    public method: string,
    public url: string,
    public id = "req-test-1",
    public headers: Record<string, string> = {},
  ) {}
}
