import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import cookie from "@fastify/cookie";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { and, eq, inArray } from "drizzle-orm";
import {
  abExperiments,
  abHits,
  homeConfigs,
  models,
  taskEvents,
  taskShares,
  tasks,
  users,
} from "@app/db";
import { newId } from "@app/shared";
import { AppModule } from "../src/app.module";
import { AllExceptionsFilter } from "../src/common/http/exception.filter";
import { EnvelopeInterceptor } from "../src/common/http/envelope.interceptor";
import { db } from "../src/db/database";

/**
 * 首页域契约测试（模块 #1 收尾）：配置驱动 / 未读长轮询 / AB 位。
 *
 * 重点验证五件事（错了会让首页"看起来有配置但其实是假的"）：
 * 1. **未配置也是成功**：没有 `home_configs` 行 → `source:"default"` + 内置 6 板块，
 *    不是 500 也不是空数组；
 * 2. **配置优先级**：space 覆盖 > global > 默认；
 * 3. **长轮询真的会挂起**：`timeout_ms` 生效（否则前端红点会变成忙轮询），
 *    且超时返回 `timed_out:true` + 可继续用的 cursor；
 * 4. **未读不漏不串**：只要有增量立即返回；别人空间/别人的任务事件不能出现；
 * 5. **AB 一人一变体**：首次落 `ab_hits`，二次读回同变体（刷新换文案=事故）。
 *
 * 说明：`HOME_UNREAD_TIMEOUT_MS` 只把服务端 25s 上限调小，测试仍显式传 `timeout_ms`，
 * 两条路径互不依赖。
 */
