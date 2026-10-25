import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import cookie from "@fastify/cookie";
import { AllExceptionsFilter } from "../src/common/http/exception.filter";
import { EnvelopeInterceptor } from "../src/common/http/envelope.interceptor";
import { AppModule } from "../src/app.module";
import { pool } from "../src/db/database";

/**
 * canvas 画布域契约测试（F1 契约 §12.1 / §14.4）
 *
 * 锁住四条会静默腐化数据的语义：
 * 1. 版本冲突 → 746002（绝不静默覆盖别人的编辑）
 * 2. 节点锁 → 746003（Redis，TTL 30s，被他人持锁时拒绝）
 * 3. 整图提交：版本+1、写快照、节点/边整体替换、悬挂边引用报错
 * 4. 11 种 node_type 硬约束；连线幂等（重复创建返回同一条）
 */
describe("canvas e2e", () => {
  let app: NestFastifyApplication;
  let token = "";
  let otherToken = "";

  const inject = async (
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
    url: string,
    payload?: unknown,
    authToken?: string,
    spaceId?: string,
  ) => {
    const headers: Record<string, string> = {};
    if (payload !== undefined) headers["content-type"] = "application/json";
    if (authToken ?? token) headers.authorization = `Bearer ${authToken ?? token}`;
    if (spaceId) headers["x-space-id"] = spaceId;
    const res = await app.inject({
      method,
      url: `/v1${url}`,
      headers,
      payload: payload === undefined ? undefined : JSON.stringify(payload),
    });
    const body = JSON.parse(res.body);
    return { status: res.statusCode, ...body, body };
  };

  async function loginNewUser(tag: string): Promise<string> {
    const tail = String(Date.now()).slice(-8);
    const phone = `1${tail}${String(tag).replace(/\D/g, "").slice(-2).padStart(2, "0")}`;
    const sms = await inject("POST", "/auth/sms-code", { phone });
    const login = await inject("POST", "/auth/login", {
      phone,
      code: sms.data?.debug_code,
      age_confirmed: true,
    });
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
    token = await loginNewUser("01");
    otherToken = await loginNewUser("02");
  }, 90_000);

  afterAll(async () => {
    await app.close();
    await pool.end().catch(() => {});
  });

  it("建画布 → 建节点/边 → 读取详情", async () => {
    const c = await inject("POST", "/canvas/canvases", { title: "测试画布" });
    expect(c.code).toBe(0);
    const canvasId = c.data.id as string;

    const n1 = await inject("POST", `/canvas/canvases/${canvasId}/nodes`, {
      node_type: "text",
      name: "剧本",
      x: 0,
      y: 0,
      params: { prompt: "开场" },
    });
    expect(n1.code).toBe(0);
    const n2 = await inject("POST", `/canvas/canvases/${canvasId}/nodes`, {
      node_type: "video",
      name: "成片",
      x: 320,
      y: 0,
      params: { mode: "text2video", settings: { ratio: "9:16", duration: 5 } },
    });
    expect(n2.code).toBe(0);

    const e = await inject("POST", `/canvas/canvases/${canvasId}/edges`, {
      src_node_id: n1.data.id,
      dst_node_id: n2.data.id,
    });
    expect(e.code).toBe(0);
    expect(e.data.created).toBe(true);

    const detail = await inject("GET", `/canvas/canvases/${canvasId}`);
    expect(detail.code).toBe(0);
    expect(detail.data.nodes).toHaveLength(2);
    expect(detail.data.edges).toHaveLength(1);
    expect(detail.data.canvas.version).toBe(1);
  });

  it("连线幂等：同一 src/dst/semantic 重复创建返回同一条，不报错", async () => {
    const c = await inject("POST", "/canvas/canvases", {});
    const canvasId = c.data.id as string;
    const a = await inject("POST", `/canvas/canvases/${canvasId}/nodes`, { node_type: "text", x: 0, y: 0 });
    const b = await inject("POST", `/canvas/canvases/${canvasId}/nodes`, { node_type: "image", x: 100, y: 0 });
    const first = await inject("POST", `/canvas/canvases/${canvasId}/edges`, {
      src_node_id: a.data.id,
      dst_node_id: b.data.id,
    });
    const second = await inject("POST", `/canvas/canvases/${canvasId}/edges`, {
      src_node_id: a.data.id,
      dst_node_id: b.data.id,
    });
    expect(first.data.created).toBe(true);
    expect(second.data.created).toBe(false);
    expect(second.data.id).toBe(first.data.id);
  });

  it("11 种 node_type 是硬约束：非法类型 → 400101", async () => {
    const c = await inject("POST", "/canvas/canvases", {});
    const canvasId = c.data.id as string;
    const bad = await inject("POST", `/canvas/canvases/${canvasId}/nodes`, {
      node_type: "not_a_real_type",
      x: 0,
      y: 0,
    });
    expect(bad.code).toBe(400101);

    // 逐一验证 11 种都能建
    const types = [
      "text", "image", "video", "audio", "table", "script",
      "asset", "clip", "director", "threeDWorld", "group",
    ];
    for (const t of types) {
      const r = await inject("POST", `/canvas/canvases/${canvasId}/nodes`, { node_type: t, x: 0, y: 0 });
      expect(r.code, `node_type=${t}`).toBe(0);
    }
  });

  it("节点级乐观锁：带旧 version 更新 → 746002，不覆盖", async () => {
    const c = await inject("POST", "/canvas/canvases", {});
    const canvasId = c.data.id as string;
    const n = await inject("POST", `/canvas/canvases/${canvasId}/nodes`, {
      node_type: "text",
      x: 0,
      y: 0,
      name: "v1",
    });
    const first = await inject("PATCH", `/canvas/canvases/${canvasId}/nodes/${n.data.id}`, {
      version: 1,
      name: "v2",
    });
    expect(first.code).toBe(0);
    expect(first.data.version).toBe(2);

    // 用过期 version=1 再改 → 必须冲突
    const stale = await inject("PATCH", `/canvas/canvases/${canvasId}/nodes/${n.data.id}`, {
      version: 1,
      name: "v3",
    });
    expect(stale.code).toBe(746002);

    // 名字没被覆盖
    const detail = await inject("GET", `/canvas/canvases/${canvasId}`);
    const node = detail.data.nodes.find((x: { id: string }) => x.id === n.data.id);
    expect(node.name).toBe("v2");
  });

  it("节点锁：同一团队空间内，他人持锁 → 746003；自己续期/解锁正常", async () => {
    // 跨用户协作必须发生在同一空间：先建团队并把 B 加进来（真实协作场景，
    // 顺带覆盖 canvas + X-Space-Id + cam 成员三者联动）
    const team = await inject("POST", "/cam/team", { name: "画布协作团队" });
    expect(team.code).toBe(0);
    const teamSpaceId = team.data.space_id as string;

    const me = await inject("GET", "/cam/permission/user", undefined, token, teamSpaceId);
    expect(me.code).toBe(0);
    const myUserId = me.data.user_id as string;

    // 找到 B 的 user_id（通过我自己的成员列表看不到 B，直接用 batch 添加需要 id；
    // 这里用 B 的 token 调 /cam/permission/user（其个人空间）拿 id）
    const bSelf = await inject("GET", "/cam/permission/user", undefined, otherToken);
    const otherUserId = bSelf.data.user_id as string;

    const add = await inject(
      "POST",
      "/cam/team/member/batch",
      { members: [{ user_id: otherUserId, role_code: "animator" }] },
      token,
      teamSpaceId,
    );
    expect(add.code).toBe(0);
    expect(add.data.added).toBe(1);
    void myUserId;

    // 我在团队空间建画布 + 节点
    const c = await inject("POST", "/canvas/canvases", { title: "协作画布" }, token, teamSpaceId);
    expect(c.code).toBe(0);
    const canvasId = c.data.id as string;
    const n = await inject(
      "POST",
      `/canvas/canvases/${canvasId}/nodes`,
      { node_type: "image", x: 0, y: 0 },
      token,
      teamSpaceId,
    );
    const nodeId = n.data.id as string;

    // 我抢锁
    const mine = await inject("POST", `/canvas/canvases/${canvasId}/nodes/${nodeId}/lock`, undefined, token, teamSpaceId);
    expect(mine.code).toBe(0);

    // 协作者（同空间）抢锁 → 746003
    const other = await inject(
      "POST",
      `/canvas/canvases/${canvasId}/nodes/${nodeId}/lock`,
      undefined,
      otherToken,
      teamSpaceId,
    );
    expect(other.code).toBe(746003);

    // 协作者解锁 → 也必须拒绝（不能解别人的锁）
    const otherUnlock = await inject(
      "POST",
      `/canvas/canvases/${canvasId}/nodes/${nodeId}/unlock`,
      undefined,
      otherToken,
      teamSpaceId,
    );
    expect(otherUnlock.code).toBe(746003);

    // 自己续期 + 解锁
    const renew = await inject("POST", `/canvas/canvases/${canvasId}/nodes/${nodeId}/renew`, undefined, token, teamSpaceId);
    expect(renew.code).toBe(0);
    const unlock = await inject("POST", `/canvas/canvases/${canvasId}/nodes/${nodeId}/unlock`, undefined, token, teamSpaceId);
    expect(unlock.code).toBe(0);

    // 解锁后协作者可取
    const otherAgain = await inject(
      "POST",
      `/canvas/canvases/${canvasId}/nodes/${nodeId}/lock`,
      undefined,
      otherToken,
      teamSpaceId,
    );
    expect(otherAgain.code).toBe(0);
  });

  it("整图提交：版本+1、写快照、整体替换；旧版本提交 → 746002", async () => {
    const c = await inject("POST", "/canvas/canvases", { title: "提交测试" });
    const canvasId = c.data.id as string;

    const commit1 = await inject("POST", `/canvas/canvases/${canvasId}/commit`, {
      version: 1,
      nodes: [
        { node_type: "text", x: 0, y: 0, name: "A" },
        { node_type: "video", x: 200, y: 0, name: "B" },
      ],
      edges: [],
    });
    expect(commit1.code).toBe(0);
    expect(commit1.data.version).toBe(2);
    expect(commit1.data.nodes).toBe(2);

    // 快照已写
    const snaps = await inject("GET", `/canvas/canvases/${canvasId}/snapshots`);
    expect(snaps.code).toBe(0);
    expect(snaps.data.list[0].version).toBe(2);

    // 用旧 version=1 再提交 → 746002
    const stale = await inject("POST", `/canvas/canvases/${canvasId}/commit`, {
      version: 1,
      nodes: [],
      edges: [],
    });
    expect(stale.code).toBe(746002);

    // 用 version=2 提交（第二次整体替换：节点数从 2 变 1）
    const commit2 = await inject("POST", `/canvas/canvases/${canvasId}/commit`, {
      version: 2,
      nodes: [{ node_type: "text", x: 0, y: 0, name: "only" }],
      edges: [],
    });
    expect(commit2.code).toBe(0);
    expect(commit2.data.version).toBe(3);

    const detail = await inject("GET", `/canvas/canvases/${canvasId}`);
    expect(detail.data.nodes).toHaveLength(1);
  });

  it("整图提交引用不存在的节点 → 400101（不留悬挂边）", async () => {
    const c = await inject("POST", "/canvas/canvases", {});
    const canvasId = c.data.id as string;
    const bad = await inject("POST", `/canvas/canvases/${canvasId}/commit`, {
      version: 1,
      nodes: [{ id: "1001", node_type: "text", x: 0, y: 0 }],
      edges: [{ src_node_id: "1001", dst_node_id: "9999" }],
    });
    expect(bad.code).toBe(400101);

    // 事务回滚：版本未推进
    const detail = await inject("GET", `/canvas/canvases/${canvasId}`);
    expect(detail.data.canvas.version).toBe(1);
    expect(detail.data.nodes).toHaveLength(0);
  });

  it("软删节点同时清连线；nodes-recover 可恢复", async () => {
    const c = await inject("POST", "/canvas/canvases", {});
    const canvasId = c.data.id as string;
    const a = await inject("POST", `/canvas/canvases/${canvasId}/nodes`, { node_type: "text", x: 0, y: 0 });
    const b = await inject("POST", `/canvas/canvases/${canvasId}/nodes`, { node_type: "image", x: 100, y: 0 });
    await inject("POST", `/canvas/canvases/${canvasId}/edges`, {
      src_node_id: a.data.id,
      dst_node_id: b.data.id,
    });

    await inject("DELETE", `/canvas/canvases/${canvasId}/nodes/${a.data.id}`);
    let detail = await inject("GET", `/canvas/canvases/${canvasId}`);
    expect(detail.data.nodes).toHaveLength(1);
    expect(detail.data.edges).toHaveLength(0); // 悬挂边已清

    const recover = await inject("POST", `/canvas/canvases/${canvasId}/nodes-recover`, {
      node_ids: [a.data.id],
    });
    expect(recover.code).toBe(0);
    detail = await inject("GET", `/canvas/canvases/${canvasId}`);
    expect(detail.data.nodes).toHaveLength(2);
  });

  it("跨空间隔离：他人画布不可见（404）", async () => {
    const c = await inject("POST", "/canvas/canvases", { title: "私有" });
    const canvasId = c.data.id as string;
    const other = await inject("GET", `/canvas/canvases/${canvasId}`, undefined, otherToken);
    expect(other.code).toBe(400102);
  });

  it("钉住节点可设置/取消", async () => {
    const c = await inject("POST", "/canvas/canvases", {});
    const canvasId = c.data.id as string;
    const n = await inject("POST", `/canvas/canvases/${canvasId}/nodes`, { node_type: "video", x: 0, y: 0 });
    const pin = await inject("PUT", `/canvas/canvases/${canvasId}/pinned-node`, { node_id: n.data.id });
    expect(pin.code).toBe(0);
    expect(pin.data.pinned_node_id).toBe(n.data.id);
    const unpin = await inject("PUT", `/canvas/canvases/${canvasId}/pinned-node`, { node_id: null });
    expect(unpin.code).toBe(0);
    expect(unpin.data.pinned_node_id).toBeNull();
  });
});
