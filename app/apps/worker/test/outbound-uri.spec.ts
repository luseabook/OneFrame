import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { createDb, models, spaces, tasks, users } from "@app/db";
import type { ModelAdapter, NormalizedGenRequest } from "@app/model-adapters";
import { LocalStorage } from "@app/storage";
import { newId } from "@app/shared";
import {
  DEFAULT_ADAPTER_URI_TTL_SECONDS,
  OutboundUriError,
  isLoopbackUrl,
  resolveOutboundUris,
} from "../src/outbound-uri";
import { runGenerationTask, type ExecutorDeps } from "../src/executor";

const rawInput = () => ({
  prompt: "雨夜街头",
  reference_uris: ["u/1/assets/a.png"],
  first_frame_uri: "u/1/assets/f.png",
  last_frame_uri: "u/1/assets/l.png",
});

describe("outbound uri resolution (P10)", () => {
  it("mock mode: raw keys pass through unchanged and sign is never called", async () => {
    const sign = vi.fn(async (key: string) => `https://cdn.test/${key}`);
    const input = rawInput();
    const out = await resolveOutboundUris(input, { adapterMode: "mock", sign });
    expect(sign).not.toHaveBeenCalled();
    expect(out).toBe(input); // 同一对象，mock 零改动
    expect(out.reference_uris).toEqual(["u/1/assets/a.png"]);
  });

  it("real mode: signs storage keys, passes https through, skips null/empty/empty-array", async () => {
    const sign = vi.fn(async (key: string, ttl: number) => `https://cdn.test/${key}?ttl=${ttl}`);
    const input = {
      prompt: "p",
      reference_uris: ["u/1/assets/a.png", "https://already-public.example/img.png", ""],
      first_frame_uri: "u/1/assets/f.png",
      last_frame_uri: null as string | null,
    };
    const out = await resolveOutboundUris(input, { adapterMode: "real", sign, ttlSeconds: 7200 });

    expect(sign).toHaveBeenCalledTimes(2); // 仅两个 storage key（https 与空串不签）
    expect(out.reference_uris).toEqual([
      "https://cdn.test/u/1/assets/a.png?ttl=7200",
      "https://already-public.example/img.png",
      "",
    ]);
    expect(out.first_frame_uri).toBe("https://cdn.test/u/1/assets/f.png?ttl=7200");
    expect(out.last_frame_uri).toBeNull();
    // 入参对象不被修改（tasks.input 保持 raw key）
    expect(input.reference_uris[0]).toBe("u/1/assets/a.png");
  });

  it("real mode: default TTL is 21600s (6h) and empty values are safe", async () => {
    const seen: number[] = [];
    const sign = vi.fn(async (key: string, ttl: number) => {
      seen.push(ttl);
      return `https://cdn.test/${key}`;
    });
    const out = await resolveOutboundUris(
      { prompt: "p", reference_uris: [], first_frame_uri: "", last_frame_uri: undefined },
      { adapterMode: "real", sign },
    );
    expect(out.reference_uris).toEqual([]);
    expect(out.first_frame_uri).toBe("");
    expect(out.last_frame_uri).toBeUndefined();
    expect(seen).toEqual([]); // 空数组/空串/undefined 不触发签名
    expect(DEFAULT_ADAPTER_URI_TTL_SECONDS).toBe(21_600);
  });

  it("real mode: signs studio_asset_image reference images too", async () => {
    const sign = vi.fn(async (key: string) => `https://cdn.test/${key}`);
    const out = await resolveOutboundUris(
      { prompt: "角色定妆图", reference_uris: ["u/1/portraits/p.png"] },
      { adapterMode: "real", sign },
    );
    expect(sign).toHaveBeenCalledWith("u/1/portraits/p.png", 21_600);
    expect(out.reference_uris).toEqual(["https://cdn.test/u/1/portraits/p.png"]);
  });

  it("real mode: loopback signed url is rejected with actionable hint, worker not crashed", async () => {
    const logger = vi.fn();
    const sign = vi.fn(
      async (key: string) => `http://127.0.0.1:3000/v1/files/local?key=${encodeURIComponent(key)}&sig=x`,
    );
    let caught: unknown;
    try {
      await resolveOutboundUris({ reference_uris: ["u/1/assets/a.png"] }, { adapterMode: "real", sign, logger });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(OutboundUriError);
    const err = caught as OutboundUriError;
    expect(err.code).toBe(745900); // VENDOR_ERROR
    expect(err.message).toContain("real 适配器需要公网可访问的存储");
    expect(err.message).toContain("STORAGE_DRIVER=s3");
    expect(err.message).toContain("STORAGE_PUBLIC_BASE");
    expect(err.message).toContain("http://127.0.0.1:3000");
    expect(err.hint).toContain("STORAGE_DRIVER=s3");
    expect(logger).toHaveBeenCalled();
  });

  it("real mode: already-loopback http url is rejected too; unsupported scheme errors", async () => {
    const sign = vi.fn();
    await expect(
      resolveOutboundUris(
        { first_frame_uri: "http://localhost:3000/x.png" },
        { adapterMode: "real", sign },
      ),
    ).rejects.toBeInstanceOf(OutboundUriError);
    expect(sign).not.toHaveBeenCalled(); // http(s) 透传不签名

    await expect(
      resolveOutboundUris({ reference_uris: ["mock://results/x.mp4"] }, { adapterMode: "real", sign }),
    ).rejects.toBeInstanceOf(OutboundUriError);
  });

  it("isLoopbackUrl detects loopback hosts only", () => {
    for (const url of [
      "http://127.0.0.1:3000/x",
      "https://localhost/x",
      "http://0.0.0.0/x",
      "http://[::1]:3000/x",
      "https://api.localhost/x",
    ]) {
      expect(isLoopbackUrl(url), url).toBe(true);
    }
    for (const url of ["https://cdn.example.com/x", "http://10.1.2.3/x", "https://storage.oss.cn/x"]) {
      expect(isLoopbackUrl(url), url).toBe(false);
    }
  });
});

// ── executor 集成：确认签名只作用于出站 payload，且 loopback 守卫不调用适配器 ──
describe("executor outbound uri integration (P10)", () => {
  const handle = createDb(process.env.DATABASE_URL ?? "postgres://app@127.0.0.1:55432/app");
  const db = handle.db;
  let spaceId: bigint;
  let userId: bigint;
  let modelId: bigint;
  const dirs: string[] = [];

  async function makeStorage(publicBaseUrl: string): Promise<LocalStorage> {
    const dir = await mkdtemp(join(tmpdir(), "outbound-uri-"));
    dirs.push(dir);
    return new LocalStorage({ rootDir: dir, publicBaseUrl, signSecret: "test-secret" });
  }

  async function createVideoTask(input: Record<string, unknown>): Promise<bigint> {
    const id = newId();
    await db.insert(tasks).values({
      id,
      spaceId,
      userId,
      capability: "video",
      mode: "text2video",
      modelId,
      input,
      options: {},
      status: 1,
      creditsFrozen: 0,
    });
    return id;
  }

  async function readTask(id: bigint) {
    const [row] = await db.select().from(tasks).where(eq(tasks.id, id));
    return row;
  }

  function fakeAdapter(captured: NormalizedGenRequest[]): ModelAdapter {
    return {
      vendor: "fake",
      submit: async (req) => {
        captured.push(req);
        return { sync_results: [{ uri: "u/test/out.mp4" }] };
      },
      poll: async () => ({ status: "failed" as const }),
      cancel: async () => {},
    };
  }

  beforeAll(async () => {
    const tag = String(Date.now()).slice(-9);
    userId = BigInt(`9${tag}`);
    spaceId = BigInt(`8${tag}`);
    await db.insert(users).values({ id: userId, nickname: `outbound-${tag}` });
    await db.insert(spaces).values({ id: spaceId, ownerUserId: userId });
    const [model] = await db.select().from(models).limit(1);
    if (!model) throw new Error("models table empty; run seed first");
    modelId = model.id;
  });

  afterAll(async () => {
    // task_events / 结果引用 tasks 的外键：先清事件再删任务
    await db.execute(sql`delete from task_events where task_id in (select id from tasks where space_id = ${spaceId})`);
    await db.delete(tasks).where(eq(tasks.spaceId, spaceId));
    await db.delete(spaces).where(eq(spaces.id, spaceId));
    await db.delete(users).where(eq(users.id, userId));
    await handle.pool.end();
    for (const dir of dirs) await rm(dir, { recursive: true, force: true });
  });

  it("real mode: adapter receives signed https uris while tasks.input keeps raw keys", async () => {
    const storage = await makeStorage("https://cdn.test/v1");
    const rawKeys = {
      prompt: "real 签名",
      reference_uris: [`u/${spaceId}/assets/a.png`],
      first_frame_uri: `u/${spaceId}/assets/f.png`,
      last_frame_uri: `u/${spaceId}/assets/l.png`,
    };
    const taskId = await createVideoTask(rawKeys);
    const captured: NormalizedGenRequest[] = [];
    const deps: ExecutorDeps = {
      db,
      storage,
      adapterOptions: { mode: "real" },
      log: () => {},
      outboundUriTtlSeconds: 3600,
      resolveAdapter: () => fakeAdapter(captured),
    };

    await runGenerationTask(String(taskId), deps);

    expect(captured).toHaveLength(1);
    const input = captured[0]!.request.input;
    // 三个字段都已是 https 签名 URL（而非 raw storage key）
    for (const value of [
      input.reference_uris?.[0],
      input.first_frame_uri,
      input.last_frame_uri,
    ]) {
      expect(String(value).startsWith("https://cdn.test/v1/files/local?key=")).toBe(true);
      expect(String(value)).toContain("expires=");
      expect(String(value)).toContain("sig=");
    }
    expect(String(input.reference_uris?.[0])).toContain(encodeURIComponent(rawKeys.reference_uris[0]));

    const row = await readTask(taskId);
    expect(row?.status).toBe(3);
    // DB 仍是 raw key
    expect((row!.input as Record<string, unknown>).reference_uris).toEqual(rawKeys.reference_uris);
    expect((row!.input as Record<string, unknown>).first_frame_uri).toBe(rawKeys.first_frame_uri);
    expect((row!.input as Record<string, unknown>).last_frame_uri).toBe(rawKeys.last_frame_uri);
  });

  it("real mode + loopback storage: adapter is never called, task fails with actionable error", async () => {
    const storage = await makeStorage("http://127.0.0.1:3000/v1");
    const taskId = await createVideoTask({
      prompt: "loopback guard",
      reference_uris: [`u/${spaceId}/assets/a.png`],
    });
    const captured: NormalizedGenRequest[] = [];
    const logs: Array<{ msg: string; obj: Record<string, unknown> }> = [];
    const deps: ExecutorDeps = {
      db,
      storage,
      adapterOptions: { mode: "real" },
      log: (obj, msg) => logs.push({ obj, msg }),
      resolveAdapter: () => fakeAdapter(captured),
    };

    await runGenerationTask(String(taskId), deps);

    const row = await readTask(taskId);
    expect(row?.status).toBe(4);
    const error = row?.error as { code?: number; message?: string };
    expect(error?.code).toBe(745900); // VENDOR_ERROR
    expect(String(error?.message)).toContain("real 适配器需要公网可访问的存储");
    expect(String(error?.message)).toContain("STORAGE_DRIVER=s3");
    expect(String(error?.message)).toContain("STORAGE_PUBLIC_BASE");
    expect(captured).toHaveLength(0); // 未调用供应商
    expect(logs.some((entry) => JSON.stringify(entry.obj).includes("STORAGE_DRIVER=s3"))).toBe(true);
  });
});
