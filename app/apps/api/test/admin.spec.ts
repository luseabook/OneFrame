import { afterAll, beforeAll, describe, expect, it } from "vitest";
import cookie from "@fastify/cookie";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { AppModule } from "../src/app.module";
import { AllExceptionsFilter } from "../src/common/http/exception.filter";
import { EnvelopeInterceptor } from "../src/common/http/envelope.interceptor";

let app: NestFastifyApplication;
let adminToken = "";

async function adminInject(method: "GET" | "POST" | "PATCH", url: string, payload?: Record<string, unknown>) {
  const res = await app.inject({
    method,
    url: `/v1${url}`,
    payload,
    headers: adminToken ? { authorization: `Bearer ${adminToken}` } : {},
  });
  return res.json();
}

beforeAll(async () => {
  app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), { logger: false });
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

describe("ops admin", () => {
  it("logs in with bootstrap admin (test env)", async () => {
    const res = await adminInject("POST", "/ops/admin/login", { username: "admin", password: "admin12345" });
    expect(res.code).toBe(0);
    adminToken = res.data.token;
    expect(adminToken.length).toBeGreaterThan(20);
  });

  it("returns dashboard stats", async () => {
    const res = await adminInject("GET", "/ops/admin/dashboard");
    expect(res.code).toBe(0);
    expect(res.data.users).toBeGreaterThanOrEqual(0);
    expect(res.data.tasks.total).toBeGreaterThanOrEqual(0);
  });

  it("lists models and toggles visibility", async () => {
    const list = await adminInject("GET", "/ops/admin/models");
    expect(list.code).toBe(0);
    expect(list.data.length).toBeGreaterThan(0);
    const first = list.data[0];
    const patched = await adminInject("PATCH", `/ops/admin/models/${first.id}`, { visible: !first.visible });
    expect(patched.code).toBe(0);
    expect(patched.data.visible).toBe(!first.visible);
    await adminInject("PATCH", `/ops/admin/models/${first.id}`, { visible: first.visible });
  });

  it("returns queue metrics", async () => {
    const res = await adminInject("GET", "/ops/admin/queues");
    expect(res.code).toBe(0);
    expect(typeof res.data["gen.submit"].wait).toBe("number");
    expect(typeof res.data["export.zip"].active).toBe("number");
  });

  it("lists tasks/exports/shares for audit", async () => {
    for (const path of ["/ops/admin/tasks", "/ops/admin/exports", "/ops/admin/shares"]) {
      const res = await adminInject("GET", path);
      expect(res.code).toBe(0);
      expect(Array.isArray(res.data.list)).toBe(true);
    }
  });

  it("returns task metrics with failure rate and adapter latency", async () => {
    const res = await adminInject("GET", "/ops/admin/task-metrics");
    expect(res.code).toBe(0);
    expect(typeof res.data.failure_rate).toBe("number");
    expect(Array.isArray(res.data.adapter_latency)).toBe(true);
    expect(Array.isArray(res.data.errors_by_code)).toBe(true);
  });

  it("exports failed tasks as CSV", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/ops/admin/failed-tasks.csv",
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    expect(res.body).toContain("task_id,space_id,model,mode,status");
  });

  it("returns the pipeline funnel with conversion rates", async () => {
    const res = await adminInject("GET", "/ops/admin/funnel");
    expect(res.code).toBe(0);
    expect(res.data).toHaveLength(6);
    expect(res.data[0].key).toBe("projects");
    expect(typeof res.data[0].count).toBe("number");
  });

  it("returns 403 when a normal user token is used", async () => {
    const phone = `13${String(Math.floor(Math.random() * 900000000) + 100000000)}`;
    const sms = (await app.inject({ method: "POST", url: "/v1/auth/sms-code", payload: { phone } })).json() as {
      data: { debug_code: string };
    };
    const login = (
      await app.inject({
        method: "POST",
        url: "/v1/auth/login",
        payload: { phone, code: sms.data.debug_code, age_confirmed: true },
      })
    ).json() as { data: { access_token: string } };
    const res = await app.inject({
      method: "GET",
      url: "/v1/ops/admin/dashboard",
      headers: { authorization: `Bearer ${login.data.access_token}` },
    });
    expect((res.json() as { code: number }).code).toBe(403101);
  });

  it("rejects requests without admin token", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/ops/admin/dashboard" });
    const body = res.json() as { code: number };
    expect(body.code).toBe(401101);
  });
});
