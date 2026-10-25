import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createDb, assets, tasks } from "@app/db";
import cookie from "@fastify/cookie";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { AppModule } from "../src/app.module";
import { AllExceptionsFilter } from "../src/common/http/exception.filter";
import { EnvelopeInterceptor } from "../src/common/http/envelope.interceptor";

// P3.5：项目资产参考图（generate-image → candidates → select），链路照搬角色定妆图。
// 本地无 worker，任务成功态由测试直接写 tasks(status=3 + results) 驱动（参考既有做法）。
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
  payload?: Record<string, unknown>,
): Promise<Envelope> {
  const res = await app.inject({
    method,
    url: `/v1${url}`,
    payload,
    headers: { authorization: `Bearer ${asToken}` },
  });
  return res.json() as Envelope;
}

async function inject(
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  url: string,
  payload?: Record<string, unknown>,
): Promise<Envelope> {
  return raw(token, method, url, payload);
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

/** 直接在 DB 把任务置为成功并写入结果（本地无 worker） */
async function markTaskSucceeded(taskId: string, results: Array<{ uri: string }>): Promise<void> {
  const { db, pool } = createDb(process.env.DATABASE_URL ?? "");
  try {
    await db
      .update(tasks)
      .set({ status: 3, results, finishedAt: new Date(), updatedAt: new Date() })
      .where(eq(tasks.id, BigInt(taskId)));
  } finally {
    await pool.end();
  }
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
  tokenOther = await login(phoneB);
});

afterAll(async () => {
  await app.close();
});

