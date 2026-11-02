import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { createDb, directorPosePresets, directorScenes, spaceMembers } from "@app/db";
import cookie from "@fastify/cookie";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { AppModule } from "../src/app.module";
import { AllExceptionsFilter } from "../src/common/http/exception.filter";
import { EnvelopeInterceptor } from "../src/common/http/envelope.interceptor";

/**
 * 3D 导演台（director 域）e2e —— 场景快照持久化 + 姿态预设 + 编辑心跳。
 *
 * 这组用例锁的是 4 处"会静默毁数据或毁协作"的接缝：
 * 1. **快照往返一致**：payload 是不透明 JSON，服务端一旦"顺手清洗"就会悄悄丢掉编辑器
 *    新增的字段（用户的机位/站位白调了），所以必须断言逐层 deep equal；
 * 2. **乐观锁**：两人同时编辑时，旧 version 的 PUT 必须 746002 而不是静默覆盖，
 *    且 msg 里要带服务端当前版本（统一信封不暴露 details，前端只能从 msg 拿）；
 * 3. **软删后不可读**：软删的场景不得出现在列表、GET/PUT/duplicate 一律 404
 *    （否则"删了还在"会让协同方一直往已删场景写）；
 * 4. **心跳不落库**：协作者列表来自 Redis TTL key，60s 过期，删除场景时顺手清 key。
 */
let app: NestFastifyApplication;
let token = "";
let otherToken = "";
let permToken = "";
let spaceId = "";
/** 被踢出 space 的用户（用来验证 403；同时也是"另一个真实用户"用于协作者昵称/预设归属） */
let permUserId = "";
let projectId = "";
const createdSceneIds: string[] = [];
const createdPresetIds: string[] = [];

interface Envelope {
  code: number;
  msg: string;
  data: any;
}

async function inject(
  method: "GET" | "POST" | "PUT" | "DELETE",
  url: string,
  payload?: unknown,
  authToken?: string,
): Promise<Envelope> {
  const bearer = authToken === undefined ? token : authToken;
  const res = await app.inject({
    method,
    url: `/v1${url}`,
    headers: {
      ...(payload === undefined ? {} : { "content-type": "application/json" }),
      ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
    },
    payload: payload === undefined ? undefined : JSON.stringify(payload),
  });
  return res.json() as Envelope;
}

async function loginNewUser(tag: number): Promise<{ token: string; userId: string }> {
  const phone = `13${String(Date.now()).slice(-7)}${String(tag).padStart(2, "0")}`;
  const sms = await app.inject({ method: "POST", url: "/v1/auth/sms-code", payload: { phone } });
  const smsBody = sms.json() as Envelope;
  const login = (
    await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: { phone, code: smsBody.data.debug_code, age_confirmed: true },
    })
  ).json() as Envelope;
  const accessToken = login.data?.access_token as string;
  if (!accessToken) throw new Error(`login failed: ${JSON.stringify(login).slice(0, 200)}`);
  const me = await inject("GET", "/me", undefined, accessToken);
  return { token: accessToken, userId: String(me.data.user.id) };
}

/** 与 `Director3D.vue` 的本地存档同形的快照（相机 / 机位列表 / 角色站位 / 场景设置） */
function snapshot(marker: string) {
  return {
    camPos: { x: 2.4, y: 2.2, z: 3.2 },
    camTarget: { x: 0, y: 1, z: 0 },
    fov: 50,
    groundOpacity: 0.4,
    positions: [
      { id: "actor-1", name: marker, x: -0.8, z: 0, rot: 0.3, pose: "walk", image: null },
      { id: "actor-2", name: "配角", x: 0.8, z: 0.5, rot: -0.2, pose: "sit", image: null },
    ],
    cameras: [
      { id: "cam-1", name: "机位1", pos: { x: 2.4, y: 2.2, z: 3.2 }, target: { x: 0, y: 1, z: 0 }, fov: 50 },
      { id: "cam-2", name: "机位2", pos: { x: -2.4, y: 2, z: 3 }, target: { x: 0, y: 1, z: 0 }, fov: 35 },
    ],
    activeCamIndex: 1,
    // 编辑器未来新增的字段也要能原样往返（服务端不解析 payload 的意义就在这）
    editorExtras: { futureField: [1, 2, 3], nested: { a: marker } },
  };
}

