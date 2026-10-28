import { Inject, Injectable } from "@nestjs/common";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { novelEditMessages, novelEditPendings, novelEditSessions, novelEpisodes } from "@app/db";
import {
  AppError,
  ErrorCode,
  NOVEL_LIMITS,
  NovelEditMessageRole,
  NovelEditPendingStatus,
  NovelEditSessionStatus,
  newId,
  type NovelEditChatRequest,
  type NovelEditDecideAllRequest,
  type NovelEditDecideRequest,
  type NovelEditHeartbeatRequest,
  type NovelEditSessionCreateRequest,
} from "@app/shared";
import { db } from "../../db/database";
import { RedisService } from "../../redis/redis.service";
import { NovelLlmService } from "./novel-llm.service";
import { NovelService } from "./novel.service";
import {
  asRecord,
  editMessageDto,
  editPendingDto,
  editSessionDto,
  episodeDto,
  type NovelEditPendingRow,
  type NovelEditSessionRow,
  type NovelEpisodeRow,
} from "./novel.dto";
import type { SessionSwitchRequest } from "./novel.schemas";

/**
 * 剧本编辑 Agent（对照竞品 `df/novel/:nt_id/script_edit_agent/*` 13 语义端点 / 16 路由，
 * `rea-reelmate/routes.txt:570-600`、`docs/07-plan/completion-plan-to-100.md:105-132`）。
 *
 * 这是本批的**产品差异点**，所以把三条实现原则写在最前面：
 *
 * 1. **pending 是逐集 diff，不是整篇重写**。
 *    模型只输出"要改哪几集 + 每集的建议全文 + 一句变更说明"，服务端把它落进
 *    `novel_edit_pendings`（original_text / proposed_text / change_summary 三段整存）。
 *    不存 patch 的原因见 `packages/db/src/schema.ts:1546-1552`：diff 是给人看的双栏对照，
 *    存 patch 等于服务端还要实现一遍渲染，而且"驳回后原文不变"就不再是天然事实。
 *
 * 2. **apply 才写正文**，且写正文必须走 `NovelService.writeEpisodeText`
 *    （它同时落 `novel_script_versions` 并维持 `episode.version == max(version_no)`）。
 *    reject 只改 pending 状态，一个字节都不碰 `novel_episodes` —— 这就是"驳回是安全的"。
 *
 * 3. **并发/中止/心跳都要显式状态**，不允许静默：
 *    - 同一会话同时 chat → `746005 AGENT_TURN_IN_FLIGHT`（与 `agent` 域同码）；
 *      互斥用 **Redis `SET NX`**（不是进程内 Set）：API 多副本时进程内锁等于没锁，
 *      两个副本会各自认为"我拿到了"，同一会话就会同时跑两轮、双写 pending/消息。
 *    - 已 closed 的会话再 chat → `400100` + reason=`session_closed`；
 *    - 重复 apply 同一 pending → `746002 VERSION_CONFLICT`（防止版本表被重放刷两遍）；
 *    - abort 无在途轮次 → `aborted:false` + reason=`no_turn_in_flight`（不是假装成功）。
 */
@Injectable()
export class NovelAgentService {
  /**
   * 轮次互斥：**Redis `SET NX` + TTL**。
   *
   * 为什么不用 DB 行锁：`chat` 的临界区跨一次 LLM 调用（最长 30s），
   * `SELECT ... FOR UPDATE` 会长时间占住连接池；也不用进程内 Set —— 多副本部署时
   * 进程内锁等于没锁（两个副本各自认为自己是唯一持有者，同一会话会同时跑两轮）。
   *
   * TTL 是**租约**而不是业务超时：正常路径在 finally 里主动释放；
   * TTL（60s）只兜底"进程崩在 LLM 调用中间"，避免会话被永久锁死。
   * 释放时用 Lua 比对 token —— 否则 A 的锁超时后 B 拿到锁，A 的 finally 会把 B 的锁删掉。
   */
  private readonly lockKey = (sid: string): string => `novel:agent:turn:${sid}`;
  /** 中止标记（跨副本可见；TTL 同样 60s，正常路径读取后即删） */
  private readonly abortKey = (sid: string): string => `novel:agent:abort:${sid}`;
  private static readonly LOCK_TTL_S = 60;
  /** 释放锁的原子比较删除（token 不符则不动） */
  private static readonly RELEASE_LUA =
    "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";

