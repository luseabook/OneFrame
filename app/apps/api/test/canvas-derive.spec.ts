import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import cookie from "@fastify/cookie";
import { AllExceptionsFilter } from "../src/common/http/exception.filter";
import { EnvelopeInterceptor } from "../src/common/http/envelope.interceptor";
import { AppModule } from "../src/app.module";
import { pool } from "../src/db/database";

/**
 * 文本类派生（剧本优化 / 拆解分镜）+ 后台价目可写
 *
 * 本轮的核心命题是 owner 定的那条：**价格在后台调，代码不写死**。所以这里最关键的
 * 断言不是"能创建任务"，而是：
 *   改掉 `model_prices` 里的金额之后，同一请求的 `credits_estimate` 立刻跟着变。
 * 如果代码里藏着任何"文本能力固定 N 积分"的常量，这条断言就会失败。
 */
describe("canvas text derive + admin pricing e2e", () => {
  let app: NestFastifyApplication;
  let token = "";
  let adminToken = "";
  let canvasId = "";
  let scriptNodeId = "";
  let imageNodeId = "";
  let videoNodeId = "";

  const inject = async (
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
    url: string,
    payload?: unknown,
    authToken?: string,
  ) => {
    const headers: Record<string, string> = {};
    if (payload !== undefined) headers["content-type"] = "application/json";
    if (authToken ?? token) headers.authorization = `Bearer ${authToken ?? token}`;
    const res = await app.inject({
      method,
      url: `/v1${url}`,
      headers,
      payload: payload === undefined ? undefined : JSON.stringify(payload),
    });
    const body = JSON.parse(res.body);
    return { status: res.statusCode, ...body, body };
  };

  const admin = (method: "GET" | "POST" | "PATCH" | "DELETE", url: string, payload?: unknown) =>
    inject(method, url, payload, adminToken);

  async function loginNewUser(tag: string): Promise<string> {
    const tail = String(Date.now()).slice(-8);
    const phone = `1${tail}${String(tag).replace(/\D/g, "").slice(-2).padStart(2, "0")}`;
    const sms = await inject("POST", "/auth/sms-code", { phone });
    const login = await inject("POST", "/auth/login", { phone, code: sms.data?.debug_code, age_confirmed: true });
    const tk = login.data?.access_token as string;
    if (!tk) throw new Error(`login failed: ${JSON.stringify(login.body).slice(0, 200)}`);
    return tk;
  }

  beforeAll(async () => {
    app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter({ trustProxy: true }), {
      logger: false,
    });
    await app.register(cookie);
    app.setGlobalPrefix("v1");
    app.useGlobalInterceptors(new EnvelopeInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    const adminLogin = await inject("POST", "/ops/admin/login", { username: "admin", password: "admin12345" });
    adminToken = adminLogin.data?.token as string;
    if (!adminToken) throw new Error("admin login failed");

    token = await loginNewUser("01");
    const created = await inject("POST", "/canvas/canvases", { title: "文本派生测试" });
    canvasId = created.data.id as string;

    const script = await inject("POST", `/canvas/canvases/${canvasId}/nodes`, {
      node_type: "script",
      name: "第一集剧本",
      x: 0,
      y: 0,
      params: { script_text: "场景一 · 夜 · 内\n林晚：这件事没那么简单。" },
    });
    scriptNodeId = script.data.id as string;

    const image = await inject("POST", `/canvas/canvases/${canvasId}/nodes`, {
      node_type: "image",
      name: "配图",
      x: 300,
      y: 0,
      params: {},
    });
    imageNodeId = image.data.id as string;

    const video = await inject("POST", `/canvas/canvases/${canvasId}/nodes`, {
      node_type: "video",
      name: "待拆解视频",
      x: 600,
      y: 0,
      params: { result_uri: "mock://results/demo.mp4", mode: "text2video", model: "seedance-1-0-lite" },
    });
    videoNodeId = video.data.id as string;
  }, 120_000);

  afterAll(async () => {
    await app.close();
    await pool.end().catch(() => {});
  });

  it("剧本优化：建任务、节点挂 task_id 并进入生成中，报价来自价目表", async () => {
    const res = await inject(
      "POST",
      `/canvas/canvases/${canvasId}/nodes/${scriptNodeId}/script-optimization`,
      {},
    );
    expect(res.code).toBe(0);
    expect(res.data.task_id).toBeTruthy();
    expect(res.data.node.status).toBe(2);

    // 报价值应等于 model_prices 里该模型的 script_optimization 单价（seed 初始 2 分）
    const { rows } = await pool.query<{ credits: number }>(
      `select p.credits from model_prices p
         join models m on m.id = p.model_id
        where m.name = 'deepseek-v4-pro' and p.mode = 'script_optimization' and p.active = true`,
    );
    expect(res.data.credits_estimate).toBe(rows[0]!.credits);
  }, 60_000);

  it("拆解分镜：任务落库且 mode/scene 正确（复用 tasks，不另造表）", async () => {
    const res = await inject(
      "POST",
      `/canvas/canvases/${canvasId}/nodes/${scriptNodeId}/storyboard-parse`,
      { prompt: "镜头尽量少" },
    );
    expect(res.code).toBe(0);
    const { rows } = await pool.query<{ mode: string; space_id: string }>(
      "select mode, space_id from tasks where id = $1",
      [res.data.task_id],
    );
    expect(rows[0]?.mode).toBe("storyboard_parse");
  }, 60_000);

  it("非文本节点 / 空原文 / 超长原文 分别 400101、400101、400104", async () => {
    const wrongType = await inject(
      "POST",
      `/canvas/canvases/${canvasId}/nodes/${imageNodeId}/script-optimization`,
      {},
    );
    expect(wrongType.code).toBe(400101);

    const empty = await inject("POST", `/canvas/canvases/${canvasId}/nodes`, {
      node_type: "text",
      name: "空节点",
      x: 0,
      y: 200,
      params: {},
    });
    const emptyDerive = await inject(
      "POST",
      `/canvas/canvases/${canvasId}/nodes/${empty.data.id}/script-optimization`,
      {},
    );
    expect(emptyDerive.code).toBe(400101);

    const tooLong = await inject(
      "POST",
      `/canvas/canvases/${canvasId}/nodes/${scriptNodeId}/script-optimization`,
      { source_text: "字".repeat(50_001) },
    );
    expect(tooLong.code).toBe(400104);
  }, 60_000);

  it("拆分资产：落 tasks 且 mode=asset_extraction（与另两个文本能力同一条脊柱）", async () => {
    const res = await inject(
      "POST",
      `/canvas/canvases/${canvasId}/nodes/${scriptNodeId}/asset-extraction`,
      { active_tab: "character" },
    );
    expect(res.code).toBe(0);
    const { rows } = await pool.query<{ mode: string }>("select mode from tasks where id = $1", [
      res.data.task_id,
    ]);
    expect(rows[0]?.mode).toBe("asset_extraction");

    // active_tab 只接受三个合法值（参照站语义：用户停在哪个 tab 就优先出哪一类）
    const badTab = await inject(
      "POST",
      `/canvas/canvases/${canvasId}/nodes/${scriptNodeId}/asset-extraction`,
      { active_tab: "character; DROP TABLE" },
    );
    expect(badTab.code).toBe(400101);
  }, 60_000);

  it("分镜×资产匹配：落 tasks、可取消、可重跑且不覆盖上一条", async () => {
    // 剧本节点先有"分镜文本"（这里直接用节点的 result_text 模拟已拆过分镜）
    const storyboard = await inject("POST", `/canvas/canvases/${canvasId}/nodes`, {
      node_type: "script",
      name: "分镜来源",
      x: 0,
      y: 400,
      params: { result_text: "镜1 | 全景 | 雨夜街头，林晚撑伞 | 5s | 9:16\n镜2 | 中景 | 顾沉递出怀表 | 5s | 9:16" },
    });
    const character = await inject("POST", `/canvas/canvases/${canvasId}/nodes`, {
      node_type: "asset",
      name: "角色·林晚",
      x: 400,
      y: 400,
      params: { assetKind: "character", prompt: "短剧角色肖像，林晚，冷色光影" },
    });
    const scene = await inject("POST", `/canvas/canvases/${canvasId}/nodes`, {
      node_type: "asset",
      name: "场景·雨夜街头",
      x: 400,
      y: 560,
      params: { assetKind: "scene", prompt: "电影感场景，雨夜街头" },
    });

    const matched = await inject(
      "POST",
      `/canvas/canvases/${canvasId}/nodes/${storyboard.data.id}/storyboard-asset-match`,
      {
        storyboard_node_id: storyboard.data.id,
        character_node_ids: [character.data.id],
        scene_node_ids: [scene.data.id],
      },
    );
    expect(matched.code).toBe(0);
    const firstTask = matched.data.task_id as string;
    const { rows } = await pool.query<{ mode: string }>("select mode from tasks where id = $1", [firstTask]);
    expect(rows[0]?.mode).toBe("storyboard_asset_match");

    // 重跑：产生**新任务**（不覆盖上一条，用户要能对比两次匹配）
    const rematched = await inject(
      "POST",
      `/canvas/canvases/${canvasId}/nodes/${storyboard.data.id}/storyboard-asset-rematch`,
      { storyboard_node_id: storyboard.data.id, task_id: firstTask },
    );
    expect(rematched.code).toBe(0);
    expect(rematched.data.task_id).not.toBe(firstTask);

    // 取消：复用 tasks.cancel（终态不可取消 → 400103）
    const cancelled = await inject(
      "POST",
      `/canvas/canvases/${canvasId}/nodes/${storyboard.data.id}/storyboard-asset-match/cancel`,
      { task_id: rematched.data.task_id },
    );
    // 队列里没有 worker，任务处于 PENDING/RUNNING 才可取消；已终态则 400103。
    // 两种结果都合法，关键是不能 500、也不能"取消成功但任务还在跑"。
    expect([0, 400103, 400102]).toContain(cancelled.code);

    // 未知任务 → 400102
    const unknown = await inject(
      "POST",
      `/canvas/canvases/${canvasId}/nodes/${storyboard.data.id}/storyboard-asset-match/cancel`,
      { task_id: "999999" },
    );
    expect(unknown.code).toBe(400102);
  }, 60_000);

  it("资产未定稿（无 prompt）→ 400105，不允许拿空名字去匹配", async () => {
    const storyboard = await inject("POST", `/canvas/canvases/${canvasId}/nodes`, {
      node_type: "script",
      name: "分镜来源2",
      x: 0,
      y: 700,
      params: { result_text: "镜1 | 全景 | 空镜 | 5s | 9:16" },
    });
    const draft = await inject("POST", `/canvas/canvases/${canvasId}/nodes`, {
      node_type: "asset",
      name: "草稿资产",
      x: 700,
      y: 700,
      params: { assetKind: "prop" },
    });
    const res = await inject(
      "POST",
      `/canvas/canvases/${canvasId}/nodes/${storyboard.data.id}/storyboard-asset-match`,
      { character_node_ids: [draft.data.id] },
    );
    expect(res.code).toBe(400105);
  }, 60_000);

  it("视频拆解：落 tasks 且 mode=video_parse（分析类与文本同一条脊柱，报价来自价目表）", async () => {
    const res = await inject("POST", `/canvas/canvases/${canvasId}/nodes/${videoNodeId}/video-parse`, {});
    expect(res.code).toBe(0);
    expect(res.data.node.status).toBe(2);
    const { rows } = await pool.query<{ mode: string }>("select mode from tasks where id = $1", [
      res.data.task_id,
    ]);
    expect(rows[0]?.mode).toBe("video_parse");

    // 价格同样来自 model_prices（seed 只是新库初值，运营可改）
    const price = await pool.query<{ credits: number }>(
      `select p.credits from model_prices p
         join models m on m.id = p.model_id
        where m.name = 'deepseek-v4-pro' and p.mode = 'video_parse' and p.active = true`,
    );
    expect(price.rows[0]?.credits).toBeTruthy();
    expect(res.data.credits_estimate).toBe(price.rows[0]!.credits);

    // 契约第二条：GET 只返回 task 本体（节点视图仍走 nodes/{id}/task/{task_id}）
    const status = await inject(
      "GET",
      `/canvas/canvases/${canvasId}/nodes/${videoNodeId}/video-parse/${res.data.task_id}`,
    );
    expect(status.code).toBe(0);
    expect(status.data.task.task_id).toBe(res.data.task_id);

    // 任务不属于该节点（或不存在）→ 400102，防止串节点/越权查询
    const wrong = await inject("GET", `/canvas/canvases/${canvasId}/nodes/${videoNodeId}/video-parse/999999`);
    expect(wrong.code).toBe(400102);
  }, 60_000);

  it("视频拆解：非视频节点 / 节点上没有视频产物 分别 400101；显式 object_key 可用", async () => {
    const wrongType = await inject("POST", `/canvas/canvases/${canvasId}/nodes/${imageNodeId}/video-parse`, {});
    expect(wrongType.code).toBe(400101);

    const emptyVideo = await inject("POST", `/canvas/canvases/${canvasId}/nodes`, {
      node_type: "video",
      name: "空视频",
      x: 0,
      y: 900,
      params: {},
    });
    const noMedia = await inject("POST", `/canvas/canvases/${canvasId}/nodes/${emptyVideo.data.id}/video-parse`, {});
    expect(noMedia.code).toBe(400101);

    // 素材库上传的视频（显式 object_key）不依赖节点产物，应可拆解
    const withKey = await inject("POST", `/canvas/canvases/${canvasId}/nodes/${emptyVideo.data.id}/video-parse`, {
      object_key: "u/space/demo-video.mp4",
    });
    expect(withKey.code).toBe(0);
  }, 60_000);

  it("后台可改价：改金额后同一请求的报价立刻变（证明价格没写死）", async () => {    const list = await admin("GET", "/ops/admin/model-prices?page=1&page_size=100");
    expect(list.code).toBe(0);
    const price = (list.data.list as Array<{ id: string; mode: string; credits: number; model_id: string }>).find(
      (row) => row.mode === "script_optimization",
    );
    expect(price).toBeTruthy();

    const doubled = await admin("PATCH", `/ops/admin/model-prices/${price!.id}`, { credits: 7 });
    expect(doubled.code).toBe(0);

    const derived = await inject(
      "POST",
      `/canvas/canvases/${canvasId}/nodes/${scriptNodeId}/script-optimization`,
      {},
    );
    expect(derived.code).toBe(0);
    expect(derived.data.credits_estimate).toBe(7);

    // 复原，避免影响其它用例/复跑
    await admin("PATCH", `/ops/admin/model-prices/${price!.id}`, { credits: price!.credits });
  }, 60_000);

  it("后台可涨价目：删除 → 新建 → 重复被唯一键挡住 → 复原", async () => {
    const models = await admin("GET", "/ops/admin/models");
    const model = (models.data as Array<{ id: string; name: string }>).find(
      (row) => row.name === "deepseek-v4-pro",
    );
    expect(model).toBeTruthy();

    // 目录里没有的 mode → 400101（防止运营造出"一调用就失败"的价目）
    const badMode = await admin("POST", "/ops/admin/model-prices", {
      model_id: model!.id,
      mode: "not_a_mode",
      resolution: "per_call",
      credits: 5,
    });
    expect(badMode.code).toBe(400101);

    // 档位必须取自该 mode 声明的 resolution_options
    const badTier = await admin("POST", "/ops/admin/model-prices", {
      model_id: model!.id,
      mode: "script_optimization",
      resolution: "1080p",
      credits: 5,
    });
    expect(badTier.code).toBe(400101);

    // 按次计价的模式不允许带 duration_s（否则会凭空多出"5s 文本"档）
    const badDuration = await admin("POST", "/ops/admin/model-prices", {
      model_id: model!.id,
      mode: "script_optimization",
      resolution: "per_call",
      duration_s: 5,
      credits: 5,
    });
    expect(badDuration.code).toBe(400101);

    // 先摘掉 seed 里的这一档，才有"新建"的空间
    const list = await admin("GET", "/ops/admin/model-prices?page=1&page_size=100");
    const seedRow = (list.data.list as Array<{ id: string; mode: string; resolution: string }>).find(
      (row) => row.mode === "script_optimization" && row.resolution === "per_call",
    );
    expect(seedRow).toBeTruthy();
    const removed = await admin("DELETE", `/ops/admin/model-prices/${seedRow!.id}`);
    expect(removed.code).toBe(0);

    const created = await admin("POST", "/ops/admin/model-prices", {
      model_id: model!.id,
      mode: "script_optimization",
      resolution: "per_call",
      credits: 11,
      strikeCredits: 13,
    });
    expect(created.code).toBe(0);
    expect(created.data.credits).toBe(11);

    // 同一档位再来一次：必须 400101（部分唯一索引 uq_model_prices_per_call 兜底，
    // 否则会影响扣费金额的确定性——这正是本轮修掉的计费缺陷）
    const dup = await admin("POST", "/ops/admin/model-prices", {
      model_id: model!.id,
      mode: "script_optimization",
      resolution: "per_call",
      credits: 9,
    });
    expect(dup.code).toBe(400101);

    // 复原成初始价，避免影响其它用例与复跑
    await admin("DELETE", `/ops/admin/model-prices/${String(created.data.id)}`);
    const restored = await admin("POST", "/ops/admin/model-prices", {
      model_id: model!.id,
      mode: "script_optimization",
      resolution: "per_call",
      credits: 2,
    });
    expect(restored.code).toBe(0);
  }, 60_000);
});