/**
 * 结构指纹：把任意 JSON 折成"类型/键集/数组长度/数值是否有限"的递归描述串。
 *
 * 为什么不用像素比对做 3D 验收（竞品口径待取证时的替代方案）：WebGL 渲染结果对
 * 显卡驱动 / DPR / 抗锯齿实现敏感，同一份 payload 在两台机器上必然出不同像素，
 * 用它做断言只会得到 flaky 用例。而"场景被保存/复制后结构是否等价、关键对象
 * 数量是否一致"是稳定可断言的——真正会毁数据的错误（丢字段、数组塌成对象、
 * 数值变字符串）都能被它抓到。
 */
function shapeOf(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return `[${value.map(shapeOf).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, item]) => `${key}:${shapeOf(item)}`);
    return `{${entries.join(",")}}`;
  }
  if (typeof value === "number") return Number.isFinite(value) ? "number" : "non-finite-number";
  return typeof value;
}

/** 关键对象计数（3D 场景的"内容规模"）：立场 / 机位 / 是否选中机位 */
function countsOfGate(payload: any) {
  return {
    positions: Array.isArray(payload?.positions) ? payload.positions.length : -1,
    cameras: Array.isArray(payload?.cameras) ? payload.cameras.length : -1,
    hasActiveCam: Number.isInteger(payload?.activeCamIndex),
  };
}

beforeAll(async () => {
  app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), { logger: false });
  await app.register(cookie as never);
  app.setGlobalPrefix("v1");
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalInterceptors(new EnvelopeInterceptor());
  await app.init();
  await app.getHttpAdapter().getInstance().ready();

  token = (await loginNewUser(1)).token;
  otherToken = (await loginNewUser(2)).token;
  spaceId = String((await inject("GET", "/me")).data.space.id);
  // 第三个用户专门用来验"非成员 403"：建完后把它的 space_members 行删掉
  const perm = await loginNewUser(3);
  permToken = perm.token;
  permUserId = perm.userId;
  const { db, pool } = createDb(process.env.DATABASE_URL ?? "");
  try {
    await db.delete(spaceMembers).where(eq(spaceMembers.userId, BigInt(perm.userId)));
  } finally {
    await pool.end();
  }

  const created = await inject("POST", "/projects", {
    title: `导演台测试项目 ${Date.now()}`,
    source_type: 1,
    source_text: "第一章：夜戏。第二章：对峙。",
  });
  projectId = String(created.data.id);
}, 120_000);

afterAll(async () => {
  const { db, pool } = createDb(process.env.DATABASE_URL ?? "");
  try {
    if (createdSceneIds.length > 0) {
      await db.delete(directorScenes).where(inArray(directorScenes.id, createdSceneIds.map((id) => BigInt(id))));
    }
    if (createdPresetIds.length > 0) {
      await db
        .delete(directorPosePresets)
        .where(inArray(directorPosePresets.id, createdPresetIds.map((id) => BigInt(id))));
    }
  } finally {
    await pool.end();
  }
  await app.close();
});

describe("场景快照：保存 → 读回 → 列表", () => {
  let sceneId = "";

  it("保存返回 version=1，读回 payload 与提交的逐层一致", async () => {
    const payload = snapshot("主角A");
    const created = await inject("POST", "/director/scenes", {
      project_id: projectId,
      name: "雨夜对峙",
      payload,
      // 缩略图存的是 /assets/upload 返回的 storage key，读时应被签名成可访问 URL
      thumbnail_uri: `u/${spaceId}/assets/test/orig.png`,
    });
    expect(created.code, created.msg).toBe(0);
    expect(created.data.version).toBe(1);
    expect(created.data.project_id).toBe(projectId);
    sceneId = String(created.data.id);
    createdSceneIds.push(sceneId);

    const detail = await inject("GET", `/director/scenes/${sceneId}`);
    expect(detail.code).toBe(0);
    // 不解析 ≠ 清洗：编辑器新增的 editorExtras 也必须原样回来
    expect(detail.data.payload).toEqual(payload);
    expect(detail.data.name).toBe("雨夜对峙");
    expect(detail.data.version).toBe(1);
    expect(String(detail.data.thumbnail_url ?? "")).toMatch(/^https?:\/\//);
  });

  it("列表按项目筛、最近编辑优先，并带缩略图字段", async () => {
    const created = await inject("POST", "/director/scenes", {
      project_id: projectId,
      name: "第二场",
      payload: snapshot("主角B"),
    });
    expect(created.code, created.msg).toBe(0);
    createdSceneIds.push(String(created.data.id));

    const list = await inject("GET", `/director/scenes?project_id=${projectId}&page=1&page_size=20`);
    expect(list.code).toBe(0);
    expect(list.data.total).toBe(2);
    // 刚建的排第一（updatedAt desc）：前端"打开项目即载入最近场景"依赖这个顺序
    expect(list.data.list[0].name).toBe("第二场");
    expect(list.data.list.every((row: { project_id: string }) => row.project_id === projectId)).toBe(true);
  });

  it("参数校验：payload 非对象 / 超大 / episode_id 缺 project_id / 跨 space 的 project", async () => {
    const notObject = await inject("POST", "/director/scenes", { payload: [1, 2, 3] });
    expect(notObject.code).not.toBe(0);

    const tooLarge = await inject("POST", "/director/scenes", {
      payload: { blob: "x".repeat(600 * 1024) },
    });
    expect(tooLarge.code).not.toBe(0);
    expect(tooLarge.msg).toMatch(/payload too large/);

    const episodeOnly = await inject("POST", "/director/scenes", {
      episode_id: "123",
      payload: snapshot("x"),
    });
    expect(episodeOnly.code).not.toBe(0);
    expect(episodeOnly.msg).toMatch(/project_id/);

    // 别人的项目：按"不存在"处理（不泄漏存在性）
    const foreign = await inject(
      "POST",
      "/director/scenes",
      { project_id: projectId, payload: snapshot("x") },
      otherToken,
    );
    expect(foreign.code).not.toBe(0);
  });
});

describe("验收口径：结构等价 + 关键对象计数（替代像素比对）", () => {
  /** 同形不同值：结构必须一致（断言不应依赖具体数值） */
  function variant(marker: string, positions: number, cameras: number) {
    return {
      camPos: { x: positions, y: 2, z: 3 },
      camTarget: { x: 0, y: 1, z: 0 },
      fov: 45,
      groundOpacity: 0.5,
      positions: Array.from({ length: positions }, (_, index) => ({
        id: `actor-${index}`,
        name: `${marker}-${index}`,
        x: index,
        z: 0,
        rot: 0,
        pose: "stand",
        image: null,
      })),
      cameras: Array.from({ length: cameras }, (_, index) => ({
        id: `cam-${index}`,
        name: `机位${index}`,
        pos: { x: index, y: 2, z: 3 },
        target: { x: 0, y: 1, z: 0 },
        fov: 45,
      })),
      activeCamIndex: 0,
      editorExtras: { futureField: [1, 2], nested: { a: marker } },
    };
  }

  it("同形快照两次保存 → 读回结构指纹一致、关键对象计数一致", async () => {
    const a = await inject("POST", "/director/scenes", {
      project_id: projectId,
      name: "结构等价A",
      payload: variant("A", 2, 2),
    });
    const b = await inject("POST", "/director/scenes", {
      project_id: projectId,
      name: "结构等价B",
      payload: variant("B", 2, 2),
    });
    expect(a.code, a.msg).toBe(0);
    expect(b.code, b.msg).toBe(0);
    createdSceneIds.push(String(a.data.id), String(b.data.id));

    const readA = (await inject("GET", `/director/scenes/${a.data.id}`)).data.payload;
    const readB = (await inject("GET", `/director/scenes/${b.data.id}`)).data.payload;

    expect(shapeOf(readA)).toBe(shapeOf(readB));
    expect(countsOfGate(readA)).toEqual({ positions: 2, cameras: 2, hasActiveCam: true });
    expect(countsOfGate(readB)).toEqual(countsOfGate(readA));
    // 值确实不同（否则上面的结构断言可能因为两边都是空壳而恒真）
    expect(readA.positions[0].name).toBe("A-0");
    expect(readB.positions[0].name).toBe("B-0");
  });

  it("结构指纹能区分规模差异（反证：多一个机位必须被检出）", async () => {
    const wide = await inject("POST", "/director/scenes", {
      project_id: projectId,
      name: "结构等价C-3机位",
      payload: variant("C", 3, 3),
    });
    expect(wide.code, wide.msg).toBe(0);
    createdSceneIds.push(String(wide.data.id));

    const readC = (await inject("GET", `/director/scenes/${wide.data.id}`)).data.payload;
    // 与上面 B（2 立场 2 机位）相比：结构串与计数都必须不同，证明断言不是恒真
    expect(shapeOf(readC)).not.toBe(shapeOf(variant("B", 2, 2)));
    expect(countsOfGate(readC)).toEqual({ positions: 3, cameras: 3, hasActiveCam: true });
  });

  it("复制场景：payload 逐层等价、结构指纹与源场景相同", async () => {
    const src = await inject("POST", "/director/scenes", {
      project_id: projectId,
      name: "待复制源",
      payload: variant("D", 2, 1),
    });
    expect(src.code, src.msg).toBe(0);
    createdSceneIds.push(String(src.data.id));

    const dup = await inject("POST", `/director/scenes/${src.data.id}/duplicate`, {});
    expect(dup.code, dup.msg).toBe(0);
    createdSceneIds.push(String(dup.data.id));

    const readDup = (await inject("GET", `/director/scenes/${dup.data.id}`)).data.payload;
    expect(readDup).toEqual(variant("D", 2, 1));
    expect(shapeOf(readDup)).toBe(shapeOf(variant("D", 2, 1)));
    expect(countsOfGate(readDup)).toEqual({ positions: 2, cameras: 1, hasActiveCam: true });
  });
});

describe("乐观锁：版本冲突 746002", () => {
  let sceneId = "";

  it("PUT 带旧 version 成功推版本，再用同一旧 version 提交必须 746002 且带 current=N", async () => {
    const created = await inject("POST", "/director/scenes", {
      project_id: projectId,
      name: "并发场景",
      payload: snapshot("并发A"),
    });
    sceneId = String(created.data.id);
    createdSceneIds.push(sceneId);
    expect(created.data.version).toBe(1);

    const first = await inject("PUT", `/director/scenes/${sceneId}`, {
      version: 1,
      name: "并发场景-改1",
      payload: snapshot("并发A改"),
    });
    expect(first.code, first.msg).toBe(0);
    expect(first.data.version).toBe(2);
    expect(first.data.payload.positions[0].name).toBe("并发A改");

    // 第二个编辑者还拿着 version=1：必须被拒，且给出服务端当前版本供前端提示
    const stale = await inject("PUT", `/director/scenes/${sceneId}`, {
      version: 1,
      name: "并发场景-改2（旧）",
      payload: snapshot("并发A改2"),
    });
    expect(stale.code).toBe(746002);
    expect(stale.msg).toMatch(/current=2/);

    // 服务端数据没被旧版本覆盖
    const detail = await inject("GET", `/director/scenes/${sceneId}`);
    expect(detail.data.version).toBe(2);
    expect(detail.data.name).toBe("并发场景-改1");
  });

  it("只更新 name/thumbnail 时不改动 payload；version 缺失 → 参数错误", async () => {
    const res = await inject("PUT", `/director/scenes/${sceneId}`, {
      version: 2,
      name: "只改名",
      thumbnail_uri: `u/${spaceId}/assets/test/orig.png`,
    });
    expect(res.code, res.msg).toBe(0);
    expect(res.data.version).toBe(3);
    expect(res.data.payload.positions[0].name).toBe("并发A改");
    expect(String(res.data.thumbnail_url ?? "")).toMatch(/^https?:\/\//);

    const missing = await inject("PUT", `/director/scenes/${sceneId}`, { name: "没有版本" });
    expect(missing.code).not.toBe(0);
  });
});

describe("复制与软删", () => {
  let sceneId = "";

  it("复制：新场景 version=1、快照一致、名字带副本", async () => {
    const created = await inject("POST", "/director/scenes", {
      project_id: projectId,
      name: "原场景",
      payload: snapshot("复制源"),
    });
    sceneId = String(created.data.id);
    createdSceneIds.push(sceneId);

    const dup = await inject("POST", `/director/scenes/${sceneId}/duplicate`, {});
    expect(dup.code, dup.msg).toBe(0);
    createdSceneIds.push(String(dup.data.id));
    expect(dup.data.version).toBe(1);
    expect(dup.data.id).not.toBe(sceneId);
    expect(dup.data.name).toBe("原场景 副本");
    expect(dup.data.payload).toEqual(snapshot("复制源"));
  });

  it("软删后 GET/PUT/duplicate 全 404，列表不再出现", async () => {
    const removed = await inject("DELETE", `/director/scenes/${sceneId}`);
    expect(removed.code, removed.msg).toBe(0);

    expect((await inject("GET", `/director/scenes/${sceneId}`)).code).toBe(400102);
    expect((await inject("PUT", `/director/scenes/${sceneId}`, { version: 1, name: "x" })).code).toBe(400102);
    expect((await inject("POST", `/director/scenes/${sceneId}/duplicate`, {})).code).toBe(400102);

    const list = await inject("GET", `/director/scenes?project_id=${projectId}&page=1&page_size=50`);
    expect(list.data.list.some((row: { id: string }) => row.id === sceneId)).toBe(false);
  });

  it("跨 space 读不到别人的场景（按不存在处理）", async () => {
    const created = await inject("POST", "/director/scenes", { payload: snapshot("隔离") });
    createdSceneIds.push(String(created.data.id));
    const res = await inject("GET", `/director/scenes/${created.data.id}`, undefined, otherToken);
    expect(res.code).toBe(400102);
  });
});

describe("姿态预设", () => {
  it("保存个人预设 → 列表可见且 mine=true；scope 非法 → 参数错误", async () => {
    const created = await inject("POST", "/director/pose-presets", {
      name: "双人对峙",
      payload: { actors: snapshot("预设").positions, camera: snapshot("预设").cameras[0] },
      scope: 1,
    });
    expect(created.code, created.msg).toBe(0);
    createdPresetIds.push(String(created.data.id));
    expect(created.data.scope).toBe(1);
    expect(created.data.mine).toBe(true);

    const list = await inject("GET", "/director/pose-presets");
    expect(list.code).toBe(0);
    const mine = list.data.list.find((row: { id: string }) => row.id === String(created.data.id));
    expect(mine?.name).toBe("双人对峙");

    const bad = await inject("POST", "/director/pose-presets", { name: "x", payload: {}, scope: 9 });
    expect(bad.code).not.toBe(0);
  });

  it("团队预设（scope=2）对同 space 其他成员可见；别人的个人预设不可见", async () => {
    /**
     * 用 DB 造"另一名成员的预设"而不是再造一个能登录的同 space 用户：
     * 登录态里的 space_id 来自 token，无法在同一 space 下切换成另一个人；
     * 这里要验的是**可见性规则**（团队共享可见、个人预设仅本人），直接落两行最直接。
     * 归属人用 `permUserId`（真实 users 行，但不是本 space 成员）——
     * 既满足 createdBy 外键，又能证明"别人的个人预设不会被我看���"。
     */
    const { db, pool } = createDb(process.env.DATABASE_URL ?? "");
    let teamPresetId = "";
    let peerPersonalId = "";
    try {
      const [mineRow] = await db
        .select()
        .from(directorPosePresets)
        .where(eq(directorPosePresets.id, BigInt(createdPresetIds[0]!)));
      expect(mineRow).toBeTruthy();
      const insertedTeam = await db
        .insert(directorPosePresets)
        .values({
          id: (await import("@app/shared")).newId(),
          spaceId: mineRow!.spaceId,
          name: "团队常用机位",
          payload: { actors: [] },
          scope: 2,
          createdBy: BigInt(permUserId),
        })
        .returning();
      teamPresetId = String(insertedTeam[0]!.id);
      const insertedPersonal = await db
        .insert(directorPosePresets)
        .values({
          id: (await import("@app/shared")).newId(),
          spaceId: mineRow!.spaceId,
          name: "别人私藏",
          payload: { actors: [] },
          scope: 1,
          createdBy: BigInt(permUserId),
        })
        .returning();
      peerPersonalId = String(insertedPersonal[0]!.id);
    } finally {
      await pool.end();
    }
    createdPresetIds.push(teamPresetId, peerPersonalId);

    const list = await inject("GET", "/director/pose-presets");
    const names = (list.data.list as Array<{ name: string; mine: boolean }>).map((row) => row.name);
    expect(names).toContain("团队常用机位");
    expect(names).not.toContain("别人私藏");
    const teamRow = (list.data.list as Array<{ name: string; mine: boolean }>).find((row) => row.name === "团队常用机位");
    expect(teamRow?.mine).toBe(false);

    const teamOnly = await inject("GET", "/director/pose-presets?scope=2");
    expect((teamOnly.data.list as Array<{ scope: number }>).every((row) => row.scope === 2)).toBe(true);
  });
});

describe("编辑心跳（Redis TTL，不落库）", () => {
  it("首次心跳：ttl=60、无协作者；另一人也在线时能列出昵称与 last_seen_ms", async () => {
    const created = await inject("POST", "/director/scenes", { payload: snapshot("心跳") });
    const sceneId = String(created.data.id);
    createdSceneIds.push(sceneId);

    const first = await inject("POST", "/director/heartbeat", { scene_id: sceneId });
    expect(first.code, first.msg).toBe(0);
    expect(first.data.ttl_s).toBe(60);
    expect(first.data.count).toBe(0);

    // 自己再跳一次：自己的 key 不能被算成"协作者"
    const second = await inject("POST", "/director/heartbeat", { scene_id: sceneId });
    expect(second.code).toBe(0);
    expect(second.data.count).toBe(0);

    // 造一个"另一名协作者"的心跳（等价于对方刚发过一跳；用真实 users 行才能取到昵称）
    const peerId = permUserId;

    const { RedisService } = await import("../src/redis/redis.service");
    const redis = app.get(RedisService);
    /**
     * 心跳是一个**每场景一个 HASH**（field=user_id）。
     * 不用"每人一个 key + SCAN"：大 keyspace 下 SCAN MATCH 要扫多轮才命中一个场景，
     * 而心跳是每次打开导演台都会调的接口（实测 dev 库万级 key 时首轮 COUNT=100 全空）。
     */
    const hbKey = `director:hb:${sceneId}`;
    await redis.client.hset(hbKey, peerId, JSON.stringify({ at: Date.now() - 5_000 }));
    await redis.client.expire(hbKey, 61);

    const withPeer = await inject("POST", "/director/heartbeat", { scene_id: sceneId });
    expect(withPeer.data.count).toBe(1);
    expect(withPeer.data.collaborators[0].user_id).toBe(peerId);
    expect(withPeer.data.collaborators[0].nickname.length).toBeGreaterThan(0);
    expect(withPeer.data.collaborators[0].last_seen_ms).toBeGreaterThanOrEqual(5_000);

    // 过期残留（超过 TTL 的 field）不算在线，并会在读取时被清掉
    await redis.client.hset(hbKey, "108000000000000009", JSON.stringify({ at: Date.now() - 70_000 }));
    const afterStale = await inject("POST", "/director/heartbeat", { scene_id: sceneId });
    expect(afterStale.data.count).toBe(1);
    expect(await redis.client.hexists(hbKey, "108000000000000009")).toBe(0);
    // 心跳是易失信息：不得写任务/场景行（版本号不动即证明没落库）
    const detail = await inject("GET", `/director/scenes/${sceneId}`);
    expect(detail.data.version).toBe(1);
  });

  it("心跳对不存在/已删场景返回 404", async () => {
    const res = await inject("POST", "/director/heartbeat", { scene_id: "108000000000000001" });
    expect(res.code).toBe(400102);
  });
});

describe("权限：非 space 成员 403", () => {
  it("被移出 space 的用户调 director 端点 → 403（不是 404，前端要提示无权限）", async () => {
    const res = await inject("POST", "/director/scenes", { payload: {} }, permToken);
    expect(res.code).toBe(403101);
  });
});