  /** 显式 `@Inject` 见 `NovelService` 构造函数注释（esbuild 不产 decorator metadata） */
  constructor(
    @Inject(NovelService) private readonly novels: NovelService,
    @Inject(NovelLlmService) private readonly llm: NovelLlmService,
    @Inject(RedisService) private readonly redis: RedisService,
  ) {}

  // ── 内部工具 ────────────────────────────────────────────────

  private async requireSession(novelId: bigint, sid: string): Promise<NovelEditSessionRow> {
    let id: bigint;
    try {
      id = BigInt(sid);
    } catch {
      throw new AppError(ErrorCode.INVALID_PARAM, "invalid session id", { field: "session_id" });
    }
    const [row] = await db
      .select()
      .from(novelEditSessions)
      .where(and(eq(novelEditSessions.id, id), eq(novelEditSessions.novelId, novelId)));
    if (!row) throw new AppError(ErrorCode.NOT_FOUND, "edit session not found", { reason: "session_not_found" });
    return row;
  }

  private assertActive(session: NovelEditSessionRow): void {
    if (session.status !== NovelEditSessionStatus.ACTIVE) {
      throw new AppError(ErrorCode.BAD_REQUEST, "edit session is closed", {
        reason: "session_closed",
        session_id: String(session.id),
      });
    }
  }

  private scopeOf(session: NovelEditSessionRow): number[] {
    const raw = asRecord(session.context).scope_episode_nos;
    return Array.isArray(raw) ? raw.filter((n): n is number => typeof n === "number") : [];
  }

  /** 会话范围内的剧集（scope 为空 = 全书） */
  private async episodesInScope(novelId: bigint, session: NovelEditSessionRow, extraNos?: number[]) {
    const rows = await db
      .select()
      .from(novelEpisodes)
      .where(eq(novelEpisodes.novelId, novelId))
      .orderBy(asc(novelEpisodes.episodeNo));
    const scope = this.scopeOf(session);
    const effective = extraNos?.length ? extraNos : scope;
    if (!effective.length) return rows;
    return rows.filter((row) => effective.includes(row.episodeNo));
  }

  private async patchSessionContext(session: NovelEditSessionRow, patch: Record<string, unknown>): Promise<void> {
    await db
      .update(novelEditSessions)
      .set({ context: { ...asRecord(session.context), ...patch }, updatedAt: new Date() })
      .where(eq(novelEditSessions.id, session.id));
  }

  /** 会话内未决 diff（带上 episode_no，前端不必再查一次剧集表） */
  private async pendingRows(sessionId: bigint) {
    const rows = await db
      .select({ pending: novelEditPendings, episode: novelEpisodes })
      .from(novelEditPendings)
      .innerJoin(novelEpisodes, eq(novelEditPendings.episodeId, novelEpisodes.id))
      .where(and(eq(novelEditPendings.sessionId, sessionId), eq(novelEditPendings.status, NovelEditPendingStatus.PENDING)))
      .orderBy(asc(novelEpisodes.episodeNo));
    return rows.map((row) => editPendingDto(row.pending, row.episode.episodeNo));
  }

  // ══════════════════════════════════════════════════════════════
  // 1. enter / exit / heartbeat
  // ══════════════════════════════════════════════════════════════

  /**
   * 进入编辑态。
   *
   * 幂等：同一用户在同一本子上已有 ACTIVE 会话时**直接复用**并返回 `replayed: true`，
   * 不再新建。竞品 enter 是"进入编辑态"而非"新建会话"，重复点击不应产生第二个会话
   * （否则会话列表会堆满空会话，pending 也会被分摊到不同 sid 上，apply_all 只处理一半）。
   */
  async enter(spaceId: string, userId: string, ntId: string, input: NovelEditSessionCreateRequest) {
    const novel = await this.novels.requireNovel(spaceId, ntId);
    const [existing] = await db
      .select()
      .from(novelEditSessions)
      .where(
        and(
          eq(novelEditSessions.novelId, novel.id),
          eq(novelEditSessions.userId, BigInt(userId)),
          eq(novelEditSessions.status, NovelEditSessionStatus.ACTIVE),
        ),
      )
      .orderBy(desc(novelEditSessions.createdAt))
      .limit(1);
    if (existing) {
      await db
        .update(novelEditSessions)
        .set({ heartbeatAt: new Date(), updatedAt: new Date() })
        .where(eq(novelEditSessions.id, existing.id));
      const pending = await this.pendingRows(existing.id);
      return { session: editSessionDto(existing), pending, replayed: true, llm_mode: this.llm.mode };
    }
    const created = await this.createSession(novel.id, userId, input, true);
    return { session: created, pending: [], replayed: false, llm_mode: this.llm.mode };
  }

