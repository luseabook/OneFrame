import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createDb, tasks } from "@app/db";
import cookie from "@fastify/cookie";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { AppModule } from "../src/app.module";
import { AllExceptionsFilter } from "../src/common/http/exception.filter";
import { EnvelopeInterceptor } from "../src/common/http/envelope.interceptor";

// P5-1：分镜生成模式（universal_reference 默认 / first_frame / first_last_frame / text2video；
// video_edit 显式 400101）。断言落到 tasks 行的 mode/scene/input 字段。
let app: NestFastifyApplication;
const phoneA = `13${String(Math.floor(Math.random() * 900000000) + 100000000)}`;
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

async function login(phone: string): Promise<string> {
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

  token = await login(phoneA);
});

afterAll(async () => {
  await app.close();
});

describe("storyboard generate-videos modes (P5-1)", () => {
  let projectId = "";
  let episodeId = "";
  let shotIds: string[] = [];
  let imgAUri = "";
  let imgBUri = "";
  let draftUri = "";
  let imgAId = "";
  let imgBId = "";
  let draftAssetId = "";

  async function bind(shotId: string, assetIds: string[]) {
    const res = await inject(
      "PUT",
      `/projects/${projectId}/episodes/${episodeId}/storyboards/${shotId}/assets`,
      { asset_ids: assetIds },
    );
    expect(res.code).toBe(0);
  }

  async function submit(mode: string | undefined, model: string, shotId: string) {
    return inject(
      "POST",
      `/projects/${projectId}/episodes/${episodeId}/storyboards/generate-videos`,
      {
        shot_ids: [shotId],
        budget_credits_max: 1000,
        model,
        ...(mode ? { mode } : {}),
      },
    );
  }

  it("prepares a project with 8 shots and image assets", async () => {
    const created = await inject("POST", "/projects", {
      title: "P5-1 生成模式测试",
      source_type: 1,
      source_text: "第一章：林晚在雨夜收到一封匿名信。第二章：她循着线索找到旧仓库。",
    });
    expect(created.code).toBe(0);
    projectId = created.data.id;

    const outline = await inject("POST", `/projects/${projectId}/outline/generate`);
    expect(outline.code).toBe(0);
    episodeId = outline.data[0].id;
    const draft = await inject("POST", `/projects/${projectId}/episodes/${episodeId}/script-draft/generate`, {});
    expect(draft.code).toBe(0);
    const chars = await inject("POST", `/projects/${projectId}/characters/generate`, { count: 2 });
    expect(chars.code).toBe(0);

    const shots = await inject("POST", `/projects/${projectId}/episodes/${episodeId}/storyboards/generate`, {
      shot_count: 8,
    });
    expect(shots.code).toBe(0);
    expect(shots.data).toHaveLength(8);
    shotIds = shots.data.map((shot: { id: string }) => shot.id);

    // 两个已定稿且有参考图的资产（按创建顺序 imgA → imgB）
    imgAUri = `u/test/modes-a-${Date.now()}.png`;
    const imgA = await inject("POST", `/projects/${projectId}/assets`, {
      kind: "scene",
      name: "定稿场景A",
    });
    expect(imgA.code).toBe(0);
    imgAId = imgA.data.id;
    const patchedA = await inject("PATCH", `/projects/${projectId}/assets/${imgAId}`, {
      status: 2,
      ref_image_uri: imgAUri,
    });
    expect(patchedA.code).toBe(0);

    imgBUri = `u/test/modes-b-${Date.now()}.png`;
    const imgB = await inject("POST", `/projects/${projectId}/assets`, {
      kind: "prop",
      name: "定稿道具B",
    });
    expect(imgB.code).toBe(0);
    imgBId = imgB.data.id;
    const patchedB = await inject("PATCH", `/projects/${projectId}/assets/${imgBId}`, {
      status: 2,
      ref_image_uri: imgBUri,
    });
    expect(patchedB.code).toBe(0);

    // 草稿资产（status=1 但有 ref_image_uri）用于 universal_reference 回归
    draftUri = `u/test/modes-draft-${Date.now()}.png`;
    const draftAsset = await inject("POST", `/projects/${projectId}/assets`, {
      kind: "other",
      name: "未定稿资产",
      ref_image_uri: draftUri,
    });
    expect(draftAsset.code).toBe(0);
    draftAssetId = draftAsset.data.id;
    expect(draftAsset.data.status).toBe(1);
  });

  it("universal_reference (default): scene + refs from finalized bindings", async () => {
    await bind(shotIds[0]!, [imgAId]);
    // 不传 mode → 默认 universal_reference
    const res = await submit(undefined, "wan-3.0", shotIds[0]!);
    expect(res.code).toBe(0);
    expect(Object.keys(res.data).sort()).toEqual(["budget_exceeded", "items"]);
    const item = res.data.items[0];
    expect(Object.keys(item).sort()).toEqual(["shot_id", "submitted", "task_id"]);
    expect(item.submitted).toBe(true);

    const task = await readTask(item.task_id);
    expect(task!.mode).toBe("universal_reference");
    expect(task!.scene).toBe("storyboard_reference_video");
    const input = task!.input as {
      reference_uris?: string[];
      first_frame_uri?: string;
      last_frame_uri?: string;
    };
    expect(input.reference_uris).toEqual([imgAUri]);
    expect(input.first_frame_uri).toBeUndefined();
    expect(input.last_frame_uri).toBeUndefined();
    expect((task!.options as { duration?: number }).duration).toBe(5);
  });

  it("first_frame: scene=null + input.first_frame_uri from first ready binding", async () => {
    await bind(shotIds[1]!, [imgAId]);
    const res = await submit("first_frame", "sky-media-2.0", shotIds[1]!);
    expect(res.code).toBe(0);
    const item = res.data.items[0];
    expect(item.submitted).toBe(true);

    const task = await readTask(item.task_id);
    expect(task!.mode).toBe("first_frame");
    expect(task!.scene).toBeNull();
    const input = task!.input as {
      prompt?: string;
      reference_uris?: string[];
      first_frame_uri?: string;
      last_frame_uri?: string;
    };
    expect(input.first_frame_uri).toBe(imgAUri);
    expect(input.last_frame_uri).toBeUndefined();
    expect(input.reference_uris).toEqual([]);
    expect((input.prompt ?? "").length).toBeGreaterThan(0);
    expect((task!.options as { duration?: number }).duration).toBe(5);
  });

  it("first_last_frame: scene=null + first/last from first two ready bindings", async () => {
    await bind(shotIds[2]!, [imgAId, imgBId]);
    const res = await submit("first_last_frame", "sky-media-2.0", shotIds[2]!);
    expect(res.code).toBe(0);
    const item = res.data.items[0];
    expect(item.submitted).toBe(true);

    const task = await readTask(item.task_id);
    expect(task!.mode).toBe("first_last_frame");
    expect(task!.scene).toBeNull();
    const input = task!.input as {
      reference_uris?: string[];
      first_frame_uri?: string;
      last_frame_uri?: string;
    };
    // 按资产创建顺序取前两个：imgA → imgB
    expect(input.first_frame_uri).toBe(imgAUri);
    expect(input.last_frame_uri).toBe(imgBUri);
    expect(input.reference_uris).toEqual([]);
  });

  it("text2video: scene=null + no refs + prompt from shot.video_prompt", async () => {
    await bind(shotIds[3]!, []);
    const res = await submit("text2video", "sky-media-2.0", shotIds[3]!);
    expect(res.code).toBe(0);
    const item = res.data.items[0];
    expect(item.submitted).toBe(true);

    const task = await readTask(item.task_id);
    expect(task!.mode).toBe("text2video");
    expect(task!.scene).toBeNull();
    const input = task!.input as { prompt?: string; reference_uris?: string[]; first_frame_uri?: string };
    expect(input.reference_uris).toEqual([]);
    expect(input.first_frame_uri).toBeUndefined();
    expect(input.prompt).toContain("电影感短剧镜头");
    expect((task!.options as { duration?: number }).duration).toBe(5);
  });

  it("text2video falls back to shot_desc when video_prompt is empty", async () => {
    const fallbackShot = shotIds[7]!;
    await bind(fallbackShot, []);
    const patched = await inject(
      "PATCH",
      `/projects/${projectId}/episodes/${episodeId}/storyboards/${fallbackShot}`,
      { video_prompt: "", shot_desc: "镜头描述退化为提示词" },
    );
    expect(patched.code).toBe(0);

    const res = await submit("text2video", "sky-media-2.0", fallbackShot);
    expect(res.code).toBe(0);
    const item = res.data.items[0];
    expect(item.submitted).toBe(true);
    const task = await readTask(item.task_id);
    expect((task!.input as { prompt?: string }).prompt).toBe("镜头描述退化为提示词");
  });

  it("rejects a model that does not support the requested mode with 400101", async () => {
    // wan-3.0 只支持 universal_reference
    const res = await submit("first_frame", "wan-3.0", shotIds[0]!);
    expect(res.code).toBe(400101);
    expect(res.msg).toContain("不支持 mode first_frame");
  });

  it("rejects video_edit with a clear 400101", async () => {
    const res = await submit("video_edit", "seedance-2.0-vip", shotIds[0]!);
    expect(res.code).toBe(400101);
    expect(res.msg).toContain("AI 改视频");
  });

  it("first_last_frame with only one ready asset → per-shot 400105 need_two_assets", async () => {
    await bind(shotIds[4]!, [imgAId]);
    const res = await submit("first_last_frame", "sky-media-2.0", shotIds[4]!);
    expect(res.code).toBe(0);
    const item = res.data.items[0];
    expect(item.submitted).toBe(false);
    expect(item.code).toBe(400105);
    expect(item.reason).toBe("need_two_assets");
    expect(item.task_id).toBeNull();
  });

  it("text2video with an empty prompt → 400101", async () => {
    const emptyShot = shotIds[6]!;
    await bind(emptyShot, []);
    const patched = await inject(
      "PATCH",
      `/projects/${projectId}/episodes/${episodeId}/storyboards/${emptyShot}`,
      { video_prompt: "", shot_desc: "" },
    );
    expect(patched.code).toBe(0);
    const res = await submit("text2video", "sky-media-2.0", emptyShot);
    expect(res.code).toBe(400101);
    expect(res.msg).toContain("text2video 需要分镜提示词");
  });

  it("universal_reference still rejects a non-finalized binding (400105 regression)", async () => {
    await bind(shotIds[5]!, [draftAssetId]);
    const res = await submit("universal_reference", "wan-3.0", shotIds[5]!);
    expect(res.code).toBe(0);
    const item = res.data.items[0];
    expect(item.submitted).toBe(false);
    expect(item.code).toBe(400105);
    expect(item.reason).toBe("asset_not_ready");
  });
});
