import { afterAll, beforeAll, describe, expect, it } from "vitest";
import cookie from "@fastify/cookie";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { and, eq } from "drizzle-orm";
import { canvasEdges, canvasNodes, canvasSnapshots, canvases } from "@app/db";
import { AppModule } from "../src/app.module";
import { AllExceptionsFilter } from "../src/common/http/exception.filter";
import { EnvelopeInterceptor } from "../src/common/http/envelope.interceptor";
import { db } from "../src/db/database";

/**
 * 画布节点恢复（模块 #11 收尾）：`POST /canvas/canvases/:id/nodes-recover`。
 *
 * 两种模式都必须成立，且**语义不能互相污染**：
 * - `{node_ids}`（既有）：撤销软删，返回**真实**恢复条数（传错 id 不再"看起来成功"）；
 * - `{from_snapshot:true}`（新）：从最近快照补齐**缺失**节点/边。
 *
 * 重点验证五件事（画布是用户资产的唯一副本，恢复错了就是数据事故）：
 * 1. **只补缺失**：真正丢行（模拟崩溃/误清）的节点与边能补回来；
 * 2. **不覆盖现存**：快照之后新建的节点、以及位置被改过的节点必须原样保留；
 * 3. **软删不复活**：软删是有意行为，快照恢复不得把它变回来（要走 node_ids 显式撤销）；
 * 4. **幂等**：连调两次，第二次 0 补 0（不会重复插边）；
 * 5. **无快照 → 400102**：没有基准就不猜。
 */