  private async createSession(
    novelId: bigint,
    userId: string,
    input: NovelEditSessionCreateRequest,
    markCurrent: boolean,
  ) {
    const context: Record<string, unknown> = {
      title: (input.title ?? "").trim(),
      instructions: input.instructions ?? "",
      scope_episode_nos: input.episode_nos ?? [],
      is_current: markCurrent,
      decisions: [],
    };
    const [row] = await db
      .insert(novelEditSessions)
      .values({
        id: newId(),
        novelId,
        userId: BigInt(userId),
        status: NovelEditSessionStatus.ACTIVE,
        heartbeatAt: new Date(),
        context,
      })
      .returning();
    return editSessionDto(row!);
  }

  /** 退出编辑态：把该用户在本子上的 ACTIVE 会话全部置 closed（幂等） */
  async exit(spaceId: string, userId: string, ntId: string) {
    const novel = await this.novels.requireNovel(spaceId, ntId);
    const rows = await db
      .select({ id: novelEditSessions.id })
      .from(novelEditSessions)
      .where(
        and(
          eq(novelEditSessions.novelId, novel.id),
          eq(novelEditSessions.userId, BigInt(userId)),
          eq(novelEditSessions.status, NovelEditSessionStatus.ACTIVE),
        ),
      );
    if (rows.length > 0) {
      await db
        .update(novelEditSessions)
        .set({ status: NovelEditSessionStatus.CLOSED, updatedAt: new Date() })
        .where(
          and(
            eq(novelEditSessions.novelId, novel.id),
            eq(novelEditSessions.userId, BigInt(userId)),
            eq(novelEditSessions.status, NovelEditSessionStatus.ACTIVE),
          ),
        );
    }
    // 未确认的 diff 随退出一起作废：closed 会话不可能再 apply，若只关会话不改 pending，
    // 前端"待处理 N 项"会永远挂着（伤害点：用户以为还有东西要确认，点进去又全部失败）。
    // 故这里把它们如实置 rejected，并把条数回显，而不是嘴上说"已作废"、库里仍是 pending。
    let discarded = 0;
    if (rows.length > 0) {
      const affected = await db
        .update(novelEditPendings)
        .set({ status: NovelEditPendingStatus.REJECTED, updatedAt: new Date() })
        .where(
          and(
            inArray(
              novelEditPendings.sessionId,
              rows.map((row) => row.id),
            ),
            eq(novelEditPendings.status, NovelEditPendingStatus.PENDING),
          ),
        )
        .returning({ id: novelEditPendings.id });
      discarded = affected.length;
    }
    return { ok: true, closed: rows.map((row) => String(row.id)), discarded_pending: discarded, replayed: rows.length === 0 };
  }

  /**
   * 心跳。
   *
   * 没有 ACTIVE 会话时**必须报错**：静默返回 ok 会让前端以为编辑态还在，
   * 用户继续输入的内容最终全部落在一个已 closed 的会话上（或干脆丢失）。
   */
  async heartbeat(spaceId: string, userId: string, ntId: string, input: NovelEditHeartbeatRequest) {
    const novel = await this.novels.requireNovel(spaceId, ntId);
    const rows = await db
      .select()
      .from(novelEditSessions)
      .where(
        and(
          eq(novelEditSessions.novelId, novel.id),
          eq(novelEditSessions.userId, BigInt(userId)),
          eq(novelEditSessions.status, NovelEditSessionStatus.ACTIVE),
        ),
      );
    if (rows.length === 0) {
      throw new AppError(ErrorCode.BAD_REQUEST, "no active edit session; call enter first", {
        reason: "no_active_session",
      });
    }
    const now = new Date();
    await db
      .update(novelEditSessions)
      .set({ heartbeatAt: now, updatedAt: now })
      .where(
        and(
          eq(novelEditSessions.novelId, novel.id),
          eq(novelEditSessions.userId, BigInt(userId)),
          eq(novelEditSessions.status, NovelEditSessionStatus.ACTIVE),
        ),
      );
    const pending = await this.pendingRows(rows[0]!.id);
    return {
      ok: true,
      heartbeat_at: now.toISOString(),
      /** 回显客户端自称的未提交状态；服务端不把它当真相（见 shared 的 heartbeat schema 注释） */
      client_dirty: input.dirty,
      sessions: rows.map(editSessionDto),
      pending_count: pending.length,
    };
  }

