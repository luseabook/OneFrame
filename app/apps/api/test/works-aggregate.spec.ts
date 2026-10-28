import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import cookie from "@fastify/cookie";
import { sql } from "drizzle-orm";
import { canvasNodes, canvases, assets, tasks } from "@app/db";
import { newId } from "@app/shared";
import { AllExceptionsFilter } from "../src/common/http/exception.filter";
import { EnvelopeInterceptor } from "../src/common/http/envelope.interceptor";
import { AppModule } from "../src/app.module";
import { db, pool } from "../src/db/database";

/**
 * 全部项目聚合（`GET /works`）契约测试 —— 工坊项目 + 画布项目跨域只读投影。
 *
 * 竞品证据：`_acceptance/_gap/fullsite-route-inventory.md:81`（作品清单口径）；
 * 竞品「全部项目」把剧集项目与画布项目放在同一清单。
 *
 * 关键断言：
 * 1. **三形态**：`tab=workshop|canvas|all` 各自只返回对应形态，`all` 按更新时间归并；
 * 2. **筛选进 SQL**：关键词/归档/四态/时间筛选后的 `total` 必须与 `list` 自洽
 *    （在内存里过滤会出现"总数 10、列表 2 条"的假分页）；
 * 3. **跨域只读**：画布只读投影出 node_count 等统计，不改画布任何一列；跨 space 空列表。
 */
