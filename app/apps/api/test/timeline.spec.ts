import { afterAll, beforeAll, describe, expect, it } from "vitest";
import cookie from "@fastify/cookie";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { createDb, models, tasks } from "@app/db";
import { newId } from "@app/shared";
import { AppModule } from "../src/app.module";
import { AllExceptionsFilter } from "../src/common/http/exception.filter";
import { EnvelopeInterceptor } from "../src/common/http/envelope.interceptor";

// P7：时间线服务端持久化（GET/PUT/DELETE）+ 成片合成导出（POST export / GET export/:id）
let app: NestFastifyApplication;
const phoneA = `13${String(Math.floor(Math.random() * 900000000) + 100000000)}`;
const phoneB = `13${String(Math.floor(Math.random() * 900000000) + 100000000)}`;
let token = "";
let tokenOther = "";

interface Envelope {
  code: number;
  msg: string;
  data: any;
}

async function raw(
  asToken: string,
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  url: string,
  payload?: unknown,
): Promise<Envelope> {
  const res = await app.inject({
    method,
    url: `/v1${url}`,
    payload: payload as Record<string, unknown> | undefined,
    headers: { authorization: `Bearer ${asToken}` },
  });
  return res.json() as Envelope;
}

async function inject(
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  url: string,
  payload?: unknown,
): Promise<Envelope> {
  return raw(token, method, url, payload);
}

async function login(phone: string): Promise<{ token: string; spaceId: string; userId: string }> {
  const sms = await app.inject({ method: "POST", url: "/v1/auth/sms-code", payload: { phone } });
  const smsBody = sms.json() as Envelope;
  expect({ code: smsBody.code, msg: smsBody.msg }).toEqual({ code: 0, msg: "" });
  const body = (
    await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: { phone, code: smsBody.data.debug_code, age_confirmed: true },
    })
  ).json() as Envelope;
  expect({ code: body.code, msg: body.msg }).toEqual({ code: 0, msg: "" });
  return {
    token: body.data.access_token as string,
    spaceId: String(body.data.space_id),
    userId: String(body.data.user.id),
  };
}

beforeAll(async () => {
  app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), {
    logger: false,
  });
  await app.register(cookie as never);
  app.setGlobalPrefix("v1");
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalInterceptors(new EnvelopeInterceptor());
  await app.init();
  await app.getHttpAdapter().getInstance().ready();

  token = (await login(phoneA)).token;
  tokenOther = (await login(phoneB)).token;
});

afterAll(async () => {
  await app.close();
});