  // ══════════════════════════════════════════════════════════════
  // 2. 会话列表 / 新建 / 切换 / 详情
  // ══════════════════════════════════════════════════════════════

  /**
   * `GET /script_edit_agent`（第 90 批；竞品同族路径）。
   *
   * 与 `heartbeat` 的关键区别：**这是只读探针，没有 ACTIVE 会话时返回 `active:false` 而不是 400**。
   * 竞品前端用它决定"要不要显示编辑态入口"，客户端在进入前一定会调它；
   * 若此时报 400，前端只能把 400 当 false 处理 —— 那等于把状态判断写进错误分支。
   *
   * `in_flight` 读 Redis 轮次锁（多副本下唯一真相）：DB 里 ACTIVE 只说明"会话开着"，
   * 不说明"模型正在跑"；这两个状态分开表达，前端才能区分"可以发消息"与"先等这一轮"。
   */
  async state(spaceId: string, userId: string, ntId: string) {
    const novel = await this.novels.requireNovel(spaceId, ntId);
    const rows = await db
      .select()
      .from(novelEditSessions)
      .where(
        and(
          eq(novelEditSessions.novelId, novel.id),
          eq(novelEditSessions.userId, BigInt(userId)),
          eq(novelEditSessions.status, NovelEditSessionStatus.ACTIVE),
        ),
      )
      .orderBy(desc(novelEditSessions.updatedAt));
    const session = rows[0] ?? null;
    const pending = session ? await this.pendingRows(session.id) : [];
    const inFlight = session ? (await this.redis.get(this.lockKey(String(session.id)))) !== null : false;
    return {
      active: session !== null,
      session: session ? editSessionDto(session) : null,
      pending_count: pending.length,
      in_flight: inFlight,
      llm_mode: this.llm.mode,
    };
  }

  async listSessions(spaceId: string, ntId: string) {
    const novel = await this.novels.requireNovel(spaceId, ntId);
    const rows = await db
      .select()
      .from(novelEditSessions)
      .where(eq(novelEditSessions.novelId, novel.id))
      .orderBy(desc(novelEditSessions.createdAt));
    const ids = rows.map((row) => row.id);
    const messageCounts = new Map<string, number>();
    const pendingCounts = new Map<string, number>();
    if (ids.length > 0) {
      const msgs = await db
        .select({ sessionId: novelEditMessages.sessionId, n: sql<number>`count(*)::int` })
        .from(novelEditMessages)
        .where(inArray(novelEditMessages.sessionId, ids))
        .groupBy(novelEditMessages.sessionId);
      for (const row of msgs) messageCounts.set(String(row.sessionId), row.n);
      const pends = await db
        .select({ sessionId: novelEditPendings.sessionId, n: sql<number>`count(*)::int` })
        .from(novelEditPendings)
        .where(
          and(
            inArray(novelEditPendings.sessionId, ids),
            eq(novelEditPendings.status, NovelEditPendingStatus.PENDING),
          ),
        )
        .groupBy(novelEditPendings.sessionId);
      for (const row of pends) pendingCounts.set(String(row.sessionId), row.n);
    }
    return {
      list: rows.map((row) => ({
        ...editSessionDto(row),
        message_count: messageCounts.get(String(row.id)) ?? 0,
        pending_count: pendingCounts.get(String(row.id)) ?? 0,
      })),
      total: rows.length,
    };
  }

  async createNewSession(spaceId: string, userId: string, ntId: string, input: NovelEditSessionCreateRequest) {
    const novel = await this.novels.requireNovel(spaceId, ntId);
    const session = await this.createSession(novel.id, userId, input, false);
    return { session, replayed: false };
  }

  /** 切换当前会话：把本子上其他会话的 is_current 清掉，目标置 true（持久化，不是无状态空转） */
  async switchSession(spaceId: string, ntId: string, input: SessionSwitchRequest) {
    const novel = await this.novels.requireNovel(spaceId, ntId);
    const target = await this.requireSession(novel.id, input.session_id);
    this.assertActive(target);
    await db.transaction(async (tx) => {
      const rows = await tx
        .select()
        .from(novelEditSessions)
        .where(eq(novelEditSessions.novelId, novel.id));
      for (const row of rows) {
        const next = { ...asRecord(row.context), is_current: row.id === target.id };
        await tx
          .update(novelEditSessions)
          .set({ context: next, updatedAt: new Date() })
          .where(eq(novelEditSessions.id, row.id));
      }
    });
    const [fresh] = await db.select().from(novelEditSessions).where(eq(novelEditSessions.id, target.id));
    return { session: editSessionDto(fresh!), switched: true };
  }

