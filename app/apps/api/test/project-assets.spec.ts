import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createDb, tasks } from "@app/db";
import cookie from "@fastify/cookie";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { AppModule } from "../src/app.module";
import { AllExceptionsFilter } from "../src/common/http/exception.filter";
import { EnvelopeInterceptor } from "../src/common/http/envelope.interceptor";

// P2：项目资产（场景/道具/其他）CRUD + 分镜资产绑定（需要真实 PG + Redis）
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
  const code = smsBody.data.debug_code as string;
  const body = (
    await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: { phone, code, age_confirmed: true },
    })
  ).json() as Envelope;
  expect({ code: body.code, msg: body.msg }).toEqual({ code: 0, msg: "" });
  return body.data.access_token as string;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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
  // 另一个 space（跨空间隔离用例）
  tokenOther = await login(phoneB);
});

afterAll(async () => {
  await app.close();
});

describe("project assets (P2): 场景/道具/其他 CRUD + 分镜绑定", () => {
  let projectId = "";
  let episodeId = "";
  let characterId = "";
  let shotIds: string[] = [];

  let sceneAId = ""; // 定稿 + 带 ref_image_uri，用于分镜 references 命中
  let sceneBId = ""; // 仅用于排序/删除
  let propAId = ""; // 最小字段
  let draftPropId = ""; // status=1，用于 400105
  let otherProjectId = "";
  let otherProjectAssetId = "";
  const sceneARef = `u/test/scene-a-${Date.now()}.png`;

  it("prepares a project with characters and 4 storyboards", async () => {
    const created = await inject("POST", "/projects", {
      title: "资产接口测试",
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
    expect(draft.data.script_text).toContain("场景");

    const chars = await inject("POST", `/projects/${projectId}/characters/generate`, { count: 2 });
    expect(chars.code).toBe(0);
    expect(chars.data).toHaveLength(2);
    characterId = chars.data[0].id;

    const shots = await inject("POST", `/projects/${projectId}/episodes/${episodeId}/storyboards/generate`, {
      shot_count: 4,
    });
    expect(shots.code).toBe(0);
    expect(shots.data).toHaveLength(4);
    shotIds = shots.data.map((shot: { id: string }) => shot.id);
    // 生成时已把角色绑定到分镜（既有行为）
    expect(shots.data[0].character_ids).toContain(characterId);

    // 另一个项目（同 space）用于「资产必须属于该项目」校验
    const other = await inject("POST", "/projects", { title: "另一个项目", source_type: 1, source_text: "素材" });
    expect(other.code).toBe(0);
    otherProjectId = other.data.id;
    const otherAsset = await inject("POST", `/projects/${otherProjectId}/assets`, {
      kind: "scene",
      name: "别的项目的场景",
    });
    expect(otherAsset.code).toBe(0);
    otherProjectAssetId = otherAsset.data.id;
  });

  it("creates a scene asset with all optional fields", async () => {
    const res = await inject("POST", `/projects/${projectId}/assets`, {
      kind: "scene",
      name: "  雨夜街角  ",
      description: "主角第一次出场的街角，霓虹与雨幕",
      prompt: "电影感雨夜街角，霓虹反光，浅景深，9:16 竖屏",
      ref_image_uri: sceneARef,
    });
    expect(res.code).toBe(0);
    expect(res.data.kind).toBe("scene");
    expect(res.data.name).toBe("雨夜街角"); // 名称 trim
    expect(res.data.description).toContain("街角");
    expect(res.data.prompt).toContain("霓虹");
    expect(res.data.ref_image_uri).toBe(sceneARef);
    expect(res.data.portrait_asset_id).toBeNull();
    expect(res.data.status).toBe(1); // 默认草稿
    expect(res.data.finalized_at).toBeNull();
    expect(res.data.bound_shot_count).toBe(0);
    // 参考图给前端展示用：预签名 URL
    expect(String(res.data.portrait_url)).toContain("files/local");
    sceneAId = res.data.id;
  });

  it("creates minimal assets and lists them in createdAt ascending order", async () => {
    await sleep(15);
    const sceneB = await inject("POST", `/projects/${projectId}/assets`, {
      kind: "scene",
      name: "旧仓库",
    });
    expect(sceneB.code).toBe(0);
    expect(sceneB.data.description).toBeNull();
    expect(sceneB.data.prompt).toBeNull();
    expect(sceneB.data.ref_image_uri).toBeNull();
    expect(sceneB.data.portrait_url).toBeNull();
    sceneBId = sceneB.data.id;

    await sleep(15);
    const prop = await inject("POST", `/projects/${projectId}/assets`, {
      kind: "prop",
      name: "匿名信",
    });
    expect(prop.code).toBe(0);
    expect(prop.data.kind).toBe("prop");
    propAId = prop.data.id;

    const list = await inject("GET", `/projects/${projectId}/assets?kind=scene`);
    expect(list.code).toBe(0);
    expect(list.data.list.map((item: { id: string }) => item.id)).toEqual([sceneAId, sceneBId]);
    expect(list.data.list.every((item: { kind: string }) => item.kind === "scene")).toBe(true);
    expect(list.data.list.map((item: { bound_shot_count: number }) => item.bound_shot_count)).toEqual([0, 0]);
  });

  it("returns kind=character with the same shape as GET /projects/:id characters plus bound_shot_count", async () => {
    const detail = await inject("GET", `/projects/${projectId}`);
    expect(detail.code).toBe(0);
    const character = detail.data.characters.find((item: { id: string }) => item.id === characterId);
    expect(character).toBeTruthy();

    const res = await inject("GET", `/projects/${projectId}/assets?kind=character`);
    expect(res.code).toBe(0);
    const listed = res.data.list.find((item: { id: string }) => item.id === characterId);
    expect(listed).toBeTruthy();
    // 与 GET /projects/{id} 的 characters 字段同构
    for (const field of [
      "id",
      "kind",
      "name",
      "description",
      "prompt",
      "ref_image_uri",
      "portrait_asset_id",
      "portrait_url",
      "source_task_id",
      "status",
    ]) {
      expect(listed[field]).toEqual(character[field]);
    }
    expect(listed.kind).toBe("character");
    // 生成分镜时已绑定到 4 个镜头
    expect(listed.bound_shot_count).toBe(4);
  });

  it("rejects creating a kind=character asset with 400101 (角色走 characters/generate)", async () => {
    const res = await inject("POST", `/projects/${projectId}/assets`, {
      kind: "character",
      name: "非法角色",
    });
    expect(res.code).toBe(400101);
    expect(res.msg).toContain("characters/generate");
  });

  it("validates payloads and the kind query (400101)", async () => {
    const badName = await inject("POST", `/projects/${projectId}/assets`, { kind: "scene", name: "" });
    expect(badName.code).toBe(400101);

    const tooLong = await inject("POST", `/projects/${projectId}/assets`, {
      kind: "scene",
      name: "x".repeat(51),
    });
    expect(tooLong.code).toBe(400101);

    const badKind = await inject("GET", `/projects/${projectId}/assets?kind=unknown`);
    expect(badKind.code).toBe(400101);

    const emptyPatch = await inject("PATCH", `/projects/${projectId}/assets/${sceneAId}`, {});
    expect(emptyPatch.code).toBe(400101);
  });

  it("patches name/description and toggles status with finalized_at", async () => {
    const renamed = await inject("PATCH", `/projects/${projectId}/assets/${sceneAId}`, {
      name: "雨夜街角（定稿）",
      description: "改名后的描述",
    });
    expect(renamed.code).toBe(0);
    expect(renamed.data.name).toBe("雨夜街角（定稿）");
    expect(renamed.data.description).toBe("改名后的描述");
    expect(renamed.data.status).toBe(1);
    expect(renamed.data.finalized_at).toBeNull();

    const finalized = await inject("PATCH", `/projects/${projectId}/assets/${sceneAId}`, { status: 2 });
    expect(finalized.code).toBe(0);
    expect(finalized.data.status).toBe(2);
    expect(finalized.data.finalized_at).toBeTruthy();
    const firstFinalizedAt = finalized.data.finalized_at as string;

    // 幂等：已定稿再次置 2 保留原 finalized_at
    const again = await inject("PATCH", `/projects/${projectId}/assets/${sceneAId}`, { status: 2 });
    expect(again.code).toBe(0);
    expect(again.data.finalized_at).toBe(firstFinalizedAt);

    const backToDraft = await inject("PATCH", `/projects/${projectId}/assets/${sceneAId}`, { status: 1 });
    expect(backToDraft.code).toBe(0);
    expect(backToDraft.data.status).toBe(1);
    expect(backToDraft.data.finalized_at).toBeNull();

    // 供后续 references 用例使用
    const refinalized = await inject("PATCH", `/projects/${projectId}/assets/${sceneAId}`, { status: 2 });
    expect(refinalized.code).toBe(0);
    expect(refinalized.data.finalized_at).toBeTruthy();
  });

  it("replaces storyboard bindings and preserves input order", async () => {
    const res = await inject("PUT", `/projects/${projectId}/episodes/${episodeId}/storyboards/${shotIds[0]}/assets`, {
      asset_ids: [propAId, sceneBId, characterId],
    });
    expect(res.code).toBe(0);
    expect(res.data.asset_ids).toEqual([propAId, sceneBId, characterId]);

    const detail = await inject("GET", `/projects/${projectId}/episodes/${episodeId}`);
    expect(detail.code).toBe(0);
    const shot = detail.data.storyboards.find((item: { id: string }) => item.id === shotIds[0]);
    expect(shot.character_ids).toEqual([propAId, sceneBId, characterId]);

    // 重复 id 按首次出现去重（返回落库后的顺序）
    const deduped = await inject(
      "PUT",
      `/projects/${projectId}/episodes/${episodeId}/storyboards/${shotIds[0]}/assets`,
      { asset_ids: [sceneBId, propAId, sceneBId] },
    );
    expect(deduped.code).toBe(0);
    expect(deduped.data.asset_ids).toEqual([sceneBId, propAId]);

    // 空数组 = 清空绑定
    const cleared = await inject(
      "PUT",
      `/projects/${projectId}/episodes/${episodeId}/storyboards/${shotIds[0]}/assets`,
      { asset_ids: [] },
    );
    expect(cleared.code).toBe(0);
    expect(cleared.data.asset_ids).toEqual([]);

    // 复位：绑定回来供删除用例使用
    const rebind = await inject(
      "PUT",
      `/projects/${projectId}/episodes/${episodeId}/storyboards/${shotIds[0]}/assets`,
      { asset_ids: [propAId, sceneBId, characterId] },
    );
    expect(rebind.code).toBe(0);
  });

  it("rejects unknown or cross-project asset ids in bindings with 400101", async () => {
    const unknown = await inject(
      "PUT",
      `/projects/${projectId}/episodes/${episodeId}/storyboards/${shotIds[1]}/assets`,
      { asset_ids: ["999999999999999999"] },
    );
    expect(unknown.code).toBe(400101);

    const crossProject = await inject(
      "PUT",
      `/projects/${projectId}/episodes/${episodeId}/storyboards/${shotIds[1]}/assets`,
      { asset_ids: [otherProjectAssetId] },
    );
    expect(crossProject.code).toBe(400101);

    const invalid = await inject(
      "PUT",
      `/projects/${projectId}/episodes/${episodeId}/storyboards/${shotIds[1]}/assets`,
      { asset_ids: ["not-a-number"] },
    );
    expect(invalid.code).toBe(400101);
  });

  it("deletes an asset and removes its storyboard bindings in the same transaction", async () => {
    const removed = await inject("DELETE", `/projects/${projectId}/assets/${sceneBId}`);
    expect(removed.code).toBe(0);
    expect(removed.data.ok).toBe(true);

    const list = await inject("GET", `/projects/${projectId}/assets?kind=scene`);
    expect(list.code).toBe(0);
    expect(list.data.list.map((item: { id: string }) => item.id)).toEqual([sceneAId]);

    const detail = await inject("GET", `/projects/${projectId}/episodes/${episodeId}`);
    const shot = detail.data.storyboards.find((item: { id: string }) => item.id === shotIds[0]);
    expect(shot.character_ids).toEqual([propAId, characterId]);

    const again = await inject("DELETE", `/projects/${projectId}/assets/${sceneBId}`);
    expect(again.code).toBe(400102);

    // 其它项目的资产不可被本项目删除
    const crossProject = await inject("DELETE", `/projects/${projectId}/assets/${otherProjectAssetId}`);
    expect(crossProject.code).toBe(400102);
  });

  it("blocks generate-videos when a bound asset is not finalized (400105)", async () => {
    const draft = await inject("POST", `/projects/${projectId}/assets`, {
      kind: "prop",
      name: "未定稿道具",
      ref_image_uri: `u/test/draft-prop-${Date.now()}.png`,
    });
    expect(draft.code).toBe(0);
    expect(draft.data.status).toBe(1);
    draftPropId = draft.data.id;

    const bound = await inject(
      "PUT",
      `/projects/${projectId}/episodes/${episodeId}/storyboards/${shotIds[0]}/assets`,
      { asset_ids: [sceneAId, draftPropId] },
    );
    expect(bound.code).toBe(0);

    const res = await inject("POST", `/projects/${projectId}/episodes/${episodeId}/storyboards/generate-videos`, {
      shot_ids: [shotIds[0]],
      budget_credits_max: 1000,
      model: "wan-3.0",
    });
    expect(res.code).toBe(0);
    const item = res.data.items.find((i: { shot_id: string }) => i.shot_id === shotIds[0]);
    expect(item.submitted).toBe(false);
    expect(item.code).toBe(400105);
  });

  it("injects a finalized scene asset's ref_image_uri into reference_uris", async () => {
    const bound = await inject(
      "PUT",
      `/projects/${projectId}/episodes/${episodeId}/storyboards/${shotIds[0]}/assets`,
      { asset_ids: [sceneAId] },
    );
    expect(bound.code).toBe(0);
    expect(bound.data.asset_ids).toEqual([sceneAId]);

    const res = await inject("POST", `/projects/${projectId}/episodes/${episodeId}/storyboards/generate-videos`, {
      shot_ids: [shotIds[0]],
      budget_credits_max: 1000,
      model: "wan-3.0",
    });
    expect(res.code).toBe(0);
    const item = res.data.items.find((i: { shot_id: string }) => i.shot_id === shotIds[0]);
    expect(item.submitted).toBe(true);
    expect(item.task_id).toBeTruthy();

    const { db, pool } = createDb(process.env.DATABASE_URL ?? "");
    try {
      const [task] = await db.select().from(tasks).where(eq(tasks.id, BigInt(item.task_id)));
      expect(task).toBeTruthy();
      const input = task!.input as { reference_uris?: string[] };
      expect(input.reference_uris).toContain(sceneARef);
      expect(input.reference_uris).toHaveLength(1);
    } finally {
      await pool.end();
    }
  });

  it("isolates assets by space (cross-space → 404)", async () => {
    const list = await raw(tokenOther, "GET", `/projects/${projectId}/assets?kind=scene`);
    expect(list.code).toBe(400102);

    const create = await raw(tokenOther, "POST", `/projects/${projectId}/assets`, {
      kind: "scene",
      name: "越权创建",
    });
    expect(create.code).toBe(400102);

    const patch = await raw(tokenOther, "PATCH", `/projects/${projectId}/assets/${sceneAId}`, {
      name: "越权改名",
    });
    expect(patch.code).toBe(400102);

    const remove = await raw(tokenOther, "DELETE", `/projects/${projectId}/assets/${sceneAId}`);
    expect(remove.code).toBe(400102);

    const bind = await raw(
      tokenOther,
      "PUT",
      `/projects/${projectId}/episodes/${episodeId}/storyboards/${shotIds[0]}/assets`,
      { asset_ids: [] },
    );
    expect(bind.code).toBe(400102);

    // 资产未被越权修改
    const self = await inject("GET", `/projects/${projectId}/assets?kind=scene`);
    expect(self.code).toBe(0);
    expect(self.data.list[0].name).toBe("雨夜街角（定稿）");
  });
});
