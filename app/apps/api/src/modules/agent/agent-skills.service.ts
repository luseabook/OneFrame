import { Injectable } from "@nestjs/common";
import { and, desc, eq, ilike, inArray, isNotNull, isNull, ne, or, sql } from "drizzle-orm";
import { agentSkillFavorites, agentSkills } from "@app/db";
import { AppError, ErrorCode, newId } from "@app/shared";
import { db } from "../../db/database";
import {
  SKILL_CATALOG,
  SKILL_CATEGORY_KEYS,
  categoryLabel,
  categoryTag,
  type SkillCatalogEntry,
} from "./agent-skills.catalog";

/**
 * Skill 卡市场（竞品 `/df/canvas/agent-skills` 8 端点，`routes.txt:378-385`）。
 *
 * 四个设计约束：
 *
 * 1. **平台卡与用户卡同表**（`space_id IS NULL` = 平台卡）。广场 = `visibility=2`，
 *    与竞品"广场卡才能被收藏与复用"的语义一致；用户自建卡默认私有(`visibility=1`)，
 *    发布后才进广场。
 * 2. **收藏幂等靠唯一索引**，不靠 `select → insert`：`agent_skill_favorites` 上有
 *    `uq_agent_skill_favorites(skill_id, user_id)`，并发双击也只会有一行；
 *    `favorite_count` 每次改动后**重算**（`count(*)`），不用 `+1/-1` 累加——
 *    累加在"取消后重新收藏"的并发下会漂移，重算永远等于真实行数。
 * 3. **删除是软删**（`deleted_at`）：卡片可能被会话消息引用，硬删会让历史消息里的
 *    `skill_id` 变成悬空引用。
 * 4. **33 张平台卡幂等 upsert**：目录在 `agent-skills.catalog.ts`（代码即事实），
 *    首次读取广场时用事务级 advisory lock 补齐缺失卡；**已存在的卡不覆盖**，
 *    避免重启冲掉运营改过的文案/下架状态。
 *
 * 归属说明：`mine` = 本 space 自建卡（团队空间内成员共享，`owner_user_id` 用于区分
 * 创建人）；跨 space 的个人卡一律不可见。
 */

export interface AgentSkillDto {
  skill_id: string;
  name: string;
  /** 斜杠指令名（`name_en` 列，老数据回落 `config.slug`），前端据此把输入框首词识别成技能 */
  name_en: string;
  summary: string;
  cover_uri: string | null;
  category: string;
  category_label: string;
  prompt_template: string;
  config: Record<string, unknown>;
  visibility: number;
  use_count: number;
  favorite_count: number;
  status: number;
  is_favorite: boolean;
  is_mine: boolean;
  /**
   * 1 平台卡 / 2 团队卡（第 64 批对齐竞品 `owner_type`）。
   * 竞品证据：`d.owner_type===1||d.owner_type===2` 且平台卡引用固定写
   * `owner_type:1`（`Vr.addSkillRef({...,owner_type:1})`），团队卡透传卡上的值。
   */
  owner_type: 1 | 2;
  /** 首页推荐位（竞品 plaza 的 `is_home_recommend` 筛选项） */
  is_home_recommend: boolean;
  owner_user_id: string | null;
  space_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface SkillListQuery {
  page?: number;
  page_size?: number;
  category?: string;
  /** 关键词：命中标题 / 摘要 / 斜杠指令名 / 预置 prompt */
  q?: string;
  /** 竞品 `name`：只按名称/英文名精确语义收敛（与 `q` 全文检索区分） */
  name?: string;
  /** 竞品 `is_home_recommend`：只在首页推荐位里筛 */
  is_home_recommend?: boolean;
  /** 竞品 `mine` 的 `status`：1 正常 / 2 下架（缺省只看正常） */
  status?: number;
  /** 竞品 `details` 的 `owner_type`：1 平台卡 / 2 团队卡 */
  owner_type?: number;
}

export interface SkillPage {
  list: AgentSkillDto[];
  total: number;
  page: number;
  page_size: number;
}

export interface CreateSkillInput {
  name: string;
  /** 斜杠指令名（竞品一等字段 `name_en`）；省略则不参与查重 */
  name_en?: string;
  summary?: string;
  category?: string;
  prompt_template?: string;
  config?: Record<string, unknown>;
  visibility?: 1 | 2;
  cover_uri?: string | null;
}

export interface UpdateSkillInput {
  skill_id: string;
  name?: string;
  name_en?: string;
  summary?: string;
  category?: string;
  prompt_template?: string;
  config?: Record<string, unknown>;
  visibility?: 1 | 2;
  cover_uri?: string | null;
}

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

@Injectable()
export class AgentSkillsService {
  /** 进程内只跑一次：完成后不再重复查/写目录（多进程由 advisory lock 兜底） */
  private seeding: Promise<void> | null = null;