  async getSession(spaceId: string, ntId: string, sid: string) {
    const novel = await this.novels.requireNovel(spaceId, ntId);
    const session = await this.requireSession(novel.id, sid);
    const messages = await db
      .select()
      .from(novelEditMessages)
      .where(eq(novelEditMessages.sessionId, session.id))
      .orderBy(asc(novelEditMessages.createdAt))
      .limit(200);
    const pending = await this.pendingRows(session.id);
    return {
      session: editSessionDto(session),
      messages: messages.map(editMessageDto),
      pending,
      llm_mode: this.llm.mode,
    };
  }

  // ══════════════════════════════════════════════════════════════
  // 3. chat（核心：产出逐集 diff）
  // ══════════════════════════════════════════════════════════════

  async chat(spaceId: string, ntId: string, sid: string, input: NovelEditChatRequest) {
    /**
     * 顺序：先做**廉价校验**（本子/会话/活跃态）拿到精确错误，再原子抢轮次锁。
     *
     * 为什么校验放前面：抢锁前失败不必写 Redis key；而"并发"的正确性不依赖顺序 ——
     * `SET NX` 本身是原子的，两个并发请求里恰好一个成功，另一个拿 746005。
     * （上一版用进程内 Set 时必须"先占位再校验"才对，换成 Redis 后这个约束消失。）
     */
    const novel = await this.novels.requireNovel(spaceId, ntId);
    const session = await this.requireSession(novel.id, sid);
    this.assertActive(session);
    const key = sid;
    const token = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const acquired = await this.redis.setNx(this.lockKey(key), token, NovelAgentService.LOCK_TTL_S);
    if (!acquired) {
      // 显式 746005：不排队、不吞掉，第二次调用者必须知道自己的要求没被处理
      throw new AppError(ErrorCode.AGENT_TURN_IN_FLIGHT, "another turn is in flight for this session", {
        reason: "turn_in_flight",
        session_id: key,
        retry: "wait_for_current_turn",
      });
    }
    // 上一轮残留的中止标记不能影响本轮
    await this.redis.del(this.abortKey(key));
    try {
      const episodes = await this.episodesInScope(novel.id, session, input.episode_nos);
      const unknown = (input.episode_nos ?? []).filter((no) => !episodes.some((e) => e.episodeNo === no));
      if (unknown.length > 0) {
        throw new AppError(ErrorCode.INVALID_PARAM, "episode_no not found in this novel", {
          field: "episode_nos",
          unknown,
        });
      }

      // 1) 先落用户消息 —— 即使后面 LLM 失败，用户输入也不该丢（可重试/可审计）
      const [userMessage] = await db
        .insert(novelEditMessages)
        .values({ id: newId(), sessionId: session.id, role: NovelEditMessageRole.USER, content: input.content })
        .returning();

      const plan = await this.llm.editPlan({
        title: novel.title,
        userMessage: input.content,
        instructions: asRecord(session.context).instructions as string | undefined,
        episodes: episodes.map((row) => ({
          episodeNo: row.episodeNo,
          title: row.title,
          scriptText: row.scriptText,
        })),
      });

      if ((await this.redis.get(this.abortKey(key))) !== null) {
        // 中止语义：LLM 结果整轮作废（**不落 pending**），已记录的用户消息保留（可审计）
        await this.redis.del(this.abortKey(key));
        throw new AppError(ErrorCode.BAD_REQUEST, "turn aborted by user", { reason: "aborted" });
      }

      // 2) 逐集 diff 落 pending：同集已有未决 diff 时**替换**（唯一索引只允许一集一条 pending）
      const byNo = new Map(episodes.map((row) => [row.episodeNo, row]));
      const accepted: Array<{ episode: NovelEpisodeRow; proposed: string; summary: string }> = [];
      const ignored: number[] = [];
      for (const item of plan.episodes) {
        const episode = byNo.get(item.episode_no);
        if (!episode) {
          // 模型编了不存在的集号：不静默改写，回显给前端（要能看见"模型跑偏了"）
          ignored.push(item.episode_no);
          continue;
        }
        accepted.push({ episode, proposed: item.new_text, summary: item.change_summary });
      }

      const created = await db.transaction(async (tx) => {
        if (accepted.length > 0) {
          await tx
            .delete(novelEditPendings)
            .where(
              and(
                eq(novelEditPendings.sessionId, session.id),
                inArray(
                  novelEditPendings.episodeId,
                  accepted.map((item) => item.episode.id),
                ),
                eq(novelEditPendings.status, NovelEditPendingStatus.PENDING),
              ),
            );
          await tx.insert(novelEditPendings).values(
            accepted.map((item) => ({
              id: newId(),
              sessionId: session.id,
              episodeId: item.episode.id,
              originalText: item.episode.scriptText,
              proposedText: item.proposed,
              changeSummary: item.summary,
              status: NovelEditPendingStatus.PENDING,
            })),
          );
        }
        const [assistant] = await tx
          .insert(novelEditMessages)
          .values({
            id: newId(),
            sessionId: session.id,
            role: NovelEditMessageRole.ASSISTANT,
            content: plan.reply,
            pendingChanges: accepted.map((item) => ({
              episode_id: String(item.episode.id),
              episode_no: item.episode.episodeNo,
              change_summary: item.summary,
            })),
          })
          .returning();
        return assistant!;
      });

      // 3) 会话上下文：首轮消息派生标题（列表展示用），记录轮次时间
      const context = asRecord(session.context);
      const patch: Record<string, unknown> = { last_turn_at: new Date().toISOString() };
      if (!context.title) patch.title = input.content.slice(0, 30);
      await this.patchSessionContext(session, patch);
      await db
        .update(novelEditSessions)
        .set({ heartbeatAt: new Date(), updatedAt: new Date() })
        .where(eq(novelEditSessions.id, session.id));

      const pending = await this.pendingRows(session.id);
      return {
        reply: plan.reply,
        message: editMessageDto(created),
        user_message: editMessageDto(userMessage!),
        pending,
        ignored_episode_nos: ignored,
        llm_mode: this.llm.mode,
      };
    } finally {
      await this.releaseTurnLock(key, token);
    }
  }

