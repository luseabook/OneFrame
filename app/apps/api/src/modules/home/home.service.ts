import { Inject, Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import { and, asc, eq, gt, isNull, lte, or, sql } from "drizzle-orm";
import { abExperiments, abHits, homeConfigs, promoSlots, taskEvents, taskShares, tasks } from "@app/db";
import { AppError, ErrorCode, newId } from "@app/shared";
import { db } from "../../db/database";
import { env } from "../../config/env";
import { RedisService } from "../../redis/redis.service";
import { StorageService } from "../../storage/storage.service";

/**
 * 首页配置驱动 / 未读长轮询 / AB 实验位（模块 #1 收尾）。
 *
 * 三件事的口径：
 * 1. **配置**：`home_configs` 一行 = 一份快照，`scope='global'` 是平台默认，
 *    `scope='space'` 可覆盖。读不到任何行**不是错误**——返回内置默认并标
 *    `source:"default"`，让前端知道「这是兜底而不是运营配置」。
 * 2. **未读**：客户端长轮询 `since`，服务端在最多 25s 内轮询 DB 增量。
 * 3. **AB**：一人一实验只命中一个变体（`uq_ab_hits` 唯一约束兜底），
 *    首次命中落库，之后永远读回同一行——否则同一个用户会"刷新一次换一次文案"。
 */

/** 内置默认板块（前端 `pages/home.vue` 的六个区块键；运营未配置时按此顺序渲染） */
export const DEFAULT_SECTIONS: ReadonlyArray<{ key: string; visible: boolean; sort: number }> = [
  { key: "hero", visible: true, sort: 10 },
  { key: "workflow", visible: true, sort: 20 },
  { key: "canvas", visible: true, sort: 30 },
  { key: "tools", visible: true, sort: 40 },
  { key: "banner", visible: true, sort: 50 },
  { key: "recent", visible: true, sort: 60 },
];

/** 长轮询上限 25s（任务口径）；测试可用 HOME_UNREAD_TIMEOUT_MS 调小 */
const MAX_WAIT_MS = 25_000;
const POLL_INTERVAL_MS = 800;
/** 单次返回上限：一次推太多对首页红点没有意义，反而拖慢首字节 */
const MAX_ITEMS = 50;
/** 运营位打点去重窗口（5 分钟）：同访客同事件只计一次，避免曝光次数被渲染次数污染 */
const PROMO_DEDUPE_TTL_S = 300;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, Math.max(0, ms));
  });

export interface HomeSection {
  key: string;
  visible: boolean;
  sort: number;
}

/**
 * 首页运营位（banner）——来自 `promo_slots`（运营后台 `/ops/admin/promo-slots` 配置）。
 *
 * 为什么要放进 `/home/config` 而不是让首页单开一个读接口：首页首屏是一次性渲染的
 * （板块显隐/顺序也在这里），运营位再单独拉一次就是首屏第二个 RTT；
 * 且 banner 的显隐本身受 `sections[].visible` 控制，两者必须同一份快照读出来
 * （否则会出现"板块隐藏了但运营位还在请求"的浪费请求）。
 */
export interface HomePromo {
  id: string;
  slot: string;
  title: string;
  /** 已签名可直接放进 `<img src>`（storage key 现签；外部 URL 原样返回） */
  image_url: string | null;
  link_uri: string | null;
  sort: number;
  view_count: number;
  click_count: number;
}

export interface HomeConfigView {
  version: number | null;
  scope: "global" | "space" | "default";
  source: "default" | "db";
  sections: HomeSection[];
  ab_slots: Array<{ key: string; experiment: string }>;
  unread: { poll_timeout_ms: number; poll_interval_ms: number };
  updated_at: string | null;
  /** 首页 banner 运营位（无配置时为空数组，前端回落到内置静态文案） */
  promos: HomePromo[];
}

export interface UnreadItem {
  type: "task_event" | "task_status" | "share";
  task_id: string;
  event_type: string | null;
  title: string | null;
  created_at: string;
}

export interface UnreadView {
  items: UnreadItem[];
  /** 下一次请求应带回来的游标（= max(since, 最大事件时间)） */
  cursor: string;
  /** 本次实际挂起时长（毫秒） */
  waited_ms: number;
  /** 是否因超时返回空（true = 客户端应原样带 cursor 再轮询） */
  timed_out: boolean;
  poll_after_ms: number;
}

