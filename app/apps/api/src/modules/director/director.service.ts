import { Inject, Injectable } from "@nestjs/common";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { directorPosePresets, directorScenes, episodes, scriptProjects, users } from "@app/db";
import { AppError, ErrorCode, newId } from "@app/shared";
import { db } from "../../db/database";
import { RedisService } from "../../redis/redis.service";
import { StorageService } from "../../storage/storage.service";
import { TeamService } from "../team/team.service";

/**
 * 3D 导演台（director 域）—— 对照参照站 director 域的 8 个操作
 * （`save` / `info` / `list` / `update` / `delete` / `duplicate` / `pose-preset` / `heartbeat`）。
 *
 * ## 为什么后端**不解析** payload
 *
 * 场景快照的真实形状由前端编辑器决定（`Director3D.vue` 的相机/机位/角色站位/位姿），
 * 且它随编辑器功能演进（今天加一个道具类型、明天加一套骨骼绑定）。服务端逐字段建列
 * 或做深校验，会让"编辑器加一个旋钮"变成"后端发一次版 + 一次迁移"。所以这一层的契约是：
 * **payload 是不透明 JSON**，服务端只保证三件事——
 *   1. 是对象、序列化后不超过 `MAX_PAYLOAD_BYTES`（防止有人把 base64 图片塞进来，把表撑爆）；
 *   2. `version` 单调递增（乐观锁，防两个人同时拖同一个角色时互相静默覆盖）；
 *   3. space 隔离 + 软删后不可读。
 * 语义校验属于编辑器；哪天真需要"服务端懂场景"，再按那时的事实补，不提前猜。
 *
 * ## 心跳为什么不落库
 *
 * 导演台是"多人同时拖场景"的编辑面，协作者状态是**秒级易失**信息：落库会产生
 * 每人每 30s 一条 update 的高频写（3 人编辑 1 小时 ≈ 360 行），而它没有任何历史价值。
 * 用 Redis key + 60s TTL 表达"此人最近 60s 在这个场景里"，自然过期、无需清理任务。
 */

/** 场景快照上限（512KB）：3D 场景是数值数组，正常在 10~100KB 量级；超限基本是把图片 base64 写进了 payload */
const MAX_PAYLOAD_BYTES = 512 * 1024;
const NAME_MAX = 60;
const URI_MAX = 2048;
/** 心跳 TTL：前端 30s 一跳，TTL 60s 允许丢一跳不误判离线 */
const HEARTBEAT_TTL_S = 60;

type SceneRow = typeof directorScenes.$inferSelect;
type PresetRow = typeof directorPosePresets.$inferSelect;

export interface SceneDto {
  id: string;
  project_id: string | null;
  episode_id: string | null;
  name: string;
  payload: Record<string, unknown>;
  thumbnail_uri: string | null;
  thumbnail_url: string | null;
  version: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface PresetDto {
  id: string;
  name: string;
  payload: Record<string, unknown>;
  scope: number;
  created_by: string | null;
  mine: boolean;
  created_at: string;
  updated_at: string;
}

export interface HeartbeatResult {
  scene_id: string;
  ttl_s: number;
  /** 除自己之外、最近 60s 内还在该场景的人 */
  collaborators: Array<{ user_id: string; nickname: string; last_seen_ms: number }>;
  count: number;
}

@Injectable()
export class DirectorService {
  constructor(
    @Inject(TeamService) private readonly team: TeamService,
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(StorageService) private readonly storage: StorageService,
  ) {}

  /** 权限闸门：非 space 成员直接 403（复用 cam 域守卫，不另写一套） */
  async requireMember(spaceId: string, userId: string) {
    return this.team.requireMember(spaceId, userId);
  }

  // ── 校验辅助 ────────────────────────────────────────────

  /** payload 必须是非数组对象且不超过上限；超限要报清楚"多大 / 上限多少" */
  private assertPayload(payload: unknown): Record<string, unknown> {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new AppError(ErrorCode.INVALID_PARAM, "payload must be a JSON object", { field: "payload" });
    }
    const bytes = Buffer.byteLength(JSON.stringify(payload), "utf8");
    if (bytes > MAX_PAYLOAD_BYTES) {
      throw new AppError(
        ErrorCode.INVALID_PARAM,
        `payload too large (${Math.round(bytes / 1024)}KB > ${MAX_PAYLOAD_BYTES / 1024}KB)`,
        { field: "payload", max_bytes: MAX_PAYLOAD_BYTES },
      );
    }
    return payload as Record<string, unknown>;
  }