  /**
   * 释放轮次锁（原子比较删除）。
   *
   * 为什么必须比对 token：A 的锁若因崩溃/TTL 到期消失、B 已抢到新锁，
   * A 的 `finally` 若直接 `DEL` 就会把 B 的锁删掉 —— 那等于给"第三个请求"开了门。
   * 释放失败不掩盖业务结果（TTL 到期后锁自然失效）。
   */
  private async releaseTurnLock(sid: string, token: string): Promise<void> {
    try {
      // 走到这里说明 setNx 成功过，连接必然 ready（RedisService.setNx 内部等 ready）
      await this.redis.client.eval(NovelAgentService.RELEASE_LUA, 1, this.lockKey(sid), token);
    } catch {
      // 忽略：租约到期即失效，最坏情况是用户等一个 TTL
    }
  }

  /**
   * 中止本轮。
   *
   * 没有在途轮次时**不假装成功**：返回 `aborted:false, reason:no_turn_in_flight`。
   * 前端据此可以判断"其实没有东西可中止"，而不是显示一个"已中止"的假状态。
   */
  async abort(spaceId: string, ntId: string, sid: string) {
    const novel = await this.novels.requireNovel(spaceId, ntId);
    const session = await this.requireSession(novel.id, sid);
    // 与 chat 用同一个 key（路径 sid），否则 abort 永远看不到 chat 占的锁
    const key = sid;
    // 在途判据 = 轮次锁是否还在（Redis 是唯一致据，所以别的副本也能判对）
    const held = await this.redis.get(this.lockKey(key));
    if (held === null) {
      return {
        aborted: false,
        in_flight: false,
        reason: "no_turn_in_flight",
        session_id: String(session.id),
      };
    }
    await this.redis.set(this.abortKey(key), "1", NovelAgentService.LOCK_TTL_S);
    return { aborted: true, in_flight: true, reason: "abort_requested", session_id: String(session.id) };
  }

  // ══════════════════════════════════════════════════════════════
  // 4. pending / apply / reject / apply_all / reject_all
  // ══════════════════════════════════════════════════════════════

  async getPending(spaceId: string, ntId: string, sid: string, neId: string) {
    const novel = await this.novels.requireNovel(spaceId, ntId);
    const session = await this.requireSession(novel.id, sid);
    const episode = await this.novels.findEpisode(novel.id, neId);
    const [row] = await db
      .select()
      .from(novelEditPendings)
      .where(
        and(
          eq(novelEditPendings.sessionId, session.id),
          eq(novelEditPendings.episodeId, episode.id),
          eq(novelEditPendings.status, NovelEditPendingStatus.PENDING),
        ),
      );
    return {
      episode: { id: String(episode.id), episode_no: episode.episodeNo, title: episode.title },
      // 没有未决 diff 是正常态（用户刚确认完），返回 null 而不是 404：
      // 404 会让前端把"这一集没问题"渲染成错误提示。
      pending: row ? editPendingDto(row, episode.episodeNo) : null,
    };
  }