  // ── 目录（幂等 upsert）──────────────────────────────────
  async ensureCatalog(): Promise<void> {
    if (!this.seeding) {
      this.seeding = this.seedCatalog().catch((error: unknown) => {
        // 失败不缓存：下次请求还要能补，否则一次抖动会让广场永久空着
        this.seeding = null;
        throw error;
      });
    }
    return this.seeding;
  }

  private async seedCatalog(): Promise<void> {
    await db.transaction(async (tx) => {
      // 与"另一个进程正在补目录"互斥：没有锁时两个进程会各插一份 33 张
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('agent_skills_catalog'))`);
      const existing = await tx
        .select({ config: agentSkills.config })
        .from(agentSkills)
        .where(and(isNull(agentSkills.spaceId), isNull(agentSkills.deletedAt)));
      const have = new Set<string>();
      for (const row of existing) {
        const slug = (row.config as Record<string, unknown> | null)?.slug;
        if (typeof slug === "string" && slug) have.add(slug);
      }
      const missing = SKILL_CATALOG.filter((entry) => !have.has(entry.slug));
      if (missing.length === 0) return;
      await tx.insert(agentSkills).values(
        missing.map((entry) => {
          const index = SKILL_CATALOG.findIndex((item) => item.slug === entry.slug);
          return {
            id: newId(),
            spaceId: null,
            ownerUserId: null,
            name: entry.name,
            // 斜杠指令名同时写进列与 config（列给 SQL 查重/筛选，config 兼容老前端读法）
            nameEn: entry.slug,
            summary: entry.summary,
            coverUri: null,
            category: entry.category,
            promptTemplate: entry.promptTemplate,
            config: this.seedConfig(entry),
            // 平台卡默认进广场（竞品"广场卡才能被收藏与复用"）
            visibility: 2,
            // 初始使用次数按目录序递减：广场默认排序稳定且可解释（无真实使用数据时）
            useCount: 240 + (SKILL_CATALOG.length - index) * 7,
            favoriteCount: 0,
            status: 1,
          };
        }),
      );
    });
  }

  private seedConfig(entry: SkillCatalogEntry): Record<string, unknown> {
    return {
      slug: entry.slug,
      name_en: entry.slug,
      slash: `/${entry.slug}`,
      tags: entry.tags,
      category_label: categoryLabel(entry.category),
      tag: categoryTag(entry.category),
      seeded: true,
    };
  }

  // ── 列表族 ──────────────────────────────────────────────
  /** 广场：`visibility=2` 的公开卡（平台卡 + 用户发布卡） */
  async plaza(spaceId: string, userId: string, query: SkillListQuery): Promise<SkillPage> {
    await this.ensureCatalog();
    return this.page(
      spaceId,
      userId,
      and(this.alive(), eq(agentSkills.visibility, 2)),
      query,
    );
  }

  /** 我的：本 space 自建卡（团队内共享；`is_mine` 标出创建人是否是自己） */
  async mine(spaceId: string, userId: string, query: SkillListQuery): Promise<SkillPage> {
    await this.ensureCatalog();
    // 竞品 mine 带 `status`（1 正常 / 2 下架）：运营下架的卡要能在"我的"里被看见并恢复，
    // 所以这里不能用 `alive()`（它把 status=1 写死）。
    const status = query.status ?? 1;
    return this.page(
      spaceId,
      userId,
      and(
        isNull(agentSkills.deletedAt),
        eq(agentSkills.spaceId, BigInt(spaceId)),
        eq(agentSkills.status, status),
      ),
      query,
    );
  }

  /**
   * 全集：广场 ∪ 本空间自建（"这张卡我能不能用"）
   * 供前端 Skill 抽屉默认 tab 与 `GET /agent-skills` 使用。
   */
  async list(spaceId: string, userId: string, query: SkillListQuery): Promise<SkillPage> {
    await this.ensureCatalog();
    return this.page(
      spaceId,
      userId,
      and(this.alive(), or(eq(agentSkills.visibility, 2), eq(agentSkills.spaceId, BigInt(spaceId)))),
      query,
    );
  }

  /** 我收藏的（收藏是用户级，不带 space 维度混排；仍按 space 归属过滤可见性） */
  async favorites(spaceId: string, userId: string, query: SkillListQuery): Promise<SkillPage> {
    await this.ensureCatalog();
    const favRows = await db
      .select({ skillId: agentSkillFavorites.skillId })
      .from(agentSkillFavorites)
      .where(and(eq(agentSkillFavorites.userId, BigInt(userId)), eq(agentSkillFavorites.spaceId, BigInt(spaceId))));
    if (favRows.length === 0) {
      return { list: [], total: 0, page: Math.max(1, query.page ?? 1), page_size: this.size(query.page_size) };
    }
    const ids = favRows.map((row) => row.skillId);
    return this.page(spaceId, userId, and(this.alive(), inArray(agentSkills.id, ids)), query);
  }

  private alive() {
    return and(isNull(agentSkills.deletedAt), eq(agentSkills.status, 1));
  }

  private size(raw?: number): number {
    const size = Number.isFinite(raw) ? Number(raw) : DEFAULT_PAGE_SIZE;
    return Math.min(Math.max(1, Math.trunc(size)), MAX_PAGE_SIZE);
  }

  private async page(
    spaceId: string,
    userId: string,
    where: ReturnType<typeof and>,
    query: SkillListQuery,
  ): Promise<SkillPage> {
    const page = Math.max(1, Math.trunc(Number(query.page ?? 1)) || 1);
    const size = this.size(query.page_size);
    const offset = (page - 1) * size;

    const conds = [where];
    if (query.category) {
      if (!SKILL_CATEGORY_KEYS.includes(query.category)) {
        throw new AppError(ErrorCode.INVALID_PARAM, "unknown category", { field: "category" });
      }
      conds.push(eq(agentSkills.category, query.category));
    }
    const keyword = query.q?.trim();
    if (keyword) {
      const like = `%${keyword}%`;
      conds.push(
        or(
          ilike(agentSkills.name, like),
          ilike(agentSkills.summary, like),
          ilike(agentSkills.promptTemplate, like),
          sql`${agentSkills.config}->>'slug' ilike ${like}`,
        )!,
      );
    }
    /**
     * 竞品 `plaza` 的 `name`：与 `q` 分开。`q` 是全文（命中 summary/prompt），
     * `name` 只按显示名 / 英文名收敛——竞品就是靠 `name_en` 精确查重
     * （`we.name_en?.trim()===t.trim()`），如果也走全文，前端"按名字找卡"会
     * 把 prompt 里偶然提到该词的卡一起返回。
     */
    const nameOnly = query.name?.trim();
    if (nameOnly) {
      const like = `%${nameOnly}%`;
      conds.push(or(ilike(agentSkills.name, like), ilike(agentSkills.nameEn, like))!);
    }
    if (query.is_home_recommend !== undefined) {
      conds.push(eq(agentSkills.isHomeRecommend, query.is_home_recommend));
    }
    if (query.owner_type !== undefined) {
      if (query.owner_type !== 1 && query.owner_type !== 2) {
        throw new AppError(ErrorCode.INVALID_PARAM, "owner_type must be 1 or 2", { field: "owner_type" });
      }
      conds.push(query.owner_type === 1 ? isNull(agentSkills.spaceId) : isNotNull(agentSkills.spaceId));
    }
    const filter = and(...conds);

    const rows = await db
      .select({ skill: agentSkills, favoriteId: agentSkillFavorites.id })
      .from(agentSkills)
      .leftJoin(
        agentSkillFavorites,
        and(
          eq(agentSkillFavorites.skillId, agentSkills.id),
          eq(agentSkillFavorites.userId, BigInt(userId)),
          eq(agentSkillFavorites.spaceId, BigInt(spaceId)),
        ),
      )
      .where(filter)
      .orderBy(desc(agentSkills.useCount), desc(agentSkills.createdAt))
      .limit(size)
      .offset(offset);

    const [countRow] = await db
      .select({ total: sql<number>`count(*)::int` })
      .from(agentSkills)
      .where(filter);

    return {
      list: rows.map((row) => this.toDto(row.skill, row.favoriteId !== null, spaceId, userId)),
      total: countRow?.total ?? 0,
      page,
      page_size: size,
    };
  }

  // ── 详情 ────────────────────────────────────────────────
  /**
   * 卡片详情。`ownerType` 来自竞品 `details` 的 `owner_type`：带了就按卡类型收敛，
   * 类型不符一律 `NOT_FOUND`（与"不可见"同一处理，避免用 owner_type 探测
   * 某个 id 是平台卡还是团队卡）。
   */
  async detail(
    spaceId: string,
    userId: string,
    skillId: string,
    ownerType?: number,
  ): Promise<AgentSkillDto> {
    await this.ensureCatalog();
    const row = await this.findAccessible(spaceId, skillId, ownerType);
    const [fav] = await db
      .select({ id: agentSkillFavorites.id })
      .from(agentSkillFavorites)
      .where(
        and(
          eq(agentSkillFavorites.skillId, row.id),
          eq(agentSkillFavorites.userId, BigInt(userId)),
          eq(agentSkillFavorites.spaceId, BigInt(spaceId)),
        ),
      );
    return this.toDto(row, fav !== undefined, spaceId, userId);
  }

  /**
   * 可访问 = 公开卡 或 本 space 的卡。
   * 不可见一律 `NOT_FOUND`（不泄漏"这个 id 存在但不属于你"）。
   */
  private async findAccessible(spaceId: string, skillId: string, ownerType?: number) {
    let id: bigint;
    try {
      id = BigInt(skillId);
    } catch {
      throw new AppError(ErrorCode.INVALID_PARAM, "invalid skill_id", { field: "skill_id" });
    }
    const conds = [
      eq(agentSkills.id, id),
      isNull(agentSkills.deletedAt),
      or(eq(agentSkills.visibility, 2), eq(agentSkills.spaceId, BigInt(spaceId)))!,
    ];
    if (ownerType !== undefined) {
      if (ownerType !== 1 && ownerType !== 2) {
        throw new AppError(ErrorCode.INVALID_PARAM, "owner_type must be 1 or 2", { field: "owner_type" });
      }
      conds.push(ownerType === 1 ? isNull(agentSkills.spaceId) : isNotNull(agentSkills.spaceId));
    }
    const [row] = await db
      .select()
      .from(agentSkills)
      .where(and(...conds));
    if (!row) throw new AppError(ErrorCode.NOT_FOUND, "skill not found", { skill_id: skillId });
    return row;
  }

  // ── 创建 / 更新 / 删除 ───────────────────────────────────
  async create(spaceId: string, userId: string, input: CreateSkillInput): Promise<AgentSkillDto> {
    await this.ensureCatalog();
    const name = input.name.trim();
    if (!name) throw new AppError(ErrorCode.INVALID_PARAM, "name is required", { field: "name" });
    const category = input.category ?? "custom";
    if (!SKILL_CATEGORY_KEYS.includes(category)) {
      throw new AppError(ErrorCode.INVALID_PARAM, "unknown category", { field: "category" });
    }
    const nameEn = this.normalizeNameEn(input.name_en);
    if (nameEn) {
      // 竞品按 name_en 查重（`we.name_en?.trim()===t.trim()`）：同名斜杠指令会让
      // 输入框首词无法确定该用哪张卡，必须在这里挡住。
      await this.assertNameEnFree(BigInt(spaceId), nameEn, null);
    }
    const [row] = await db
      .insert(agentSkills)
      .values({
        id: newId(),
        spaceId: BigInt(spaceId),
        ownerUserId: BigInt(userId),
        name,
        nameEn,
        summary: input.summary?.trim() ?? "",
        coverUri: input.cover_uri ?? null,
        category,
        promptTemplate: input.prompt_template ?? "",
        config: {
          ...(input.config ?? {}),
          ...(nameEn ? { name_en: nameEn, slug: nameEn, slash: `/${nameEn}` } : {}),
          category_label: categoryLabel(category),
          tag: categoryTag(category),
        },
        visibility: input.visibility ?? 1,
        status: 1,
      })
      .returning();
    if (!row) throw new AppError(ErrorCode.INTERNAL, "skill create failed");
    return this.toDto(row, false, spaceId, userId);
  }

  /**
   * 更新卡片（第 64 批，对齐竞品 `PUT /df/canvas/agent-skills`）。
   *
   * 竞品这个端点的 `paramNames`/`queryNames` 都是空数组 —— 目标卡只能来自 body，
   * 所以入参用 `skill_id`。权限口径与删除一致：平台卡是运营资产不可改，团队卡
   * 只有创建人能改（别人改我的卡等于篡改我的提示词）。
   */
  async update(spaceId: string, userId: string, input: UpdateSkillInput): Promise<AgentSkillDto> {
    await this.ensureCatalog();
    const row = await this.requireOwned(spaceId, userId, input.skill_id);
    const patch: Partial<typeof agentSkills.$inferInsert> = { updatedAt: new Date() };
    const nextConfig: Record<string, unknown> = { ...((row.config ?? {}) as Record<string, unknown>) };

    if (input.name !== undefined) {
      const name = input.name.trim();
      if (!name) throw new AppError(ErrorCode.INVALID_PARAM, "name is required", { field: "name" });
      patch.name = name;
    }
    if (input.name_en !== undefined) {
      const nameEn = this.normalizeNameEn(input.name_en);
      if (nameEn) await this.assertNameEnFree(row.spaceId!, nameEn, row.id);
      patch.nameEn = nameEn;
      // config 里的三个派生态一起改，否则老前端读 config.slug 会看到旧指令名
      if (nameEn) {
        nextConfig.name_en = nameEn;
        nextConfig.slug = nameEn;
        nextConfig.slash = `/${nameEn}`;
      } else {
        delete nextConfig.name_en;
        delete nextConfig.slug;
        delete nextConfig.slash;
      }
    }
    if (input.category !== undefined) {
      if (!SKILL_CATEGORY_KEYS.includes(input.category)) {
        throw new AppError(ErrorCode.INVALID_PARAM, "unknown category", { field: "category" });
      }
      patch.category = input.category;
      nextConfig.category_label = categoryLabel(input.category);
      nextConfig.tag = categoryTag(input.category);
    }
    if (input.summary !== undefined) patch.summary = input.summary.trim();
    if (input.prompt_template !== undefined) patch.promptTemplate = input.prompt_template;
    if (input.visibility !== undefined) patch.visibility = input.visibility;
    if (input.cover_uri !== undefined) patch.coverUri = input.cover_uri;
    if (input.config !== undefined) {
      patch.config = { ...nextConfig, ...input.config };
    } else if (input.name_en !== undefined || input.category !== undefined) {
      patch.config = nextConfig;
    }

    const [after] = await db
      .update(agentSkills)
      .set(patch)
      .where(and(eq(agentSkills.id, row.id), isNull(agentSkills.deletedAt)))
      .returning();
    if (!after) throw new AppError(ErrorCode.NOT_FOUND, "skill not found", { skill_id: input.skill_id });

    const [fav] = await db
      .select({ id: agentSkillFavorites.id })
      .from(agentSkillFavorites)
      .where(
        and(
          eq(agentSkillFavorites.skillId, row.id),
          eq(agentSkillFavorites.userId, BigInt(userId)),
          eq(agentSkillFavorites.spaceId, BigInt(spaceId)),
        ),
      );
    return this.toDto(after, fav !== undefined, spaceId, userId);
  }

  /** 斜杠指令名归一：小写 + 去空白（竞品比较时也 `.trim()`） */
  private normalizeNameEn(raw?: string | null): string {
    return (raw ?? "").trim().toLowerCase();
  }

  /** 同空间内 `name_en` 不可重复；`excludeId` 用于更新时排除自己 */
  private async assertNameEnFree(spaceId: bigint, nameEn: string, excludeId: bigint | null): Promise<void> {
    const conds = [
      isNull(agentSkills.deletedAt),
      eq(agentSkills.spaceId, spaceId),
      eq(agentSkills.nameEn, nameEn),
    ];
    if (excludeId !== null) conds.push(ne(agentSkills.id, excludeId));
    const [hit] = await db
      .select({ id: agentSkills.id })
      .from(agentSkills)
      .where(and(...conds));
    if (hit) {
      throw new AppError(ErrorCode.INVALID_PARAM, "name_en already exists in this space", {
        field: "name_en",
      });
    }
  }

  /** 改/删共用的归属校验：平台卡 403，非本空间 400102，非创建人 403 */
  private async requireOwned(spaceId: string, userId: string, skillId: string) {
    let id: bigint;
    try {
      id = BigInt(skillId);
    } catch {
      throw new AppError(ErrorCode.INVALID_PARAM, "invalid skill_id", { field: "skill_id" });
    }
    const [row] = await db
      .select()
      .from(agentSkills)
      .where(and(eq(agentSkills.id, id), isNull(agentSkills.deletedAt)));
    if (!row) throw new AppError(ErrorCode.NOT_FOUND, "skill not found", { skill_id: skillId });
    if (row.spaceId === null) {
      throw new AppError(ErrorCode.FORBIDDEN, "platform skill cannot be edited", { reason: "platform_skill" });
    }
    if (String(row.spaceId) !== spaceId) {
      throw new AppError(ErrorCode.NOT_FOUND, "skill not found", { skill_id: skillId });
    }
    if (row.ownerUserId === null || String(row.ownerUserId) !== userId) {
      throw new AppError(ErrorCode.FORBIDDEN, "only the creator can edit this skill", { reason: "not_owner" });
    }
    return row;
  }

  /**
   * 软删。平台卡（`space_id IS NULL`）不可删：它是运营资产，用户只能"不收藏"。
   * 只有创建人可删本空间卡（团队空间里别人的卡不能被我删掉）。
   */
  async remove(spaceId: string, userId: string, skillId: string): Promise<{ ok: boolean }> {
    let id: bigint;
    try {
      id = BigInt(skillId);
    } catch {
      throw new AppError(ErrorCode.INVALID_PARAM, "invalid skill_id", { field: "skill_id" });
    }
    const [row] = await db
      .select()
      .from(agentSkills)
      .where(and(eq(agentSkills.id, id), isNull(agentSkills.deletedAt)));
    if (!row) throw new AppError(ErrorCode.NOT_FOUND, "skill not found", { skill_id: skillId });
    if (row.spaceId === null) {
      throw new AppError(ErrorCode.FORBIDDEN, "platform skill cannot be deleted", { reason: "platform_skill" });
    }
    if (String(row.spaceId) !== spaceId) {
      throw new AppError(ErrorCode.NOT_FOUND, "skill not found", { skill_id: skillId });
    }
    if (row.ownerUserId === null || String(row.ownerUserId) !== userId) {
      throw new AppError(ErrorCode.FORBIDDEN, "only the creator can delete this skill", { reason: "not_owner" });
    }
    await db
      .update(agentSkills)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(agentSkills.id, row.id));
    return { ok: true };
  }

  // ── 收藏 ────────────────────────────────────────────────
  /**
   * 收藏 / 取消收藏（幂等）。
   *
   * `favorite` 省略 = 取反（兼容"点一下切换"的 UI）；显式传 `true/false` 时
   * 重复调用结果完全一致（幂等），这也是 spec 里断言的重点：
   * 双击不能把 `favorite_count` 变成 2。
   */
  async favorite(
    spaceId: string,
    userId: string,
    skillId: string,
    desired?: boolean,
  ): Promise<{ favorited: boolean; favorite_count: number }> {
    const row = await this.findAccessible(spaceId, skillId);
    const userIdBig = BigInt(userId);
    const spaceIdBig = BigInt(spaceId);

    return db.transaction(async (tx) => {
      // 同一 (skill, user) 的并发收藏串行化：否则 count 重算与 insert 之间会看到中间态
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`agent_skill_fav:${row.id}:${userId}`}))`,
      );
      const [existing] = await tx
        .select({ id: agentSkillFavorites.id })
        .from(agentSkillFavorites)
        .where(and(eq(agentSkillFavorites.skillId, row.id), eq(agentSkillFavorites.userId, userIdBig)));

      const next = desired ?? existing === undefined;
      if (next && !existing) {
        await tx
          .insert(agentSkillFavorites)
          .values({ id: newId(), skillId: row.id, userId: userIdBig, spaceId: spaceIdBig })
          .onConflictDoNothing();
      } else if (!next && existing) {
        await tx.delete(agentSkillFavorites).where(eq(agentSkillFavorites.id, existing.id));
      }

      const [countRow] = await tx
        .select({ total: sql<number>`count(*)::int` })
        .from(agentSkillFavorites)
        .where(eq(agentSkillFavorites.skillId, row.id));
      const favoriteCount = countRow?.total ?? 0;
      await tx
        .update(agentSkills)
        .set({ favoriteCount, updatedAt: new Date() })
        .where(eq(agentSkills.id, row.id));

      const [after] = await tx
        .select({ id: agentSkillFavorites.id })
        .from(agentSkillFavorites)
        .where(and(eq(agentSkillFavorites.skillId, row.id), eq(agentSkillFavorites.userId, userIdBig)));

      return { favorited: after !== undefined, favorite_count: favoriteCount };
    });
  }

  /**
   * 记一次"被使用"（点卡片发送 / 走斜杠指令）。
   * 只做 +1 计数：使用次数是运营排序信号，不是账本，丢了不影响正确性。
   */
  async markUsed(spaceId: string, skillIds: string[]): Promise<void> {
    const ids: bigint[] = [];
    for (const raw of skillIds) {
      try {
        ids.push(BigInt(raw));
      } catch {
        // 非法 id 静默跳过：使用计数不该让"发送消息"失败
      }
    }
    if (ids.length === 0) return;
    await db
      .update(agentSkills)
      .set({ useCount: sql`${agentSkills.useCount} + 1`, updatedAt: new Date() })
      .where(and(inArray(agentSkills.id, ids), isNull(agentSkills.deletedAt), or(eq(agentSkills.visibility, 2), eq(agentSkills.spaceId, BigInt(spaceId)))));
  }

  // ── DTO ────────────────────────────────────────────────
  private toDto(
    row: typeof agentSkills.$inferSelect,
    isFavorite: boolean,
    spaceId: string,
    userId: string,
  ): AgentSkillDto {
    const config = (row.config ?? {}) as Record<string, unknown>;
    // 列优先、config 回落：迁移 0041 已把老数据的 config.slug 回填进列，
    // 但运维手改 config 的场景仍要能读到（两边不一致时列是权威）。
    const slug =
      row.nameEn || (typeof config.slug === "string" ? config.slug : "") || "";
    return {
      skill_id: String(row.id),
      name: row.name,
      name_en: slug,
      summary: row.summary,
      cover_uri: row.coverUri,
      category: row.category,
      category_label: categoryLabel(row.category),
      prompt_template: row.promptTemplate,
      config,
      visibility: row.visibility,
      use_count: row.useCount,
      favorite_count: row.favoriteCount,
      status: row.status,
      is_favorite: isFavorite,
      is_mine: row.ownerUserId !== null && String(row.ownerUserId) === userId && String(row.spaceId) === spaceId,
      owner_type: row.spaceId === null ? 1 : 2,
      is_home_recommend: row.isHomeRecommend,
      owner_user_id: row.ownerUserId === null ? null : String(row.ownerUserId),
      space_id: row.spaceId === null ? null : String(row.spaceId),
      created_at: row.createdAt.toISOString(),
      updated_at: row.updatedAt.toISOString(),
    };
  }
}