export interface AbView {
  key: string;
  active: boolean;
  experiment_id: string | null;
  variant: string | null;
  assigned: boolean;
  reason?: string;
}

function parseSections(raw: unknown): HomeSection[] | null {
  if (!Array.isArray(raw)) return null;
  const out: HomeSection[] = [];
  for (const item of raw) {
    if (item === null || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    if (typeof record.key !== "string" || record.key.length === 0) continue;
    out.push({
      key: record.key,
      visible: record.visible === undefined ? true : Boolean(record.visible),
      sort: typeof record.sort === "number" ? record.sort : 100,
    });
  }
  if (out.length === 0) return null;
  return out.sort((a, b) => a.sort - b.sort);
}

function parseAbSlots(raw: unknown): Array<{ key: string; experiment: string }> {
  if (!Array.isArray(raw)) return [];
  const out: Array<{ key: string; experiment: string }> = [];
  for (const item of raw) {
    if (item === null || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const key = typeof record.key === "string" ? record.key : null;
    if (!key) continue;
    out.push({ key, experiment: typeof record.experiment === "string" ? record.experiment : key });
  }
  return out;
}

/** `since` 支持 ISO 字符串或 epoch 毫秒；非法值 → 400101（不静默当成 0，否则会回灌全部历史） */
export function parseSince(raw: string | undefined): number | null {
  if (raw === undefined || raw === "") return null;
  const asNumber = Number(raw);
  if (Number.isFinite(asNumber) && asNumber > 0) return Math.floor(asNumber);
  const parsed = Date.parse(raw);
  if (!Number.isFinite(parsed)) {
    throw new AppError(ErrorCode.INVALID_PARAM, "since must be ISO time or epoch ms", { field: "since" });
  }
  return parsed;
}

/** 确定性分桶：同一 (user, key) 永远落到同一变体，避免刷新换文案 */
export function pickVariant(
  variants: ReadonlyArray<{ name: string; weight: number }>,
  userId: string,
  key: string,
): string | null {
  const usable = variants.filter((v) => v.name && Number.isFinite(v.weight) && v.weight > 0);
  if (usable.length === 0) return variants[0]?.name ?? null;
  const total = usable.reduce((sum, v) => sum + v.weight, 0);
  let hash = 0;
  const seed = `${userId}:${key}`;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) % 1_000_003;
  }
  let bucket = hash % total;
  for (const variant of usable) {
    if (bucket < variant.weight) return variant.name;
    bucket -= variant.weight;
  }
  return usable[usable.length - 1].name;
}

@Injectable()
export class HomeService {
  constructor(
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(StorageService) private readonly storage: StorageService,
  ) {}

  /** 首页配置：space 覆盖 > global > 内置默认（永不 500） */
  async config(spaceId?: string): Promise<HomeConfigView> {
    const space = spaceId && /^\d+$/.test(spaceId) ? BigInt(spaceId) : null;
    const promos = await this.activePromos("banner");

    if (space !== null) {
      const [scoped] = await db
        .select()
        .from(homeConfigs)
        .where(and(eq(homeConfigs.scope, "space"), eq(homeConfigs.spaceId, space)));
      const view = this.toView(scoped, "space");
      if (view) return { ...view, promos };
    }

    const [global] = await db
      .select()
      .from(homeConfigs)
      .where(and(eq(homeConfigs.scope, "global"), isNull(homeConfigs.spaceId)));
    const view = this.toView(global, "global");
    if (view) return { ...view, promos };

    return {
      version: null,
      scope: "default",
      source: "default",
      sections: DEFAULT_SECTIONS.map((s) => ({ ...s })),
      ab_slots: [],
      unread: { poll_timeout_ms: this.maxWaitMs(), poll_interval_ms: POLL_INTERVAL_MS },
      updated_at: null,
      promos,
    };
  }

  // ── 运营位（banner）：读 + 曝光/点击打点 ─────────────────