  private async findPendingForEpisode(sessionId: bigint, episodeId: bigint): Promise<NovelEditPendingRow | undefined> {
    const [row] = await db
      .select()
      .from(novelEditPendings)
      .where(and(eq(novelEditPendings.sessionId, sessionId), eq(novelEditPendings.episodeId, episodeId)))
      .orderBy(desc(novelEditPendings.createdAt))
      .limit(1);
    return row;
  }

  async apply(spaceId: string, userId: string, ntId: string, sid: string, neId: string, input: NovelEditDecideRequest) {
    void input;
    const novel = await this.novels.requireNovel(spaceId, ntId);
    // 定稿后正文冻结（status=16 是"可拆集"的判据，改正文会让已拆集与本子对不上）
    this.novels.assertDraftLike(novel, "script_edit_agent/apply");
    const session = await this.requireSession(novel.id, sid);
    this.assertActive(session);
    const episode = await this.novels.findEpisode(novel.id, neId);
    const pending = await this.findPendingForEpisode(session.id, episode.id);
    if (!pending) {
      throw new AppError(ErrorCode.BAD_REQUEST, "no pending change for this episode", { reason: "no_pending" });
    }
    if (pending.status === NovelEditPendingStatus.APPLIED) {
      // 重放保护：第二次 apply 若再写一次正文，版本表会多出一条同内容快照
      throw new AppError(ErrorCode.VERSION_CONFLICT, "pending change already applied", {
        reason: "pending_already_applied",
      });
    }
    if (pending.status === NovelEditPendingStatus.REJECTED) {
      throw new AppError(ErrorCode.VERSION_CONFLICT, "pending change already rejected", {
        reason: "pending_already_rejected",
      });
    }

    const row = await db.transaction(async (tx) => {
      const updatedEpisode = await this.novels.writeEpisodeText(
        tx,
        novel.id,
        episode.episodeNo,
        episode.title,
        pending.proposedText,
        { status: 2, createdBy: BigInt(userId) },
      );
      await tx
        .update(novelEditPendings)
        .set({ status: NovelEditPendingStatus.APPLIED, updatedAt: new Date() })
        .where(eq(novelEditPendings.id, pending.id));
      return updatedEpisode;
    });
    return {
      applied: true,
      pending: editPendingDto({ ...pending, status: NovelEditPendingStatus.APPLIED }, episode.episodeNo),
      episode: episodeDto(row),
    };
  }

  async reject(spaceId: string, ntId: string, sid: string, neId: string, input: NovelEditDecideRequest) {
    const novel = await this.novels.requireNovel(spaceId, ntId);
    const session = await this.requireSession(novel.id, sid);
    this.assertActive(session);
    const episode = await this.novels.findEpisode(novel.id, neId);
    const pending = await this.findPendingForEpisode(session.id, episode.id);
    if (!pending) {
      throw new AppError(ErrorCode.BAD_REQUEST, "no pending change for this episode", { reason: "no_pending" });
    }
    if (pending.status === NovelEditPendingStatus.REJECTED) {
      throw new AppError(ErrorCode.VERSION_CONFLICT, "pending change already rejected", {
        reason: "pending_already_rejected",
      });
    }
    if (pending.status === NovelEditPendingStatus.APPLIED) {
      throw new AppError(ErrorCode.VERSION_CONFLICT, "pending change already applied", {
        reason: "pending_already_applied",
      });
    }
    await db.transaction(async (tx) => {
      await tx
        .update(novelEditPendings)
        .set({ status: NovelEditPendingStatus.REJECTED, updatedAt: new Date() })
        .where(eq(novelEditPendings.id, pending.id));
    });
    // 驳回原因落在会话 context.decisions（审计用；pending 表没有 reason 列，不为一行原因加迁移）
    const decisions = Array.isArray(asRecord(session.context).decisions)
      ? (asRecord(session.context).decisions as unknown[])
      : [];
    await this.patchSessionContext(session, {
      decisions: [
        ...decisions.slice(-49),
        {
          action: "reject",
          episode_id: String(episode.id),
          episode_no: episode.episodeNo,
          reason: input.reason ?? "",
          at: new Date().toISOString(),
        },
      ],
    });
    return {
      rejected: true,
      pending: editPendingDto({ ...pending, status: NovelEditPendingStatus.REJECTED }, episode.episodeNo),
      reason: input.reason ?? "",
      // 明确回显"正文没动"：这是驳回语义的核心保证
      episode_text_changed: false,
      episode: episodeDto(episode),
    };
  }