describe("episode timeline (P7)", () => {
  let projectId = "";
  let episodeId = "";
  let secondEpisodeId = "";
  let shotIds: string[] = [];
  let taskAId = "";
  let taskBId = "";
  let otherEpisodeTaskId = "";
  const clipTaskAUri = `u/test/timeline-a-${Date.now()}.mp4`;

  it("prepares a project with 4 storyboards and video tasks", async () => {
    const me = await inject("GET", "/me");
    const spaceId = String(me.data.space.id);
    const userId = String(me.data.user.id);

    const created = await inject("POST", "/projects", {
      title: "时间线测试",
      source_type: 1,
      source_text: "第一章：林晚在雨夜收到匿名信。第二章：旧仓库的真相。",
    });
    expect(created.code).toBe(0);
    projectId = created.data.id;

    const outline = await inject("POST", `/projects/${projectId}/outline/generate`);
    expect(outline.code).toBe(0);
    episodeId = outline.data[0].id;
    secondEpisodeId = outline.data[1].id;
    const draft = await inject("POST", `/projects/${projectId}/episodes/${episodeId}/script-draft/generate`, {});
    expect(draft.code).toBe(0);

    const shots = await inject("POST", `/projects/${projectId}/episodes/${episodeId}/storyboards/generate`, {
      shot_count: 4,
    });
    expect(shots.code).toBe(0);
    shotIds = shots.data.map((shot: { id: string }) => shot.id);

    // 直接落两条成功视频任务（不实际生成视频，只用于 timeline 的 task_id 校验）
    const { db, pool } = createDb(process.env.DATABASE_URL ?? "");
    try {
      const [model] = await db.select().from(models).limit(1);
      if (!model) throw new Error("models table empty; run seed first");
      taskAId = String(newId());
      taskBId = String(newId());
      otherEpisodeTaskId = String(newId());
      const base = {
        spaceId: BigInt(spaceId),
        userId: BigInt(userId),
        capability: "video",
        mode: "text2video",
        modelId: model.id,
        input: {},
        options: {},
        status: 3,
      } as const;
      await db.insert(tasks).values([
        { ...base, id: BigInt(taskAId), episodeId: BigInt(episodeId), shotId: BigInt(shotIds[0]!), results: [{ uri: clipTaskAUri }] },
        { ...base, id: BigInt(taskBId), episodeId: BigInt(episodeId), shotId: BigInt(shotIds[1]!), results: [{ uri: `u/test/timeline-b-${Date.now()}.mp4` }] },
        // 其它分集的任务：用于「task 必须属于本集」校验
        { ...base, id: BigInt(otherEpisodeTaskId), episodeId: BigInt(secondEpisodeId), results: [{ uri: "u/test/other-ep.mp4" }] },
      ]);
    } finally {
      await pool.end();
    }
  });

  it("returns an empty clips array before any timeline is saved", async () => {
    const res = await inject("GET", `/projects/${projectId}/episodes/${episodeId}/timeline`);
    expect(res.code).toBe(0);
    expect(res.data).toEqual({ clips: [] });
  });

  it("PUT persists clips in order and backfills missing clip_id", async () => {
    const res = await inject("PUT", `/projects/${projectId}/episodes/${episodeId}/timeline`, {
      clips: [
        { clip_id: "clip-explicit", shot_id: shotIds[0], task_id: taskAId, name: "开场", duration: 2 },
        { shot_id: shotIds[1], task_id: taskBId, name: "冲突", duration: 3 },
      ],
    });
    expect(res.code).toBe(0);
    const clips = res.data.clips as Array<Record<string, unknown>>;
    expect(clips).toHaveLength(2);
    expect(Object.keys(clips[0]!).sort()).toEqual(["clip_id", "duration", "name", "shot_id", "task_id"]);
    expect(clips[0]!.clip_id).toBe("clip-explicit");
    expect(clips[0]!.shot_id).toBe(shotIds[0]);
    expect(clips[0]!.task_id).toBe(taskAId);
    expect(clips[0]!.name).toBe("开场");
    expect(clips[0]!.duration).toBe(2);
    expect(String(clips[1]!.clip_id).length).toBeGreaterThan(0);
    expect(clips[1]!.clip_id).not.toBe("clip-explicit");

    const fetched = await inject("GET", `/projects/${projectId}/episodes/${episodeId}/timeline`);
    expect(fetched.code).toBe(0);
    expect(fetched.data.clips).toEqual(clips);
  });

  it("PUT overwrites the whole timeline for the episode", async () => {
    const res = await inject("PUT", `/projects/${projectId}/episodes/${episodeId}/timeline`, {
      clips: [{ shot_id: shotIds[2], task_id: null, name: "独白", duration: 5 }],
    });
    expect(res.code).toBe(0);
    expect(res.data.clips).toHaveLength(1);
    expect(res.data.clips[0].task_id).toBeNull();
    expect(res.data.clips[0].name).toBe("独白");

    const fetched = await inject("GET", `/projects/${projectId}/episodes/${episodeId}/timeline`);
    expect(fetched.data.clips).toHaveLength(1);
    expect(fetched.data.clips[0].name).toBe("独白");
  });

  it("validates clips (shot/task ownership, duration, count) with 400101", async () => {
    const cases: Array<{ url?: string; payload: unknown; field?: string }> = [
      { payload: { clips: [{ shot_id: "999999999999999999", name: "x", duration: 2 }] } },
      { payload: { clips: [{ shot_id: "not-a-number", name: "x", duration: 2 }] } },
      { payload: { clips: [{ shot_id: shotIds[0], name: "x", duration: 0 }] } },
      { payload: { clips: [{ shot_id: shotIds[0], name: "x", duration: 31 }] } },
      { payload: { clips: [{ shot_id: shotIds[0], name: "", duration: 2 }] } },
      {
        payload: {
          clips: Array.from({ length: 101 }, (_, i) => ({ shot_id: shotIds[0], name: `c${i}`, duration: 1 })),
        },
      },
      {
        // 其它分集的任务不能挂到本集时间线
        payload: {
          clips: [{ shot_id: shotIds[0], task_id: otherEpisodeTaskId, name: "越集任务", duration: 2 }],
        },
      },
    ];
    for (const item of cases) {
      const res = await inject("PUT", `/projects/${projectId}/episodes/${episodeId}/timeline`, item.payload);
      expect(res.code, JSON.stringify(item.payload).slice(0, 120)).toBe(400101);
    }

    // 校验失败不覆盖已有时间线
    const fetched = await inject("GET", `/projects/${projectId}/episodes/${episodeId}/timeline`);
    expect(fetched.data.clips).toHaveLength(1);
  });

  it("creates a timeline export and reports pending status", async () => {
    const created = await inject("POST", `/projects/${projectId}/episodes/${episodeId}/timeline/export`);
    expect(created.code).toBe(0);
    expect(created.data.status).toBe(1);
    expect(created.data.export_id).toBeTruthy();

    const fetched = await inject(
      "GET",
      `/projects/${projectId}/episodes/${episodeId}/timeline/export/${created.data.export_id}`,
    );
    expect(fetched.code).toBe(0);
    expect(fetched.data.export_id).toBe(created.data.export_id);
    expect(fetched.data.status).toBe(1);
    expect(fetched.data.download_url).toBeNull();
    expect(fetched.data.error).toBeNull();
    expect(fetched.data.skipped).toBe(0);

    const missing = await inject(
      "GET",
      `/projects/${projectId}/episodes/${episodeId}/timeline/export/999999999999999999`,
    );
    expect(missing.code).toBe(400102);

    const badId = await inject(
      "GET",
      `/projects/${projectId}/episodes/${episodeId}/timeline/export/not-a-number`,
    );
    expect(badId.code).toBe(400101);
  });

  it("rejects export when the timeline is empty", async () => {
    const emptied = await inject("PUT", `/projects/${projectId}/episodes/${episodeId}/timeline`, { clips: [] });
    expect(emptied.code).toBe(0);
    const fetched = await inject("GET", `/projects/${projectId}/episodes/${episodeId}/timeline`);
    expect(fetched.data.clips).toEqual([]);

    const res = await inject("POST", `/projects/${projectId}/episodes/${episodeId}/timeline/export`);
    expect(res.code).toBe(400101);
  });

  it("deletes the timeline", async () => {
    await inject("PUT", `/projects/${projectId}/episodes/${episodeId}/timeline`, {
      clips: [{ shot_id: shotIds[3], name: "待删", duration: 1 }],
    });
    const res = await inject("DELETE", `/projects/${projectId}/episodes/${episodeId}/timeline`);
    expect(res.code).toBe(0);
    expect(res.data.ok).toBe(true);
    const fetched = await inject("GET", `/projects/${projectId}/episodes/${episodeId}/timeline`);
    expect(fetched.data.clips).toEqual([]);
  });

  it("isolates timeline endpoints by space (cross-space → 400102)", async () => {
    const get = await raw(tokenOther, "GET", `/projects/${projectId}/episodes/${episodeId}/timeline`);
    expect(get.code).toBe(400102);

    const put = await raw(tokenOther, "PUT", `/projects/${projectId}/episodes/${episodeId}/timeline`, {
      clips: [{ shot_id: shotIds[0], name: "越权", duration: 1 }],
    });
    expect(put.code).toBe(400102);

    const del = await raw(tokenOther, "DELETE", `/projects/${projectId}/episodes/${episodeId}/timeline`);
    expect(del.code).toBe(400102);

    const exp = await raw(tokenOther, "POST", `/projects/${projectId}/episodes/${episodeId}/timeline/export`);
    expect(exp.code).toBe(400102);
  });

  it("keeps the legacy zip export endpoints untouched", async () => {
    const created = await inject("POST", `/projects/${projectId}/episodes/${episodeId}/exports`);
    expect(created.code).toBe(0);
    expect(created.data.status).toBe(1);
    const fetched = await inject(
      "GET",
      `/projects/${projectId}/episodes/${episodeId}/exports/${created.data.export_id}`,
    );
    expect(fetched.code).toBe(0);
    expect(fetched.data.export_id).toBe(created.data.export_id);
    expect(fetched.data.status).toBe(1);
  });
});
