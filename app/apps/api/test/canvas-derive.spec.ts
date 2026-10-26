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

  it("后台可改价：改金额后同一请求的报价立刻变（证明价格没写死）", async () => {
    const list = await admin("GET", "/ops/admin/model-prices?page=1&page_size=100");
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