  async applyAll(spaceId: string, userId: string, ntId: string, sid: string, input: NovelEditDecideAllRequest) {
    const novel = await this.novels.requireNovel(spaceId, ntId);
    this.novels.assertDraftLike(novel, "script_edit_agent/apply_all");
    const session = await this.requireSession(novel.id, sid);
    this.assertActive(session);
    const rows = await this.pendingRows(session.id);
    const targets = input.episode_nos?.length
      ? rows.filter((row) => input.episode_nos!.includes(row.episode_no))
      : rows;
    if (rows.length > 0 && targets.length === 0 && input.episode_nos?.length) {
      throw new AppError(ErrorCode.INVALID_PARAM, "no pending change for requested episodes", {
        field: "episode_nos",
      });
    }
    const applied: Array<{ episode_id: string; episode_no: number; version: number }> = [];
    await db.transaction(async (tx) => {
      for (const item of targets) {
        const episode = await this.novels.findEpisode(novel.id, item.episode_id);
        const updated = await this.novels.writeEpisodeText(
          tx,
          novel.id,
          episode.episodeNo,
          episode.title,
          item.proposed_text,
          { status: 2, createdBy: BigInt(userId) },
        );
        await tx
          .update(novelEditPendings)
          .set({ status: NovelEditPendingStatus.APPLIED, updatedAt: new Date() })
          .where(eq(novelEditPendings.id, BigInt(item.id)));
        applied.push({ episode_id: String(episode.id), episode_no: episode.episodeNo, version: updated.version });
      }
    });
    return {
      applied: applied.length,
      list: applied,
      // 重放时返回 0 而不是报错：批量操作被前端重试命中是常态，报错只会制造假告警
      remaining: (await this.pendingRows(session.id)).length,
    };
  }

  async rejectAll(spaceId: string, ntId: string, sid: string, input: NovelEditDecideAllRequest) {
    const novel = await this.novels.requireNovel(spaceId, ntId);
    const session = await this.requireSession(novel.id, sid);
    this.assertActive(session);
    const rows = await this.pendingRows(session.id);
    const targets = input.episode_nos?.length
      ? rows.filter((row) => input.episode_nos!.includes(row.episode_no))
      : rows;
    if (targets.length > 0) {
      await db
        .update(novelEditPendings)
        .set({ status: NovelEditPendingStatus.REJECTED, updatedAt: new Date() })
        .where(
          and(
            inArray(
              novelEditPendings.id,
              targets.map((row) => BigInt(row.id)),
            ),
            eq(novelEditPendings.status, NovelEditPendingStatus.PENDING),
          ),
        );
      const decisions = Array.isArray(asRecord(session.context).decisions)
        ? (asRecord(session.context).decisions as unknown[])
        : [];
      await this.patchSessionContext(session, {
        decisions: [
          ...decisions.slice(-49),
          {
            action: "reject_all",
            episode_nos: targets.map((row) => row.episode_no),
            reason: input.reason ?? "",
            at: new Date().toISOString(),
          },
        ],
      });
    }
    return {
      rejected: targets.length,
      list: targets.map((row) => ({ episode_id: row.episode_id, episode_no: row.episode_no })),
      reason: input.reason ?? "",
      remaining: (await this.pendingRows(session.id)).length,
    };
  }

  // ══════════════════════════════════════════════════════════════
  // 5. 版本（version/:vid/finalize | delete）
  // ══════════════════════════════════════════════════════════════

  async finalizeVersion(spaceId: string, ntId: string, vid: string) {
    return this.novels.finalizeVersion(spaceId, ntId, vid);
  }

  async deleteVersion(spaceId: string, ntId: string, vid: string) {
    return this.novels.deleteVersion(spaceId, ntId, vid);
  }



  /** 每次会话上限保护（消息过多时 chat 的上下文会超窗，这里只做一条明确失败） */
  assertMessageBudget(count: number): void {
    if (count > NOVEL_LIMITS.EPISODE_MAX * 10) {
      throw new AppError(ErrorCode.BAD_REQUEST, "session has too many messages", { reason: "message_budget" });
    }
  }
}
