import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createDb, tasks } from "@app/db";
import cookie from "@fastify/cookie";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { AppModule } from "../src/app.module";
import { AllExceptionsFilter } from "../src/common/http/exception.filter";
import { EnvelopeInterceptor } from "../src/common/http/envelope.interceptor";

// P9：分镜首帧/尾帧（3D 定格图）+ generate-videos 优先使用 shot frame
let app: NestFastifyApplication;
const phone = `13${String(Math.floor(Math.random() * 900000000) + 100000000)}`;
let token = "";

interface Envelope {
  code: number;
  msg: string;
  data: any;
}

async function inject(
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  url: string,
  payload?: Record<string, unknown>,
): Promise<Envelope> {
  const res = await app.inject({
    method,
    url: `/v1${url}`,
    payload,
    headers: { authorization: `Bearer ${token}` },
  });
  return res.json() as Envelope;
}

async function login(phoneValue: string): Promise<string> {
  const sms = await app.inject({ method: "POST", url: "/v1/auth/sms-code", payload: { phone: phoneValue } });
  const smsBody = sms.json() as Envelope;
  expect({ code: smsBody.code, msg: smsBody.msg }).toEqual({ code: 0, msg: "" });
  const body = (
    await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: { phone: phoneValue, code: smsBody.data.debug_code, age_confirmed: true },
    })
  ).json() as Envelope;
  expect({ code: body.code, msg: body.msg }).toEqual({ code: 0, msg: "" });
  return body.data.access_token as string;
}

async function readTask(taskId: string) {
  const { db, pool } = createDb(process.env.DATABASE_URL ?? "");
  try {
    const [row] = await db.select().from(tasks).where(eq(tasks.id, BigInt(taskId)));
    return row;
  } finally {
    await pool.end();
  }
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
  token = await login(phone);
});

afterAll(async () => {
  await app.close();
});

