import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createDb, exportJobs, tasks } from "@app/db";
import { newId } from "@app/shared";
import cookie from "@fastify/cookie";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { AppModule } from "../src/app.module";
import { AllExceptionsFilter } from "../src/common/http/exception.filter";
import { EnvelopeInterceptor } from "../src/common/http/envelope.interceptor";
import { StorageService } from "../src/storage/storage.service";

let app: NestFastifyApplication;
const phone = `13${String(Math.floor(Math.random() * 900000000) + 100000000)}`;
let token = "";

async function inject(
  method: "GET" | "POST" | "PUT" | "PATCH",
  url: string,
  payload?: Record<string, unknown>,
): Promise<any> {
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
    code: number;
    msg: string;
    data: { debug_code: string } | null;
  };
  expect({ code: smsBody.code, msg: smsBody.msg }).toEqual({ code: 0, msg: "" });
  const code = smsBody.data!.debug_code;
  const loginBody = (await app.inject({ method: "POST", url: "/v1/auth/login", payload: { phone, code, age_confirmed: true } })).json() as {
    code: number;
    msg: string;
    data: { access_token: string } | null;
  };
  expect({ code: loginBody.code, msg: loginBody.msg }).toEqual({ code: 0, msg: "" });
  token = loginBody.data!.access_token;
});

afterAll(async () => {
  await app.close();
});

