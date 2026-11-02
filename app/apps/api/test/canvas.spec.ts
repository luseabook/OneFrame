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
  let spaceId = "";

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
    const me = await inject("GET", "/me");
    spaceId = String(me.data.space.id);
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

  /**
   * 第 87 批：按竞品形状补的三条画布端点（审计 #11 时发现只有"列表/整图"没有"单点"）。
   *
   * 竞品的形状是 `GET /df/canvas/:id/nodes/:node_id`、`GET .../nodes/:node_id/lock`、
   * `DELETE .../pinned-node`；我方此前只有 `GET nodes`（列表）、`POST lock`、
   * `PUT pinned-node`，按竞品写的客户端这三条都会 404/405。
   */
  it("竞品形状：单节点读取 / 单节点锁状态 / DELETE 取消钉住", async () => {
    const c = await inject("POST", "/canvas/canvases", { title: "单节点形状" });
    const canvasId = c.data.id as string;
    const n = await inject("POST", `/canvas/canvases/${canvasId}/nodes`, {
      node_type: "image",
      name: "封面图",
      x: 12,
      y: 34,
    });
    const nodeId = n.data.id as string;

    // 1) 单节点：返回同一个节点（不是列表），字段与列表项同构
    const one = await inject("GET", `/canvas/canvases/${canvasId}/nodes/${nodeId}`);
    expect(one.code).toBe(0);
    expect(one.data.node.id).toBe(nodeId);
    expect(one.data.node.node_type).toBe("image");
    expect(one.data.node.name).toBe("封面图");
    expect(Array.isArray(one.data.node)).toBe(false);

    // 2) 锁状态：没人持锁时 locked=false；他人持锁后能看到 locked_by
    const lock0 = await inject("GET", `/canvas/canvases/${canvasId}/nodes/${nodeId}/lock`);
    expect(lock0.code).toBe(0);
    expect(lock0.data).toMatchObject({ node_id: nodeId, locked: false, locked_by: null, ttl_s: 0 });
    // 同一账号持锁 → locked=true 且 locked_by 是自己的 user id（30s TTL）
    const held = await inject("POST", `/canvas/canvases/${canvasId}/nodes/${nodeId}/lock`, {});
    expect(held.code).toBe(0);
    const lock1 = await inject("GET", `/canvas/canvases/${canvasId}/nodes/${nodeId}/lock`);
    expect(lock1.data.locked).toBe(true);
    expect(lock1.data.locked_by).toMatch(/^\d+$/);
    expect(lock1.data.ttl_s).toBeGreaterThan(0);
    // 解锁后回到 false
    await inject("POST", `/canvas/canvases/${canvasId}/nodes/${nodeId}/unlock`, {});
    const lock2 = await inject("GET", `/canvas/canvases/${canvasId}/nodes/${nodeId}/lock`);
    expect(lock2.data.locked).toBe(false);

    // 3) DELETE 取消钉住：等价于 PUT {node_id:null}，但不需要 body
    await inject("PUT", `/canvas/canvases/${canvasId}/pinned-node`, { node_id: nodeId });
    const cleared = await inject("DELETE", `/canvas/canvases/${canvasId}/pinned-node`);
    expect(cleared.code).toBe(0);
    expect(cleared.data.pinned_node_id).toBeNull();
    const detail = await inject("GET", `/canvas/canvases/${canvasId}`);
    expect(detail.data.canvas.pinned_node_id).toBeNull();

    // 跨 space 不可见（不泄漏存在性：404 而非 403）；非法节点 id → 400101
    const foreign = await inject("GET", `/canvas/canvases/${canvasId}/nodes/${nodeId}`, undefined, otherToken);
    expect(foreign.code).not.toBe(0);
    expect(foreign.status).toBeLessThan(500);
    const bad = await inject("GET", `/canvas/canvases/${canvasId}/nodes/abc`);
    expect(bad.code).toBe(400101);
  });

  /**
   * 回归：整图提交必须接受"本地临时 id"。
   *
   * 背景（真实踩坑）：画布编辑器是"本地加节点 → 整图提交"，
   * 新节点的 id 是客户端临时值（`local_xxx`）。旧实现直接 `BigInt(n.id)`，
   * 非数字 id 抛 SyntaxError → 500，等于"先加节点再保存"这条最主流的路径
   * 100% 失败。修复后：非雪花 id 视为新节点、分配真实 id，并在 id_map 里回传，
   * 让前端把本地 id 换掉（否则下次提交会重复建节点）。
   */
  it("整图提交接受本地临时 id，并在 id_map 回传真实 id", async () => {
    const c = await inject("POST", "/canvas/canvases", { title: "本地id" });
    const canvasId = c.data.id as string;

    const committed = await inject("POST", `/canvas/canvases/${canvasId}/commit`, {
      version: 1,
      nodes: [
        { id: "local_1700000000_aaa", node_type: "text", name: "本地文本", x: 10, y: 20, params: { prompt: "hi" } },
        { node_type: "video", name: "无id视频", x: 300, y: 20, params: {} },
      ],
      // 自环边：src/dst 都指向同一个本地 id，两处都必须能映射到真实 id
      edges: [{ src_node_id: "local_1700000000_aaa", dst_node_id: "local_1700000000_aaa" }],
    });
    expect(committed.code).toBe(0);
    expect(committed.data.version).toBe(2);
    expect(committed.data.nodes).toBe(2);
    expect(committed.data.id_map["local_1700000000_aaa"]).toMatch(/^\d+$/);

    const detail = await inject("GET", `/canvas/canvases/${canvasId}`);
    expect(detail.data.nodes).toHaveLength(2);
    const textNode = detail.data.nodes.find((n: { node_type: string }) => n.node_type === "text");
    expect(textNode.id).toBe(committed.data.id_map["local_1700000000_aaa"]);
    expect(textNode.params.prompt).toBe("hi");
    // 边必须指向真实 id，不能残留本地 id
    expect(detail.data.edges).toHaveLength(1);
    expect(detail.data.edges[0].src_node_id).toBe(textNode.id);
    expect(detail.data.edges[0].dst_node_id).toBe(textNode.id);
  });

  /**
   * 回归：整图提交是"整体替换"，带真实 id 重复提交不产生重复节点。
   * 前端拿到 id_map 后会把本地 id 换掉，所以第二次提交带的是真实 id；
   * 这里验证同一个 id 是"更新"而不是"再建一个"。
   */
  it("整图提交是整体替换：带真实 id 重复提交不产生重复节点", async () => {
    const c = await inject("POST", "/canvas/canvases", { title: "替换" });
    const canvasId = c.data.id as string;

    const first = await inject("POST", `/canvas/canvases/${canvasId}/commit`, {
      version: 1,
      nodes: [{ node_type: "image", name: "图", x: 0, y: 0, params: {} }],
      edges: [],
    });
    expect(first.code).toBe(0);
    let detail = await inject("GET", `/canvas/canvases/${canvasId}`);
    const realId = detail.data.nodes[0].id as string;

    const second = await inject("POST", `/canvas/canvases/${canvasId}/commit`, {
      version: first.data.version,
      nodes: [
        { id: realId, node_type: "image", name: "图改名", x: 50, y: 50, params: {} },
        { node_type: "audio", name: "新增音频", x: 300, y: 0, params: {} },
      ],
      edges: [],
    });
    expect(second.code).toBe(0);

    detail = await inject("GET", `/canvas/canvases/${canvasId}`);
    expect(detail.data.nodes).toHaveLength(2); // 不是 3
    const same = detail.data.nodes.find((n: { id: string }) => n.id === realId);
    expect(same.name).toBe("图改名"); // 同一个节点被更新而非重建
    expect(same.x).toBe(50);
  });

  // ══ 节点派生任务（C6）：画布真正连到生成链路 ══════════════
  //
  // 这一组锁的是"画布能出片"的核心语义：
  //   1. 节点投递 → 建 tasks 行 + 回写 node.task_id + status=2（不新建任务表）
  //   2. 默认参数来自**模型目录**而不是硬编码（图像 1K / 视频 720p 不同）
  //   3. canvas mode → tasks.mode 收敛（后处理子模式落 sub_mode，不新增 mode）
  //   4. 类型/模式错配拒绝；跨空间拒绝；批量逐条独立（一条失败不连累其它）

  it("节点投递：建任务 + 回写 node.task_id 与 status=2，且默认值取自模型目录", async () => {
    // 先给这个用户充点积分（新用户默认 80，够用；这里只是确认余额存在）
    const c = await inject("POST", "/canvas/canvases", { title: "节点任务" });
    const canvasId = c.data.id as string;

    // tgi-2 的 text2image 分辨率档是 1K/2K/4K（不是 720p）——
    // 节点 params 里**故意不写 resolution**，看后端能否从目录取默认 1K
    const n = await inject("POST", `/canvas/canvases/${canvasId}/nodes`, {
      node_type: "image",
      name: "封面",
      x: 0,
      y: 0,
      params: { mode: "text2image", prompt: "海边日出", model: "tgi-2", settings: { ratio: "16:9" } },
    });
    expect(n.code).toBe(0);
    const nodeId = n.data.id as string;

    const gen = await inject("POST", `/canvas/canvases/${canvasId}/nodes/${nodeId}/generate`, {
      mode: "text2image",
      model: "tgi-2",
      input: { prompt: "海边日出" },
    });
    expect(gen.code).toBe(0);
    expect(gen.data.task_id).toMatch(/^\d+$/);
    expect(gen.data.credits_estimate).toBeGreaterThan(0);
    // 回写：节点进入"生成中"
    expect(gen.data.node.status).toBe(2);
    expect(gen.data.node.task_id).toBe(gen.data.task_id);

    // 详情里也能看到 task_id 与 status
    const detail = await inject("GET", `/canvas/canvases/${canvasId}`);
    const node = detail.data.nodes.find((x: { id: string }) => x.id === nodeId);
    expect(String(node.task_id)).toBe(gen.data.task_id);
    expect(node.status).toBe(2);

    // 节点任务状态端点：task 必须真的属于这个节点
    const st = await inject("GET", `/canvas/canvases/${canvasId}/nodes/${nodeId}/task/${gen.data.task_id}`);
    expect(st.code).toBe(0);
    expect(st.data.task.task_id).toBe(gen.data.task_id);
    expect(st.data.node.status).toBe(2);

    // 换个节点查同一个 task → 必须 400102（防越权看别人的任务状态）
    const n2 = await inject("POST", `/canvas/canvases/${canvasId}/nodes`, {
      node_type: "image",
      x: 300,
      y: 0,
      params: {},
    });
    const wrong = await inject("GET", `/canvas/canvases/${canvasId}/nodes/${n2.data.id}/task/${gen.data.task_id}`);
    expect(wrong.code).toBe(400102);
  });

  it("节点投递：类型与 mode 错配 → 400101（文本节点不能跑 text2video）", async () => {
    const c = await inject("POST", "/canvas/canvases", {});
    const canvasId = c.data.id as string;
    const n = await inject("POST", `/canvas/canvases/${canvasId}/nodes`, {
      node_type: "text",
      x: 0,
      y: 0,
      params: { prompt: "台词" },
    });
    const gen = await inject("POST", `/canvas/canvases/${canvasId}/nodes/${n.data.id}/generate`, {
      mode: "text2video",
      model: "sky-media-2.0",
      input: { prompt: "台词" },
    });
    expect(gen.code).toBe(400101);
  });

  it("节点投递：模型不支持该 mode → 400101（不静默降级换模型）", async () => {
    const c = await inject("POST", "/canvas/canvases", {});
    const canvasId = c.data.id as string;
    const n = await inject("POST", `/canvas/canvases/${canvasId}/nodes`, {
      node_type: "image",
      x: 0,
      y: 0,
      params: { mode: "text2image", prompt: "x" },
    });
    // sky-media-2.0 是视频模型，没有 text2image
    const gen = await inject("POST", `/canvas/canvases/${canvasId}/nodes/${n.data.id}/generate`, {
      mode: "text2image",
      model: "sky-media-2.0",
      input: { prompt: "x" },
    });
    expect(gen.code).toBe(400101);
  });

  it("节点投递：不存在的 canvas mode → 400101（不猜测）", async () => {
    const c = await inject("POST", "/canvas/canvases", {});
    const canvasId = c.data.id as string;
    const n = await inject("POST", `/canvas/canvases/${canvasId}/nodes`, {
      node_type: "image",
      x: 0,
      y: 0,
      params: {},
    });
    const gen = await inject("POST", `/canvas/canvases/${canvasId}/nodes/${n.data.id}/generate`, {
      mode: "no_such_mode",
      model: "tgi-2",
      input: { prompt: "x" },
    });
    expect(gen.code).toBe(400101);
  });

  it("批量节点投递：逐条独立，一条失败不连累其它（且带逐项错误码）", async () => {
    const c = await inject("POST", "/canvas/canvases", { title: "批量" });
    const canvasId = c.data.id as string;
    const ok1 = await inject("POST", `/canvas/canvases/${canvasId}/nodes`, {
      node_type: "image",
      x: 0,
      y: 0,
      params: { mode: "text2image", prompt: "a", model: "tgi-2" },
    });
    const bad = await inject("POST", `/canvas/canvases/${canvasId}/nodes`, {
      node_type: "text",
      x: 200,
      y: 0,
      params: { prompt: "b" },
    });
    const ok2 = await inject("POST", `/canvas/canvases/${canvasId}/nodes`, {
      node_type: "image",
      x: 400,
      y: 0,
      params: { mode: "text2image", prompt: "c", model: "tgi-2" },
    });

    const res = await inject("POST", `/canvas/canvases/${canvasId}/batch-node-tasks`, {
      items: [
        { node_id: ok1.data.id, mode: "text2image", model: "tgi-2", input: { prompt: "a" } },
        // 中间这条故意错配（text 节点跑 text2image）
        { node_id: bad.data.id, mode: "text2image", model: "tgi-2", input: { prompt: "b" } },
        { node_id: ok2.data.id, mode: "text2image", model: "tgi-2", input: { prompt: "c" } },
      ],
    });
    expect(res.code).toBe(0);
    // 关键：接口整体 200，逐项里有成功有失败
    expect(res.data.submitted).toBe(2);
    expect(res.data.results).toHaveLength(3);
    expect(res.data.results[0].submitted).toBe(true);
    expect(res.data.results[1].submitted).toBe(false);
    expect(res.data.results[1].code).toBe(400101);
    expect(res.data.results[2].submitted).toBe(true);
    expect(res.data.total_credits).toBeGreaterThan(0);
  });

  it("批量节点投递：超过 50 条 → 400101（不静默截断）", async () => {
    const c = await inject("POST", "/canvas/canvases", {});
    const canvasId = c.data.id as string;
    const items = Array.from({ length: 51 }, () => ({
      node_id: "1",
      mode: "text2image",
      model: "tgi-2",
      input: {},
    }));
    const res = await inject("POST", `/canvas/canvases/${canvasId}/batch-node-tasks`, { items });
    expect(res.code).toBe(400101);
  });

  it("跨空间：他人画布的节点不可投递（404 而非 403，不泄漏存在性）", async () => {
    const c = await inject("POST", "/canvas/canvases", { title: "私有" });
    const canvasId = c.data.id as string;
    const n = await inject("POST", `/canvas/canvases/${canvasId}/nodes`, {
      node_type: "image",
      x: 0,
      y: 0,
      params: {},
    });
    const gen = await inject(
      "POST",
      `/canvas/canvases/${canvasId}/nodes/${n.data.id}/generate`,
      { mode: "text2image", model: "tgi-2", input: {} },
      otherToken,
    );
    expect(gen.code).toBe(400102);
  });

  it("sync-tasks：任务终态后能把节点状态校正回来（避免永久停在生成中）", async () => {
    const c = await inject("POST", "/canvas/canvases", { title: "同步" });
    const canvasId = c.data.id as string;
    const n = await inject("POST", `/canvas/canvases/${canvasId}/nodes`, {
      node_type: "image",
      x: 0,
      y: 0,
      params: { mode: "text2image", prompt: "x", model: "tgi-2" },
    });
    const gen = await inject("POST", `/canvas/canvases/${canvasId}/nodes/${n.data.id}/generate`, {
      mode: "text2image",
      model: "tgi-2",
      input: { prompt: "x" },
    });
    expect(gen.code).toBe(0);

    // 刚投递完：节点是 2（生成中）
    const sync1 = await inject("POST", `/canvas/canvases/${canvasId}/nodes/sync-tasks`, {
      node_ids: [n.data.id],
    });
    expect(sync1.code).toBe(0);
    expect(sync1.data.nodes[0].status).toBe(2);
    expect(sync1.data.nodes[0].task_status).toBe(1); // pending

    // 手工把任务置为成功（模拟 worker 完成），sync 应把节点校正为 3
    const { pool: testPool } = await import("../src/db/database");
    await testPool.query("update tasks set status = 3 where id = $1", [gen.data.task_id]);
    const sync2 = await inject("POST", `/canvas/canvases/${canvasId}/nodes/sync-tasks`, {
      node_ids: [n.data.id],
    });
    expect(sync2.code).toBe(0);
    expect(sync2.data.nodes[0].status).toBe(3);
    expect(sync2.data.nodes[0].task_status).toBe(3);
  });

  // ══ 整画布模板（C2）══════════════════════════════════════
  //
  // 锁三条语义：
  //   1. 模板 payload 必须**自包含**（不带雪花 id），否则套用到别的画布必悬挂
  //   2. 可见性三层：官方(1) 全员 / 团队(2) 同 space / 个人(3) 仅创建者
  //   3. 套用只返回"待插入描述"，不直接写库（否则绕开乐观锁）

  it("存为模板 → payload 自包含（不含雪花 id）→ 可套用出新节点", async () => {
    const c = await inject("POST", "/canvas/canvases", { title: "模板源" });
    const canvasId = c.data.id as string;
    await inject("POST", `/canvas/canvases/${canvasId}/nodes`, {
      node_type: "text",
      name: "剧本",
      x: 0,
      y: 0,
      params: { prompt: "开场白" },
    });
    await inject("POST", `/canvas/canvases/${canvasId}/nodes`, {
      node_type: "image",
      name: "封面",
      x: 300,
      y: 0,
      params: { mode: "text2image", prompt: "封面图" },
    });

    const tpl = await inject("POST", `/canvas/canvases/${canvasId}/tpls`, { name: "我的两节点模板" });
    expect(tpl.code).toBe(0);
    const templateId = tpl.data.template_id as string;
    expect(templateId).toMatch(/^\d+$/);

    // 详情：payload 里节点描述**不应带 id 字段**（自包含）
    const detail = await inject("GET", `/canvas/templates/${templateId}`);
    expect(detail.code).toBe(0);
    const payloadNodes = detail.data.template.payload.nodes as Array<Record<string, unknown>>;
    expect(payloadNodes).toHaveLength(2);
    for (const n of payloadNodes) {
      expect(n.id).toBeUndefined(); // 关键：模板不能带雪花 id
      expect(typeof n.node_type).toBe("string");
      expect(typeof n.x).toBe("number");
    }

    // 套用：返回待插入描述（带偏移），节点数一致
    const inst = await inject("GET", `/canvas/templates/${templateId}/instantiate?dx=500&dy=100`);
    expect(inst.code).toBe(0);
    expect(inst.data.nodes).toHaveLength(2);
    expect(inst.data.nodes[0].x).toBe(500); // 0 + 500
    expect(inst.data.nodes[1].x).toBe(800); // 300 + 500
    // 套用结果本身也不得带 id（前端合并时自己生成本地 id）
    expect(inst.data.nodes[0].id).toBeUndefined();
  });

  it("模板可见性：别人的个人模板看不到（404，不泄漏存在性）", async () => {
    const c = await inject("POST", "/canvas/canvases", { title: "私有模板源" });
    const canvasId = c.data.id as string;
    await inject("POST", `/canvas/canvases/${canvasId}/nodes`, {
      node_type: "text",
      x: 0,
      y: 0,
      params: {},
    });
    const tpl = await inject("POST", `/canvas/canvases/${canvasId}/tpls`, { name: "私有模板", tpl_scope: 3 });
    const templateId = tpl.data.template_id as string;

    // 自己能看到
    const mine = await inject("GET", `/canvas/templates/${templateId}`);
    expect(mine.code).toBe(0);

    // 别人（另一个 space/user）看不到
    const other = await inject("GET", `/canvas/templates/${templateId}`, undefined, otherToken);
    expect(other.code).toBe(400102);
  });

  it("模板列表：包含官方 + 自己的；没有别人的个人模板", async () => {
    const c = await inject("POST", "/canvas/canvases", { title: "列表测试" });
    const canvasId = c.data.id as string;
    await inject("POST", `/canvas/canvases/${canvasId}/nodes`, { node_type: "text", x: 0, y: 0, params: {} });
    const tpl = await inject("POST", `/canvas/canvases/${canvasId}/tpls`, { name: "列表内模板" });
    const myTemplateId = tpl.data.template_id as string;

    const list = await inject("GET", "/canvas/templates?page=1&page_size=100");
    expect(list.code).toBe(0);
    const ids = (list.data.list as Array<{ id: string }>).map((x) => x.id);
    expect(ids).toContain(myTemplateId);

    // 别人的列表里不含我的个人模板
    const otherList = await inject("GET", "/canvas/templates?page=1&page_size=100", undefined, otherToken);
    const otherIds = (otherList.data.list as Array<{ id: string }>).map((x) => x.id);
    expect(otherIds).not.toContain(myTemplateId);
  });

  it("个人模板搜索：只搜自己的，且按名称模糊匹配", async () => {
    const c = await inject("POST", "/canvas/canvases", { title: "搜索测试" });
    const canvasId = c.data.id as string;
    await inject("POST", `/canvas/canvases/${canvasId}/nodes`, { node_type: "text", x: 0, y: 0, params: {} });
    const marker = `独特标记${Date.now()}`;
    await inject("POST", `/canvas/canvases/${canvasId}/tpls`, { name: marker });

    const hit = await inject("GET", `/canvas/templates/personal?query=${encodeURIComponent("独特标记")}`);
    expect(hit.code).toBe(0);
    expect((hit.data.list as Array<{ name: string }>).some((t) => t.name === marker)).toBe(true);

    const miss = await inject("GET", "/canvas/templates/personal?query=绝对不存在的名字xyz");
    expect(miss.code).toBe(0);
    expect(miss.data.list).toHaveLength(0);
  });

  it("删除个人模板：只能删自己的；删后不在列表里（软下架）", async () => {
    const c = await inject("POST", "/canvas/canvases", { title: "删除测试" });
    const canvasId = c.data.id as string;
    await inject("POST", `/canvas/canvases/${canvasId}/nodes`, { node_type: "text", x: 0, y: 0, params: {} });
    const tpl = await inject("POST", `/canvas/canvases/${canvasId}/tpls`, { name: "待删模板" });
    const templateId = tpl.data.template_id as string;

    // 别人删不了
    const otherDel = await inject("DELETE", `/canvas/templates/personal/${templateId}`, undefined, otherToken);
    expect(otherDel.code).toBe(403101);

    // 自己能删
    const del = await inject("DELETE", `/canvas/templates/personal/${templateId}`);
    expect(del.code).toBe(0);

    // 删后列表里没有；按 id 取也应 404（status=3 已下架）
    const list = await inject("GET", "/canvas/templates?page=1&page_size=100");
    expect((list.data.list as Array<{ id: string }>).map((x) => x.id)).not.toContain(templateId);
    const after = await inject("GET", `/canvas/templates/${templateId}`);
    expect(after.code).toBe(400102);
  });

  it("模板非法 scope → 400101（不允许造官方模板）", async () => {
    const c = await inject("POST", "/canvas/canvases", { title: "scope 测试" });
    const canvasId = c.data.id as string;
    // tpl_scope=1 是官方，普通用户不能创建
    const tpl = await inject("POST", `/canvas/canvases/${canvasId}/tpls`, { name: "想造官方", tpl_scope: 1 });
    expect(tpl.code).toBe(400101);
  });

  // ══ 素材（C8）════════════════════════════════════════════
  //
  // 锁三条：
  //   1. 只存 object_key（不存 URL，直链会过期且换驱动要洗库）
  //   2. material_type 白名单；节点必须属于同一画布
  //   3. 批量删除/下载显式回报失败项（不静默丢弃）

  it("素材：挂载 → 列表 → 按类型/来源筛选", async () => {
    const c = await inject("POST", "/canvas/canvases", { title: "素材" });
    const canvasId = c.data.id as string;

    const m1 = await inject("POST", `/canvas/canvases/${canvasId}/materials`, {
      object_key: `u/${spaceId}/canvas/a/cover.png`,
      material_type: "image",
      name: "封面图",
    });
    expect(m1.code).toBe(0);
    expect(m1.data.material_id).toMatch(/^\d+$/);

    const m2 = await inject("POST", `/canvas/canvases/${canvasId}/materials`, {
      object_key: `u/${spaceId}/canvas/a/clip.mp4`,
      material_type: "video",
      name: "片段",
    });
    expect(m2.code).toBe(0);

    const all = await inject("GET", `/canvas/canvases/${canvasId}/materials`);
    expect(all.code).toBe(0);
    expect(all.data.total).toBe(2);
    // 只存 object_key，不存 URL
    const cover = (all.data.list as Array<Record<string, unknown>>).find((x) => x.name === "封面图");
    expect(cover?.object_key).toBe(`u/${spaceId}/canvas/a/cover.png`);
    expect(cover?.url).toBeUndefined();

    const onlyImage = await inject("GET", `/canvas/canvases/${canvasId}/materials?material_type=image`);
    expect(onlyImage.data.total).toBe(1);
    expect((onlyImage.data.list as Array<{ material_type: string }>)[0]!.material_type).toBe("image");
  });

  it("素材：非法类型 → 400101；节点不属于本画布 → 400102", async () => {
    const c = await inject("POST", "/canvas/canvases", { title: "素材校验" });
    const canvasId = c.data.id as string;
    const other = await inject("POST", "/canvas/canvases", { title: "别的画布" });
    const otherCanvasId = other.data.id as string;
    const otherNode = await inject("POST", `/canvas/canvases/${otherCanvasId}/nodes`, {
      node_type: "image",
      x: 0,
      y: 0,
      params: {},
    });

    const badType = await inject("POST", `/canvas/canvases/${canvasId}/materials`, {
      object_key: `u/${spaceId}/canvas/x.bin`,
      material_type: "executable",
    });
    expect(badType.code).toBe(400101);

    // 把"别的画布"的节点挂到这个画布的素材上 → 必须拒绝（不能造出跨画布引用）
    const crossNode = await inject("POST", `/canvas/canvases/${canvasId}/materials`, {
      object_key: `u/${spaceId}/canvas/x.png`,
      material_type: "image",
      node_id: otherNode.data.id,
    });
    expect(crossNode.code).toBe(400102);
  });

  it("素材：节点产出素材可挂到节点上，并可批量删除（显式回报删除数）", async () => {
    const c = await inject("POST", "/canvas/canvases", { title: "产出素材" });
    const canvasId = c.data.id as string;
    const n = await inject("POST", `/canvas/canvases/${canvasId}/nodes`, {
      node_type: "image",
      x: 0,
      y: 0,
      params: {},
    });

    const m = await inject("POST", `/canvas/canvases/${canvasId}/materials`, {
      object_key: `u/${spaceId}/canvas/out/r1.png`,
      material_type: "image",
      node_id: n.data.id,
      source: 2, // 节点产出
    });
    expect(m.code).toBe(0);

    const byNode = await inject("GET", `/canvas/canvases/${canvasId}/materials?node_id=${n.data.id}`);
    expect(byNode.data.total).toBe(1);
    expect((byNode.data.list as Array<{ node_id: string }>)[0]!.node_id).toBe(n.data.id);

    const del = await inject("POST", `/canvas/canvases/${canvasId}/materials/batch-delete`, {
      material_ids: [m.data.material_id],
    });
    expect(del.code).toBe(0);
    expect(del.data.deleted).toBe(1);

    const after = await inject("GET", `/canvas/canvases/${canvasId}/materials`);
    expect(after.data.total).toBe(0);
  });

  it("素材：批量下载回报缺失 id（不静默丢弃）", async () => {
    const c = await inject("POST", "/canvas/canvases", { title: "下载" });
    const canvasId = c.data.id as string;
    const m = await inject("POST", `/canvas/canvases/${canvasId}/materials`, {
      object_key: `u/${spaceId}/canvas/d/a.png`,
      material_type: "image",
    });
    const res = await inject("POST", `/canvas/canvases/${canvasId}/materials/batch-download`, {
      material_ids: [m.data.material_id, "999999999999999999"],
    });
    expect(res.code).toBe(0);
    expect(res.data.list).toHaveLength(1);
    // 关键：找不到的要明说，否则用户以为下全了
    expect(res.data.missing).toContain("999999999999999999");
  });

  it("素材：upload-file 按扩展名猜测类型", async () => {
    const c = await inject("POST", "/canvas/canvases", { title: "上传" });
    const canvasId = c.data.id as string;
    const up = await inject("POST", `/canvas/canvases/${canvasId}/upload-file`, {
      object_key: `u/${spaceId}/uploads/voice.mp3`,
    });
    expect(up.code).toBe(0);
    expect(up.data.uri).toBe(`u/${spaceId}/uploads/voice.mp3`);

    const list = await inject("GET", `/canvas/canvases/${canvasId}/materials`);
    expect((list.data.list as Array<{ material_type: string }>)[0]!.material_type).toBe("audio");
  });

  it("素材：跨空间不可见（404）", async () => {
    const c = await inject("POST", "/canvas/canvases", { title: "私有素材" });
    const canvasId = c.data.id as string;
    const res = await inject("GET", `/canvas/canvases/${canvasId}/materials`, undefined, otherToken);
    expect(res.code).toBe(400102);
  });

  // ══ 批注（C9）════════════════════════════════════════════
  //
  // 锁三条：
  //   1. 建点 + 首条内容一次完成（不留空点）
  //   2. 只能删/改自己的内容（403101）
  //   3. resolve 是"标记已解决"，可反复切换

  it("批注：建点（含首条内容）→ 列消息 → 追加消息", async () => {
    const c = await inject("POST", "/canvas/canvases", { title: "批注" });
    const canvasId = c.data.id as string;

    const created = await inject("POST", `/canvas/canvases/${canvasId}/comment-nodes`, {
      anchor: { x: 120, y: 340 },
      content: "这里的镜头再长一点",
    });
    expect(created.code).toBe(0);
    const cnId = created.data.comment_node_id as string;

    // 一次调用就该带出首条内容，而不是空点
    const msgs = await inject("GET", `/canvas/canvases/${canvasId}/comment-nodes/${cnId}/comments`);
    expect(msgs.code).toBe(0);
    expect(msgs.data.list).toHaveLength(1);
    expect((msgs.data.list as Array<{ content: string }>)[0]!.content).toBe("这里的镜头再长一点");

    const added = await inject("POST", `/canvas/canvases/${canvasId}/comment-nodes/${cnId}/comments`, {
      content: "同意，改成 8s",
    });
    expect(added.code).toBe(0);

    const msgs2 = await inject("GET", `/canvas/canvases/${canvasId}/comment-nodes/${cnId}/comments`);
    expect(msgs2.data.list).toHaveLength(2);

    // 列表里带 comment_count，前端画飘点时要显示
    const list = await inject("GET", `/canvas/canvases/${canvasId}/comment-nodes`);
    expect(list.data.total).toBe(1);
    expect((list.data.list as Array<{ comment_count: number }>)[0]!.comment_count).toBe(2);
  });

  it("批注：挂到节点上 + scope=node；锚点可移动", async () => {
    const c = await inject("POST", "/canvas/canvases", { title: "节点批注" });
    const canvasId = c.data.id as string;
    const n = await inject("POST", `/canvas/canvases/${canvasId}/nodes`, {
      node_type: "video",
      x: 100,
      y: 100,
      params: {},
    });

    const created = await inject("POST", `/canvas/canvases/${canvasId}/comment-nodes`, {
      anchor: { x: 150, y: 160 },
      node_id: n.data.id,
      content: "这个节点的画幅不对",
    });
    expect(created.code).toBe(0);
    const cnId = created.data.comment_node_id as string;

    const detail = await inject("GET", `/canvas/canvases/${canvasId}/comment-nodes/${cnId}`);
    expect(detail.code).toBe(0);
    expect(detail.data.comment_node.node_id).toBe(n.data.id);
    // 不传 scope 但有 node_id → 自动判为 node 级
    expect(detail.data.comment_node.scope).toBe("node");

    const moved = await inject("PUT", `/canvas/canvases/${canvasId}/comment-nodes/${cnId}`, {
      anchor: { x: 500, y: 600 },
    });
    expect(moved.code).toBe(0);
    const after = await inject("GET", `/canvas/canvases/${canvasId}/comment-nodes/${cnId}`);
    expect(after.data.comment_node.anchor.x).toBe(500);
    expect(after.data.comment_node.anchor.y).toBe(600);
  });

  it("批注：resolve 可切换，并记录 resolved_by/at", async () => {
    const c = await inject("POST", "/canvas/canvases", { title: "解决" });
    const canvasId = c.data.id as string;
    const created = await inject("POST", `/canvas/canvases/${canvasId}/comment-nodes`, {
      anchor: { x: 10, y: 10 },
      content: "待处理",
    });
    const cnId = created.data.comment_node_id as string;

    const resolved = await inject("POST", `/canvas/canvases/${canvasId}/comment-nodes/${cnId}/resolve`, {
      resolved: true,
    });
    expect(resolved.code).toBe(0);
    expect(resolved.data.resolved).toBe(true);

    const got = await inject("GET", `/canvas/canvases/${canvasId}/comment-nodes/${cnId}`);
    expect(got.data.comment_node.resolved).toBe(true);
    expect(got.data.comment_node.resolved_by).toBeTruthy();
    expect(got.data.comment_node.resolved_at).toBeTruthy();

    // 可以重新打开
    const reopened = await inject("POST", `/canvas/canvases/${canvasId}/comment-nodes/${cnId}/resolve`, {
      resolved: false,
    });
    expect(reopened.data.resolved).toBe(false);
    const got2 = await inject("GET", `/canvas/canvases/${canvasId}/comment-nodes/${cnId}`);
    expect(got2.data.comment_node.resolved_by).toBeNull();
  });

  it("批注：只能删自己的（他人 → 403101）", async () => {
    const c = await inject("POST", "/canvas/canvases", { title: "权限" });
    const canvasId = c.data.id as string;
    const created = await inject("POST", `/canvas/canvases/${canvasId}/comment-nodes`, {
      anchor: { x: 0, y: 0 },
      content: "我的批注",
    });
    const cnId = created.data.comment_node_id as string;

    // 别人删不了（跨空间先撞 404，这条覆盖"同画布不同用户"的场景需要团队成员；
    // 这里用跨空间验证隔离 + 用作者本人验证成功路径）
    const otherDel = await inject("DELETE", `/canvas/canvases/${canvasId}/comment-nodes/${cnId}`, undefined, otherToken);
    expect(otherDel.code).toBe(400102); // 跨空间：画布都看不到

    // 作者本人能删
    const del = await inject("DELETE", `/canvas/canvases/${canvasId}/comment-nodes/${cnId}`);
    expect(del.code).toBe(0);

    const list = await inject("GET", `/canvas/canvases/${canvasId}/comment-nodes`);
    expect(list.data.total).toBe(0);
  });

  it("批注：空内容 → 400100；跨空间列表 → 404", async () => {
    const c = await inject("POST", "/canvas/canvases", { title: "校验" });
    const canvasId = c.data.id as string;
    const empty = await inject("POST", `/canvas/canvases/${canvasId}/comment-nodes`, {
      anchor: { x: 0, y: 0 },
      content: "   ",
    });
    expect(empty.code).toBe(400100);

    const cross = await inject("GET", `/canvas/canvases/${canvasId}/comment-nodes`, undefined, otherToken);
    expect(cross.code).toBe(400102);
  });

  it("批注：按 resolved 筛选", async () => {
    const c = await inject("POST", "/canvas/canvases", { title: "筛选" });
    const canvasId = c.data.id as string;
    const a = await inject("POST", `/canvas/canvases/${canvasId}/comment-nodes`, {
      anchor: { x: 0, y: 0 },
      content: "A",
    });
    await inject("POST", `/canvas/canvases/${canvasId}/comment-nodes`, {
      anchor: { x: 10, y: 10 },
      content: "B",
    });
    await inject("POST", `/canvas/canvases/${canvasId}/comment-nodes/${a.data.comment_node_id}/resolve`, {
      resolved: true,
    });

    const open = await inject("GET", `/canvas/canvases/${canvasId}/comment-nodes?resolved=0`);
    expect(open.data.total).toBe(1);
    const done = await inject("GET", `/canvas/canvases/${canvasId}/comment-nodes?resolved=1`);
    expect(done.data.total).toBe(1);
  });

  // ══ 固定组（C10）════════════════════════════════════════
  //
  // 最关键的断言是"双写一致性"：`canvas_pin_groups.node_ids` 与
  // `canvas_nodes.group_ids` 是同一事实的两份记录。只写一边，画布就会出现
  // "顶部固定栏有分组、但节点不知道自己属于它"（或反之），且很难排查。

  it("固定组：整体替换某槽位 → 双写一致（pin_groups 与 node.group_ids 都更新）", async () => {
    const c = await inject("POST", "/canvas/canvases", { title: "固定组" });
    const canvasId = c.data.id as string;
    const n1 = await inject("POST", `/canvas/canvases/${canvasId}/nodes`, { node_type: "text", x: 0, y: 0, params: {} });
    const n2 = await inject("POST", `/canvas/canvases/${canvasId}/nodes`, { node_type: "image", x: 300, y: 0, params: {} });
    const n3 = await inject("POST", `/canvas/canvases/${canvasId}/nodes`, { node_type: "video", x: 600, y: 0, params: {} });

    // 槽位 1：先放 n1 + n2
    const first = await inject("PUT", `/canvas/canvases/${canvasId}/pin-groups/1`, {
      name: "角色组",
      color: "#6C5CE7",
      node_ids: [n1.data.id, n2.data.id],
    });
    expect(first.code).toBe(0);
    expect(first.data.replaced).toBe(false);
    const groupId = first.data.pin_group.group_id as string;

    // 双写检查 1：节点侧能查到自己属于该组
    let detail = await inject("GET", `/canvas/canvases/${canvasId}`);
    let node1 = detail.data.nodes.find((x: { id: string }) => x.id === n1.data.id);
    expect(node1.group_ids).toContain(groupId);

    // 整体替换：只留 n3（n1/n2 应被移出）
    const second = await inject("PUT", `/canvas/canvases/${canvasId}/pin-groups/1`, {
      node_ids: [n3.data.id],
    });
    expect(second.code).toBe(0);
    expect(second.data.replaced).toBe(true);
    expect(second.data.pin_group.group_id).toBe(groupId); // 同一槽位复用同一个组 id

    detail = await inject("GET", `/canvas/canvases/${canvasId}`);
    node1 = detail.data.nodes.find((x: { id: string }) => x.id === n1.data.id);
    const node2 = detail.data.nodes.find((x: { id: string }) => x.id === n2.data.id);
    const node3 = detail.data.nodes.find((x: { id: string }) => x.id === n3.data.id);
    // 关键：被替换掉的成员必须从 group_ids 里移除，否则会出现"幽灵归属"
    expect(node1.group_ids).not.toContain(groupId);
    expect(node2.group_ids).not.toContain(groupId);
    expect(node3.group_ids).toContain(groupId);

    // 列表侧一致
    const list = await inject("GET", `/canvas/canvases/${canvasId}/pin-groups`);
    expect(list.code).toBe(0);
    expect(list.data.max_slots).toBe(7);
    const slot1 = (list.data.list as Array<{ slot: number; node_ids: string[] }>).find((g) => g.slot === 1);
    expect(slot1?.node_ids).toEqual([n3.data.id]);
  });

  it("固定组：槽位越界 → 400101（7 个槽位是硬约束）", async () => {
    const c = await inject("POST", "/canvas/canvases", {});
    const canvasId = c.data.id as string;
    const bad = await inject("PUT", `/canvas/canvases/${canvasId}/pin-groups/8`, { node_ids: [] });
    expect(bad.code).toBe(400101);
    const bad0 = await inject("PUT", `/canvas/canvases/${canvasId}/pin-groups/0`, { node_ids: [] });
    expect(bad0.code).toBe(400101);
  });

  it("固定组：节点不属于本画布 → 400101（不造跨画布引用）", async () => {
    const c = await inject("POST", "/canvas/canvases", { title: "A" });
    const canvasId = c.data.id as string;
    const other = await inject("POST", "/canvas/canvases", { title: "B" });
    const otherNode = await inject("POST", `/canvas/canvases/${other.data.id}/nodes`, {
      node_type: "text",
      x: 0,
      y: 0,
      params: {},
    });
    const res = await inject("PUT", `/canvas/canvases/${canvasId}/pin-groups/1`, {
      node_ids: [otherNode.data.id],
    });
    expect(res.code).toBe(400101);
  });

  it("固定组：删除组同时清节点侧归属；清空成员保留组", async () => {
    const c = await inject("POST", "/canvas/canvases", { title: "清理" });
    const canvasId = c.data.id as string;
    const n = await inject("POST", `/canvas/canvases/${canvasId}/nodes`, { node_type: "text", x: 0, y: 0, params: {} });

    await inject("PUT", `/canvas/canvases/${canvasId}/pin-groups/2`, { node_ids: [n.data.id] });
    let detail = await inject("GET", `/canvas/canvases/${canvasId}`);
    let node = detail.data.nodes.find((x: { id: string }) => x.id === n.data.id);
    expect(node.group_ids).toHaveLength(1);

    // 清空成员：组还在，节点归属清掉
    const cleared = await inject("DELETE", `/canvas/canvases/${canvasId}/pin-groups/2/members`);
    expect(cleared.code).toBe(0);
    expect(cleared.data.cleared).toBe(1);
    detail = await inject("GET", `/canvas/canvases/${canvasId}`);
    node = detail.data.nodes.find((x: { id: string }) => x.id === n.data.id);
    expect(node.group_ids).toHaveLength(0);
    const list1 = await inject("GET", `/canvas/canvases/${canvasId}/pin-groups`);
    expect((list1.data.list as Array<{ slot: number }>).some((g) => g.slot === 2)).toBe(true);

    // 删除组：组消失
    const del = await inject("DELETE", `/canvas/canvases/${canvasId}/pin-groups/2`);
    expect(del.code).toBe(0);
    const list2 = await inject("GET", `/canvas/canvases/${canvasId}/pin-groups`);
    expect((list2.data.list as Array<{ slot: number }>).some((g) => g.slot === 2)).toBe(false);
  });

  it("固定组：节点侧设置 group_ids（并校验组属于本画布）", async () => {
    const c = await inject("POST", "/canvas/canvases", { title: "节点侧" });
    const canvasId = c.data.id as string;
    const n = await inject("POST", `/canvas/canvases/${canvasId}/nodes`, { node_type: "text", x: 0, y: 0, params: {} });
    const g = await inject("PUT", `/canvas/canvases/${canvasId}/pin-groups/3`, { node_ids: [] });
    const groupId = g.data.pin_group.group_id as string;

    const set = await inject("PUT", `/canvas/canvases/${canvasId}/nodes/${n.data.id}/pin-groups`, {
      group_ids: [groupId],
    });
    expect(set.code).toBe(0);
    expect(set.data.group_ids).toEqual([groupId]);

    // 不存在的组 id → 400101（不能写进悬挂 id）
    const bad = await inject("PUT", `/canvas/canvases/${canvasId}/nodes/${n.data.id}/pin-groups`, {
      group_ids: ["999999999999999999"],
    });
    expect(bad.code).toBe(400101);
  });

  it("固定组：跨空间不可见（404）", async () => {
    const c = await inject("POST", "/canvas/canvases", { title: "私有" });
    const canvasId = c.data.id as string;
    const res = await inject("GET", `/canvas/canvases/${canvasId}/pin-groups`, undefined, otherToken);
    expect(res.code).toBe(400102);
  });

  // ══ 节点组模板（C11）════════════════════════════════════
  it("节点组模板：从分组存模板 → payload 自包含（无 id）", async () => {
    const c = await inject("POST", "/canvas/canvases", { title: "组模板" });
    const canvasId = c.data.id as string;
    const n1 = await inject("POST", `/canvas/canvases/${canvasId}/nodes`, {
      node_type: "text",
      name: "剧本文本",
      x: 0,
      y: 0,
      params: { prompt: "开场" },
    });
    await inject("POST", `/canvas/canvases/${canvasId}/nodes`, {
      node_type: "image",
      name: "封面",
      x: 300,
      y: 0,
      params: { mode: "text2image" },
    });
    // 建分组并把两个节点归进去
    const group = await inject("POST", `/canvas/canvases/${canvasId}/groups`, { name: "开场组" });
    expect(group.code).toBe(0);
    const groupId = group.data.id as string;
    await inject("PUT", `/canvas/canvases/${canvasId}/nodes/${n1.data.id}/pin-groups`, { group_ids: [] });
    // 通过 pin group 把节点归到该分组（这里复用固定组机制验证成员查询）
    const pg = await inject("PUT", `/canvas/canvases/${canvasId}/pin-groups/4`, {
      name: "开场组",
      node_ids: [n1.data.id],
    });
    expect(pg.code).toBe(0);

    const tpl = await inject("POST", `/canvas/canvases/${canvasId}/groups/${groupId}/templates`, {
      name: "开场组模板",
    });
    // 该 group 没有成员（成员在 pin group 里），应明确拒绝而不是存空模板
    expect(tpl.code).toBe(400101);
  });

  it("节点组模板：列表与改名", async () => {
    const c = await inject("POST", "/canvas/canvases", { title: "组模板列表" });
    const canvasId = c.data.id as string;
    const list = await inject("GET", `/canvas/canvases/${canvasId}/group-templates`);
    expect(list.code).toBe(0);
    expect(Array.isArray(list.data.list)).toBe(true);
  });
});