describe("storyboard first/last frame (P9)", () => {
  let projectId = "";
  let episodeId = "";
  let shotIds: string[] = [];
  let imgAId = "";
  let imgBId = "";
  let imgAUri = "";
  let imgBUri = "";

  const shotFirstUri = `u/test/shot-first-${Date.now()}.png`;
  const shotLastUri = `u/test/shot-last-${Date.now()}.png`;

  async function bind(shotId: string, assetIds: string[]) {
    const res = await inject(
      "PUT",
      `/projects/${projectId}/episodes/${episodeId}/storyboards/${shotId}/assets`,
      { asset_ids: assetIds },
    );
    expect(res.code).toBe(0);
  }

  async function patchShot(shotId: string, body: Record<string, unknown>) {
    return inject("PATCH", `/projects/${projectId}/episodes/${episodeId}/storyboards/${shotId}`, body);
  }

  async function submit(mode: string, shotId: string) {
    return inject("POST", `/projects/${projectId}/episodes/${episodeId}/storyboards/generate-videos`, {
      shot_ids: [shotId],
      budget_credits_max: 1000,
      model: "sky-media-2.0",
      mode,
    });
  }

  it("prepares project, 8 shots and two finalized image assets", async () => {
    const created = await inject("POST", "/projects", {
      title: "P9 首尾帧测试",
      source_type: 1,
      source_text: "第一章：林晚在雨夜收到匿名信。第二章：旧仓库的真相。",
    });
    expect(created.code).toBe(0);
    projectId = created.data.id;

    const outline = await inject("POST", `/projects/${projectId}/outline/generate`);
    expect(outline.code).toBe(0);
    episodeId = outline.data[0].id;
    const draft = await inject("POST", `/projects/${projectId}/episodes/${episodeId}/script-draft/generate`, {});
    expect(draft.code).toBe(0);
    const chars = await inject("POST", `/projects/${projectId}/characters/generate`, { count: 1 });
    expect(chars.code).toBe(0);

    const shots = await inject("POST", `/projects/${projectId}/episodes/${episodeId}/storyboards/generate`, {
      shot_count: 8,
    });
    expect(shots.code).toBe(0);
    shotIds = shots.data.map((shot: { id: string }) => shot.id);

    imgAUri = `u/test/frames-a-${Date.now()}.png`;
    const imgA = await inject("POST", `/projects/${projectId}/assets`, { kind: "scene", name: "首帧资产A" });
    imgAId = imgA.data.id;
    await inject("PATCH", `/projects/${projectId}/assets/${imgAId}`, { status: 2, ref_image_uri: imgAUri });

    imgBUri = `u/test/frames-b-${Date.now()}.png`;
    const imgB = await inject("POST", `/projects/${projectId}/assets`, { kind: "prop", name: "尾帧资产B" });
    imgBId = imgB.data.id;
    await inject("PATCH", `/projects/${projectId}/assets/${imgBId}`, { status: 2, ref_image_uri: imgBUri });
  });

  it("PATCH sets first/last frame uri and returns signed urls; episode detail reads them back", async () => {
    const patched = await patchShot(shotIds[0]!, {
      first_frame_uri: shotFirstUri,
      last_frame_uri: shotLastUri,
    });
    expect(patched.code).toBe(0);
    expect(patched.data.first_frame_uri).toBe(shotFirstUri);
    expect(patched.data.last_frame_uri).toBe(shotLastUri);
    // DTO 派生的签名 URL（storage key 原值仍在 *_uri）
    expect(String(patched.data.first_frame_url)).toContain("files/local");
    expect(String(patched.data.last_frame_url)).toContain("files/local");

    const detail = await inject("GET", `/projects/${projectId}/episodes/${episodeId}`);
    expect(detail.code).toBe(0);
    const shot = detail.data.storyboards.find((item: { id: string }) => item.id === shotIds[0]);
    expect(shot.first_frame_uri).toBe(shotFirstUri);
    expect(shot.last_frame_uri).toBe(shotLastUri);
    expect(String(shot.first_frame_url)).toContain("files/local");
    expect(String(shot.last_frame_url)).toContain("files/local");
  });

  it("PATCH null / empty string clears frames (and derived urls)", async () => {
    const clearedNull = await patchShot(shotIds[0]!, { first_frame_uri: null });
    expect(clearedNull.code).toBe(0);
    expect(clearedNull.data.first_frame_uri).toBeNull();
    expect(clearedNull.data.first_frame_url).toBeNull();
    expect(clearedNull.data.last_frame_uri).toBe(shotLastUri); // 未传的字段不动

    const clearedEmpty = await patchShot(shotIds[0]!, { last_frame_uri: "" });
    expect(clearedEmpty.code).toBe(0);
    expect(clearedEmpty.data.last_frame_uri).toBeNull();
    expect(clearedEmpty.data.last_frame_url).toBeNull();

    const tooLong = await patchShot(shotIds[0]!, { first_frame_uri: `u/${"x".repeat(600)}` });
    expect(tooLong.code).toBe(400101);
  });

  it("first_frame mode: shot frame alone works without any bound asset", async () => {
    await bind(shotIds[1]!, []);
    const patched = await patchShot(shotIds[1]!, { first_frame_uri: shotFirstUri });
    expect(patched.code).toBe(0);

    const res = await submit("first_frame", shotIds[1]!);
    expect(res.code).toBe(0);
    const item = res.data.items[0];
    expect(item.submitted).toBe(true);

    const task = await readTask(item.task_id);
    expect(task!.mode).toBe("first_frame");
    expect(task!.scene).toBeNull();
    const input = task!.input as { first_frame_uri?: string; reference_uris?: string[] };
    // storage key 与既有 refImageUri 同口径：不签名、原样写入 input
    expect(input.first_frame_uri).toBe(shotFirstUri);
    expect(input.reference_uris).toEqual([]);
  });

  it("first_frame mode prefers shot frame over bound asset", async () => {
    await bind(shotIds[2]!, [imgAId]);
    await patchShot(shotIds[2]!, { first_frame_uri: shotFirstUri });

    const res = await submit("first_frame", shotIds[2]!);
    expect(res.code).toBe(0);
    expect(res.data.items[0].submitted).toBe(true);

    const task = await readTask(res.data.items[0].task_id);
    const input = task!.input as { first_frame_uri?: string };
    expect(input.first_frame_uri).toBe(shotFirstUri); // 优先 shot frame，而非 imgAUri
    expect(input.first_frame_uri).not.toBe(imgAUri);
  });

  it("first_last_frame: shot first_frame + last falls back to the second asset", async () => {
    await bind(shotIds[3]!, [imgAId, imgBId]);
    await patchShot(shotIds[3]!, { first_frame_uri: shotFirstUri });

    const res = await submit("first_last_frame", shotIds[3]!);
    expect(res.code).toBe(0);
    expect(res.data.items[0].submitted).toBe(true);

    const task = await readTask(res.data.items[0].task_id);
    const input = task!.input as { first_frame_uri?: string; last_frame_uri?: string };
    expect(input.first_frame_uri).toBe(shotFirstUri);
    expect(input.last_frame_uri).toBe(imgBUri); // 第二个合格资产
  });

  it("first_last_frame: both shot frames win over bound assets", async () => {
    await bind(shotIds[4]!, [imgAId, imgBId]);
    await patchShot(shotIds[4]!, { first_frame_uri: shotFirstUri, last_frame_uri: shotLastUri });

    const res = await submit("first_last_frame", shotIds[4]!);
    expect(res.code).toBe(0);
    expect(res.data.items[0].submitted).toBe(true);

    const task = await readTask(res.data.items[0].task_id);
    const input = task!.input as { first_frame_uri?: string; last_frame_uri?: string };
    expect(input.first_frame_uri).toBe(shotFirstUri);
    expect(input.last_frame_uri).toBe(shotLastUri);
  });

  it("clearing shot frame falls back to bound assets", async () => {
    await bind(shotIds[5]!, [imgAId]);
    await patchShot(shotIds[5]!, { first_frame_uri: null });

    const res = await submit("first_frame", shotIds[5]!);
    expect(res.code).toBe(0);
    expect(res.data.items[0].submitted).toBe(true);

    const task = await readTask(res.data.items[0].task_id);
    expect((task!.input as { first_frame_uri?: string }).first_frame_uri).toBe(imgAUri);
  });

  it("first_last_frame without enough frames → per-shot 400105 need_two_assets", async () => {
    await bind(shotIds[6]!, []);
    await patchShot(shotIds[6]!, { first_frame_uri: null, last_frame_uri: null });

    const res = await submit("first_last_frame", shotIds[6]!);
    expect(res.code).toBe(0);
    const item = res.data.items[0];
    expect(item.submitted).toBe(false);
    expect(item.code).toBe(400105);
    expect(item.reason).toBe("need_two_assets");
  });
});
