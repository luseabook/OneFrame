import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import cookie from "@fastify/cookie";
import { eq, inArray } from "drizzle-orm";
import { canvasNodes, canvases, episodes, projectAssets, scriptProjects, storyboards } from "@app/db";
import { newId } from "@app/shared";
import { AllExceptionsFilter } from "../src/common/http/exception.filter";
import { EnvelopeInterceptor } from "../src/common/http/envelope.interceptor";
import { AppModule } from "../src/app.module";
import { db, pool } from "../src/db/database";

/**
 * 工作流阶段探测（`GET /v1/workflow/detect`）契约测试。
 *
 * 对照竞品 `manual/workflow/_stage-machine.md` 与 `commands/workflow.md`，本测试钉住
 * 五件错了就会让 CLI「把用户带到错误环节」的事：
 *
 * 1. **未绑定项目不是错误**：没给 project_id 时返回 stage=project + missing[].sp_id，
 *    而不是 4xx/500（`commands/workflow.md:154`「探测不是错误路径」）。
 * 2. **stage = 第一个未完成阶段**（`_stage-machine.md:30`），completed/pending 顺序固定。
 * 3. **studio 只认工坊侧**：被画布引用的剧集不算 script 完成（`_stage-machine.md:32`）。
 * 4. **分镜要求"每集"非空**：只有一集有分镜不算 storyboard 完成（`_stage-machine.md:39`）。
 * 5. **render 永不自动完成**：`stage=render` 表示可以出片，不是已出片
 *    （`_stage-machine.md:40`）。
 *
 * 另外两个安全断言：跨 space 必须 403；探测**只读**（探测前后行数/状态不变）。
 */
