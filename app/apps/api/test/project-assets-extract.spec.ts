import { afterAll, beforeAll, describe, expect, it } from "vitest";
import cookie from "@fastify/cookie";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { AppModule } from "../src/app.module";
import { AllExceptionsFilter } from "../src/common/http/exception.filter";
import { EnvelopeInterceptor } from "../src/common/http/envelope.interceptor";
import { LlmService } from "../src/modules/script/llm.service";

// P3：AI 提取资产（场景/道具/可选角色 → project_assets 草稿；mock 模式确定性输出）
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

const P2_DTO_FIELDS = [
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
  "finalized_at",
  "bound_shot_count",
];

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

describe("AI asset extraction (P3): 剧本 → 场景/道具草稿资产", () => {
  let projectId = "";
  let episodeId = "";
  let episodeProjectId = "";
  let episodeProjectEpisodeId = "";
  const extractedSceneIds: string[] = [];
  const extractedPropIds: string[] = [];
  let firstScene: { id: string; description: string | null; prompt: string | null };

  it("prepares projects with source text and one drafted episode", async () => {
    const created = await inject("POST", "/projects", {
      title: "AI 提取测试",
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

    // 独立的第二个项目：用 episode_id 作为内容来源（避免与项目级提取的资产互相干扰）
    const second = await inject("POST", "/projects", {
      title: "分集提取项目",
      source_type: 1,
      source_text: "备用素材",
    });
    expect(second.code).toBe(0);
    episodeProjectId = second.data.id;
    const secondOutline = await inject("POST", `/projects/${episodeProjectId}/outline/generate`);
    expect(secondOutline.code).toBe(0);
    episodeProjectEpisodeId = secondOutline.data[0].id;
    const secondDraft = await inject(
      "POST",
      `/projects/${episodeProjectId}/episodes/${episodeProjectEpisodeId}/script-draft/generate`,
      {},
    );
    expect(secondDraft.code).toBe(0);
  });

  it("extracts scene/prop draft assets from the project source text", async () => {
    const res = await inject("POST", `/projects/${projectId}/assets/extract`, {});
    expect(res.code).toBe(0);
    expect(Object.keys(res.data).sort()).toEqual(["created", "items", "skipped", "truncated", "updated"]);
    expect(res.data.created).toBe(6); // mock：3 场景 + 3 道具
    expect(res.data.updated).toBe(0);
    expect(res.data.skipped).toBe(0);
    expect(res.data.truncated).toBe(false);
    expect(res.data.items).toHaveLength(6);

    const items = res.data.items as Array<Record<string, unknown>>;
    const scenes = items.filter((item) => item.kind === "scene");
    const props = items.filter((item) => item.kind === "prop");
    expect(scenes).toHaveLength(3);
    expect(props).toHaveLength(3);
    // 名称去重
    expect(new Set(items.map((item) => `${item.kind}:${item.name}`)).size).toBe(6);

    for (const item of items) {
      // P2 DTO 同构（含 finalized_at / bound_shot_count）
      expect(Object.keys(item).sort()).toEqual([...P2_DTO_FIELDS].sort());
      expect(item.status).toBe(1); // 草稿
      expect(item.finalized_at).toBeNull();
      expect(item.bound_shot_count).toBe(0);
      expect(String(item.name).length).toBeGreaterThan(0);
      expect(String(item.prompt).length).toBeGreaterThan(0);
      expect(String(item.description).length).toBeGreaterThan(0);
      expect(item.ref_image_uri).toBeNull();
    }

    for (const item of scenes) extractedSceneIds.push(String(item.id));
    for (const item of props) extractedPropIds.push(String(item.id));
    firstScene = {
      id: String(scenes[0]!.id),
      description: scenes[0]!.description as string,
      prompt: scenes[0]!.prompt as string,
    };

    // 落库生效：GET 列表能读到同批草稿
    const sceneList = await inject("GET", `/projects/${projectId}/assets?kind=scene`);
    expect(sceneList.code).toBe(0);
    expect(sceneList.data.list.map((item: { id: string }) => item.id).sort()).toEqual(
      [...extractedSceneIds].sort(),
    );
    const propList = await inject("GET", `/projects/${projectId}/assets?kind=prop`);
    expect(propList.data.list.map((item: { id: string }) => item.id).sort()).toEqual(
      [...extractedPropIds].sort(),
    );
    // 列表项与提取返回项同构
    expect(Object.keys(sceneList.data.list[0]).sort()).toEqual([...P2_DTO_FIELDS].sort());
    expect(sceneList.data.list[0].name).toBe(scenes[0]!.name);
  });

  it("is idempotent on replay without overwrite (created=0, skipped>0)", async () => {
    const res = await inject("POST", `/projects/${projectId}/assets/extract`, {});
    expect(res.code).toBe(0);
    expect(res.data.created).toBe(0);
    expect(res.data.updated).toBe(0);
    expect(res.data.skipped).toBe(6);
    expect(res.data.items).toEqual([]);
    expect(res.data.truncated).toBe(false);

    const list = await inject("GET", `/projects/${projectId}/assets`);
    expect(list.data.list).toHaveLength(6); // 未重复落库
  });

  it("overwrite=true updates description/prompt but never status/finalized_at/ref_image_uri", async () => {
    const patched = await inject("PATCH", `/projects/${projectId}/assets/${firstScene.id}`, {
      description: "人工改写的描述",
      ref_image_uri: "u/test/extract-manual.png",
      status: 2,
    });
    expect(patched.code).toBe(0);
    expect(patched.data.status).toBe(2);
    const finalizedAt = patched.data.finalized_at as string;
    expect(finalizedAt).toBeTruthy();

    const res = await inject("POST", `/projects/${projectId}/assets/extract`, { overwrite: true });
    expect(res.code).toBe(0);
    // 只有被人工改过的那一条文本有差异 → updated=1，其余 5 条幂等跳过
    expect(res.data.created).toBe(0);
    expect(res.data.updated).toBe(1);
    expect(res.data.skipped).toBe(5);
    expect(res.data.items).toHaveLength(1);

    const item = res.data.items[0];
    expect(item.id).toBe(firstScene.id);
    expect(item.description).toBe(firstScene.description); // 覆盖回 AI 结果
    expect(item.description).not.toBe("人工改写的描述");
    // 定稿状态 / 定稿时间 / 参考图绑定一律不动
    expect(item.status).toBe(2);
    expect(item.finalized_at).toBe(finalizedAt);
    expect(item.ref_image_uri).toBe("u/test/extract-manual.png");
    expect(String(item.portrait_url)).toContain("files/local");
  });

  it("extracts from a specific episode via episode_id", async () => {
    const res = await inject("POST", `/projects/${episodeProjectId}/assets/extract`, {
      episode_id: episodeProjectEpisodeId,
    });
    expect(res.code).toBe(0);
    expect(res.data.created).toBe(6);
    expect(res.data.skipped).toBe(0);
    expect(res.data.items.filter((item: { kind: string }) => item.kind === "scene")).toHaveLength(3);
    expect(res.data.items.filter((item: { kind: string }) => item.kind === "prop")).toHaveLength(3);
  });

  it("returns 400102 for a missing episode_id and 400101 for malformed input", async () => {
    const missing = await inject("POST", `/projects/${projectId}/assets/extract`, {
      episode_id: "999999999999999999",
    });
    expect(missing.code).toBe(400102);

    const malformed = await inject("POST", `/projects/${projectId}/assets/extract`, {
      overwrite: "yes",
    });
    expect(malformed.code).toBe(400101);

    const tooLong = await inject("POST", `/projects/${projectId}/assets/extract`, {
      episode_id: "x".repeat(33),
    });
    expect(tooLong.code).toBe(400101);
  });

  it("include_characters=true persists character drafts and dedupes existing same-name assets", async () => {
    const first = await inject("POST", `/projects/${projectId}/assets/extract`, {
      include_characters: true,
    });
    expect(first.code).toBe(0);
    expect(first.data.created).toBe(3); // 3 个角色；场景/道具同名已存在 → skipped
    expect(first.data.skipped).toBe(6);
    expect(first.data.items).toHaveLength(3);
    expect(first.data.items.every((item: { kind: string; status: number }) => item.kind === "character" && item.status === 1)).toBe(true);

    // 再跑一次：角色同样按 kind+name 去重
    const second = await inject("POST", `/projects/${projectId}/assets/extract`, {
      include_characters: true,
    });
    expect(second.code).toBe(0);
    expect(second.data.created).toBe(0);
    expect(second.data.skipped).toBe(9);

    const characters = await inject("GET", `/projects/${projectId}/assets?kind=character`);
    expect(characters.code).toBe(0);
    expect(characters.data.list).toHaveLength(3);
  });

  it("isolates extraction by space (cross-space → 400102)", async () => {
    const res = await raw(tokenOther, "POST", `/projects/${projectId}/assets/extract`, {});
    expect(res.code).toBe(400102);

    // 未产生越权写入
    const list = await inject("GET", `/projects/${projectId}/assets?kind=scene`);
    expect(list.code).toBe(0);
    expect(list.data.list).toHaveLength(3);
  });

  it("truncates to 20 assets and flags truncated=true", async () => {
    // 极端情况：LLM 返回超过 20 条（真实模型 prompt 上限 50 条/类）
    const created = await inject("POST", "/projects", {
      title: "截断测试",
      source_type: 1,
      source_text: "素材",
    });
    expect(created.code).toBe(0);
    const truncProjectId = created.data.id;

    const llm = app.get(LlmService);
    const original = llm.extractAssets;
    llm.extractAssets = async () => ({
      scenes: Array.from({ length: 25 }, (_, i) => ({
        name: `批量场景${String(i + 1).padStart(2, "0")}`,
        description: "批量场景描述",
        prompt: "批量场景提示词",
      })),
      props: [],
      characters: [],
    });
    try {
      const res = await inject("POST", `/projects/${truncProjectId}/assets/extract`, {});
      expect(res.code).toBe(0);
      expect(res.data.truncated).toBe(true);
      expect(res.data.created).toBe(20);
      expect(res.data.skipped).toBe(0);
      expect(res.data.items).toHaveLength(20);

      const list = await inject("GET", `/projects/${truncProjectId}/assets?kind=scene`);
      expect(list.data.list).toHaveLength(20);
    } finally {
      llm.extractAssets = original;
    }
  });
});