describe("home config / unread / ab e2e", () => {
  let app: NestFastifyApplication;
  const runTag = randomUUID().slice(0, 8);
  /** AB 实验 key（唯一，避免撞上别的套件/线上实验） */
  const abKey = `home_ab_${runTag}`;
  /** 首页配置版本号（本套件独占 global 行，值本身不影响断言） */
  const configVersion = 901;
  let token = "";
  let spaceId = "";
  let userId = "";
  let otherToken = "";
  let otherSpaceId = "";
  let taskId = "";
  let otherTaskId = "";

  const inject = async (method: string, url: string, payload?: unknown, authToken?: string, space?: string) => {
    const headers: Record<string, string> = {};
    if (payload !== undefined) headers["content-type"] = "application/json";
    if (authToken) headers.authorization = `Bearer ${authToken}`;
    if (space) headers["x-space-id"] = space;
    const res = await app.inject({
      method: method as "GET" | "POST" | "PATCH",
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

  async function login(tag: string): Promise<{ token: string; spaceId: string; userId: string }> {
    // 手机号必须严格 11 位数字（`^1\d{10}$`）：1 + 8 位时间戳 + 2 位数字 tag
    const phone = `1${String(Date.now()).slice(-8)}${tag}`;
    const sms = await inject("POST", "/auth/sms-code", { phone });
    const code = (sms.data as { debug_code?: string } | undefined)?.debug_code;
    const login1 = await inject("POST", "/auth/login", { phone, code, age_confirmed: true });
    const data = login1.data as { access_token?: string; space_id?: string; user?: { id?: string } } | undefined;
    return {
      token: data?.access_token ?? "",
      spaceId: String(data?.space_id ?? ""),
      userId: String(data?.user?.id ?? ""),
    };
  }

  /** 直接插任务行：首页只读 tasks/task_events，不需要跑真实生成（不依赖 worker） */
  async function seedTask(space: string, user: string, label: string): Promise<string> {
    const [model] = await db.select({ id: models.id }).from(models).limit(1);
    expect(model).toBeTruthy();
    const id = BigInt(newId());
    await db.insert(tasks).values({
      id,
      spaceId: BigInt(space),
      userId: BigInt(user),
      capability: "video",
      mode: "text2video",
      modelId: model.id,
      input: { prompt: label },
      options: { ratio: "9:16", resolution: "720p", duration: 5, count: 1 },
      status: 3,
      title: label,
      finishedAt: new Date(),
    });
    return String(id);
  }

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

    // 本套件独占 `scope='global'` 的首页配置行：先清干净再断言"未配置→默认"。
    // 注意：`home_configs` 还被 op/campaign 域当通用 KV 用（scope 形如 `op:*`、
    // `campaign_signup_draft:*`），所以这里只删 global，不能清整表。
    await db.delete(homeConfigs).where(eq(homeConfigs.scope, "global"));

    const me = await login("01");
    token = me.token;
    spaceId = me.spaceId;
    userId = me.userId;
    const other = await login("02");
    otherToken = other.token;
    otherSpaceId = other.spaceId;
    taskId = await seedTask(spaceId, userId, `home-task-${runTag}`);
    otherTaskId = await seedTask(otherSpaceId, other.userId, `home-other-${runTag}`);
  });

  afterAll(async () => {
    // 顺序很重要：ab_hits 有指向 ab_experiments 的外键，先删命中再删实验，
    // 否则 afterAll 抛 FK 错误会让后面的清理全部跳过（上一版踩过）。
    const experiments = await db
      .select({ id: abExperiments.id })
      .from(abExperiments)
      .where(eq(abExperiments.key, abKey));
    if (experiments.length > 0) {
      await db.delete(abHits).where(inArray(abHits.experimentId, experiments.map((row) => row.id)));
      await db.delete(abExperiments).where(inArray(abExperiments.id, experiments.map((row) => row.id)));
    }
    await db.delete(taskEvents).where(inArray(taskEvents.taskId, [BigInt(taskId), BigInt(otherTaskId)]));
    await db.delete(taskShares).where(inArray(taskShares.taskId, [BigInt(taskId), BigInt(otherTaskId)]));
    await db.delete(tasks).where(inArray(tasks.id, [BigInt(taskId), BigInt(otherTaskId)]));
    await db.delete(homeConfigs).where(eq(homeConfigs.scope, "global"));
    await db
      .delete(homeConfigs)
      .where(and(eq(homeConfigs.scope, "space"), eq(homeConfigs.spaceId, BigInt(spaceId))));
    await app.close();
  });

  // ── 配置 ─────────────────────────────────────────────────
  it("未配置时返回内置默认板块（source=default，不是 500/空数组）", async () => {
    const res = await inject("GET", "/home/config", undefined, token, spaceId);
    expect(res.status).toBe(200);
    expect(res.code).toBe(0);
    const data = res.data as {
      source: string;
      version: number | null;
      sections: Array<{ key: string; visible: boolean; sort: number }>;
      unread: { poll_timeout_ms: number };
    };
    expect(data.source).toBe("default");
    expect(data.version).toBeNull();
    expect(data.sections.map((s) => s.key)).toEqual([
      "hero",
      "workflow",
      "canvas",
      "tools",
      "banner",
      "recent",
    ]);
    expect(data.sections.every((s) => s.visible)).toBe(true);
    // 排序必须是从小到大（前端直接按返回顺序渲染）
    const sorts = data.sections.map((s) => s.sort);
    expect([...sorts].sort((a, b) => a - b)).toEqual(sorts);
    expect(data.unread.poll_timeout_ms).toBeGreaterThan(0);
  });

  it("global 配置生效（含板块显隐/排序与 AB 位声明）", async () => {
    const version = configVersion;
    await db.insert(homeConfigs).values({
      id: BigInt(newId()),
      scope: "global",
      spaceId: null,
      version,
      payload: {
        sections: [
          { key: "recent", visible: true, sort: 5 },
          { key: "hero", visible: false, sort: 10 },
        ],
        ab_slots: [{ key: "home_hero_cta", experiment: abKey }],
      },
    });
    const res = await inject("GET", "/home/config", undefined, token, spaceId);
    const data = res.data as {
      source: string;
      version: number;
      sections: Array<{ key: string; visible: boolean; sort: number }>;
      ab_slots: Array<{ key: string; experiment: string }>;
    };
    expect(data.source).toBe("db");
    expect(data.version).toBe(version);
    // 按 sort 升序：recent(5) 在 hero(10) 前，且 hero 被显式隐藏
    expect(data.sections.map((s) => s.key)).toEqual(["recent", "hero"]);
    expect(data.sections[1].visible).toBe(false);
    expect(data.ab_slots).toEqual([{ key: "home_hero_cta", experiment: abKey }]);
  });

  it("space 级配置覆盖 global（同 scope 唯一）", async () => {
    await db.insert(homeConfigs).values({
      id: BigInt(newId()),
      scope: "space",
      spaceId: BigInt(spaceId),
      version: 1,
      payload: { sections: [{ key: "canvas", visible: true, sort: 1 }] },
    });
    const res = await inject("GET", "/home/config", undefined, token, spaceId);
    const data = res.data as { scope: string; sections: Array<{ key: string }> };
    expect(data.scope).toBe("space");
    expect(data.sections.map((s) => s.key)).toEqual(["canvas"]);
  });

  it("未登录访问配置 → 401101（space 覆盖层属于运营配置，不做公开端点）", async () => {
    const res = await inject("GET", "/home/config");
    expect(res.code).toBe(401101);
  });

  // ── 未读长轮询 ───────────────────────────────────────────
  it("首次调用（无 since）立即返回当前游标，不挂起", async () => {
    const started = Date.now();
    const res = await inject("GET", "/home/unread", undefined, token, spaceId);
    const elapsed = Date.now() - started;
    const data = res.data as { items: unknown[]; cursor: string; waited_ms: number; timed_out: boolean };
    expect(res.code).toBe(0);
    expect(data.items).toEqual([]);
    expect(Number.isNaN(Date.parse(data.cursor))).toBe(false);
    expect(data.timed_out).toBe(false);
    // 不挂起：远小于 25s（也不该等于 0 的假值，只断言"很快返回"）
    expect(elapsed).toBeLessThan(2000);
    expect(data.waited_ms).toBe(0);
  });

  it("没有增量时挂到 timeout_ms 才返回 timed_out（证明真的在长轮询）", async () => {
    const since = new Date(Date.now() - 60_000).toISOString();
    const started = Date.now();
    const res = await inject("GET", `/home/unread?since=${encodeURIComponent(since)}&timeout_ms=400`, undefined, token, spaceId);
    const elapsed = Date.now() - started;
    const data = res.data as { items: unknown[]; timed_out: boolean; waited_ms: number; cursor: string };
    expect(res.code).toBe(0);
    expect(data.items).toEqual([]);
    expect(data.timed_out).toBe(true);
    expect(elapsed).toBeGreaterThanOrEqual(350);
    expect(elapsed).toBeLessThan(5000);
    // 超时后 cursor 不变（客户端原样带走，不会跳读）
    expect(data.cursor).toBe(since);
  });

  it("有增量立即返回（task_events），并推进 cursor", async () => {
    const since = new Date(Date.now() - 1000).toISOString();
    await db.insert(taskEvents).values({
      id: BigInt(newId()),
      taskId: BigInt(taskId),
      type: "task.succeeded",
      payload: { progress: 100 },
    });
    const started = Date.now();
    const res = await inject("GET", `/home/unread?since=${encodeURIComponent(since)}&timeout_ms=5000`, undefined, token, spaceId);
    const elapsed = Date.now() - started;
    const data = res.data as {
      items: Array<{ type: string; task_id: string; event_type: string | null }>;
      cursor: string;
      timed_out: boolean;
    };
    expect(res.code).toBe(0);
    expect(data.timed_out).toBe(false);
    expect(data.items.length).toBeGreaterThanOrEqual(1);
    expect(data.items[0]).toMatchObject({ type: "task_event", task_id: taskId, event_type: "task.succeeded" });
    // 有增量就不该挂到超时
    expect(elapsed).toBeLessThan(4000);
    expect(Date.parse(data.cursor)).toBeGreaterThanOrEqual(Date.parse(since));
  });

  it("未读不漏别人的任务（只本 space + 本 user）", async () => {
    const since = new Date(Date.now() - 5000).toISOString();
    const res = await inject("GET", `/home/unread?since=${encodeURIComponent(since)}&timeout_ms=300`, undefined, token, spaceId);
    const data = res.data as { items: Array<{ task_id: string }> };
    expect(data.items.map((item) => item.task_id)).not.toContain(otherTaskId);
  });

  it("since 非法 → 400101（不静默当成 0 回灌全部历史）", async () => {
    const res = await inject("GET", "/home/unread?since=not-a-date", undefined, token, spaceId);
    expect(res.code).toBe(400101);
  });

  it("跨 space 访问未读 → 403", async () => {
    const res = await inject("GET", "/home/unread?since=2020-01-01T00:00:00.000Z", undefined, token, otherSpaceId);
    expect(res.code).toBe(403101);
  });

  it("未登录访问未读 → 401101", async () => {
    const res = await inject("GET", "/home/unread?since=2020-01-01T00:00:00.000Z");
    expect(res.code).toBe(401101);
  });

  // ── AB ──────────────────────────────────────────────────
  it("无运行中实验 → active:false（不伪造变体）", async () => {
    const res = await inject("GET", `/home/ab?key=missing_${runTag}`, undefined, token, spaceId);
    expect(res.code).toBe(0);
    expect(res.data).toMatchObject({
      active: false,
      variant: null,
      assigned: false,
      reason: "experiment_not_running",
    });
  });

  it("命中实验：首次落库 assigned:true，二次同变体 assigned:false，库里只有一行", async () => {
    const key = abKey;
    await db.insert(abExperiments).values({
      id: BigInt(newId()),
      key,
      name: "首页 CTA 文案",
      variants: [
        { name: "control", weight: 50 },
        { name: "variant_b", weight: 50 },
      ],
      status: 2,
    });

    const first = await inject("GET", `/home/ab?key=${key}`, undefined, token, spaceId);
    const firstData = first.data as { active: boolean; variant: string; assigned: boolean; experiment_id: string };
    expect(first.code).toBe(0);
    expect(firstData.active).toBe(true);
    expect(["control", "variant_b"]).toContain(firstData.variant);
    expect(firstData.assigned).toBe(true);

    const second = await inject("GET", `/home/ab?key=${key}`, undefined, token, spaceId);
    const secondData = second.data as { variant: string; assigned: boolean };
    expect(secondData.assigned).toBe(false);
    expect(secondData.variant).toBe(firstData.variant);

    const rows = await db
      .select({ variant: abHits.variant })
      .from(abHits)
      .where(and(eq(abHits.experimentId, BigInt(firstData.experiment_id)), eq(abHits.userId, BigInt(userId))));
    expect(rows).toHaveLength(1);
    expect(rows[0].variant).toBe(firstData.variant);
  });

  it("实验已结束/停用 → active:false", async () => {
    const key = abKey;
    await db.update(abExperiments).set({ status: 3 }).where(eq(abExperiments.key, key));
    const res = await inject("GET", `/home/ab?key=${key}`, undefined, token, spaceId);
    expect((res.data as { active: boolean }).active).toBe(false);
    await db.update(abExperiments).set({ status: 2 }).where(eq(abExperiments.key, key));
  });

  it("缺 key → 400101；未登录 → 401101", async () => {
    const missing = await inject("GET", "/home/ab", undefined, token, spaceId);
    expect(missing.code).toBe(400101);
    const anon = await inject("GET", `/home/ab?key=k_${runTag}`);
    expect(anon.code).toBe(401101);
  });

  it("AB 命中会写库，所以非成员必须 403（不能只靠前端）", async () => {
    const res = await inject("GET", `/home/ab?key=${abKey}`, undefined, token, otherSpaceId);
    expect(res.code).toBe(403101);
  });

  // 兜底：确认 users 表没被测试污染（只读断言）
  it("测试账号确实各自独立（避免两个用例串到同一 space）", async () => {
    const rows = await db.select({ id: users.id }).from(users).where(inArray(users.id, [BigInt(userId)]));
    expect(rows).toHaveLength(1);
    expect(spaceId).not.toBe(otherSpaceId);
  });
});