describe("project asset reference image (P3.5)", () => {
  let projectId = "";
  let sceneId = "";
  let propId = "";
  let otherId = "";
  let characterId = "";
  let sceneTaskId = "";
  const scenePrompt = "电影感雨夜街角，霓虹反光，浅景深，9:16 竖屏";
  const explicitPrompt = "雨夜街角，湿漉漉的柏油路反光，电影感";
  const results = [{ uri: "u/test/scene-img-a.png" }, { uri: "u/test/scene-img-b.png" }];

  it("prepares a project with scene/prop/other assets and one character", async () => {
    const created = await inject("POST", "/projects", {
      title: "资产参考图测试",
      source_type: 1,
      source_text: "第一章：林晚在雨夜收到一封匿名信。",
    });
    expect(created.code).toBe(0);
    projectId = created.data.id;

    const scene = await inject("POST", `/projects/${projectId}/assets`, {
      kind: "scene",
      name: "雨夜街角",
      prompt: scenePrompt,
    });
    expect(scene.code).toBe(0);
    sceneId = scene.data.id;

    const prop = await inject("POST", `/projects/${projectId}/assets`, {
      kind: "prop",
      name: "匿名信",
    });
    expect(prop.code).toBe(0);
    propId = prop.data.id;

    const other = await inject("POST", `/projects/${projectId}/assets`, {
      kind: "other",
      name: "未生成资产",
    });
    expect(other.code).toBe(0);
    otherId = other.data.id;

    const chars = await inject("POST", `/projects/${projectId}/characters/generate`, { count: 1 });
    expect(chars.code).toBe(0);
    characterId = chars.data[0].id;
  });

  it("creates a studio_asset_image task and resets the asset image state", async () => {
    const res = await inject("POST", `/projects/${projectId}/assets/${sceneId}/generate-image`, {
      prompt: explicitPrompt,
      count: 2,
    });
    expect(res.code).toBe(0);
    expect(Object.keys(res.data).sort()).toEqual(["model", "project_asset_id", "task_id"]);
    expect(res.data.task_id).toBeTruthy();
    expect(res.data.project_asset_id).toBe(sceneId);
    expect(typeof res.data.model).toBe("string");
    sceneTaskId = res.data.task_id;

    // 资产回写：source_task_id / prompt，清空旧参考图与定稿状态
    const list = await inject("GET", `/projects/${projectId}/assets?kind=scene`);
    expect(list.code).toBe(0);
    const asset = list.data.list.find((item: { id: string }) => item.id === sceneId);
    expect(asset.source_task_id).toBe(sceneTaskId);
    expect(asset.prompt).toBe(explicitPrompt);
    expect(asset.status).toBe(1);
    expect(asset.ref_image_uri).toBeNull();
    expect(asset.portrait_asset_id).toBeNull();
    expect(asset.finalized_at).toBeNull();

    // 任务：mode=studio_asset_image，pending，无参考图（纯文生图）
    const task = await readTask(sceneTaskId);
    expect(task).toBeTruthy();
    expect(task!.mode).toBe("studio_asset_image");
    expect(task!.status).toBe(1);
    expect((task!.input as { prompt?: string }).prompt).toBe(explicitPrompt);
    expect((task!.input as { reference_uris?: string[] }).reference_uris).toEqual([]);
    expect((task!.options as { count?: number }).count).toBe(2);
  });

  it("returns 400105 before any image generation / while the task is pending", async () => {
    const notGenerated = await inject("GET", `/projects/${projectId}/assets/${otherId}/candidates`);
    expect(notGenerated.code).toBe(400105);
    expect(notGenerated.msg).toContain("not generated");

    const pending = await inject("GET", `/projects/${projectId}/assets/${sceneId}/candidates`);
    expect(pending.code).toBe(400105);
  });

  it("returns signed candidate urls after the task succeeds", async () => {
    await markTaskSucceeded(sceneTaskId, results);
    const res = await inject("GET", `/projects/${projectId}/assets/${sceneId}/candidates`);
    expect(res.code).toBe(0);
    expect(res.data.task_id).toBe(sceneTaskId);
    expect(res.data.candidates).toHaveLength(2);
    expect(res.data.candidates.map((item: { index: number }) => item.index)).toEqual([0, 1]);
    for (const candidate of res.data.candidates as Array<{ url: string }>) {
      expect(candidate.url).toContain("files/local");
    }
    expect(String(res.data.candidates[0].url)).toContain(encodeURIComponent(results[0]!.uri));
  });

  it("select writes an image asset row and finalizes the project asset", async () => {
    const res = await inject("POST", `/projects/${projectId}/assets/${sceneId}/select`, {
      task_id: sceneTaskId,
      index: 1,
    });
    expect(res.code).toBe(0);
    // 返回 P2 ProjectAssetDto
    expect(res.data.id).toBe(sceneId);
    expect(res.data.kind).toBe("scene");
    expect(res.data.status).toBe(2);
    expect(res.data.finalized_at).toBeTruthy();
    expect(res.data.ref_image_uri).toBe(results[1]!.uri);
    expect(res.data.portrait_asset_id).toBeTruthy();
    expect(String(res.data.portrait_url)).toContain("files/local");
    expect(res.data.bound_shot_count).toBe(0);

    const { db, pool } = createDb(process.env.DATABASE_URL ?? "");
    try {
      const [row] = await db
        .select()
        .from(assets)
        .where(eq(assets.id, BigInt(res.data.portrait_asset_id)));
      expect(row).toBeTruthy();
      expect(row!.kind).toBe("image");
      expect(row!.uri).toBe(results[1]!.uri);
      expect(String(row!.sourceTaskId)).toBe(sceneTaskId);
      expect(row!.name).toBe("雨夜街角");
      expect(row!.tags).toEqual(["scene"]);
      expect(row!.meta).toEqual({
        project_id: projectId,
        project_asset_id: sceneId,
        candidate_index: 1,
      });
    } finally {
      await pool.end();
    }

    // 列表读到的状态与 select 返回一致
    const list = await inject("GET", `/projects/${projectId}/assets?kind=scene`);
    const listed = list.data.list.find((item: { id: string }) => item.id === sceneId);
    expect(listed.status).toBe(2);
    expect(listed.ref_image_uri).toBe(results[1]!.uri);
    expect(listed.finalized_at).toBe(res.data.finalized_at);
  });

  it("select rejects invalid index / task / pending task", async () => {
    const badIndex = await inject("POST", `/projects/${projectId}/assets/${sceneId}/select`, {
      task_id: sceneTaskId,
      index: 3,
    });
    expect(badIndex.code).toBe(400102);

    const badTask = await inject("POST", `/projects/${projectId}/assets/${sceneId}/select`, {
      task_id: "not-a-task",
      index: 0,
    });
    expect(badTask.code).toBe(400101);

    // 新开一轮生图（任务 pending）→ select 400105
    const regenerated = await inject("POST", `/projects/${projectId}/assets/${propId}/generate-image`, {});
    expect(regenerated.code).toBe(0);
    // prompt 兜底：prop 无 prompt/description → 用 name
    const propTask = await readTask(regenerated.data.task_id);
    expect((propTask!.input as { prompt?: string }).prompt).toBe("匿名信");

    const pendingSelect = await inject("POST", `/projects/${projectId}/assets/${propId}/select`, {
      task_id: regenerated.data.task_id,
      index: 0,
    });
    expect(pendingSelect.code).toBe(400105);

    const badCount = await inject("POST", `/projects/${projectId}/assets/${propId}/generate-image`, {
      count: 5,
    });
    expect(badCount.code).toBe(400101);

    const badIndexParam = await inject("POST", `/projects/${projectId}/assets/${propId}/select`, {
      task_id: regenerated.data.task_id,
      index: 4,
    });
    expect(badIndexParam.code).toBe(400101);
  });

  it("uses prompt priority body.prompt > asset.prompt > description > name", async () => {
    // asset.prompt 兜底（新资产生成图时未显式传 prompt）
    const promptOnly = await inject("POST", `/projects/${projectId}/assets`, {
      kind: "scene",
      name: "深夜咖啡馆",
      prompt: "霓虹灯下的深夜咖啡馆，暖色灯光，浅景深",
    });
    expect(promptOnly.code).toBe(0);
    const fromAssetPrompt = await inject(
      "POST",
      `/projects/${projectId}/assets/${promptOnly.data.id}/generate-image`,
      {},
    );
    expect(fromAssetPrompt.code).toBe(0);
    expect(((await readTask(fromAssetPrompt.data.task_id))!.input as { prompt?: string }).prompt).toBe(
      "霓虹灯下的深夜咖啡馆，暖色灯光，浅景深",
    );

    // description 兜底（无 prompt 有 description）
    const descOnly = await inject("POST", `/projects/${projectId}/assets`, {
      kind: "scene",
      name: "旧仓库",
      description: "空旷潮湿的旧仓库，铁门半掩",
    });
    expect(descOnly.code).toBe(0);
    const fromDescription = await inject(
      "POST",
      `/projects/${projectId}/assets/${descOnly.data.id}/generate-image`,
      {},
    );
    expect(fromDescription.code).toBe(0);
    expect(((await readTask(fromDescription.data.task_id))!.input as { prompt?: string }).prompt).toBe(
      "空旷潮湿的旧仓库，铁门半掩",
    );
  });

  it("rejects kind=character with 400101", async () => {
    const res = await inject("POST", `/projects/${projectId}/assets/${characterId}/generate-image`, {});
    expect(res.code).toBe(400101);
    expect(res.msg).toContain("characters");
  });

  it("isolates image endpoints by space (400102)", async () => {
    const generate = await raw(
      tokenOther,
      "POST",
      `/projects/${projectId}/assets/${sceneId}/generate-image`,
      {},
    );
    expect(generate.code).toBe(400102);

    const candidates = await raw(
      tokenOther,
      "GET",
      `/projects/${projectId}/assets/${sceneId}/candidates`,
    );
    expect(candidates.code).toBe(400102);

    const select = await raw(tokenOther, "POST", `/projects/${projectId}/assets/${sceneId}/select`, {
      task_id: sceneTaskId,
      index: 0,
    });
    expect(select.code).toBe(400102);

    // 未知资产 → 400102（同一项目内不存在）
    const missing = await inject(
      "POST",
      `/projects/${projectId}/assets/999999999999999999/generate-image`,
      {},
    );
    expect(missing.code).toBe(400102);
  });
});