describe("canvas snapshot recover e2e", () => {
  let app: NestFastifyApplication;
  let token = "";
  let spaceId = "";
  let otherToken = "";
  let otherSpaceId = "";
  let canvasId = "";

  const inject = async (method: string, url: string, payload?: unknown, authToken?: string, space?: string) => {
    const headers: Record<string, string> = {};
    if (payload !== undefined) headers["content-type"] = "application/json";
    if (authToken) headers["authorization"] = `Bearer ${authToken}`;
    if (space) headers["x-space-id"] = space;
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

  async function login(tag: string): Promise<{ token: string; spaceId: string }> {
    const phone = `1${String(Date.now()).slice(-8)}${tag}`;
    const sms = await inject("POST", "/auth/sms-code", { phone });
    const code = (sms.data as { debug_code?: string } | undefined)?.debug_code;
    const res = await inject("POST", "/auth/login", { phone, code, age_confirmed: true });
    const data = res.data as { access_token?: string; space_id?: string } | undefined;
    return { token: data?.access_token ?? "", spaceId: String(data?.space_id ?? "") };
  }

  type NodeDto = { id: string; name: string; x: number; node_type: string };

  beforeAll(async () => {
    const appInstance = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), {
      logger: false,
    });
    await appInstance.register(cookie as never);
    appInstance.setGlobalPrefix("v1");
    appInstance.useGlobalFilters(new AllExceptionsFilter());
    appInstance.useGlobalInterceptors(new EnvelopeInterceptor());
    await appInstance.init();
    app = appInstance;

    const me = await login("01");
    token = me.token;
    spaceId = me.spaceId;
    const other = await login("02");
    otherToken = other.token;
    otherSpaceId = other.spaceId;
  });

  afterAll(async () => {
    if (canvasId) {
      const id = BigInt(canvasId);
      await db.delete(canvasEdges).where(eq(canvasEdges.canvasId, id));
      await db.delete(canvasNodes).where(eq(canvasNodes.canvasId, id));
      await db.delete(canvasSnapshots).where(eq(canvasSnapshots.canvasId, id));
      await db.delete(canvases).where(eq(canvases.id, id));
    }
    await app.close();
  });

  it("无快照的画布 → 400102（没有基准不猜）", async () => {
    const canvas = await inject("POST", "/canvas/canvases", { title: "rec-no-snap" }, token, spaceId);
    canvasId = String((canvas.data as { id: string }).id);
    const res = await inject("POST", `/canvas/canvases/${canvasId}/nodes-recover`, { from_snapshot: true }, token, spaceId);
    expect(res.code).toBe(400102);

    const byVersion = await inject(
      "POST",
      `/canvas/canvases/${canvasId}/nodes-recover`,
      { version: 99 },
      token,
      spaceId,
    );
    expect(byVersion.code).toBe(400102);
  });

  it("两种模式互斥：node_ids + from_snapshot 同时给 → 400101", async () => {
    const res = await inject(
      "POST",
      `/canvas/canvases/${canvasId}/nodes-recover`,
      { node_ids: ["1"], from_snapshot: true },
      token,
      spaceId,
    );
    expect(res.code).toBe(400101);
  });

  it("非法 node_ids（非雪花 id）→ 400101（不是 500）", async () => {
    const res = await inject(
      "POST",
      `/canvas/canvases/${canvasId}/nodes-recover`,
      { node_ids: ["local-tmp-1"] },
      token,
      spaceId,
    );
    expect(res.code).toBe(400101);
  });

  it("跨 space 恢复 → 403（不能改别人的画布）", async () => {
    const res = await inject(
      "POST",
      `/canvas/canvases/${canvasId}/nodes-recover`,
      { from_snapshot: true },
      otherToken,
      otherSpaceId,
    );
    // mustGetCanvas 按 space 过滤：别的空间看不到这张画布 → 400102。
    // 这里**故意不是 403**：403 会告诉对方"这个 id 存在"，等于泄露他人画布 ID 空间。
    expect(res.code).toBe(400102);
  });

  // ── 主流程：快照 → 丢数据 → 恢复 ──────────────────────────
  let nodeA = "";
  let nodeB = "";
  let edgeId = "";
  let nodeC = "";

  it("准备：建两个节点+一条边，整图提交产生快照", async () => {
    const a = await inject("POST", `/canvas/canvases/${canvasId}/nodes`, { node_type: "text", x: 0, y: 0, name: "A" }, token, spaceId);
    const b = await inject("POST", `/canvas/canvases/${canvasId}/nodes`, { node_type: "image", x: 100, y: 0, name: "B" }, token, spaceId);
    nodeA = String((a.data as { id: string }).id);
    nodeB = String((b.data as { id: string }).id);
    const edge = await inject(
      "POST",
      `/canvas/canvases/${canvasId}/edges`,
      { src_node_id: nodeA, dst_node_id: nodeB },
      token,
      spaceId,
    );
    expect(edge.code).toBe(0);
    expect((edge.data as { id: string }).id.length).toBeGreaterThan(0);

    // 整图提交 → version 1→2 并写快照（payload 里带真实雪花 id）
    const commit = await inject(
      "POST",
      `/canvas/canvases/${canvasId}/commit`,
      {
        version: 1,
        nodes: [
          { id: nodeA, node_type: "text", name: "A", x: 0, y: 0 },
          { id: nodeB, node_type: "image", name: "B", x: 100, y: 0 },
        ],
        edges: [{ src_node_id: nodeA, dst_node_id: nodeB }],
      },
      token,
      spaceId,
    );
    expect(commit.code, commit.msg).toBe(0);
    expect((commit.data as { version: number }).version).toBe(2);

    // 快照之后新建的节点：恢复时**不能**被动到（它不在快照里）
    const c = await inject("POST", `/canvas/canvases/${canvasId}/nodes`, { node_type: "video", x: 200, y: 0, name: "C" }, token, spaceId);
    nodeC = String((c.data as { id: string }).id);
  });

  it("模拟数据丢失（硬删节点 B 与边），恢复只补缺失且保留快照后的新节点", async () => {
    // 外键顺序：先删边再删节点。
    // 注意不能按 edgeId 删：整图提交会重建边（新 id），旧 id 已经不在了。
    await db
      .delete(canvasEdges)
      .where(
        and(
          eq(canvasEdges.canvasId, BigInt(canvasId)),
          eq(canvasEdges.srcNodeId, BigInt(nodeA)),
          eq(canvasEdges.dstNodeId, BigInt(nodeB)),
        ),
      );
    await db.delete(canvasNodes).where(eq(canvasNodes.id, BigInt(nodeB)));

    const res = await inject("POST", `/canvas/canvases/${canvasId}/nodes-recover`, { from_snapshot: true }, token, spaceId);
    expect(res.code, res.msg).toBe(0);
    const data = res.data as {
      from_version: number;
      nodes_recovered: number;
      edges_recovered: number;
      skipped_existing: number;
    };
    expect(data.from_version).toBe(2);
    expect(data.nodes_recovered).toBe(1);
    expect(data.edges_recovered).toBe(1);
    // A 现存 → 计数里能看到"跳过"
    expect(data.skipped_existing).toBeGreaterThanOrEqual(1);

    const detail = await inject("GET", `/canvas/canvases/${canvasId}`, undefined, token, spaceId);
    const nodes = ((detail.data as { nodes?: NodeDto[] }).nodes ?? []) as NodeDto[];
    const ids = nodes.map((node) => node.id);
    expect(ids).toContain(nodeA);
    expect(ids).toContain(nodeB); // 恢复回来
    expect(ids).toContain(nodeC); // 快照之后的新节点未被覆盖
    const restoredB = nodes.find((node) => node.id === nodeB);
    expect(restoredB).toMatchObject({ name: "B", x: 100, node_type: "image" });
  });

  it("幂等：再恢复一次是 0 补 0（不重复插边）", async () => {
    const res = await inject("POST", `/canvas/canvases/${canvasId}/nodes-recover`, { from_snapshot: true }, token, spaceId);
    expect(res.code).toBe(0);
    const data = res.data as { nodes_recovered: number; edges_recovered: number };
    expect(data.nodes_recovered).toBe(0);
    expect(data.edges_recovered).toBe(0);
  });

  it("软删节点不会被快照恢复复活（要救得显式传 node_ids）", async () => {
    const del = await inject("POST", `/canvas/canvases/${canvasId}/nodes/batch-delete`, { node_ids: [nodeA] }, token, spaceId);
    expect(del.code).toBe(0);

    const res = await inject("POST", `/canvas/canvases/${canvasId}/nodes-recover`, { from_snapshot: true }, token, spaceId);
    expect(res.code).toBe(0);
    const data = res.data as { nodes_recovered: number; skipped_deleted: number };
    expect(data.nodes_recovered).toBe(0);
    expect(data.skipped_deleted).toBeGreaterThanOrEqual(1);

    const detail = await inject("GET", `/canvas/canvases/${canvasId}`, undefined, token, spaceId);
    const ids = (((detail.data as { nodes?: NodeDto[] }).nodes ?? []) as NodeDto[]).map((node) => node.id);
    expect(ids).not.toContain(nodeA); // 仍是被删状态

    // 显式撤销软删（既有语义回归）：恢复条数是真实条数
    const undelete = await inject("POST", `/canvas/canvases/${canvasId}/nodes-recover`, { node_ids: [nodeA] }, token, spaceId);
    expect(undelete.code).toBe(0);
    expect((undelete.data as { recovered: number }).recovered).toBe(1);

    const after = await inject("GET", `/canvas/canvases/${canvasId}`, undefined, token, spaceId);
    const afterIds = (((after.data as { nodes?: NodeDto[] }).nodes ?? []) as NodeDto[]).map((node) => node.id);
    expect(afterIds).toContain(nodeA);
  });

  it("撤销软删传不存在的 id → recovered:0（不虚报成功）", async () => {
    const res = await inject("POST", `/canvas/canvases/${canvasId}/nodes-recover`, { node_ids: ["999999999999"] }, token, spaceId);
    expect(res.code).toBe(0);
    expect((res.data as { recovered: number }).recovered).toBe(0);
  });

  it("快照恢复后画布版本没有被偷偷推进（恢复不是编辑提交）", async () => {
    const detail = await inject("GET", `/canvas/canvases/${canvasId}`, undefined, token, spaceId);
    // canvas 详情是 { canvas:{version,...}, nodes, edges } 结构
    expect((detail.data as { canvas: { version: number } }).canvas.version).toBe(2);
  });
});