describe("works aggregate e2e", () => {
  let app: NestFastifyApplication;
  let token = "";
  let tokenOther = "";
  let spaceId = "";
  let userId = "";
  let otherSpaceId = "";
  const stamp = `w${Date.now()}`;

  interface Envelope {
    code: number;
    msg: string;
    data: any;
  }

  const raw = async (
    asToken: string,
    method: "GET" | "POST",
    url: string,
    payload?: unknown,
  ): Promise<Envelope> => {
    const res = await app.inject({
      method,
      url: `/v1${url}`,
      payload: payload as Record<string, unknown> | undefined,
      headers: { authorization: `Bearer ${asToken}` },
    });
    return res.json() as Envelope;
  };
  const inject = (method: "GET" | "POST", url: string, payload?: unknown) => raw(token, method, url, payload);

  const login = async (phone: string) => {
    const sms = (await app.inject({ method: "POST", url: "/v1/auth/sms-code", payload: { phone } })).json() as Envelope;
    expect(sms.code).toBe(0);
    const body = (
      await app.inject({
        method: "POST",
        url: "/v1/auth/login",
        payload: { phone, code: sms.data.debug_code as string, age_confirmed: true },
      })
    ).json() as Envelope;
    expect(body.code).toBe(0);
    return {
      token: body.data.access_token as string,
      spaceId: String(body.data.space_id),
      userId: String(body.data.user.id),
    };
  };

  let canvasId = "";
  let activeProjectId = "";
  let archivedProjectId = "";
  // 第 62 批：封面相关夹具
  let manualAssetId = "";
  let autoAssetId = "";
  let imageNodeId = "";
  let foreignAssetId = "";
  let coverTaskId = "";

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

    const a = await login(`19${String(Math.floor(Math.random() * 900000000) + 100000000)}`);
    token = a.token;
    spaceId = a.spaceId;
    userId = a.userId;
    const b = await login(`19${String(Math.floor(Math.random() * 900000000) + 100000000)}`);
    tokenOther = b.token;
    otherSpaceId = b.spaceId;

    // 工坊侧：一个活跃项目 + 一个已归档项目（归档走既有端点，保持只读投影假设）
    const active = await inject("POST", "/projects", {
      title: `作品A-${stamp}`,
      source_type: 1,
      source_text: "第一章：开端。",
    });
    expect(active.code).toBe(0);
    activeProjectId = active.data.id;
    const archived = await inject("POST", "/projects", {
      title: `作品B-${stamp}`,
      source_type: 1,
      source_text: "第一章：另一个故事。",
    });
    expect(archived.code).toBe(0);
    archivedProjectId = archived.data.id;
    expect((await inject("POST", `/projects/${archivedProjectId}/archive`, { archived: true })).code).toBe(0);

    // 画布侧：直接落一行画布 + 两个节点（只读投影要能数出 node_count）
    canvasId = String(newId());
    await db.insert(canvases).values({
      id: BigInt(canvasId),
      spaceId: BigInt(spaceId),
      title: `画布-${stamp}`,
      creationMode: 2,
      ownerUserId: BigInt(userId),
      version: 1,
    });
    await db.insert(canvasNodes).values([
      {
        id: newId(),
        spaceId: BigInt(spaceId),
        canvasId: BigInt(canvasId),
        nodeType: "text",
        name: "节点1",
      },
      {
        id: newId(),
        spaceId: BigInt(spaceId),
        canvasId: BigInt(canvasId),
        nodeType: "image",
        name: "节点2",
        status: 2,
      },
    ]);

    // ── 第 62 批夹具：封面 ────────────────────────────────
    // ① 人工可选的素材（走 asset_id 分支；不需要任务）
    manualAssetId = String(newId());
    await db.insert(assets).values({
      id: BigInt(manualAssetId),
      spaceId: BigInt(spaceId),
      kind: "image",
      uri: `u/${spaceId}/assets/manual-${stamp}.png`,
      name: `人工封面-${stamp}`,
    });
    // ② 图片节点产物（走自动兜底：node.task_id → assets.source_task_id）
    coverTaskId = String(newId());
    await db.insert(tasks).values({
      id: BigInt(coverTaskId),
      spaceId: BigInt(spaceId),
      userId: BigInt(userId),
      capability: "image",
      mode: "text2image",
      modelId: 1001n,
      input: { prompt: "cover" },
      options: {},
      status: 3,
    });
    autoAssetId = String(newId());
    await db.insert(assets).values({
      id: BigInt(autoAssetId),
      spaceId: BigInt(spaceId),
      kind: "image",
      uri: `u/${spaceId}/assets/auto-${stamp}.png`,
      name: `自动封面-${stamp}`,
      sourceTaskId: BigInt(coverTaskId),
    });
    imageNodeId = String(newId());
    await db.insert(canvasNodes).values({
      id: BigInt(imageNodeId),
      spaceId: BigInt(spaceId),
      canvasId: BigInt(canvasId),
      nodeType: "image",
      name: "产物节点",
      status: 3,
      taskId: BigInt(coverTaskId),
    });
    // ③ 别的空间的素材（越权用例）
    foreignAssetId = String(newId());
    await db.insert(assets).values({
      id: BigInt(foreignAssetId),
      spaceId: BigInt(otherSpaceId),
      kind: "image",
      uri: `u/${otherSpaceId}/assets/foreign-${stamp}.png`,
      name: `别人的图-${stamp}`,
    });
  });

  afterAll(async () => {
    const cleanup = (query: Parameters<typeof db.execute>[0]) => db.execute(query).catch(() => {});
    await cleanup(sql`delete from canvas_nodes where canvas_id in (
      select id from canvases where title like ${`%${stamp}%`}
    )`);
    await cleanup(sql`delete from canvases where title like ${`%${stamp}%`}`);
    await cleanup(sql`delete from episodes where project_id in (
      select id from script_projects where title like ${`%${stamp}%`}
    )`);
    await cleanup(sql`delete from script_projects where title like ${`%${stamp}%`}`);
    // 第 62 批夹具：先删素材（canvases.cover_asset_id 是 set null，不挡删除），再删任务
    await cleanup(sql`delete from assets where name like ${`%${stamp}%`}`);
    if (coverTaskId) await cleanup(sql`delete from tasks where id = ${BigInt(coverTaskId)}`);
    await app.close();
    await pool.end().catch(() => {});
  });

  it("default tab=workshop returns only workshop projects with the legacy aggregates", async () => {
    const res = await inject("GET", "/works?page=1&page_size=24");
    expect(res.code).toBe(0);
    expect(res.data.list.every((item: { kind: string }) => item.kind === "workshop")).toBe(true);
    const mine = res.data.list.filter((item: { title: string }) => item.title.includes(stamp));
    expect(mine).toHaveLength(1);
    expect(mine[0].work_state).toBeDefined();
    expect(mine[0].node_count).toBeNull();
    // 未归档项目不出现在默认列表
    expect(mine[0].id).toBe(activeProjectId);
  });

  it("tab=canvas projects canvas rows read-only (node_count / creation_mode)", async () => {
    const res = await inject("GET", "/works?tab=canvas");
    expect(res.code).toBe(0);
    const mine = res.data.list.filter((item: { title: string }) => item.title.includes(stamp));
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ kind: "canvas", id: canvasId, node_count: 3, creation_mode: 2, work_state: "canvas" });
    // 画布统计只读：节点仍在、状态未变
    const rows = await db.execute(sql`select count(*)::int as count from canvas_nodes where canvas_id = ${BigInt(canvasId)}`);
    expect(Number((((rows as unknown) as { rows?: Array<{ count: number }> }).rows ?? [])[0]?.count ?? 0)).toBe(3);
  });

  it("tab=all merges both forms sorted by updated_at desc", async () => {
    const res = await inject("GET", "/works?tab=all&page_size=60");
    expect(res.code).toBe(0);
    const mine = res.data.list.filter((item: { title: string }) => item.title.includes(stamp));
    expect(mine.map((item: { kind: string }) => item.kind).sort()).toEqual(["canvas", "workshop"]);
    const times = (res.data.list as Array<{ updated_at: string }>).map((item) =>
      new Date(item.updated_at).getTime(),
    );
    expect([...times].sort((x, y) => y - x)).toEqual(times);
    expect(res.data.total).toBeGreaterThanOrEqual(2);
  });

  it("filters (status/keyword/state/time) are applied in SQL and stay consistent with total", async () => {
    const archived = await inject("GET", "/works?status=archived&page_size=60");
    expect(archived.code).toBe(0);
    expect(archived.data.list.every((item: { archived_at: string | null }) => item.archived_at !== null)).toBe(true);
    expect(archived.data.list.some((item: { id: string }) => item.id === archivedProjectId)).toBe(true);
    // 归档视图下画布不参与（画布没有归档概念）
    expect(archived.data.list.every((item: { kind: string }) => item.kind === "workshop")).toBe(true);

    const keyword = await inject("GET", `/works?keyword=${encodeURIComponent(`作品A-${stamp}`)}`);
    expect(keyword.code).toBe(0);
    expect(keyword.data.list.map((item: { id: string }) => item.id)).toEqual([activeProjectId]);

    const ready = await inject("GET", "/works?state=ready&page_size=60");
    expect(ready.code).toBe(0);
    expect(ready.data.list.every((item: { work_state: string }) => item.work_state === "ready")).toBe(true);
    // 四态筛选时画布不参与
    expect(ready.data.tabs.canvas).toBe(0);

    const future = await inject("GET", `/works?from=${encodeURIComponent("2099-01-01T00:00:00.000Z")}`);
    expect(future.code).toBe(0);
    expect(future.data.total).toBe(0);
    expect(future.data.list).toEqual([]);

    // 分页自洽：page_size=1 时 has_more 与 total 一致
    const p1 = await inject("GET", "/works?page=1&page_size=1&status=all");
    expect(p1.code).toBe(0);
    expect(p1.data.page_size).toBe(1);
    expect(p1.data.list).toHaveLength(1);
    expect(p1.data.has_more).toBe(p1.data.total > 1);
  });

  it("invalid filter values are rejected with 400101", async () => {
    expect((await inject("GET", "/works?tab=nope")).code).toBe(400101);
    expect((await inject("GET", "/works?state=unknown")).code).toBe(400101);
    expect((await inject("GET", `/works?from=not-a-date`)).code).toBe(400101);
  });

  it("isolates by space: another space sees an empty work list", async () => {
    const res = await raw(tokenOther, "GET", "/works?tab=all&page_size=60");
    expect(res.code).toBe(0);
    const mine = res.data.list.filter((item: { title: string }) => item.title.includes(stamp));
    expect(mine).toHaveLength(0);
    void otherSpaceId;
  });

  // ── 第 62 批：全部项目元信息（封面 / 创建人 / 最后编辑 + 竞品参数别名）──
  /**
   * 竞品证据（`_acceptance/competitor_endpoints.tsv` + `DDLTpMu7.js` / `Cp3a6_yk.js`）：
   * - `GET /df/script_project/list` 返回 `cover` + `covers[]`，展示取 `cover || covers[0]`；
   * - 封面是 **file_id**，设置走 `POST /df/script_project/edit { cover: file_id, sp_id }`；
   * - 列表项另有 `creator_nick`、`updated_at`、`created_at` 等元信息。
   * 我方把「全部项目」拆成 工坊项目 + 画布 两个域投影，所以封面只对画布有真缺口
   * （工坊侧的 cover_uri 本来就由分镜结果推导）。
   */
  it("canvas cover falls back to the latest image node output, and works list signs it", async () => {
    const res = await inject("GET", "/works?tab=canvas");
    expect(res.code).toBe(0);
    const row = res.data.list.find((item: { id: string }) => item.id === canvasId);
    expect(row).toBeTruthy();
    // 没有人工封面时自动取"画布内最近一次图片节点产物"
    expect(row.cover_uri).toBeTruthy();
    // 竞品给 `covers[]`，我方单封面 → 兼容形状恰为一项，且与 cover_uri 一致
    expect(row.covers).toEqual([row.cover_uri]);
    // 创建人昵称与最后编辑时间来自 canvases 本体
    expect(row).toHaveProperty("creator_nick");
    expect(row).toHaveProperty("last_edited_at");
  });

  it("POST /canvas/canvases/:id/cover sets manual cover, prefers it, and clears back to automatic", async () => {
    const set = await inject("POST", `/canvas/canvases/${canvasId}/cover`, { asset_id: manualAssetId });
    expect(set.code).toBe(0);
    expect(set.data.cover_asset_id).toBe(manualAssetId);
    expect(set.data.cover_uri).toBeTruthy();

    // 人工封面优先于自动兜底
    const byAsset = await inject("GET", `/works?tab=canvas`);
    const rowByAsset = byAsset.data.list.find((item: { id: string }) => item.id === canvasId);
    expect(rowByAsset.cover_uri).toBe(set.data.cover_uri);

    // 用节点 id 设封面：解析到节点产物（assets.source_task_id = node.task_id）
    const byNode = await inject("POST", `/canvas/canvases/${canvasId}/cover`, { node_id: imageNodeId });
    expect(byNode.code).toBe(0);
    expect(byNode.data.cover_asset_id).toBe(autoAssetId);

    // 清除（不传任何字段）→ 回落到自动兜底，仍是节点产物而不是 null
    const cleared = await inject("POST", `/canvas/canvases/${canvasId}/cover`, {});
    expect(cleared.code).toBe(0);
    expect(cleared.data.cover_asset_id).toBe(autoAssetId);

    // 越权 / 非法参数
    expect((await inject("POST", `/canvas/canvases/${canvasId}/cover`, { asset_id: foreignAssetId })).code).toBe(400102);
    expect((await inject("POST", `/canvas/canvases/${canvasId}/cover`, { asset_id: "not-a-number" })).code).toBe(400101);
    expect((await inject("POST", `/canvas/canvases/${canvasId}/cover`, { asset_id: "9999999999" })).code).toBe(400102);
    // 节点没有产物时给"还没产物"（同一个 400102，但 msg 不同，前端据此换提示）
    const textNode = await inject("POST", `/canvas/canvases/${canvasId}/cover`, {
      node_id: "9999999999",
    });
    expect(textNode.code).toBe(400102);
  });

  it("accepts competitor query aliases: name ≡ keyword, process_status=-1 ≡ status=all", async () => {
    // 竞品参数名是 name（我方叫 keyword）
    const byName = await inject("GET", `/works?name=${encodeURIComponent(`作品A-${stamp}`)}`);
    expect(byName.code).toBe(0);
    expect(byName.data.list.map((item: { id: string }) => item.id)).toEqual([activeProjectId]);

    // process_status=-1 是竞品"全部"（含归档）；不带时为默认 active
    const all = await inject("GET", "/works?process_status=-1&page_size=60");
    expect(all.code).toBe(0);
    expect(all.data.list.some((item: { id: string }) => item.id === archivedProjectId)).toBe(true);

    // 其它取值含义未取证 → 明确拒绝，不静默当成"全部"
    const bad = await inject("GET", "/works?process_status=1");
    expect(bad.code).toBe(400101);
  });
});