  /** 生效口径与运营后台一致：启用 + 在投放窗口内（ends_at 用闭区间，见 admin.service 注释） */
  private async activePromos(slot: string): Promise<HomePromo[]> {
    const now = new Date();
    const rows = await db
      .select()
      .from(promoSlots)
      .where(
        and(
          eq(promoSlots.slot, slot),
          eq(promoSlots.status, 1),
          sql`(${promoSlots.startsAt} is null or ${promoSlots.startsAt} <= ${now})`,
          sql`(${promoSlots.endsAt} is null or ${promoSlots.endsAt} >= ${now})`,
        ),
      )
      .orderBy(asc(promoSlots.sort), asc(promoSlots.id))
      .limit(20);
    const out: HomePromo[] = [];
    for (const row of rows) {
      out.push({
        id: String(row.id),
        slot: row.slot,
        title: row.title,
        image_url: await this.signImage(row.imageUri),
        link_uri: row.linkUri,
        sort: row.sort,
        view_count: row.viewCount,
        click_count: row.clickCount,
      });
    }
    return out;
  }

  /** 图片可能存的是 storage key（`u/...`，会过期）或外部 URL；前者现签，后者原样 */
  private async signImage(uri: string | null): Promise<string | null> {
    if (!uri) return null;
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(uri)) return uri;
    try {
      return await this.storage.signDownload(uri, 86_400);
    } catch {
      return null;
    }
  }

  /**
   * 运营位打点（曝光 / 点击）。
   *
   * ## 为什么不用 `task_events` 记流水
   * `task_events.task_id` 是 NOT NULL + FK 指向 `tasks`，运营位打点与任务无关，
   * 借用它只能造出"假任务"（历史上确实踩过：外键一写就 500）。运营位要的只是
   * **两个计数器**（运营后台看效果），所以直接原子自增 `promo_slots` 的两个列。
   *
   * ## 去重
   * 同一访客 5 分钟内对同一运营位的同类事件只计一次（Redis `SET NX EX 300`）——
   * 曝光用 IntersectionObserver 上报，快速滚动/来回切换 banner 会重复触发；
   * 不去重的话 view_count 变成"渲染次数"，运营没法用它算 CTR。
   * 去重键含"谁"：登录用户用 user_id，匿名访客用 ip+UA 的哈希（不落原始 IP）。
   *
   * ## 计数为什么在应用层算而不是 SQL 条件更新
   * 需要在"未去重"时也返回当前计数给前端（前端可能展示热度），因此先判去重、
   * 命中再 `view_count = view_count + 1` 并 `returning` 取回权威值。
   */
  async trackPromo(
    id: string,
    kind: "view" | "click",
    actor: { userId?: string | null; ip?: string | null; userAgent?: string | null },
  ): Promise<{ id: string; kind: "view" | "click"; counted: boolean; view_count: number; click_count: number }> {
    if (!/^\d+$/.test(id)) {
      throw new AppError(ErrorCode.INVALID_PARAM, "invalid promo id", { field: "id" });
    }
    const [row] = await db.select().from(promoSlots).where(eq(promoSlots.id, BigInt(id)));
    if (!row) throw new AppError(ErrorCode.NOT_FOUND, "promo slot not found");

    const who = actor.userId
      ? `u:${actor.userId}`
      : `a:${createHash("sha256")
          .update(`${actor.ip ?? ""}|${actor.userAgent ?? ""}`)
          .digest("hex")
          .slice(0, 24)}`;
    const key = `home:promo:${kind}:${id}:${who}`;
    const first = await this.redis.setNx(key, String(Date.now()), PROMO_DEDUPE_TTL_S);
    if (!first) {
      return {
        id: String(row.id),
        kind,
        counted: false,
        view_count: row.viewCount,
        click_count: row.clickCount,
      };
    }
    const column = kind === "view" ? promoSlots.viewCount : promoSlots.clickCount;
    const [updated] = await db
      .update(promoSlots)
      .set({ [kind === "view" ? "viewCount" : "clickCount"]: sql`${column} + 1`, updatedAt: new Date() })
      .where(eq(promoSlots.id, row.id))
      .returning({ viewCount: promoSlots.viewCount, clickCount: promoSlots.clickCount });
    return {
      id: String(row.id),
      kind,
      counted: true,
      view_count: updated?.viewCount ?? row.viewCount + (kind === "view" ? 1 : 0),
      click_count: updated?.clickCount ?? row.clickCount + (kind === "click" ? 1 : 0),
    };
  }

  private maxWaitMs(): number {
    // 25s 上限来自 env（默认 25_000，低于常见反代 30s 读超时）；测试把它调到几百毫秒，
    // 否则整套测试会被长轮询挂住。见 `config/env.ts:HOME_UNREAD_TIMEOUT_MS`。
    return Math.min(env.HOME_UNREAD_TIMEOUT_MS, MAX_WAIT_MS);
  }

  private toView(
    row: typeof homeConfigs.$inferSelect | undefined,
    scope: "global" | "space",
  ): Omit<HomeConfigView, "promos"> | null {
    if (!row) return null;
    const payload = (row.payload ?? {}) as Record<string, unknown>;
    return {
      version: row.version,
      scope,
      source: "db",
      sections: parseSections(payload.sections) ?? DEFAULT_SECTIONS.map((s) => ({ ...s })),
      ab_slots: parseAbSlots(payload.ab_slots),
      unread: { poll_timeout_ms: this.maxWaitMs(), poll_interval_ms: POLL_INTERVAL_MS },
      updated_at: row.updatedAt.toISOString(),
    };
  }

  /** 单次增量查询（长轮询每轮调用） */
  private async fetchUnread(spaceId: string, userId: string, sinceMs: number): Promise<UnreadItem[]> {
    const since = new Date(sinceMs);
    const spaceBig = BigInt(spaceId);
    const userBig = BigInt(userId);

    // 事件源 1：worker 写的 task_events（排队/进度/成功/失败）——只取本人、本空间
    const events = await db
      .select({
        taskId: taskEvents.taskId,
        type: taskEvents.type,
        createdAt: taskEvents.createdAt,
        title: tasks.title,
        mode: tasks.mode,
      })
      .from(taskEvents)
      .innerJoin(tasks, eq(tasks.id, taskEvents.taskId))
      .where(and(eq(tasks.spaceId, spaceBig), eq(tasks.userId, userBig), gt(taskEvents.createdAt, since)))
      // 索引是 (task_id, created_at)，按时间升序做增量；总量由 limit 兜住
      .orderBy(asc(taskEvents.createdAt))
      .limit(MAX_ITEMS);

    // 事件源 2：新增分享（他人打开分享/自己生成分享链接都算"有新动态"）
    const shares = await db
      .select({
        taskId: taskShares.taskId,
        token: taskShares.token,
        createdAt: taskShares.createdAt,
        title: tasks.title,
      })
      .from(taskShares)
      .innerJoin(tasks, eq(tasks.id, taskShares.taskId))
      .where(and(eq(taskShares.spaceId, spaceBig), eq(tasks.userId, userBig), gt(taskShares.createdAt, since)))
      .orderBy(asc(taskShares.createdAt))
      .limit(MAX_ITEMS);

    const items: UnreadItem[] = [
      ...events.map((row) => ({
        type: "task_event" as const,
        task_id: String(row.taskId),
        event_type: row.type,
        title: row.title ?? row.mode,
        created_at: row.createdAt.toISOString(),
      })),
      ...shares.map((row) => ({
        type: "share" as const,
        task_id: String(row.taskId),
        event_type: "share_created",
        title: row.title,
        created_at: row.createdAt.toISOString(),
      })),
    ].sort((a, b) => a.created_at.localeCompare(b.created_at));

    return items.slice(0, MAX_ITEMS);
  }

  /**
   * 未读长轮询。
   *
   * **为什么不用 WebSocket / SSE**：
   * - 首页红点只需要"有没有新动态"这一个比特，SSE/WS 要维护连接表、心跳、
   *   多实例广播（Redis pub/sub 或 sticky session），运维与故障面都大得多；
   * - 现有栈里已经有 `GET /tasks` 轮询与 `GET /agent/task/stream` 的 SSE，
   *   首页再引一条 WS 通道会出现"两套推送语义"，前端反而更难对齐；
   * - 长轮询可以**在客户端断开时立刻释放**（`req.raw` 的 close 事件），不占连接池。
   *
   * **为什么不给每个请求开 pg LISTEN**：LISTEN 是连接级订阅，每个挂起的 HTTP 请求
   * 都要独占一条 PG 连接（100 个在线用户 = 100 条空闲连接），发布端还要额外写入
   * `pg_notify`；MVP 规模下"短间隔 SELECT 增量"（800ms、受 limit 约束、走索引）
   * 的代价远低于连接数爆炸。
   */
  async unread(
    spaceId: string,
    userId: string,
    options: { since?: string; timeoutMsRaw?: string; shouldStop?: () => boolean },
  ): Promise<UnreadView> {
    const sinceMs = parseSince(options.since);
    const startedAt = Date.now();
    const maxWait = Math.min(
      this.maxWaitMs(),
      Number.isFinite(Number(options.timeoutMsRaw)) && Number(options.timeoutMsRaw) > 0
        ? Number(options.timeoutMsRaw)
        : this.maxWaitMs(),
    );

    // 首次调用（没有 since）：立即返回当前游标，让客户端从"此刻"开始计红点
    if (sinceMs === null) {
      const now = new Date();
      return {
        items: [],
        cursor: now.toISOString(),
        waited_ms: 0,
        timed_out: false,
        poll_after_ms: 0,
      };
    }

    // 超时/中断时原样返回同一个 cursor（客户端据此继续轮询，不会跳读）
    const cursor = new Date(sinceMs).toISOString();
    for (;;) {
      const items = await this.fetchUnread(spaceId, userId, sinceMs);
      if (items.length > 0) {
        const newest = items.reduce((max, item) => (item.created_at > max ? item.created_at : max), cursor);
        return {
          items,
          cursor: newest,
          waited_ms: Date.now() - startedAt,
          timed_out: false,
          poll_after_ms: 0,
        };
      }
      const elapsed = Date.now() - startedAt;
      const remaining = maxWait - elapsed;
      if (remaining <= 0 || options.shouldStop?.()) {
        return {
          items: [],
          cursor,
          waited_ms: elapsed,
          timed_out: true,
          // 超时后让客户端歇一下再挂（避免断网时打成忙轮询）
          poll_after_ms: 1000,
        };
      }
      // 分片睡眠：客户端断开后最多 200ms 内释放，不会挂满 25s
      await sleep(Math.min(POLL_INTERVAL_MS, remaining, 200));
    }
  }

  /** AB 命中：无实验/未运行 → active:false；命中后落库且一人一变体 */
  async ab(userId: string, key: string): Promise<AbView> {
    const trimmed = key.trim();
    if (!trimmed) throw new AppError(ErrorCode.INVALID_PARAM, "key is required", { field: "key" });

    const now = new Date();
    const [experiment] = await db
      .select()
      .from(abExperiments)
      .where(
        and(
          eq(abExperiments.key, trimmed),
          eq(abExperiments.status, 2),
          or(isNull(abExperiments.startAt), lte(abExperiments.startAt, now)),
          or(isNull(abExperiments.endAt), gt(abExperiments.endAt, now)),
        ),
      );
    if (!experiment) {
      return {
        key: trimmed,
        active: false,
        experiment_id: null,
        variant: null,
        assigned: false,
        reason: "experiment_not_running",
      };
    }

    const [existing] = await db
      .select({ variant: abHits.variant })
      .from(abHits)
      .where(and(eq(abHits.experimentId, experiment.id), eq(abHits.userId, BigInt(userId))));
    if (existing) {
      return {
        key: trimmed,
        active: true,
        experiment_id: String(experiment.id),
        variant: existing.variant,
        assigned: false,
      };
    }

    const variants = Array.isArray(experiment.variants)
      ? (experiment.variants as Array<{ name?: unknown; weight?: unknown }>).map((item) => ({
          name: typeof item.name === "string" ? item.name : "",
          weight: typeof item.weight === "number" ? item.weight : 0,
        }))
      : [];
    const chosen = pickVariant(
      variants.map((v) => ({ name: v.name, weight: v.weight })),
      userId,
      trimmed,
    );
    if (!chosen) {
      return {
        key: trimmed,
        active: false,
        experiment_id: String(experiment.id),
        variant: null,
        assigned: false,
        reason: "no_variants",
      };
    }

    // 并发首刷：唯一约束 (experiment_id, user_id) 兜底，冲突时以库里那行为准
    const inserted = await db
      .insert(abHits)
      .values({ id: newId(), experimentId: experiment.id, userId: BigInt(userId), variant: chosen })
      .onConflictDoNothing({ target: [abHits.experimentId, abHits.userId] })
      .returning({ variant: abHits.variant });
    if (inserted[0]) {
      return {
        key: trimmed,
        active: true,
        experiment_id: String(experiment.id),
        variant: inserted[0].variant,
        assigned: true,
      };
    }
    const [raced] = await db
      .select({ variant: abHits.variant })
      .from(abHits)
      .where(and(eq(abHits.experimentId, experiment.id), eq(abHits.userId, BigInt(userId))));
    return {
      key: trimmed,
      active: true,
      experiment_id: String(experiment.id),
      variant: raced?.variant ?? chosen,
      assigned: false,
    };
  }
}
