import { afterAll, beforeAll, describe, expect, it } from "vitest";
import cookie from "@fastify/cookie";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { createDb, tasks } from "@app/db";
import { newId } from "@app/shared";
import { AppModule } from "../src/app.module";
import { AllExceptionsFilter } from "../src/common/http/exception.filter";
import { EnvelopeInterceptor } from "../src/common/http/envelope.interceptor";
import { StorageService } from "../src/storage/storage.service";

const PNG_1PX =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

let app: NestFastifyApplication;
const phone = `13${String(Math.floor(Math.random() * 900000000) + 100000000)}`;
let token = "";
let assetId = "";
let userId = "";
let spaceId = "";

async function inject(method: "GET" | "POST" | "DELETE", url: string, payload?: Record<string, unknown>) {
  const res = await app.inject({
    method,
    url: `/v1${url}`,
    payload,
    headers: { authorization: `Bearer ${token}` },
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

  const smsBody = (await app.inject({ method: "POST", url: "/v1/auth/sms-code", payload: { phone } })).json() as {
    data: { debug_code: string } | null;
  };
  const loginBody = (
    await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: { phone, code: smsBody.data!.debug_code, age_confirmed: true },
    })
  ).json() as { data: { access_token: string; user: { id: string }; space_id: string } | null };
  token = loginBody.data!.access_token;
  userId = loginBody.data!.user.id;
  spaceId = loginBody.data!.space_id;
});

afterAll(async () => {
  await app.close();
});

describe("assets upload/list/delete", () => {
  it("uploads an image and returns a signed URL", async () => {
    const res = await inject("POST", "/assets/upload", {
      filename: "ref.png",
      content_type: "image/png",
      data_base64: PNG_1PX,
    });
    expect(res.code).toBe(0);
    assetId = res.data.id;
    expect(res.data.kind).toBe("image");
    expect(res.data.url).toContain("/files/local");
  });

  it("lists the asset and quotes image2video with its URL", async () => {
    const list = await inject("GET", "/assets");
    expect(list.code).toBe(0);
    expect(list.data.total).toBeGreaterThan(0);
    const asset = list.data.list.find((a: { id: string }) => a.id === assetId);
    expect(asset).toBeTruthy();

    const quote = await inject("POST", "/credits/quote", {
      mode: "image2video",
      model: "seedance-2.0-vip",
      input: { prompt: "镜头推进", first_frame_uri: asset.url },
      options: { ratio: "9:16", resolution: "720p", duration: 5, count: 1 },
    });
    expect(quote.code).toBe(0);
    expect(quote.data.credits).toBeGreaterThan(0);
    expect(quote.data.sufficient).toBe(true);
  });

  it("transfers a succeeded task result and restores it from recycle bin", async () => {
    const { db, pool } = createDb(process.env.DATABASE_URL ?? "");
    try {
      const storage = app.get(StorageService);
      const key = `u/${spaceId}/tasks/test-${Date.now()}.mp4`;
      await storage.put(key, Buffer.from("result-bytes"), "video/mp4");
      const taskId = newId();
      await db.insert(tasks).values({
        id: taskId,
        spaceId: BigInt(spaceId),
        userId: BigInt(userId),
        capability: "video",
        mode: "text2video",
        modelId: 1001n,
        input: { prompt: "test" },
        options: {},
        status: 3,
        results: [{ uri: key }],
      });

      const transferred = await inject("POST", "/assets/from-task", { task_id: String(taskId), index: 0 });
      expect(transferred.code).toBe(0);
      expect(transferred.data.kind).toBe("video");
      expect(transferred.data.tags).toContain("from-task");
      const id = transferred.data.id as string;

      const removed = await inject("DELETE", `/assets/${id}`);
      expect(removed.code).toBe(0);
      const bin = await inject("GET", "/assets?deleted=true");
      expect(bin.data.list.some((item: { id: string }) => item.id === id)).toBe(true);

      const restored = await inject("POST", `/assets/${id}/restore`);
      expect(restored.code).toBe(0);
      const normal = await inject("GET", "/assets");
      expect(normal.data.list.some((item: { id: string }) => item.id === id)).toBe(true);
    } finally {
      await pool.end();
    }
  });

  it("soft-deletes the asset", async () => {
    const removed = await inject("DELETE", `/assets/${assetId}`);
    expect(removed.code).toBe(0);
    const list = await inject("GET", "/assets");
    expect(list.data.list.some((a: { id: string }) => a.id === assetId)).toBe(false);
  });
});