describe("workflow detect e2e", () => {
  let app: NestFastifyApplication;
  const suffix = String(Date.now()).slice(-8);

  const inject = async (
    method: string,
    url: string,
    payload?: unknown,
    authToken?: string,
    spaceId?: string,
  ) => {
    const headers: Record<string, string> = {};
    if (payload !== undefined) headers["content-type"] = "application/json";
    if (authToken) headers.authorization = `Bearer ${authToken}`;
    if (spaceId) headers["x-space-id"] = spaceId;
    const res = await app.inject({
      method: method as "GET" | "POST" | "PATCH" | "DELETE",
      url: `/v1${url}`,
      headers,
      payload: payload === undefined ? undefined : JSON.stringify(payload),
    });
    let body: Record<string, unknown> = {};
    try {
      body = JSON.parse(res.body) as Record<string, unknown>;
    } catch {
      body = { raw: res.body };
    }
    return {
      status: res.statusCode,
      code: (body as { code?: number }).code ?? -1,
      msg: (body as { msg?: string }).msg ?? "",
      data: (body as { data?: unknown }).data,
    };
  };

  async function loginNewUser(tag: string): Promise<{ token: string; spaceId: string }> {
    const tail = String(Date.now()).slice(-5);
    // 11 位手机号：1 + 3(suite) + 5(时间戳) + 2(用例 tag) —— tag 必须在末尾，
    // 否则截断后同 ms 内的两个用例会撞号（撞号会把两个用例串到同一账号上）
    const phone = `1${suffix.slice(0, 3)}${tail}${tag}`;
    const sms = await inject("POST", "/auth/sms-code", { phone });
    const code = (sms.data as { debug_code?: string } | undefined)?.debug_code;
    const login = await inject("POST", "/auth/login", { phone, code, age_confirmed: true });
    const data = login.data as { access_token?: string; space_id?: string } | undefined;
    return { token: data?.access_token ?? "", spaceId: String(data?.space_id ?? "") };
  }

  async function createProject(token: string, spaceId: string, title: string): Promise<string> {
    const res = await inject("POST", "/projects", { title, drama_type: 1, ratio: "9:16" }, token, spaceId);
    expect(res.code).toBe(0);
    return String((res.data as { id?: string }).id ?? "");
  }

  async function episodeIds(token: string, spaceId: string, projectId: string): Promise<string[]> {
    const res = await inject("GET", `/projects/${projectId}/matrix`, undefined, token, spaceId);
    expect(res.code).toBe(0);
    const rows = (res.data as { episodes?: { id: string }[] }).episodes ?? [];
    return rows.map((row) => String(row.id));
  }

  async function detect(token: string, spaceId: string, query: string) {
    return inject("GET", `/workflow/detect${query}`, undefined, token, spaceId);
  }

  beforeAll(async () => {
    const appInstance = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter());
    await appInstance.register(cookie as unknown as Parameters<typeof appInstance.register>[0]);
    appInstance.setGlobalPrefix("v1");
    appInstance.useGlobalFilters(new AllExceptionsFilter());
    appInstance.useGlobalInterceptors(new EnvelopeInterceptor());
    await appInstance.init();
    app = appInstance;
  });

  afterAll(async () => {
    // 只清自己造的行（按随机 suffix 的标题定位），避免污染其它 suite
    const projects = await db
      .select({ id: scriptProjects.id })
      .from(scriptProjects)
      .where(eq(scriptProjects.title, `wf-${suffix}`));
    const projectIds = projects.map((p) => p.id);
    if (projectIds.length > 0) {
      const eps = await db
        .select({ id: episodes.id })
        .from(episodes)
        .where(inArray(episodes.projectId, projectIds));
      const epIds = eps.map((e) => e.id);
      if (epIds.length > 0) {
        await db.delete(storyboards).where(inArray(storyboards.episodeId, epIds));
        await db.delete(episodes).where(inArray(episodes.id, epIds));
      }
      await db.delete(projectAssets).where(inArray(projectAssets.projectId, projectIds));
      await db.delete(scriptProjects).where(inArray(scriptProjects.id, projectIds));
    }
    const projectCanvases = await db
      .select({ id: canvases.id })
      .from(canvases)
      .where(eq(canvases.title, `wf-canvas-${suffix}`));
    for (const canvas of projectCanvases) {
      await db.delete(canvasNodes).where(eq(canvasNodes.canvasId, canvas.id));
      await db.delete(canvases).where(eq(canvases.id, canvas.id));
    }
    await app.close();
    await pool.end().catch(() => {});
  });

  it("未绑定项目：stage=project、pending 全量、missing.sp_id 指向 project（不是错误）", async () => {
    const user = await loginNewUser("01");
    const res = await detect(user.token, user.spaceId, "?scope=studio");
    expect(res.status).toBe(200);
    expect(res.code).toBe(0);
    const data = res.data as {
      scope: string;
      stage: string;
      completed: string[];
      pending: string[];
      missing: { key: string; goto_stage: string }[];
      next_command: string;
    };
    expect(data.scope).toBe("studio");
    expect(data.stage).toBe("project");
    expect(data.completed).toEqual([]);
    expect(data.pending).toEqual(["project", "script", "asset", "storyboard", "render"]);
    expect(data.missing[0]).toMatchObject({ key: "sp_id", goto_stage: "project" });
    expect(data.next_command).toContain("workspace create");
  });

  it("空项目（已绑定但无剧集）：stage=script，missing 指向 script", async () => {
    const user = await loginNewUser("02");
    const projectId = await createProject(user.token, user.spaceId, `wf-${suffix}`);
    const res = await detect(user.token, user.spaceId, `?scope=studio&project_id=${projectId}`);
    expect(res.code).toBe(0);
    const data = res.data as {
      stage: string;
      completed: string[];
      missing: { key: string; goto_stage: string }[];
      next_command: string;
    };
    expect(data.stage).toBe("script");
    expect(data.completed).toEqual(["project"]);
    expect(data.missing.map((m) => m.goto_stage)).toContain("script");
    expect(data.next_command).toContain("upload");
  });

  it("有剧集但无定稿资产：stage=asset", async () => {
    const user = await loginNewUser("03");
    const projectId = await createProject(user.token, user.spaceId, `wf-${suffix}`);
    await inject("POST", `/projects/${projectId}/episodes`, { count: 1 }, user.token, user.spaceId);

    const res = await detect(user.token, user.spaceId, `?scope=studio&project_id=${projectId}`);
    const data = res.data as { stage: string; completed: string[]; missing: { key: string }[] };
    expect(data.stage).toBe("asset");
    expect(data.completed).toEqual(["project", "script"]);
    expect(data.missing.map((m) => m.key)).toContain("resource");
  });

  it("定稿资产后：stage=storyboard（有剧集但每集都还没有分镜）", async () => {
    const user = await loginNewUser("04");
    const projectId = await createProject(user.token, user.spaceId, `wf-${suffix}`);
    await inject("POST", `/projects/${projectId}/episodes`, { count: 1 }, user.token, user.spaceId);
    const asset = await inject(
      "POST",
      `/projects/${projectId}/assets`,
      { kind: "scene", name: `场景-${suffix}` },
      user.token,
      user.spaceId,
    );
    const assetId = String((asset.data as { id?: string }).id ?? "");
    const finalized = await inject(
      "PATCH",
      `/projects/${projectId}/assets/${assetId}`,
      { status: 2 },
      user.token,
      user.spaceId,
    );
    expect(finalized.code).toBe(0);

    const res = await detect(user.token, user.spaceId, `?scope=studio&project_id=${projectId}`);
    const data = res.data as { stage: string; completed: string[]; missing: { key: string }[] };
    expect(data.stage).toBe("storyboard");
    expect(data.completed).toEqual(["project", "script", "asset"]);
    expect(data.missing.map((m) => m.key)).toContain("storyboard");
  });

  it("每个剧集都有分镜后：stage=render，且 render 仍在 pending（探测不替用户判定完成）", async () => {
    const user = await loginNewUser("05");
    const projectId = await createProject(user.token, user.spaceId, `wf-${suffix}`);
    await inject("POST", `/projects/${projectId}/episodes`, { count: 2 }, user.token, user.spaceId);
    const eps = await episodeIds(user.token, user.spaceId, projectId);
    expect(eps.length).toBeGreaterThanOrEqual(2);

    const asset = await inject(
      "POST",
      `/projects/${projectId}/assets`,
      { kind: "prop", name: `道具-${suffix}` },
      user.token,
      user.spaceId,
    );
    await inject(
      "PATCH",
      `/projects/${projectId}/assets/${String((asset.data as { id?: string }).id ?? "")}`,
      { status: 2 },
      user.token,
      user.spaceId,
    );

    // 只给第一集插分镜 → 仍应停在 storyboard（"每集非空"才算完成）
    await db.insert(storyboards).values({ id: BigInt(newId()), episodeId: BigInt(eps[0]), shotNo: 1 });
    const partial = await detect(user.token, user.spaceId, `?scope=studio&project_id=${projectId}`);
    expect((partial.data as { stage: string }).stage).toBe("storyboard");
    const partialMissing = (partial.data as { missing: { key: string; reason: string }[] }).missing;
    expect(partialMissing.find((m) => m.key === "storyboard")?.reason).toContain("1/2");

    // 补齐第二集 → storyboard 完成，stage=render 但 render 不完成
    await db.insert(storyboards).values({ id: BigInt(newId()), episodeId: BigInt(eps[1]), shotNo: 1 });
    const full = await detect(user.token, user.spaceId, `?scope=studio&project_id=${projectId}`);
    const data = full.data as {
      stage: string;
      completed: string[];
      pending: string[];
      next_command: string;
    };
    expect(data.stage).toBe("render");
    expect(data.completed).toEqual(["project", "script", "asset", "storyboard"]);
    expect(data.pending).toEqual(["render"]);
    expect(data.next_command).toContain("batch-generate-video");
  });

  it("studio 只认工坊侧：被画布引用的剧集不算 script 完成（双作用域）", async () => {
    const user = await loginNewUser("06");
    const projectId = await createProject(user.token, user.spaceId, `wf-${suffix}`);
    await inject("POST", `/projects/${projectId}/episodes`, { count: 1 }, user.token, user.spaceId);
    const [episodeId] = await episodeIds(user.token, user.spaceId, projectId);

    // 把该剧集挂到画布上：等价竞品「canvas_id 非空」的剧集
    const canvas = await inject(
      "POST",
      "/canvas/canvases",
      { title: `wf-canvas-${suffix}`, creation_mode: 2, episode_id: episodeId },
      user.token,
      user.spaceId,
    );
    expect(canvas.code).toBe(0);

    const res = await detect(user.token, user.spaceId, `?scope=studio&project_id=${projectId}`);
    const data = res.data as { stage: string; completed: string[]; missing: { key: string }[] };
    expect(data.stage).toBe("script");
    expect(data.missing.map((m) => m.key)).toContain("episode");
  });

  it("canvas 作用域：按节点类型判定（text→asset 档、补 image→storyboard 档）", async () => {
    const user = await loginNewUser("07");
    const canvas = await inject(
      "POST",
      "/canvas/canvases",
      { title: `wf-canvas-${suffix}`, creation_mode: 2 },
      user.token,
      user.spaceId,
    );
    const canvasId = String((canvas.data as { id?: string }).id ?? "");

    const empty = await detect(user.token, user.spaceId, `?scope=canvas&canvas_id=${canvasId}`);
    expect((empty.data as { stage: string }).stage).toBe("script");

    await inject(
      "POST",
      `/canvas/canvases/${canvasId}/nodes`,
      { node_type: "text", x: 0, y: 0 },
      user.token,
      user.spaceId,
    );
    const withText = await detect(user.token, user.spaceId, `?scope=canvas&canvas_id=${canvasId}`);
    expect((withText.data as { stage: string }).stage).toBe("asset");

    // asset 档的判据是「拆资产或图片节点」（_stage-machine.md:38），表格节点只补分镜档
    await inject(
      "POST",
      `/canvas/canvases/${canvasId}/nodes`,
      { node_type: "image", x: 0, y: 10 },
      user.token,
      user.spaceId,
    );
    const withImage = await detect(user.token, user.spaceId, `?scope=canvas&canvas_id=${canvasId}`);
    expect((withImage.data as { stage: string }).stage).toBe("storyboard");

    await inject(
      "POST",
      `/canvas/canvases/${canvasId}/nodes`,
      { node_type: "table", x: 10, y: 0 },
      user.token,
      user.spaceId,
    );
    const withTable = await detect(user.token, user.spaceId, `?scope=canvas&canvas_id=${canvasId}`);
    const data = withTable.data as { stage: string; completed: string[] };
    expect(data.stage).toBe("render");
    expect(data.completed).toEqual(["project", "script", "asset", "storyboard"]);
  });

  it("跨 space 探测别人的项目 → 403（多租户隔离）", async () => {
    const owner = await loginNewUser("08");
    const outsider = await loginNewUser("09");
    const projectId = await createProject(owner.token, owner.spaceId, `wf-${suffix}`);

    const res = await detect(outsider.token, outsider.spaceId, `?scope=studio&project_id=${projectId}`);
    expect(res.code).toBe(403101);
    expect(res.msg).toContain("not a member");
  });

  it("不存在的项目 → 404 语义（400102），不是空结果", async () => {
    const user = await loginNewUser("10");
    const res = await detect(user.token, user.spaceId, "?scope=studio&project_id=999999999999");
    expect(res.code).toBe(400102);
  });

  it("参数校验：scope 非 studio|canvas → 400101", async () => {
    const user = await loginNewUser("11");
    const res = await detect(user.token, user.spaceId, "?scope=wrong");
    expect(res.code).toBe(400101);
  });

  it("未登录 → 401101", async () => {
    const res = await inject("GET", "/workflow/detect?scope=studio");
    expect(res.code).toBe(401101);
  });

  it("探测只读：连续探测不改变任何行数/状态", async () => {
    const user = await loginNewUser("12");
    const projectId = await createProject(user.token, user.spaceId, `wf-${suffix}`);
    await inject("POST", `/projects/${projectId}/episodes`, { count: 1 }, user.token, user.spaceId);

    const snapshot = async () => {
      const eps = await db.select({ id: episodes.id }).from(episodes).where(eq(episodes.projectId, BigInt(projectId)));
      const assets = await db
        .select({ id: projectAssets.id, status: projectAssets.status })
        .from(projectAssets)
        .where(eq(projectAssets.projectId, BigInt(projectId)));
      const shots = await db
        .select({ id: storyboards.id })
        .from(storyboards)
        .where(inArray(storyboards.episodeId, eps.map((e) => e.id)));
      return { eps: eps.length, assets: assets.length, shots: shots.length, statuses: assets.map((a) => a.status) };
    };

    const before = await snapshot();
    for (let i = 0; i < 3; i += 1) {
      const res = await detect(user.token, user.spaceId, `?scope=studio&project_id=${projectId}`);
      expect(res.code).toBe(0);
    }
    expect(await snapshot()).toEqual(before);
  });
});