  private assertName(name: string | undefined): void {
    if (name !== undefined && (name.trim().length === 0 || name.length > NAME_MAX)) {
      throw new AppError(ErrorCode.INVALID_PARAM, `name must be 1~${NAME_MAX} chars`, { field: "name" });
    }
  }

  private assertUri(uri: string | null | undefined): void {
    if (uri !== undefined && uri !== null && uri.length > URI_MAX) {
      throw new AppError(ErrorCode.INVALID_PARAM, `thumbnail_uri too long (max ${URI_MAX})`, {
        field: "thumbnail_uri",
      });
    }
  }

  private bigId(raw: string, field: string): bigint {
    try {
      return BigInt(raw);
    } catch {
      throw new AppError(ErrorCode.INVALID_PARAM, `invalid ${field}`, { field });
    }
  }

  /**
   * 缩略图的值有两种形态，都要能读：
   *   - `/assets/upload` 返回的 storage key（`u/<space>/assets/<id>/orig.png`）→ 读时签成 URL；
   *   - 已经签名/外部的完整 URL → 原样返回（避免二次签名把 URL 套成 `...?url=http...`）。
   */
  private async thumbnailUrl(uri: string | null): Promise<string | null> {
    if (!uri) return null;
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(uri)) return uri;
    try {
      return await this.storage.signDownload(uri, 86_400);
    } catch {
      return null;
    }
  }

  private async toSceneDto(row: SceneRow): Promise<SceneDto> {
    return {
      id: String(row.id),
      project_id: row.projectId === null ? null : String(row.projectId),
      episode_id: row.episodeId === null ? null : String(row.episodeId),
      name: row.name,
      payload: (row.payload ?? {}) as Record<string, unknown>,
      thumbnail_uri: row.thumbnailUri,
      thumbnail_url: await this.thumbnailUrl(row.thumbnailUri),
      version: row.version,
      created_by: row.createdBy === null ? null : String(row.createdBy),
      created_at: row.createdAt.toISOString(),
      updated_at: row.updatedAt.toISOString(),
    };
  }

  private toPresetDto(row: PresetRow, userId: string): PresetDto {
    return {
      id: String(row.id),
      name: row.name,
      payload: (row.payload ?? {}) as Record<string, unknown>,
      scope: row.scope,
      created_by: row.createdBy === null ? null : String(row.createdBy),
      mine: row.createdBy !== null && String(row.createdBy) === userId,
      created_at: row.createdAt.toISOString(),
      updated_at: row.updatedAt.toISOString(),
    };
  }

  /** 项目/剧集归属校验：跨 space 一律按"不存在"处理，不泄漏存在性 */
  private async assertProjectInSpace(spaceId: string, projectId: string): Promise<bigint> {
    const id = this.bigId(projectId, "project_id");
    const [row] = await db
      .select({ id: scriptProjects.id })
      .from(scriptProjects)
      .where(and(eq(scriptProjects.id, id), eq(scriptProjects.spaceId, BigInt(spaceId))));
    if (!row) throw new AppError(ErrorCode.NOT_FOUND, "project not found", { field: "project_id" });
    return row.id;
  }

  private async assertEpisodeInProject(episodeId: string, projectId: bigint): Promise<bigint> {
    const id = this.bigId(episodeId, "episode_id");
    const [row] = await db
      .select({ id: episodes.id })
      .from(episodes)
      .where(and(eq(episodes.id, id), eq(episodes.projectId, projectId)));
    if (!row) throw new AppError(ErrorCode.NOT_FOUND, "episode not found", { field: "episode_id" });
    return row.id;
  }

  /** 取场景；软删/跨 space 都返回 404 */
  async requireScene(spaceId: string, sceneId: string): Promise<SceneRow> {
    const id = this.bigId(sceneId, "scene_id");
    const [row] = await db
      .select()
      .from(directorScenes)
      .where(
        and(
          eq(directorScenes.id, id),
          eq(directorScenes.spaceId, BigInt(spaceId)),
          isNull(directorScenes.deletedAt),
        ),
      );
    if (!row) throw new AppError(ErrorCode.NOT_FOUND, "scene not found");
    return row;
  }

  // ── 1. 保存场景 ────────────────────────────────────────

  async createScene(
    spaceId: string,
    userId: string,
    input: {
      project_id?: string;
      episode_id?: string;
      name?: string;
      payload: Record<string, unknown>;
      thumbnail_uri?: string | null;
    },
  ): Promise<SceneDto> {
    const payload = this.assertPayload(input.payload);
    this.assertName(input.name);
    this.assertUri(input.thumbnail_uri);
    let projectId: bigint | null = null;
    let episodeId: bigint | null = null;
    if (input.project_id) {
      projectId = await this.assertProjectInSpace(spaceId, input.project_id);
      if (input.episode_id) episodeId = await this.assertEpisodeInProject(input.episode_id, projectId);
    } else if (input.episode_id) {
      throw new AppError(ErrorCode.INVALID_PARAM, "episode_id requires project_id", { field: "episode_id" });
    }
    const [row] = await db
      .insert(directorScenes)
      .values({
        id: newId(),
        spaceId: BigInt(spaceId),
        projectId,
        episodeId,
        name: input.name?.trim() || "未命名场景",
        payload,
        thumbnailUri: input.thumbnail_uri ?? null,
        // 首版固定 1：客户端拿到后每次 PUT 带回，版本由服务端 +1
        version: 1,
        createdBy: BigInt(userId),
      })
      .returning();
    if (!row) throw new AppError(ErrorCode.INTERNAL, "scene save failed");
    return this.toSceneDto(row);
  }

  // ── 2. 读场景 ──────────────────────────────────────────

  async getScene(spaceId: string, sceneId: string): Promise<SceneDto> {
    return this.toSceneDto(await this.requireScene(spaceId, sceneId));
  }

  // ── 3. 列表（按项目/全集，带缩略图）────────────────────

  async listScenes(
    spaceId: string,
    filters: { project_id?: string; episode_id?: string; page: number; page_size: number },
  ) {
    const conds = [eq(directorScenes.spaceId, BigInt(spaceId)), isNull(directorScenes.deletedAt)];
    if (filters.project_id) conds.push(eq(directorScenes.projectId, this.bigId(filters.project_id, "project_id")));
    if (filters.episode_id) conds.push(eq(directorScenes.episodeId, this.bigId(filters.episode_id, "episode_id")));
    const where = and(...conds);
    const rows = await db
      .select()
      .from(directorScenes)
      .where(where)
      // 最近编辑优先：前端"打开项目即载入最近场景"依赖这个顺序
      .orderBy(desc(directorScenes.updatedAt))
      .limit(filters.page_size)
      .offset((filters.page - 1) * filters.page_size);
    const [countRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(directorScenes)
      .where(where);
    const list: SceneDto[] = [];
    for (const row of rows) list.push(await this.toSceneDto(row));
    return { list, total: countRow?.count ?? 0, page: filters.page, page_size: filters.page_size };
  }

  // ── 4. 更新（乐观锁）───────────────────────────────────

  async updateScene(
    spaceId: string,
    sceneId: string,
    input: { version: number; name?: string; payload?: Record<string, unknown>; thumbnail_uri?: string | null },
  ): Promise<SceneDto> {
    const scene = await this.requireScene(spaceId, sceneId);
    this.assertName(input.name);
    this.assertUri(input.thumbnail_uri);
    /**
     * 乐观锁：版本不一致**绝不静默覆盖**。
     *
     * 消息里带 `current=N`，因为统一信封只暴露 code+msg（`AllExceptionsFilter` 只 send
     * `fail(code,msg)`），客户端拿不到结构化 details；前端据此提示"服务端已是 vN，是否覆盖"，
     * 而 details 里仍给出结构化字段供服务端日志/后续过滤使用（与 film 表头的写法一致）。
     */
    if (input.version !== scene.version) {
      throw new AppError(ErrorCode.VERSION_CONFLICT, `scene version conflict: current=${scene.version}`, {
        field: "version",
        expected: input.version,
        current: scene.version,
      });
    }
    const patch: Partial<typeof directorScenes.$inferInsert> = {
      version: sql`${directorScenes.version} + 1` as unknown as number,
      updatedAt: new Date(),
    };
    if (input.name !== undefined) patch.name = input.name.trim();
    if (input.payload !== undefined) patch.payload = this.assertPayload(input.payload);
    if (input.thumbnail_uri !== undefined) patch.thumbnailUri = input.thumbnail_uri;
    const [row] = await db
      .update(directorScenes)
      .set(patch)
      .where(and(eq(directorScenes.id, scene.id), eq(directorScenes.version, input.version)))
      .returning();
    if (!row) {
      // 真空竞争：读到的版本在 UPDATE 之前被另一请求推进了
      throw new AppError(ErrorCode.VERSION_CONFLICT, "scene version conflict: concurrent update", {
        field: "version",
      });
    }
    return this.toSceneDto(row);
  }

  // ── 5. 软删 ────────────────────────────────────────────

  async deleteScene(spaceId: string, sceneId: string): Promise<{ ok: true; id: string }> {
    const scene = await this.requireScene(spaceId, sceneId);
    await db
      .update(directorScenes)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(directorScenes.id, scene.id));
    // 删场景时顺手清掉心跳 key（否则列表里"已删场景仍有人在编辑"会残留 60s）
    await this.clearHeartbeats(String(scene.id)).catch(() => undefined);
    return { ok: true, id: String(scene.id) };
  }

  // ── 6. 复制 ────────────────────────────────────────────

  async duplicateScene(
    spaceId: string,
    userId: string,
    sceneId: string,
    name?: string,
  ): Promise<SceneDto> {
    const scene = await this.requireScene(spaceId, sceneId);
    this.assertName(name);
    const [row] = await db
      .insert(directorScenes)
      .values({
        id: newId(),
        spaceId: scene.spaceId,
        projectId: scene.projectId,
        episodeId: scene.episodeId,
        name: (name?.trim() || `${scene.name} 副本`).slice(0, NAME_MAX),
        payload: (scene.payload ?? {}) as Record<string, unknown>,
        thumbnailUri: scene.thumbnailUri,
        version: 1,
        createdBy: BigInt(userId),
      })
      .returning();
    if (!row) throw new AppError(ErrorCode.INTERNAL, "scene duplicate failed");
    return this.toSceneDto(row);
  }

  // ── 7. 姿态预设 ────────────────────────────────────────

  async createPreset(
    spaceId: string,
    userId: string,
    input: { name: string; payload: Record<string, unknown>; scope?: number },
  ): Promise<PresetDto> {
    this.assertName(input.name);
    if (!input.name.trim()) {
      throw new AppError(ErrorCode.INVALID_PARAM, "name required", { field: "name" });
    }
    const scope = input.scope ?? 1;
    if (![1, 2].includes(scope)) {
      throw new AppError(ErrorCode.INVALID_PARAM, "scope must be 1(personal) or 2(team)", { field: "scope" });
    }
    const payload = this.assertPayload(input.payload);
    const [row] = await db
      .insert(directorPosePresets)
      .values({
        id: newId(),
        spaceId: BigInt(spaceId),
        name: input.name.trim(),
        payload,
        scope,
        createdBy: BigInt(userId),
      })
      .returning();
    if (!row) throw new AppError(ErrorCode.INTERNAL, "preset save failed");
    return this.toPresetDto(row, userId);
  }

  /**
   * 预设列表：**团队共享（scope=2）+ 我自己的个人预设（scope=1）**。
   *
   * 别人的个人预设不返回：姿态预设是"这个人惯用的摆位"，共享范围由 scope 显式表达，
   * 不能靠"同 space 就能看"默认放开（团队里 20 个人各存 30 个预设会变成噪音）。
   */
  async listPresets(spaceId: string, userId: string, scope?: number) {
    const conds = [eq(directorPosePresets.spaceId, BigInt(spaceId))];
    if (scope !== undefined) {
      if (![1, 2].includes(scope)) {
        throw new AppError(ErrorCode.INVALID_PARAM, "scope must be 1(personal) or 2(team)", { field: "scope" });
      }
      conds.push(eq(directorPosePresets.scope, scope));
    }
    const rows = await db
      .select()
      .from(directorPosePresets)
      .where(and(...conds))
      .orderBy(desc(directorPosePresets.updatedAt))
      .limit(200);
    const visible = rows.filter((row) => row.scope === 2 || String(row.createdBy ?? "") === userId);
    return { list: visible.map((row) => this.toPresetDto(row, userId)), total: visible.length };
  }

  // ── 8. 心跳（Redis TTL，不落库）────────────────────────

  /**
   * 心跳用**每场景一个 HASH**（field=user_id, value={at}）而不是"每人一个 key + SCAN"。
   *
   * 为什么不用 SCAN：`SCAN MATCH director:hb:<scene>:*` 在大 keyspace 上要扫很多轮才能
   * 命中一个场景的 key（实测 dev 库 keyspace 到万级时首轮 COUNT=100 全空），
   * 心跳是每次打开导演台都会调的接口，不能依赖"扫到为止"。
   * HASH 的读取是 O(场景协作者数)，与全库大小无关；`EXPIRE` 刷新整场景 TTL，
   * 单个用户离开后其 field 最迟在 TTL 后随整个 hash 一起消失（读取时再按时间戳过滤，
   * 所以"人走了但 hash 还在"也不会把他算成在线）。
   */
  private heartbeatKey(sceneId: string): string {
    return `director:hb:${sceneId}`;
  }

  private async clearHeartbeats(sceneId: string): Promise<void> {
    await this.redis.del(this.heartbeatKey(sceneId));
  }

  /**
   * 编辑心跳：把自己的 field 写进场景 hash（整 hash TTL 60s+1），返回**其他**在线的人。
   *
   * 响应里给 `last_seen_ms`（距今毫秒）而不是绝对时间戳：协作者列表是"刚才谁在"，
   * 客户端只需要算"XX 秒前活跃"，给时间戳还要客户端处理时钟偏差。
   */
  async heartbeat(spaceId: string, userId: string, sceneId: string): Promise<HeartbeatResult> {
    const scene = await this.requireScene(spaceId, sceneId);
    const key = this.heartbeatKey(String(scene.id));
    const at = Date.now();
    await this.redis.client.hset(key, userId, JSON.stringify({ at }));
    // TTL 比业务 TTL 多 1s：避免"刚写完就被过期"导致最后一跳丢失
    await this.redis.client.expire(key, HEARTBEAT_TTL_S + 1);

    const raw = await this.redis.client.hgetall(key);
    const staleFields: string[] = [];
    const entries: Array<{ user_id: string; at: number }> = [];
    for (const [field, value] of Object.entries(raw)) {
      let parsed: { at?: number } | null = null;
      try {
        parsed = JSON.parse(value) as { at?: number };
      } catch {
        parsed = null;
      }
      const seenAt = typeof parsed?.at === "number" ? parsed.at : 0;
      if (at - seenAt > HEARTBEAT_TTL_S * 1000) {
        // 超过 TTL 的残留 field：顺手清掉，避免 hash 越积越大（下次读又会过滤一遍）
        staleFields.push(field);
        continue;
      }
      if (field === userId) continue;
      entries.push({ user_id: field, at: seenAt });
    }
    if (staleFields.length > 0) await this.redis.client.hdel(key, ...staleFields);

    let nicknameById = new Map<string, string>();
    if (entries.length > 0) {
      const ids = entries.map((entry) => entry.user_id);
      const rows = await db
        .select({ id: users.id, nickname: users.nickname })
        .from(users)
        .where(sql`${users.id} in (${sql.join(ids.map((id) => BigInt(id)), sql`, `)})`);
      nicknameById = new Map(rows.map((row) => [String(row.id), row.nickname]));
    }
    const collaborators = entries
      .map((entry) => ({
        user_id: entry.user_id,
        nickname: nicknameById.get(entry.user_id) ?? "队友",
        last_seen_ms: Math.max(0, at - entry.at),
      }))
      .sort((a, b) => a.last_seen_ms - b.last_seen_ms);
    return { scene_id: String(scene.id), ttl_s: HEARTBEAT_TTL_S, collaborators, count: collaborators.length };
  }
}