describe("script pipeline (PRD F2 backend)", () => {
  let projectId = "";
  let episodeId = "";
  let characterId = "";
  let shotIds: string[] = [];
  let storyboardId = "";
  let exportJobId = "";

  it("creates a novel project", async () => {
    const res = await inject("POST", "/projects", {
      title: "测试短剧",
      source_type: 1,
      source_text: "第一章：林晚在雨夜收到一封匿名信。第二章：她发现信上的笔迹属于失踪多年的父亲。",
    });
    expect(res.code).toBe(0);
    projectId = res.data.id;
    expect(projectId).toBeTruthy();
  });

  it("generates and confirms a 3-episode outline", async () => {
    const generated = await inject("POST", `/projects/${projectId}/outline/generate`);
    expect(generated.code).toBe(0);
    expect(generated.data).toHaveLength(3);
    episodeId = generated.data[0].id;

    const confirmed = await inject("PUT", `/projects/${projectId}/outline`, {
      episodes: generated.data.map((ep: any) => ({
        ep_no: ep.ep_no,
        title: `${ep.title}（定稿）`,
        synopsis: ep.synopsis,
      })),
    });
    expect(confirmed.code).toBe(0);
    expect(confirmed.data.every((ep: any) => ep.status === 2)).toBe(true);
  });

  it("auto-saves outline edits via episode PATCH", async () => {
    const patched = await inject("PATCH", `/projects/${projectId}/episodes/${episodeId}`, {
      title: "第1集 自动保存",
      synopsis: "自动保存后的梗概",
    });
    expect(patched.code).toBe(0);
    expect(patched.data.title).toBe("第1集 自动保存");

    const detail = await inject("GET", `/projects/${projectId}`);
    const episode = detail.data.episodes.find((ep: { id: string }) => ep.id === episodeId);
    expect(episode.synopsis).toBe("自动保存后的梗概");
  });

  it("generates characters bound to the project", async () => {
    const res = await inject("POST", `/projects/${projectId}/characters/generate`, { count: 3 });
    expect(res.code).toBe(0);
    expect(res.data).toHaveLength(3);
    expect(res.data[0].status).toBe(1);
    characterId = res.data[0].id;
  });

  it("creates a portrait generation task for a character", async () => {
    const res = await inject("POST", `/projects/${projectId}/characters/${characterId}/portrait`, { count: 1 });
    expect(res.code).toBe(0);
    expect(res.data.task_id).toBeTruthy();
    expect(res.data.credits_estimate).toBeGreaterThan(0);
  });

  it("generates a script draft for episode 1", async () => {
    const res = await inject("POST", `/projects/${projectId}/episodes/${episodeId}/script-draft/generate`, {});
    expect(res.code).toBe(0);
    expect(res.data.script_text).toContain("场景");
  });

  it("generates 10 storyboards and patches one", async () => {
    const generated = await inject(
      "POST",
      `/projects/${projectId}/episodes/${episodeId}/storyboards/generate`,
      { shot_count: 10 },
    );
    expect(generated.code).toBe(0);
    expect(generated.data).toHaveLength(10);
    storyboardId = generated.data[0].id;
    shotIds = generated.data.map((s: { id: string }) => s.id);

    const patched = await inject(
      "PATCH",
      `/projects/${projectId}/episodes/${episodeId}/storyboards/${storyboardId}`,
      { duration_s: 6, video_prompt: "改后的提示词" },
    );
    expect(patched.code).toBe(0);
    expect(patched.data.duration_s).toBe(6);

    const detail = await inject("GET", `/projects/${projectId}/episodes/${episodeId}`);
    expect(detail.code).toBe(0);
    expect(detail.data.storyboards).toHaveLength(10);
    expect(detail.data.storyboards[0].character_ids.length).toBeGreaterThan(0);
  });

  it("returns the project storyboard matrix", async () => {
    const matrix = await inject("GET", `/projects/${projectId}/matrix`);
    expect(matrix.code).toBe(0);
    expect(matrix.data.episodes).toHaveLength(3);
    expect(matrix.data.episodes[0].shots).toHaveLength(10);
    expect(matrix.data.episodes[0].shots[0]).toHaveProperty("task_status");
  });

  it("blocks batch generation until referenced assets are finalized", async () => {
    const res = await inject("POST", `/projects/${projectId}/episodes/${episodeId}/storyboards/generate-videos`, {
      shot_ids: shotIds,
      budget_credits_max: 1000,
      model: "wan-3.0",
    });
    expect(res.code).toBe(0);
    expect(res.data.items).toHaveLength(shotIds.length);
    expect(res.data.items.every((item: { code?: number }) => item.code === 400105)).toBe(true);
    expect(res.data.budget_exceeded).toBe(false);
  });

  it("creates an async export job for the episode", async () => {
    const created = await inject("POST", `/projects/${projectId}/episodes/${episodeId}/exports`);
    expect(created.code).toBe(0);
    expect(created.data.status).toBe(1);
    exportJobId = created.data.export_id;

    const status = await inject(
      "GET",
      `/projects/${projectId}/episodes/${episodeId}/exports/${created.data.export_id}`,
    );
    expect(status.code).toBe(0);
    expect(status.data.export_id).toBe(created.data.export_id);
  });
  it("retries a failed export job", async () => {
    const { db, pool } = createDb(process.env.DATABASE_URL ?? "");
    try {
      await db
        .update(exportJobs)
        .set({ status: 4, error: { code: 400106, message: "test failure" } })
        .where(eq(exportJobs.id, BigInt(exportJobId)));
    } finally {
      await pool.end();
    }
    const retried = await inject(
      "POST",
      `/projects/${projectId}/episodes/${episodeId}/exports/${exportJobId}/retry`,
    );
    expect(retried.code).toBe(0);
    expect(retried.data.status).toBe(1);
  });

  it("adds a task result as project shot material", async () => {
    const me = await inject("GET", "/me");
    expect(me.code).toBe(0);
    const spaceId = String(me.data.space.id);
    const userId = String(me.data.user.id);
    const storage = app.get(StorageService);
    const key = `u/${spaceId}/tasks/material-${Date.now()}.mp4`;
    await storage.put(key, Buffer.from("material"), "video/mp4");
    const { db, pool } = createDb(process.env.DATABASE_URL ?? "");
    let taskId = "";
    try {
      taskId = newId();
      await db.insert(tasks).values({
        id: taskId,
        spaceId: BigInt(spaceId),
        userId: BigInt(userId),
        capability: "video",
        mode: "text2video",
        modelId: 1001n,
        input: { prompt: "material" },
        options: {},
        status: 3,
        results: [{ uri: key }],
      });
    } finally {
      await pool.end();
    }
    const added = await inject("POST", `/projects/${projectId}/shot-materials`, {
      task_id: String(taskId),
    });
    expect(added.code).toBe(0);
    expect(added.data.kind).toBe("shot_material");

    const list = await inject("GET", `/projects/${projectId}/shot-materials`);
    expect(list.code).toBe(0);
    expect(list.data.length).toBeGreaterThan(0);
    expect(list.data[0].portrait_url).toBeTruthy();
  });

  it("splits an imported script into episodes", async () => {
    const project = await inject("POST", "/projects", {
      title: "导入剧本",
      source_type: 3,
      source_text: "第一集 开端\n雨夜。\n第二集 转折\n真相浮出水面。",
    });
    const split = await inject("POST", `/projects/${project.data.id}/episodes/split`, {});
    expect(split.code).toBe(0);
    expect(split.data).toHaveLength(2);
    expect(split.data[0].script_text).toContain("雨夜");
  });
});
