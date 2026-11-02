import http from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import cookie from "@fastify/cookie";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { eq, inArray } from "drizzle-orm";
import { modelProviders, modelRoutes, models, providerModels } from "@app/db";
import { AppModule } from "../src/app.module";
import { AllExceptionsFilter } from "../src/common/http/exception.filter";
import { EnvelopeInterceptor } from "../src/common/http/envelope.interceptor";
import { db } from "../src/db/database";

/**
 * 供应商接入控制面：
 * - Key 加密落库、列表只回 hint；
 * - OpenAI 兼容测试连接/发现；
 * - Ark 类协议明确“手工导入”，不伪造发现成功；
 * - 路由存在时禁止停用供应商。
 */
describe("ops admin providers e2e", () => {
  let app: NestFastifyApplication;
  let adminToken = "";
  let server: http.Server;
  let baseUrl = "";
  const providerIds: bigint[] = [];
  let modelId: bigint | null = null;
  let routeId: bigint | null = null;

  async function adminInject(method: "GET" | "POST" | "PATCH" | "DELETE", url: string, payload?: unknown) {
    const res = await app.inject({
      method,
      url: `/v1${url}`,
      headers: {
        ...(payload === undefined ? {} : { "content-type": "application/json" }),
        ...(adminToken ? { authorization: `Bearer ${adminToken}` } : {}),
      },
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
  }

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      if (req.url?.endsWith("/v1/models")) {
        if (req.headers.authorization === "Bearer bad-key-12345678") {
          res.writeHead(401, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: { message: "invalid api key" } }));
          return;
        }
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            object: "list",
            data: [
              { id: "mock-model-a", object: "model", owned_by: "test" },
              { id: "mock-model-b", object: "model", owned_by: "test" },
            ],
          }),
        );
        return;
      }
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "not found" }));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("test server did not bind");
    baseUrl = `http://127.0.0.1:${address.port}`;

    app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), { logger: false });
    await app.register(cookie as never);
    app.setGlobalPrefix("v1");
    app.useGlobalFilters(new AllExceptionsFilter());
    app.useGlobalInterceptors(new EnvelopeInterceptor());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    const login = await adminInject("POST", "/ops/admin/login", { username: "admin", password: "admin12345" });
    expect(login.code).toBe(0);
    adminToken = String((login.data as { token: string }).token);
  });

  afterAll(async () => {
    if (routeId) await db.delete(modelRoutes).where(eq(modelRoutes.id, routeId));
    if (modelId) await db.delete(models).where(eq(models.id, modelId));
    if (providerIds.length > 0) {
      await db.delete(modelProviders).where(inArray(modelProviders.id, providerIds));
    }
    await app.close();
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  });

  it("creates an OpenAI-compatible provider without ever returning the key", async () => {
    const secret = "sk-test-secret-12345678";
    const res = await adminInject("POST", "/ops/admin/providers", {
      code: `openai-e2e-${Date.now()}`,
      name: "E2E OpenAI",
      protocol: "openai-compatible",
      base_url: baseUrl,
      api_key: secret,
    });
    expect(res.code).toBe(0);
    const provider = res.data as Record<string, unknown>;
    expect(provider.id).toBeTruthy();
    expect(provider.key_hint).toBe("****5678");
    expect(provider.key_configured).toBe(true);
    expect(JSON.stringify(res.data)).not.toContain(secret);
    expect(JSON.stringify(res.data)).not.toContain("credentials_ciphertext");
    providerIds.push(BigInt(String(provider.id)));

    const [row] = await db
      .select()
      .from(modelProviders)
      .where(eq(modelProviders.id, BigInt(String(provider.id))));
    expect(row?.credentialsCiphertext).toBeTruthy();
    expect(row?.credentialsCiphertext).not.toContain(secret);
  });

  it("tests the connection and discovers models", async () => {
    const providerId = String(providerIds[0]);
    const test = await adminInject("POST", `/ops/admin/providers/${providerId}/test`);
    expect(test.code).toBe(0);
    expect((test.data as { ok: boolean }).ok).toBe(true);

    const discover = await adminInject("POST", `/ops/admin/providers/${providerId}/discover`);
    expect(discover.code).toBe(0);
    const data = discover.data as { supported: boolean; models: Array<{ remote_model_id: string }> };
    expect(data.supported).toBe(true);
    expect(data.models.map((row) => row.remote_model_id)).toEqual(["mock-model-a", "mock-model-b"]);

    const list = await adminInject("GET", `/ops/admin/provider-models?provider_id=${providerId}`);
    expect(list.code).toBe(0);
    expect((list.data as { list: unknown[] }).list).toHaveLength(2);
  });

  it("rotates a provider key without returning either plaintext", async () => {
    const providerId = String(providerIds[0]);
    const before = await db
      .select({ ciphertext: modelProviders.credentialsCiphertext })
      .from(modelProviders)
      .where(eq(modelProviders.id, providerIds[0]!));
    const rotated = await adminInject("PATCH", `/ops/admin/providers/${providerId}`, {
      api_key: "sk-rotated-secret-87654321",
    });
    expect(rotated.code).toBe(0);
    expect((rotated.data as { key_hint: string }).key_hint).toBe("****4321");
    expect(JSON.stringify(rotated.data)).not.toContain("sk-rotated-secret-87654321");
    const after = await db
      .select({ ciphertext: modelProviders.credentialsCiphertext })
      .from(modelProviders)
      .where(eq(modelProviders.id, providerIds[0]!));
    expect(after[0]?.ciphertext).not.toBe(before[0]?.ciphertext);
  });

  it("reports auth failure instead of pretending success", async () => {
    const res = await adminInject("POST", "/ops/admin/providers", {
      code: `openai-bad-${Date.now()}`,
      name: "E2E OpenAI bad key",
      protocol: "openai-compatible",
      base_url: baseUrl,
      api_key: "bad-key-12345678",
    });
    expect(res.code).toBe(0);
    const id = String((res.data as { id: string }).id);
    providerIds.push(BigInt(id));
    const test = await adminInject("POST", `/ops/admin/providers/${id}/test`);
    expect(test.code).toBe(0);
    expect(test.data).toMatchObject({ ok: false, kind: "auth" });
  });

  it("keeps Ark-style providers on manual import", async () => {
    const res = await adminInject("POST", "/ops/admin/providers", {
      code: `ark-${Date.now()}`,
      name: "E2E Ark",
      protocol: "ark",
      base_url: "https://ark.example.com",
      api_key: "ark-key-12345678",
    });
    expect(res.code).toBe(0);
    const id = String((res.data as { id: string }).id);
    providerIds.push(BigInt(id));

    const test = await adminInject("POST", `/ops/admin/providers/${id}/test`);
    expect(test.data).toMatchObject({ ok: false, kind: "unsupported" });
    const discover = await adminInject("POST", `/ops/admin/providers/${id}/discover`);
    expect(discover.data).toMatchObject({ supported: false, reason: "manual_import_required" });

    const imported = await adminInject("POST", `/ops/admin/providers/${id}/provider-models`, {
      remote_model_ids: ["ep-ark-1", "ep-ark-2"],
    });
    expect(imported.code).toBe(0);
    expect((imported.data as { list: unknown[] }).list).toHaveLength(2);
  });

  it("creates a draft model and blocks disabling a provider with active routes", async () => {
    const providerId = String(providerIds[0]);
    const model = await adminInject("POST", "/ops/admin/models", {
      name: `e2e-provider-model-${Date.now()}`,
      display_name: "E2E Provider Model",
      capability: "video",
      adapter_code: "volcengine:video",
    });
    expect(model.code).toBe(0);
    modelId = BigInt(String((model.data as { id: string }).id));
    expect((model.data as { visible: boolean }).visible).toBe(false);

    const route = await adminInject("POST", "/ops/admin/model-routes", {
      model_id: String(modelId),
      provider_id: providerId,
      remote_model_id: "mock-model-a",
    });
    expect(route.code).toBe(0);
    routeId = BigInt(String((route.data as { id: string }).id));

    const blocked = await adminInject("DELETE", `/ops/admin/providers/${providerId}`);
    expect(blocked.code).toBe(400101);

    const off = await adminInject("PATCH", `/ops/admin/model-routes/${String(routeId)}`, { active: false });
    expect(off.code).toBe(0);
    const disabled = await adminInject("DELETE", `/ops/admin/providers/${providerId}`);
    expect(disabled.code).toBe(0);
    expect((disabled.data as { status: number }).status).toBe(0);
  });

  it("rejects invalid base URLs and duplicate provider codes", async () => {
    const bad = await adminInject("POST", "/ops/admin/providers", {
      code: `bad-url-${Date.now()}`,
      name: "Bad URL",
      protocol: "openai-compatible",
      base_url: "ftp://example.com",
      api_key: "sk-test-12345678",
    });
    expect(bad.code).toBe(400101);

    const duplicate = await adminInject("POST", "/ops/admin/providers", {
      code: "duplicate-provider",
      name: "Duplicate 1",
      protocol: "openai-compatible",
      base_url: baseUrl,
      api_key: "sk-test-12345678",
    });
    expect(duplicate.code).toBe(0);
    const duplicateId = String((duplicate.data as { id: string }).id);
    providerIds.push(BigInt(duplicateId));
    const again = await adminInject("POST", "/ops/admin/providers", {
      code: "duplicate-provider",
      name: "Duplicate 2",
      protocol: "openai-compatible",
      base_url: baseUrl,
      api_key: "sk-test-12345678",
    });
    expect(again.code).toBe(400101);
  });

  it("does not list ciphertext or plaintext in the provider list", async () => {
    const list = await adminInject("GET", "/ops/admin/providers");
    expect(list.code).toBe(0);
    const body = JSON.stringify(list.data);
    expect(body).not.toContain("credentials_ciphertext");
    expect(body).not.toContain("sk-test-secret-12345678");
    expect(body).not.toContain("ark-key-12345678");
  });
});
