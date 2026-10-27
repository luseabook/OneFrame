import { Inject, Injectable } from "@nestjs/common";
import { and, asc, desc, eq, gt, ilike, inArray, isNull, notInArray, sql } from "drizzle-orm";
import {
  novelChapterOutlines,
  novelChapters,
  novelCharacters,
  novelEpisodeOutlines,
  novelEpisodes,
  novelScriptVersions,
  novelWorldviews,
  novels,
} from "@app/db";
import {
  AppError,
  ErrorCode,
  NOVEL_LIMITS,
  NovelStatus,
  newId,
  type ChapterOutlinesPutRequest,
  type CreateNovelRequest,
  type EpisodeOutlinesPutRequest,
  type NovelCharacterCreateRequest,
  type NovelCharacterPatchRequest,
  type NovelCharactersConfirmRequest,
  type NovelEpisodePatchRequest,
  type NovelFinalizeRequest,
  type NovelPatchRequest,
  type NovelScriptGenerateRequest,
  type NovelSplitRequest,
  type WorldviewPutRequest,
  type WorldviewResult,
} from "@app/shared";
import { db } from "../../db/database";
import { ModerationService } from "../moderation/moderation.service";
import { NovelLlmService } from "./novel-llm.service";
import {
  asRecord,
  chapterDto,
  chapterOutlineDto,
  chapterSummaryDto,
  characterDto,
  episodeDto,
  episodeOutlineDto,
  episodeSummaryDto,
  novelDto,
  scriptVersionDto,
  worldviewDto,
  type NovelCharacterRow,
  type NovelEpisodeRow,
  type NovelRow,
} from "./novel.dto";
import type {
  ChapterListQuery,
  ChapterOutlineGenerateRequest,
  CharactersGenerateRequest,
  ContentAnalysisRequest,
  CoreCharacterGenerateRequest,
  EpisodeOutlineGenerateRequest,
  ListQuery,
  OutlinePatch,
} from "./novel.schemas";

/**
 * novel 域核心服务：分章 → 内容分析（世界观 + 角色卡）→ 章节大纲 → 分集大纲
 * → 核心角色 → 分集剧本 → 版本/定稿。
 *
 * 与竞品 `df/novel` 的对照见 `docs/07-plan/completion-plan-to-100.md` §3 与
 * `rea-reelmate/routes.txt:515-580`。三个贯穿全文的设计决定：
 *
 * 1. **`novels` 是唯一聚合根**：子表不带 space_id（`packages/db/src/schema.ts:1257-1259`），
 *    所以越权判断只做一次 —— 先按 id 取本子，再比 `novels.space_id`。
 *    查到但不同 space = 403（不泄露"这个 id 存在但属于别人"，也不假装 404）。
 *
 * 2. **每一步都可重放**：重新分章/重新生成大纲走 upsert（按自然键 `chapter_no`/`episode_no`
 *    或名字），不 DELETE 全表再 INSERT。所以同一输入重复调用得到同一批行（id 稳定），
 *    前端不会因为"点两次"把章节号打乱。
 *
 * 3. **原文存在 `meta.source_text`**：`novels` 表没有 source_text 列（只有分章后的
 *    `novel_chapters.content`）。竞品的"上传即拆解"口径下，原文的唯一合法归属就是分章结果，
 *    但重新分章需要一个可覆盖的原文副本，故落 meta —— 这是域内自由字段的正当用途。
 */
@Injectable()
export class NovelService {
  /**
   * ⚠️ 必须写显式 `@Inject(...)`：本仓库的 e2e 用 esbuild 转译，
   * esbuild 不实现 `emitDecoratorMetadata`，靠 `design:paramtypes` 的隐式注入
   * 在测试里会拿到 `undefined`（表现为 500 "Cannot read properties of undefined"）。
   * 既有模块（kds/script/team）全部是显式 `@Inject`，照抄这条约定。
   */
  constructor(
    @Inject(NovelLlmService) private readonly llm: NovelLlmService,
    @Inject(ModerationService) private readonly moderation: ModerationService,
  ) {}

  // ══════════════════════════════════════════════════════════════
  // 0. 权限/查找/公共工具
  // ══════════════════════════════════════════════════════════════

  /** 字符串 id → bigint（非法 id 是参数错误，不是 404） */
  private toBigId(value: string, field: string): bigint {
    try {
      const id = BigInt(value);
      if (id <= 0n) throw new Error("non-positive");
      return id;
    } catch {
      throw new AppError(ErrorCode.INVALID_PARAM, `invalid ${field}`, { field });
    }
  }

  /**
   * 取本子并做空间校验。**所有**本子级操作都必须先过这里。
   *
   * 顺序很重要：先按 id 查（不带 space 条件），查到再比 space。
   * 若把 space 写进 where，跨 space 会返回 404 —— 那等于把"id 存在"这个信息
   * 和"id 不存在"合并，前端无法区分"链接失效"与"你没权限"，排查成本高。
   */
  async requireNovel(spaceId: string | bigint, ntId: string | bigint): Promise<NovelRow> {
    const id = this.toBigId(String(ntId), "nt_id");
    const [row] = await db.select().from(novels).where(eq(novels.id, id));
    if (!row) throw new AppError(ErrorCode.NOT_FOUND, "novel not found", { reason: "novel_not_found" });
    if (row.spaceId !== BigInt(String(spaceId))) {
      throw new AppError(ErrorCode.FORBIDDEN, "novel belongs to another space", { reason: "space_mismatch" });
    }
    return row;
  }

  /** 已定稿（status=16）后正文冻结：除"删除版本/取消归档"外的一切写操作都要先撞这道墙 */
  private assertDraft(novel: NovelRow, action: string): void {
    if (novel.status === NovelStatus.FINALIZED) {
      throw new AppError(ErrorCode.BAD_REQUEST, "novel is finalized; reopen before editing", {
        reason: "novel_finalized",
        action,
      });
    }
  }

  private assertNotArchived(novel: NovelRow, action: string): void {
    if (novel.archivedAt) {
      throw new AppError(ErrorCode.BAD_REQUEST, "novel is archived", { reason: "novel_archived", action });
    }
  }

  /**
   * 供变体服务（裂变/海外）复用的"草稿态校验"。
   *
   * 变体链要往**另一个**本子上写，它拿到的是自己的行；这里暴露的语义与内部完全一致
   * （已定稿 / 已归档都不许再生成），避免变体服务自己再写一份判断而慢慢分叉。
   */
  assertDraftLike(novel: NovelRow, action: string): void {
    this.assertNotArchived(novel, action);
    this.assertDraft(novel, action);
  }

  /** 供变体服务复用：按名字合并角色卡（同名更新、新名插入，不产生重复卡） */
  async mergeCharacters(
    novelId: bigint,
    items: Array<{
      name: string;
      role_type: number;
      description: string;
      appearance: string;
      personality: string;
      prompt: string;
      is_core: boolean;
    }>,
  ) {
    return this.saveCharacters(novelId, items);
  }

  private meta(novel: NovelRow): Record<string, unknown> {
    return asRecord(novel.meta);
  }

  /** 原文副本（无原文时返回空串，由调用方决定是报错还是降级） */
  sourceTextOf(novel: NovelRow): string {
    const raw = this.meta(novel).source_text;
    return typeof raw === "string" ? raw : "";
  }

  private async touchNovel(novelId: bigint, patch: Partial<{ episodeCount: number; status: number; meta: Record<string, unknown> }> = {}): Promise<void> {
    await db
      .update(novels)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(novels.id, novelId));
  }

  private async chaptersOf(novelId: bigint) {
    return db
      .select()
      .from(novelChapters)
      .where(eq(novelChapters.novelId, novelId))
      .orderBy(asc(novelChapters.chapterNo));
  }

  /** 去空白字符数（与既有 `script.service` 的统计口径一致：不按 UTF-16 码元算） */
  private wordCount(text: string): number {
    return text.replace(/\s+/g, "").length;
  }

  /**
   * 原文切章。
   *
   * 优先级：
   * 1. 显式给了 `chapter_count` → 按长度均分（用户明确要 N 章，就别自作聪明按标题切）；
   * 2. 文本里有 ≥2 个"第N章/Chapter N"标题 → 按标题切（这是小说的天然边界，最准）；
   * 3. 都没有 → 按 ~3000 字一段均分。
   *
   * 为什么不用 LLM 切章：切章是纯结构问题，LLM 只会在长文本上引入不可复现的漂移；
   * 竞品的拆解也是规则任务（`novel.md:244` `task_type=4` 的拆解任务）。
   */
  splitChapters(text: string, chapterCount?: number): Array<{ title: string; content: string }> {
    const trimmed = text.trim();
    if (!trimmed) return [];

    if (chapterCount && chapterCount >= 1) {
      return this.evenSplit(trimmed, chapterCount);
    }

    const marker = /^[ \t\u3000]*(?:第[0-9一二三四五六七八九十百千零〇两]{1,10}[章节回卷]|Chapter\s+\d+)[^\n]{0,80}$/gmu;
    const hits = Array.from(trimmed.matchAll(marker)).map((m) => ({ index: m.index ?? 0, line: m[0].trim() }));
    if (hits.length >= 2) {
      return hits.map((hit, i) => {
        const end = i + 1 < hits.length ? hits[i + 1]!.index : trimmed.length;
        return {
          title: hit.line.slice(0, NOVEL_LIMITS.TITLE_MAX),
          content: trimmed.slice(hit.index, end).trim(),
        };
      });
    }

    const auto = Math.max(1, Math.min(Math.ceil(trimmed.length / 3_000), NOVEL_LIMITS.CHAPTER_MAX));
    return this.evenSplit(trimmed, auto);
  }

  private evenSplit(text: string, count: number): Array<{ title: string; content: string }> {
    const target = Math.max(1, Math.min(count, NOVEL_LIMITS.CHAPTER_MAX));
    const size = Math.ceil(text.length / target);
    return Array.from({ length: target }, (_, i) => ({
      title: `第${i + 1}章`,
      content: text.slice(i * size, (i + 1) * size).trim(),
    })).filter((chapter) => chapter.content.length > 0);
  }

  // ══════════════════════════════════════════════════════════════
  // 1. 本子 CRUD（对照竞品 novel/list、novel get、rename、delete）
  // ══════════════════════════════════════════════════════════════

  async create(spaceId: string, input: CreateNovelRequest) {
    const title = input.title.trim();
    // 竞品同名剧本返回业务冲突（`novel.md:706` 748201）。我方不新造错误码，
    // 用 BAD_REQUEST + reason=duplicate_title 表达同一语义（api-spec 未登记 748201 段）。
    const [dup] = await db
      .select({ id: novels.id })
      .from(novels)
      .where(and(eq(novels.spaceId, BigInt(spaceId)), eq(novels.title, title), isNull(novels.archivedAt)));
    if (dup) {
      throw new AppError(ErrorCode.BAD_REQUEST, "novel title already exists", {
        reason: "duplicate_title",
        field: "title",
      });
    }

    const sourceText = (input.source_text ?? "").trim();
    const meta: Record<string, unknown> = {};
    if (sourceText) meta.source_text = sourceText;
    if (input.source_file_name) meta.source_file_name = input.source_file_name;

    const [row] = await db
      .insert(novels)
      .values({
        id: newId(),
        spaceId: BigInt(spaceId),
        title,
        sourceType: input.source_type,
        status: NovelStatus.DRAFT,
        ratio: input.ratio,
        episodeCount: input.episode_count ?? 0,
        meta,
      })
      .returning();

    // 竞品 analyze 入口是"上传 → 建拆解任务 → 内容分析"，即上传即拆解。
    // 这里同样在创建时就把原文切成章节，用户打开工作台时第一步已经是完成态。
    let chapterCount = 0;
    if (sourceText) {
      chapterCount = (await this.splitIntoChapters(row, sourceText, undefined)).count;
    }
    return { ...novelDto(row), chapter_count: chapterCount };
  }

  async list(spaceId: string, query: ListQuery) {
    const conds = [eq(novels.spaceId, BigInt(spaceId))];
    if (query.archived === "1") conds.push(sql`${novels.archivedAt} is not null`);
    else if (query.archived === "all") {
      // 不加条件
    } else conds.push(isNull(novels.archivedAt));
    if (query.status !== undefined) conds.push(eq(novels.status, query.status));
    if (query.source_type !== undefined) conds.push(eq(novels.sourceType, query.source_type));
    if (query.q) conds.push(ilike(novels.title, `%${query.q}%`));

    const where = and(...conds);
    const [rows, [counted]] = await Promise.all([
      db
        .select()
        .from(novels)
        .where(where)
        .orderBy(desc(novels.createdAt))
        .limit(query.page_size)
        .offset((query.page - 1) * query.page_size),
      db.select({ total: sql<number>`count(*)::int` }).from(novels).where(where),
    ]);
    return {
      list: rows.map(novelDto),
      total: counted?.total ?? 0,
      page: query.page,
      page_size: query.page_size,
    };
  }

  async detail(spaceId: string, ntId: string) {
    const novel = await this.requireNovel(spaceId, ntId);
    const counts = await this.countsOf(novel.id);
    return { novel: novelDto(novel), counts, llm_mode: this.llm.mode };
  }

  private async countsOf(novelId: bigint) {
    const [chapters] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(novelChapters)
      .where(eq(novelChapters.novelId, novelId));
    const [characters] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(novelCharacters)
      .where(eq(novelCharacters.novelId, novelId));
    const [chapterOutlines] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(novelChapterOutlines)
      .where(eq(novelChapterOutlines.novelId, novelId));
    const [episodeOutlines] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(novelEpisodeOutlines)
      .where(eq(novelEpisodeOutlines.novelId, novelId));
    const [episodes] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(novelEpisodes)
      .where(eq(novelEpisodes.novelId, novelId));
    const [versions] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(novelScriptVersions)
      .where(eq(novelScriptVersions.novelId, novelId));
    return {
      chapters: chapters?.n ?? 0,
      characters: characters?.n ?? 0,
      chapter_outlines: chapterOutlines?.n ?? 0,
      episode_outlines: episodeOutlines?.n ?? 0,
      episodes: episodes?.n ?? 0,
      script_versions: versions?.n ?? 0,
    };
  }

  async patch(spaceId: string, ntId: string, input: NovelPatchRequest) {
    const novel = await this.requireNovel(spaceId, ntId);
    const values: Partial<typeof novels.$inferInsert> = { updatedAt: new Date() };
    if (input.title !== undefined) {
      const title = input.title.trim();
      const [dup] = await db
        .select({ id: novels.id })
        .from(novels)
        .where(
          and(eq(novels.spaceId, novel.spaceId), eq(novels.title, title), isNull(novels.archivedAt), sql`${novels.id} <> ${novel.id}`),
        );
      if (dup) {
        throw new AppError(ErrorCode.BAD_REQUEST, "novel title already exists", {
          reason: "duplicate_title",
          field: "title",
        });
      }
      values.title = title;
    }
    if (input.ratio !== undefined) values.ratio = input.ratio;
    if (input.meta !== undefined) values.meta = { ...this.meta(novel), ...input.meta };
    if (input.archived !== undefined) values.archivedAt = input.archived ? new Date() : null;
    const [row] = await db.update(novels).set(values).where(eq(novels.id, novel.id)).returning();
    return novelDto(row ?? novel);
  }

  /**
   * 删除 = 归档（软删）。
   *
   * 竞品 `delete` 是硬删且"不可恢复"（`novel.md:728-730`）。我方不硬删的原因：
   * 已经 finalize 的本子可能被制片工坊的剧集引用（§3.3 衔接契约），
   * 硬删会在 `episodes` 侧留下悬空来源。归档保留可追溯性，前端列表默认不展示。
   */
  async archive(spaceId: string, ntId: string) {
    const novel = await this.requireNovel(spaceId, ntId);
    if (novel.archivedAt) return { ok: true, archived: true, replayed: true, novel: novelDto(novel) };
    const [row] = await db
      .update(novels)
      .set({ archivedAt: new Date(), updatedAt: new Date() })
      .where(eq(novels.id, novel.id))
      .returning();
    return { ok: true, archived: true, replayed: false, novel: novelDto(row ?? novel) };
  }

  // ══════════════════════════════════════════════════════════════
  // 2. 分章解析（对照竞品 split 子链 / novel_chapters/list）
  // ══════════════════════════════════════════════════════════════

  async split(spaceId: string, ntId: string, input: NovelSplitRequest) {
    const novel = await this.requireNovel(spaceId, ntId);
    this.assertNotArchived(novel, "split");
    // 已定稿后重新分章会让"已确认的剧本"与章节对不上，必须先撤销定稿
    this.assertDraft(novel, "split");

    const override = (input.source_text ?? "").trim();
    if (override.length > NOVEL_LIMITS.SOURCE_TEXT_MAX) {
      throw new AppError(ErrorCode.SOURCE_TOO_LONG, "source text exceeds 50000 chars", { field: "source_text" });
    }
    const sourceText = override || this.sourceTextOf(novel);
    if (!sourceText.trim()) {
      throw new AppError(ErrorCode.INVALID_PARAM, "source text is empty", { field: "source_text" });
    }
    this.moderation.assertText(sourceText, "source_text");

    if (override) {
      await db
        .update(novels)
        .set({ meta: { ...this.meta(novel), source_text: sourceText }, updatedAt: new Date() })
        .where(eq(novels.id, novel.id));
    }
    const result = await this.splitIntoChapters(novel, sourceText, input.chapter_count);
    const chapters = await this.chaptersOf(novel.id);
    return { count: result.count, list: chapters.map(chapterSummaryDto), llm_mode: this.llm.mode };
  }

  private async splitIntoChapters(novel: NovelRow, sourceText: string, chapterCount?: number) {
    const chunks = this.splitChapters(sourceText, chapterCount);
    if (chunks.length === 0) {
      throw new AppError(ErrorCode.INVALID_PARAM, "source text produced no chapters", { field: "source_text" });
    }
    await db.transaction(async (tx) => {
      // 先删"多出来的尾巴"再 upsert：只删尾部是关键 ——
      // 若先全删再插，章节 id 会变，前端正在看的 chapter 详情会 404。
      await tx
        .delete(novelChapters)
        .where(and(eq(novelChapters.novelId, novel.id), gt(novelChapters.chapterNo, chunks.length)));
      await tx
        .insert(novelChapters)
        .values(
          chunks.map((chunk, i) => ({
            id: newId(),
            novelId: novel.id,
            chapterNo: i + 1,
            title: chunk.title,
            content: chunk.content,
            wordCount: this.wordCount(chunk.content),
          })),
        )
        .onConflictDoUpdate({
          target: [novelChapters.novelId, novelChapters.chapterNo],
          set: {
            title: sql`excluded.title`,
            content: sql`excluded.content`,
            wordCount: sql`excluded.word_count`,
            updatedAt: new Date(),
          },
        });
    });
    await this.touchNovel(novel.id);
    return { count: chunks.length };
  }

  async listChapters(spaceId: string, ntId: string, query: ChapterListQuery) {
    const novel = await this.requireNovel(spaceId, ntId);
    const where = eq(novelChapters.novelId, novel.id);
    const [rows, [counted]] = await Promise.all([
      db
        .select()
        .from(novelChapters)
        .where(where)
        .orderBy(asc(novelChapters.chapterNo))
        .limit(query.page_size)
        .offset((query.page - 1) * query.page_size),
      db.select({ total: sql<number>`count(*)::int` }).from(novelChapters).where(where),
    ]);
    return { list: rows.map(chapterSummaryDto), total: counted?.total ?? 0, page: query.page, page_size: query.page_size };
  }

  async getChapter(spaceId: string, ntId: string, chapterNo: number) {
    const novel = await this.requireNovel(spaceId, ntId);
    const [row] = await db
      .select()
      .from(novelChapters)
      .where(and(eq(novelChapters.novelId, novel.id), eq(novelChapters.chapterNo, chapterNo)));
    if (!row) throw new AppError(ErrorCode.NOT_FOUND, "chapter not found", { reason: "chapter_not_found" });
    return chapterDto(row);
  }

  // ══════════════════════════════════════════════════════════════
  // 3. 内容分析：世界观 + 角色卡（对照竞品 content-analysis 子链）
  // ══════════════════════════════════════════════════════════════

  /** 世界观 + 角色卡一次性生成（竞品 content-analysis 入口） */
  async analyze(spaceId: string, ntId: string, input: ContentAnalysisRequest) {
    const novel = await this.requireNovel(spaceId, ntId);
    this.assertNotArchived(novel, "content-analysis");
    this.assertDraft(novel, "content-analysis");
    const sourceText = await this.analysisText(novel);

    const [worldview, characters] = await Promise.all([
      this.llm.worldview({ title: novel.title, sourceText }),
      this.llm.characters({
        title: novel.title,
        sourceText,
        count: input.character_count ?? 6,
        existingNames: [],
      }),
    ]);
    const saved = await this.saveWorldview(novel.id, worldview);
    const cards = await this.saveCharacters(novel.id, characters.characters);
    return {
      worldview: saved,
      characters: cards,
      llm_mode: this.llm.mode,
      detail: "内容分析完成：世界观已落库，角色卡已按名字合并（重复分析不会产生重复卡）。",
    };
  }

  /** 内容分析结果详情（世界观 + 角色卡 + 进度计数） */
  async analysisDetail(spaceId: string, ntId: string) {
    const novel = await this.requireNovel(spaceId, ntId);
    const [worldview] = await db.select().from(novelWorldviews).where(eq(novelWorldviews.novelId, novel.id));
    const cards = await db
      .select()
      .from(novelCharacters)
      .where(eq(novelCharacters.novelId, novel.id))
      .orderBy(asc(novelCharacters.roleType), asc(novelCharacters.createdAt));
    return {
      worldview: worldview ? worldviewDto(worldview) : null,
      characters: cards.map(characterDto),
      counts: await this.countsOf(novel.id),
      llm_mode: this.llm.mode,
    };
  }

  async analysisText(novel: NovelRow): Promise<string> {
    const chapters = await this.chaptersOf(novel.id);
    if (chapters.length > 0) {
      // 只取前若干章：世界观/角色抽取不需要全书，超长上下文反而降低结构稳定性
      return chapters
        .slice(0, 20)
        .map((c) => `【${c.title}】\n${c.content}`)
        .join("\n\n")
        .slice(0, 20_000);
    }
    const source = this.sourceTextOf(novel);
    if (!source.trim()) {
      throw new AppError(ErrorCode.INVALID_PARAM, "no source text or chapters to analyze", {
        reason: "source_empty",
        hint: "先 POST /novel/:nt/split 或创建时带 source_text",
      });
    }
    return source.slice(0, 20_000);
  }

  private async saveWorldview(novelId: bigint, worldview: WorldviewResult) {
    const settings = {
      era: worldview.era,
      geography: worldview.geography,
      factions: worldview.factions,
      rules: worldview.rules,
      relations: worldview.relations,
    };
    const [row] = await db
      .insert(novelWorldviews)
      .values({ id: newId(), novelId, summary: worldview.summary, settings })
      .onConflictDoUpdate({
        target: novelWorldviews.novelId,
        set: { summary: sql`excluded.summary`, settings: sql`excluded.settings`, updatedAt: new Date() },
      })
      .returning();
    return worldviewDto(row!);
  }

  /** 按名字合并角色卡（同名更新、新名插入），保证重复生成不产生重复卡 */
  private async saveCharacters(
    novelId: bigint,
    items: Array<{
      name: string;
      role_type: number;
      description: string;
      appearance: string;
      personality: string;
      prompt: string;
      is_core: boolean;
    }>,
  ) {
    const existing = await db.select().from(novelCharacters).where(eq(novelCharacters.novelId, novelId));
    const byName = new Map(existing.map((row) => [row.name, row]));
    const out: Array<ReturnType<typeof characterDto>> = [];
    for (const item of items) {
      const hit = byName.get(item.name);
      if (hit) {
        const [row] = await db
          .update(novelCharacters)
          .set({
            roleType: item.role_type,
            description: item.description,
            appearance: item.appearance,
            personality: item.personality,
            prompt: item.prompt,
            // 用户手工标过的核心角色不被重新生成冲掉（is_core 是人工决定，不是模型决定）
            isCore: hit.isCore || item.is_core,
            updatedAt: new Date(),
          })
          .where(eq(novelCharacters.id, hit.id))
          .returning();
        out.push(characterDto(row!));
      } else {
        const [row] = await db
          .insert(novelCharacters)
          .values({
            id: newId(),
            novelId,
            name: item.name,
            roleType: item.role_type,
            description: item.description,
            appearance: item.appearance,
            personality: item.personality,
            prompt: item.prompt,
            isCore: item.is_core,
          })
          .returning();
        out.push(characterDto(row!));
      }
    }
    await this.touchNovel(novelId);
    return out;
  }

  /** 单独重生成角色卡（不动世界观） */
  async generateCharacters(spaceId: string, ntId: string, input: CharactersGenerateRequest) {
    const novel = await this.requireNovel(spaceId, ntId);
    this.assertDraft(novel, "characters/generate");
    const sourceText = await this.analysisText(novel);
    const existing = await db.select().from(novelCharacters).where(eq(novelCharacters.novelId, novel.id));
    const generated = await this.llm.characters({
      title: novel.title,
      sourceText,
      count: input.count,
      existingNames: existing.map((row) => row.name),
    });
    const cards = await this.saveCharacters(novel.id, generated.characters);
    return { characters: cards, llm_mode: this.llm.mode };
  }

  async getWorldview(spaceId: string, ntId: string) {
    const novel = await this.requireNovel(spaceId, ntId);
    const [row] = await db.select().from(novelWorldviews).where(eq(novelWorldviews.novelId, novel.id));
    return { worldview: row ? worldviewDto(row) : null };
  }

  /** 世界观覆盖写（LLM 结果与人工编辑共用同一形状，见 shared 的 worldviewPutSchema） */
  async putWorldview(spaceId: string, ntId: string, input: WorldviewPutRequest) {
    const novel = await this.requireNovel(spaceId, ntId);
    this.assertDraft(novel, "worldview");
    const saved = await this.saveWorldview(novel.id, input);
    return { worldview: saved, llm_mode: this.llm.mode };
  }

  /** 新建/覆盖单张角色卡（同名即覆盖 —— 这就是幂等点，见方法注释） */
  async createCharacter(spaceId: string, ntId: string, input: NovelCharacterCreateRequest) {
    const novel = await this.requireNovel(spaceId, ntId);
    this.assertDraft(novel, "characters");
    const [existing] = await db
      .select()
      .from(novelCharacters)
      .where(and(eq(novelCharacters.novelId, novel.id), eq(novelCharacters.name, input.name.trim())));
    if (existing) {
      const [row] = await db
        .update(novelCharacters)
        .set({
          roleType: input.role_type,
          description: input.description,
          appearance: input.appearance,
          personality: input.personality,
          prompt: input.prompt,
          isCore: input.is_core || existing.isCore,
          updatedAt: new Date(),
        })
        .where(eq(novelCharacters.id, existing.id))
        .returning();
      return { character: characterDto(row!), replayed: true };
    }
    const [row] = await db
      .insert(novelCharacters)
      .values({
        id: newId(),
        novelId: novel.id,
        name: input.name.trim(),
        roleType: input.role_type,
        description: input.description,
        appearance: input.appearance,
        personality: input.personality,
        prompt: input.prompt,
        isCore: input.is_core,
      })
      .returning();
    await this.touchNovel(novel.id);
    return { character: characterDto(row!), replayed: false };
  }

  async patchCharacter(spaceId: string, ntId: string, nccId: string, input: NovelCharacterPatchRequest) {
    const novel = await this.requireNovel(spaceId, ntId);
    this.assertDraft(novel, "characters/patch");
    const row = await this.findCharacter(novel.id, nccId);
    const values: Partial<typeof novelCharacters.$inferInsert> = { updatedAt: new Date() };
    if (input.name !== undefined) values.name = input.name.trim();
    if (input.role_type !== undefined) values.roleType = input.role_type;
    if (input.description !== undefined) values.description = input.description ?? "";
    if (input.appearance !== undefined) values.appearance = input.appearance ?? "";
    if (input.personality !== undefined) values.personality = input.personality ?? "";
    if (input.prompt !== undefined) values.prompt = input.prompt ?? "";
    if (input.is_core !== undefined) values.isCore = input.is_core;
    const [updated] = await db.update(novelCharacters).set(values).where(eq(novelCharacters.id, row.id)).returning();
    await this.touchNovel(novel.id);
    return characterDto(updated!);
  }

  async deleteCharacter(spaceId: string, ntId: string, nccId: string) {
    const novel = await this.requireNovel(spaceId, ntId);
    this.assertDraft(novel, "characters/delete");
    const row = await this.findCharacter(novel.id, nccId);
    await db.delete(novelCharacters).where(eq(novelCharacters.id, row.id));
    return { ok: true, deleted: String(row.id) };
  }

  /** 批量确认 LLM 草稿（overwrite=false 时同名跳过，避免冲掉用户手改过的卡） */
  async confirmCharacters(spaceId: string, ntId: string, input: NovelCharactersConfirmRequest) {
    const novel = await this.requireNovel(spaceId, ntId);
    this.assertDraft(novel, "characters/confirm");
    const existing = await db.select().from(novelCharacters).where(eq(novelCharacters.novelId, novel.id));
    const byName = new Map(existing.map((row) => [row.name, row]));
    let created = 0;
    let updated = 0;
    let skipped = 0;
    for (const item of input.characters) {
      const hit = byName.get(item.name);
      if (hit && !input.overwrite) {
        skipped += 1;
        continue;
      }
      if (hit) {
        await db
          .update(novelCharacters)
          .set({
            roleType: item.role_type,
            description: item.description,
            appearance: item.appearance,
            personality: item.personality,
            prompt: item.prompt,
            isCore: hit.isCore || item.is_core,
            updatedAt: new Date(),
          })
          .where(eq(novelCharacters.id, hit.id));
        updated += 1;
      } else {
        await db.insert(novelCharacters).values({
          id: newId(),
          novelId: novel.id,
          name: item.name,
          roleType: item.role_type,
          description: item.description,
          appearance: item.appearance,
          personality: item.personality,
          prompt: item.prompt,
          isCore: item.is_core,
        });
        created += 1;
      }
    }
    await this.touchNovel(novel.id);
    const cards = await db
      .select()
      .from(novelCharacters)
      .where(eq(novelCharacters.novelId, novel.id))
      .orderBy(asc(novelCharacters.roleType), asc(novelCharacters.createdAt));
    return { created, updated, skipped, characters: cards.map(characterDto) };
  }

  private async findCharacter(novelId: bigint, nccId: string): Promise<NovelCharacterRow> {
    const id = this.toBigId(nccId, "ncc_id");
    const [row] = await db
      .select()
      .from(novelCharacters)
      .where(and(eq(novelCharacters.id, id), eq(novelCharacters.novelId, novelId)));
    if (!row) throw new AppError(ErrorCode.NOT_FOUND, "character not found", { reason: "character_not_found" });
    return row;
  }

  // ══════════════════════════════════════════════════════════════
  // 4. 章节大纲（对照竞品 chapter_outline 子链 / nco_id）
  // ══════════════════════════════════════════════════════════════

  async generateChapterOutlines(spaceId: string, ntId: string, input: ChapterOutlineGenerateRequest) {
    const novel = await this.requireNovel(spaceId, ntId);
    this.assertDraft(novel, "chapter_outline/generate");
    const chapters = await this.chaptersOf(novel.id);
    if (chapters.length === 0) {
      throw new AppError(ErrorCode.INVALID_PARAM, "no chapters; split the novel first", { reason: "chapters_empty" });
    }
    const [worldview] = await db.select().from(novelWorldviews).where(eq(novelWorldviews.novelId, novel.id));
    const result = await this.llm.chapterOutlines({
      title: novel.title,
      chapters: chapters.map((c) => ({ chapterNo: c.chapterNo, title: c.title, content: c.content })),
      worldviewSummary: worldview?.summary ?? "",
    });
    const rows = await this.replaceChapterOutlines(novel.id, result.chapters.map((c, i) => ({
      chapterNo: c.chapter_no,
      title: c.title,
      synopsis: c.synopsis,
      sort: i,
    })));
    return { list: rows, count: rows.length, llm_mode: this.llm.mode, instructions: input.instructions ?? "" };
  }

  async listChapterOutlines(spaceId: string, ntId: string) {
    const novel = await this.requireNovel(spaceId, ntId);
    const rows = await db
      .select()
      .from(novelChapterOutlines)
      .where(eq(novelChapterOutlines.novelId, novel.id))
      .orderBy(asc(novelChapterOutlines.chapterNo));
    return { list: rows.map(chapterOutlineDto), total: rows.length };
  }

  /** 整体替换（LLM 结果确认 / 用户批量编辑都走这里） */
  async replaceChapterOutlines(
    novelId: bigint,
    items: Array<{ chapterNo: number; title: string; synopsis: string; sort?: number }>,
  ) {
    const rows = await db.transaction(async (tx) => {
      const nos = items.map((item) => item.chapterNo).filter((no) => Number.isInteger(no));
      if (nos.length > 0) {
        await tx
          .delete(novelChapterOutlines)
          .where(and(eq(novelChapterOutlines.novelId, novelId), notInArray(novelChapterOutlines.chapterNo, nos)));
      } else {
        await tx.delete(novelChapterOutlines).where(eq(novelChapterOutlines.novelId, novelId));
      }
      await tx
        .insert(novelChapterOutlines)
        .values(
          items.map((item) => ({
            id: newId(),
            novelId,
            chapterNo: item.chapterNo,
            title: item.title,
            synopsis: item.synopsis,
            sort: item.sort ?? item.chapterNo - 1,
          })),
        )
        .onConflictDoUpdate({
          target: [novelChapterOutlines.novelId, novelChapterOutlines.chapterNo],
          set: {
            title: sql`excluded.title`,
            synopsis: sql`excluded.synopsis`,
            sort: sql`excluded.sort`,
            updatedAt: new Date(),
          },
        });
      return tx
        .select()
        .from(novelChapterOutlines)
        .where(eq(novelChapterOutlines.novelId, novelId))
        .orderBy(asc(novelChapterOutlines.chapterNo));
    });
    await this.touchNovel(novelId);
    return rows.map(chapterOutlineDto);
  }

  async putChapterOutlines(spaceId: string, ntId: string, input: ChapterOutlinesPutRequest) {
    const novel = await this.requireNovel(spaceId, ntId);
    this.assertDraft(novel, "chapter_outline/put");
    const rows = await this.replaceChapterOutlines(
      novel.id,
      input.chapters.map((c, i) => ({ chapterNo: c.chapter_no, title: c.title, synopsis: c.synopsis, sort: i })),
    );
    return { list: rows, count: rows.length };
  }

  async patchChapterOutline(spaceId: string, ntId: string, ncoId: string, input: OutlinePatch) {
    const novel = await this.requireNovel(spaceId, ntId);
    this.assertDraft(novel, "chapter_outline/patch");
    const id = this.toBigId(ncoId, "nco_id");
    const [row] = await db
      .select()
      .from(novelChapterOutlines)
      .where(and(eq(novelChapterOutlines.id, id), eq(novelChapterOutlines.novelId, novel.id)));
    if (!row) throw new AppError(ErrorCode.NOT_FOUND, "chapter outline not found", { reason: "nco_not_found" });
    const [updated] = await db
      .update(novelChapterOutlines)
      .set({
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.synopsis !== undefined ? { synopsis: input.synopsis } : {}),
        updatedAt: new Date(),
      })
      .where(eq(novelChapterOutlines.id, row.id))
      .returning();
    await this.touchNovel(novel.id);
    return chapterOutlineDto(updated!);
  }

  // ══════════════════════════════════════════════════════════════
  // 5. 分集大纲（对照竞品 episode_outline 子链 / neo_id）
  // ══════════════════════════════════════════════════════════════

  async generateEpisodeOutlines(spaceId: string, ntId: string, input: EpisodeOutlineGenerateRequest) {
    const novel = await this.requireNovel(spaceId, ntId);
    this.assertDraft(novel, "episode_outline/generate");
    const chapterOutlines = await db
      .select()
      .from(novelChapterOutlines)
      .where(eq(novelChapterOutlines.novelId, novel.id))
      .orderBy(asc(novelChapterOutlines.chapterNo));
    const chapters = chapterOutlines.length > 0 ? [] : await this.chaptersOf(novel.id);
    if (chapterOutlines.length === 0 && chapters.length === 0) {
      throw new AppError(ErrorCode.INVALID_PARAM, "no chapter outline or chapters to adapt", {
        reason: "chapters_empty",
      });
    }
    const wanted = input.episode_count ?? (novel.episodeCount > 0 ? novel.episodeCount : 0);
    const fallbackCount = Math.max(1, Math.ceil((chapterOutlines.length || chapters.length) / 2));
    const episodeCount = Math.min(wanted > 0 ? wanted : fallbackCount, NOVEL_LIMITS.EPISODE_MAX);

    const [worldview] = await db.select().from(novelWorldviews).where(eq(novelWorldviews.novelId, novel.id));
    const result = await this.llm.episodeOutlines({
      title: novel.title,
      episodeCount,
      chapterOutlines:
        chapterOutlines.length > 0
          ? chapterOutlines.map((c) => ({ chapterNo: c.chapterNo, title: c.title, synopsis: c.synopsis }))
          : chapters.map((c) => ({
              chapterNo: c.chapterNo,
              title: c.title,
              synopsis: c.content.slice(0, 120) || c.title,
            })),
      worldviewSummary: worldview?.summary ?? "",
      instructions: input.instructions,
    });
    const rows = await this.replaceEpisodeOutlines(
      novel.id,
      result.episodes.map((e, i) => ({ episodeNo: e.episode_no, title: e.title, synopsis: e.synopsis, sort: i })),
    );
    await this.touchNovel(novel.id, { episodeCount: rows.length });
    return { list: rows, count: rows.length, llm_mode: this.llm.mode };
  }

  async listEpisodeOutlines(spaceId: string, ntId: string) {
    const novel = await this.requireNovel(spaceId, ntId);
    const rows = await db
      .select()
      .from(novelEpisodeOutlines)
      .where(eq(novelEpisodeOutlines.novelId, novel.id))
      .orderBy(asc(novelEpisodeOutlines.episodeNo));
    return { list: rows.map(episodeOutlineDto), total: rows.length };
  }

  async replaceEpisodeOutlines(
    novelId: bigint,
    items: Array<{ episodeNo: number; title: string; synopsis: string; sort?: number }>,
  ) {
    const rows = await db.transaction(async (tx) => {
      const nos = items.map((item) => item.episodeNo).filter((no) => Number.isInteger(no));
      if (nos.length > 0) {
        await tx
          .delete(novelEpisodeOutlines)
          .where(and(eq(novelEpisodeOutlines.novelId, novelId), notInArray(novelEpisodeOutlines.episodeNo, nos)));
      } else {
        await tx.delete(novelEpisodeOutlines).where(eq(novelEpisodeOutlines.novelId, novelId));
      }
      await tx
        .insert(novelEpisodeOutlines)
        .values(
          items.map((item) => ({
            id: newId(),
            novelId,
            episodeNo: item.episodeNo,
            title: item.title,
            synopsis: item.synopsis,
            sort: item.sort ?? item.episodeNo - 1,
          })),
        )
        .onConflictDoUpdate({
          target: [novelEpisodeOutlines.novelId, novelEpisodeOutlines.episodeNo],
          set: {
            title: sql`excluded.title`,
            synopsis: sql`excluded.synopsis`,
            sort: sql`excluded.sort`,
            updatedAt: new Date(),
          },
        });
      return tx
        .select()
        .from(novelEpisodeOutlines)
        .where(eq(novelEpisodeOutlines.novelId, novelId))
        .orderBy(asc(novelEpisodeOutlines.episodeNo));
    });
    await this.touchNovel(novelId);
    return rows.map(episodeOutlineDto);
  }

  async putEpisodeOutlines(spaceId: string, ntId: string, input: EpisodeOutlinesPutRequest) {
    const novel = await this.requireNovel(spaceId, ntId);
    this.assertDraft(novel, "episode_outline/put");
    const rows = await this.replaceEpisodeOutlines(
      novel.id,
      input.episodes.map((e, i) => ({ episodeNo: e.episode_no, title: e.title, synopsis: e.synopsis, sort: i })),
    );
    await this.touchNovel(novel.id, { episodeCount: rows.length });
    return { list: rows, count: rows.length };
  }

  async patchEpisodeOutline(spaceId: string, ntId: string, neoId: string, input: OutlinePatch) {
    const novel = await this.requireNovel(spaceId, ntId);
    this.assertDraft(novel, "episode_outline/patch");
    const id = this.toBigId(neoId, "neo_id");
    const [row] = await db
      .select()
      .from(novelEpisodeOutlines)
      .where(and(eq(novelEpisodeOutlines.id, id), eq(novelEpisodeOutlines.novelId, novel.id)));
    if (!row) throw new AppError(ErrorCode.NOT_FOUND, "episode outline not found", { reason: "neo_not_found" });
    const [updated] = await db
      .update(novelEpisodeOutlines)
      .set({
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.synopsis !== undefined ? { synopsis: input.synopsis } : {}),
        updatedAt: new Date(),
      })
      .where(eq(novelEpisodeOutlines.id, row.id))
      .returning();
    await this.touchNovel(novel.id);
    return episodeOutlineDto(updated!);
  }

  // ══════════════════════════════════════════════════════════════
  // 6. 核心角色（对照竞品 core_character 子链）
  // ══════════════════════════════════════════════════════════════

  /**
   * 核心角色生成。
   *
   * 竞品的 core_character 是"从角色卡里挑出要用于资产一致性的那几张"（`routes.txt:523-525`）。
   * 故这里的语义是**标记**而不是**新建一族角色**：已有角色卡够用就在其中挑（按 role_type
   * 主角优先，其次出现顺序），不够才让 LLM 补生成。这样"核心角色"永远指向同一批
   * `novel_characters` 行，下游（资产/subject）不会因为两次生成拿到两套 id。
   */
  async generateCoreCharacters(spaceId: string, ntId: string, input: CoreCharacterGenerateRequest) {
    const novel = await this.requireNovel(spaceId, ntId);
    this.assertDraft(novel, "core_character/generate");
    const wanted = input.count;
    let all = await db
      .select()
      .from(novelCharacters)
      .where(eq(novelCharacters.novelId, novel.id))
      .orderBy(asc(novelCharacters.roleType), asc(novelCharacters.createdAt));

    if (all.length < wanted) {
      const sourceText = await this.analysisText(novel);
      const generated = await this.llm.characters({
        title: novel.title,
        sourceText,
        count: wanted,
        existingNames: all.map((row) => row.name),
      });
      await this.saveCharacters(novel.id, generated.characters);
      all = await db
        .select()
        .from(novelCharacters)
        .where(eq(novelCharacters.novelId, novel.id))
        .orderBy(asc(novelCharacters.roleType), asc(novelCharacters.createdAt));
    }

    const chosen = all.slice(0, Math.max(1, Math.min(wanted, all.length)));
    const chosenIds = chosen.map((row) => row.id);
    await db
      .update(novelCharacters)
      .set({ isCore: true, updatedAt: new Date() })
      .where(and(eq(novelCharacters.novelId, novel.id), inArray(novelCharacters.id, chosenIds)));
    const rows = await db
      .select()
      .from(novelCharacters)
      .where(and(eq(novelCharacters.novelId, novel.id), eq(novelCharacters.isCore, true)))
      .orderBy(asc(novelCharacters.roleType), asc(novelCharacters.createdAt));
    await this.touchNovel(novel.id);
    return {
      list: rows.map(characterDto),
      count: rows.length,
      llm_mode: this.llm.mode,
      instructions: input.instructions ?? "",
    };
  }

  async listCoreCharacters(spaceId: string, ntId: string) {
    const novel = await this.requireNovel(spaceId, ntId);
    const rows = await db
      .select()
      .from(novelCharacters)
      .where(and(eq(novelCharacters.novelId, novel.id), eq(novelCharacters.isCore, true)))
      .orderBy(asc(novelCharacters.roleType), asc(novelCharacters.createdAt));
    return { list: rows.map(characterDto), total: rows.length };
  }

  async createCoreCharacter(spaceId: string, ntId: string, input: NovelCharacterCreateRequest) {
    const result = await this.createCharacter(spaceId, ntId, { ...input, is_core: true });
    return result;
  }

  async patchCoreCharacter(spaceId: string, ntId: string, nccId: string, input: NovelCharacterPatchRequest) {
    return this.patchCharacter(spaceId, ntId, nccId, input);
  }

  // ══════════════════════════════════════════════════════════════
  // 7. 分集剧本生成（对照竞品 script-generate + episode/list）
  // ══════════════════════════════════════════════════════════════

  async generateScripts(spaceId: string, ntId: string, userId: string, input: NovelScriptGenerateRequest) {
    const novel = await this.requireNovel(spaceId, ntId);
    this.assertDraft(novel, "script-generate");
    const outlines = await db
      .select()
      .from(novelEpisodeOutlines)
      .where(eq(novelEpisodeOutlines.novelId, novel.id))
      .orderBy(asc(novelEpisodeOutlines.episodeNo));
    if (outlines.length === 0) {
      throw new AppError(ErrorCode.INVALID_PARAM, "no episode outline; generate episode outline first", {
        reason: "episode_outline_empty",
      });
    }
    const known = new Set(outlines.map((row) => row.episodeNo));
    const requested = input.episode_nos ?? outlines.map((row) => row.episodeNo);
    const unknown = requested.filter((no) => !known.has(no));
    if (unknown.length > 0) {
      // 指定了不存在的集号 = 客户端与服务端大纲不同步，必须报错而不是静默跳过
      throw new AppError(ErrorCode.INVALID_PARAM, "episode_no not in outline", {
        field: "episode_nos",
        unknown,
      });
    }
    const targets = outlines.filter((row) => requested.includes(row.episodeNo));
    const result = await this.llm.scripts({
      title: novel.title,
      episodes: targets.map((row) => ({ episodeNo: row.episodeNo, title: row.title, synopsis: row.synopsis })),
      instructions: input.instructions,
    });
    const written = await db.transaction(async (tx) => {
      const output: NovelEpisodeRow[] = [];
      for (const item of result.episodes) {
        const row = await this.writeEpisodeText(tx, novel.id, item.episode_no, item.title, item.script_text, {
          status: 1,
          createdBy: BigInt(userId),
        });
        output.push(row);
      }
      return output;
    });
    await this.touchNovel(novel.id);
    return {
      list: written.map(episodeDto),
      count: written.length,
      llm_mode: this.llm.mode,
      // 只生成了指定集时明确回显"还差哪些"，避免前端以为整本好了
      missing: outlines.filter((row) => !result.episodes.some((e) => e.episode_no === row.episodeNo)).map((row) => row.episodeNo),
    };
  }

  /**
   * 写入一集的正文 + 同步一条版本记录。
   *
   * 不变式：`novel_episodes.version == 该集在 novel_script_versions 里的最大 version_no`。
   * 所有改正文的路径（生成 / 编辑 Agent apply / 手工 PATCH）都必须走这里，
   * 否则"版本号"会退化成"改了几次"这种无法与版本表对齐的计数。
   */
  async writeEpisodeText(
    tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
    novelId: bigint,
    episodeNo: number,
    title: string,
    scriptText: string,
    opts: { status?: number; createdBy?: bigint | null } = {},
  ): Promise<NovelEpisodeRow> {
    const [existing] = await tx
      .select()
      .from(novelEpisodes)
      .where(and(eq(novelEpisodes.novelId, novelId), eq(novelEpisodes.episodeNo, episodeNo)));
    let row: NovelEpisodeRow;
    let versionNo: number;
    if (existing) {
      versionNo = existing.version + 1;
      const [updated] = await tx
        .update(novelEpisodes)
        .set({
          title,
          scriptText,
          status: opts.status ?? existing.status,
          version: versionNo,
          updatedAt: new Date(),
        })
        .where(eq(novelEpisodes.id, existing.id))
        .returning();
      row = updated!;
    } else {
      versionNo = 1;
      const [inserted] = await tx
        .insert(novelEpisodes)
        .values({
          id: newId(),
          novelId,
          episodeNo,
          title,
          scriptText,
          status: opts.status ?? 1,
          version: versionNo,
        })
        .returning();
      row = inserted!;
    }
    await tx.insert(novelScriptVersions).values({
      id: newId(),
      novelId,
      episodeId: row.id,
      versionNo,
      scriptText,
      createdBy: opts.createdBy ?? null,
    });
    return row;
  }

  async listEpisodes(spaceId: string, ntId: string) {
    const novel = await this.requireNovel(spaceId, ntId);
    const rows = await db
      .select()
      .from(novelEpisodes)
      .where(eq(novelEpisodes.novelId, novel.id))
      .orderBy(asc(novelEpisodes.episodeNo));
    return { list: rows.map(episodeSummaryDto), total: rows.length };
  }

  async getEpisode(spaceId: string, ntId: string, neId: string) {
    const novel = await this.requireNovel(spaceId, ntId);
    return episodeDto(await this.findEpisode(novel.id, neId));
  }

  async findEpisode(novelId: bigint, neId: string): Promise<NovelEpisodeRow> {
    const id = this.toBigId(neId, "ne_id");
    const [row] = await db
      .select()
      .from(novelEpisodes)
      .where(and(eq(novelEpisodes.id, id), eq(novelEpisodes.novelId, novelId)));
    if (!row) throw new AppError(ErrorCode.NOT_FOUND, "episode not found", { reason: "episode_not_found" });
    return row;
  }

  async patchEpisode(spaceId: string, ntId: string, neId: string, input: NovelEpisodePatchRequest) {
    const novel = await this.requireNovel(spaceId, ntId);
    this.assertDraft(novel, "episode/patch");
    const episode = await this.findEpisode(novel.id, neId);
    const row = await db.transaction(async (tx) => {
      if (input.script_text !== undefined && input.script_text !== episode.scriptText) {
        // 改正文 = 产生新版本（人工编辑同样要留痕，否则"回滚到上一稿"无处可取）
        return this.writeEpisodeText(
          tx,
          novel.id,
          episode.episodeNo,
          input.title ?? episode.title,
          input.script_text,
          { status: input.status ?? 1 },
        );
      }
      const [updated] = await tx
        .update(novelEpisodes)
        .set({
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
          updatedAt: new Date(),
        })
        .where(eq(novelEpisodes.id, episode.id))
        .returning();
      return updated!;
    });
    await this.touchNovel(novel.id);
    return episodeDto(row);
  }

  /** 确认单集（status=2）。已确认再确认 = 幂等，返回 replayed */
  async confirmEpisode(spaceId: string, ntId: string, neId: string) {
    const novel = await this.requireNovel(spaceId, ntId);
    this.assertDraft(novel, "episode/confirm");
    const episode = await this.findEpisode(novel.id, neId);
    if (episode.status === 2) return { episode: episodeDto(episode), replayed: true };
    const [row] = await db
      .update(novelEpisodes)
      .set({ status: 2, updatedAt: new Date() })
      .where(eq(novelEpisodes.id, episode.id))
      .returning();
    return { episode: episodeDto(row!), replayed: false };
  }

  // ══════════════════════════════════════════════════════════════
  // 8. 汇总 / 定稿 / 版本（对照竞品 summary、finalize、version）
  // ══════════════════════════════════════════════════════════════

  /** 工作台步进器数据源：每步做了没有、还差什么 */
  async summary(spaceId: string, ntId: string) {
    const novel = await this.requireNovel(spaceId, ntId);
    const counts = await this.countsOf(novel.id);
    const step = (done: boolean, seed: string, todo: string) => ({ done, hint: done ? seed : todo });
    return {
      novel: novelDto(novel),
      counts,
      llm_mode: this.llm.mode,
      steps: {
        split: step(counts.chapters > 0, `${counts.chapters} 章已解析`, "粘贴或上传小说后自动分章"),
        content_analysis: step(
          counts.characters > 0,
          `${counts.characters} 张角色卡`,
          "生成世界观与角色卡（内容分析）",
        ),
        chapter_outline: step(counts.chapter_outlines > 0, `${counts.chapter_outlines} 条章纲`, "生成章节大纲"),
        episode_outline: step(counts.episode_outlines > 0, `${counts.episode_outlines} 集大纲`, "生成分集大纲"),
        core_character: step(
          counts.characters > 0,
          "核心角色已标记",
          "生成/标记核心角色（用于资产一致性）",
        ),
        script: step(counts.episodes > 0, `${counts.episodes} 集剧本`, "生成分集剧本"),
        finalize: step(novel.status === NovelStatus.FINALIZED, "已定稿（可作为拆集源）", "定稿后才能进制片工坊"),
      },
      finalized: novel.status === NovelStatus.FINALIZED,
    };
  }

  /**
   * 整本定稿 → `status=16`。
   *
   * 这是 §3.3 衔接契约的唯一入口：只有 16 的本子才允许作为
   * `POST /projects/:id/episodes/split` 的 source（否则 400）。
   * 重复定稿 = 幂等成功（`replayed: true`），不再造一遍快照 ——
   * 否则前端刷新后重试会把版本表刷成一堆同内容的整本快照。
   */
  async finalize(spaceId: string, ntId: string, input: NovelFinalizeRequest, userId: string) {
    const novel = await this.requireNovel(spaceId, ntId);
    this.assertNotArchived(novel, "finalize");
    if (novel.status === NovelStatus.FINALIZED) {
      return {
        ok: true,
        replayed: true,
        status: NovelStatus.FINALIZED,
        novel: novelDto(novel),
        snapshot_version_id: null as string | null,
      };
    }
    const episodes = await db
      .select()
      .from(novelEpisodes)
      .where(eq(novelEpisodes.novelId, novel.id))
      .orderBy(asc(novelEpisodes.episodeNo));
    if (episodes.length === 0) {
      throw new AppError(ErrorCode.INVALID_PARAM, "no episodes to finalize", { reason: "episodes_empty" });
    }

    const snapshotVersionId = await db.transaction(async (tx) => {
      let snapshotId: string | null = null;
      if (input.snapshot_episodes) {
        // 每集一份快照（finalized_at 非空 = 这一稿是定稿依据）
        for (const episode of episodes) {
          const versionNo = episode.version + 1;
          await tx.insert(novelScriptVersions).values({
            id: newId(),
            novelId: novel.id,
            episodeId: episode.id,
            versionNo,
            scriptText: episode.scriptText,
            finalizedAt: new Date(),
            createdBy: BigInt(userId),
          });
          await tx
            .update(novelEpisodes)
            .set({ version: versionNo, status: 2, updatedAt: new Date() })
            .where(eq(novelEpisodes.id, episode.id));
        }
      }
      // 整本快照：episode_id 为 NULL，靠部分唯一索引 (novel_id, version_no) WHERE episode_id IS NULL 锁住
      const [maxRow] = await tx
        .select({ max: sql<number>`coalesce(max(${novelScriptVersions.versionNo}), 0)::int` })
        .from(novelScriptVersions)
        .where(and(eq(novelScriptVersions.novelId, novel.id), isNull(novelScriptVersions.episodeId)));
      const wholeNo = (maxRow?.max ?? 0) + 1;
      const [snapshot] = await tx
        .insert(novelScriptVersions)
        .values({
          id: newId(),
          novelId: novel.id,
          episodeId: null,
          versionNo: wholeNo,
          scriptText: episodes
            .map((episode) => `【第${episode.episodeNo}集 ${episode.title}】\n${episode.scriptText}`)
            .join("\n\n"),
          finalizedAt: new Date(),
          createdBy: BigInt(userId),
        })
        .returning();
      snapshotId = String(snapshot!.id);
      await tx
        .update(novels)
        .set({ status: NovelStatus.FINALIZED, meta: { ...this.meta(novel), finalize_memo: input.memo ?? "" }, updatedAt: new Date() })
        .where(eq(novels.id, novel.id));
      return snapshotId;
    });

    const [fresh] = await db.select().from(novels).where(eq(novels.id, novel.id));
    return {
      ok: true,
      replayed: false,
      status: NovelStatus.FINALIZED,
      novel: novelDto(fresh!),
      snapshot_version_id: snapshotVersionId,
    };
  }

  async listVersions(spaceId: string, ntId: string, query: ListQuery) {
    const novel = await this.requireNovel(spaceId, ntId);
    const where = eq(novelScriptVersions.novelId, novel.id);
    const [rows, [counted]] = await Promise.all([
      db
        .select()
        .from(novelScriptVersions)
        .where(where)
        .orderBy(desc(novelScriptVersions.createdAt), desc(novelScriptVersions.versionNo))
        .limit(query.page_size)
        .offset((query.page - 1) * query.page_size),
      db.select({ total: sql<number>`count(*)::int` }).from(novelScriptVersions).where(where),
    ]);
    return { list: rows.map(scriptVersionDto), total: counted?.total ?? 0, page: query.page, page_size: query.page_size };
  }

  /** 版本定稿（单集/整本版本行打 finalized_at；重复定稿幂等） */
  async finalizeVersion(spaceId: string, ntId: string, vid: string) {
    const novel = await this.requireNovel(spaceId, ntId);
    const id = this.toBigId(vid, "vid");
    const [row] = await db
      .select()
      .from(novelScriptVersions)
      .where(and(eq(novelScriptVersions.id, id), eq(novelScriptVersions.novelId, novel.id)));
    if (!row) throw new AppError(ErrorCode.NOT_FOUND, "version not found", { reason: "version_not_found" });
    if (row.finalizedAt) return { version: scriptVersionDto(row), replayed: true };
    const [updated] = await db
      .update(novelScriptVersions)
      .set({ finalizedAt: new Date(), updatedAt: new Date() })
      .where(eq(novelScriptVersions.id, row.id))
      .returning();
    return { version: scriptVersionDto(updated!), replayed: false };
  }

  /** 删除版本（删完要重算该集 version，维持 "version == max(version_no)" 不变式） */
  async deleteVersion(spaceId: string, ntId: string, vid: string) {
    const novel = await this.requireNovel(spaceId, ntId);
    const id = this.toBigId(vid, "vid");
    const [row] = await db
      .select()
      .from(novelScriptVersions)
      .where(and(eq(novelScriptVersions.id, id), eq(novelScriptVersions.novelId, novel.id)));
    if (!row) throw new AppError(ErrorCode.NOT_FOUND, "version not found", { reason: "version_not_found" });
    await db.transaction(async (tx) => {
      await tx.delete(novelScriptVersions).where(eq(novelScriptVersions.id, row.id));
      if (row.episodeId !== null) {
        const [maxRow] = await tx
          .select({ max: sql<number>`coalesce(max(${novelScriptVersions.versionNo}), 0)::int` })
          .from(novelScriptVersions)
          .where(eq(novelScriptVersions.episodeId, row.episodeId));
        await tx
          .update(novelEpisodes)
          .set({ version: maxRow?.max ?? 0, updatedAt: new Date() })
          .where(eq(novelEpisodes.id, row.episodeId));
      }
    });
    return { ok: true, deleted: String(row.id), episode_id: row.episodeId === null ? null : String(row.episodeId) };
  }

  // ══════════════════════════════════════════════════════════════
  // 9. 与制片工坊的衔接（§3.3：只有 status=16 才可作拆集源）
  // ══════════════════════════════════════════════════════════════

  /**
   * 供制片工坊 `POST /projects/:id/episodes/split` 校验并取素材（跨批次契约）。
   *
   * 由 asset-core 调用，因此**不能**返回空对象糊过去：
   * - 本子不存在 → 400102 NOT_FOUND
   * - 本子不属于该 space → 403101 FORBIDDEN
   * - 未定稿 → 400100 BAD_REQUEST（reason=not_finalized）
   *
   * `episodeScripts` 是附加字段（Lead 允许），让调用方按集落 `episodes` 时能保留集号，
   * 而不是把整篇再切一次（再切一次必然与剧本工厂的集边界不一致）。
   */
  async assertSplittable(
    spaceId: bigint | string,
    ntId: bigint | string,
  ): Promise<{
    title: string;
    sourceText: string;
    episodeCount: number;
    episodeScripts: Array<{ epNo: number; title: string; text: string }>;
  }> {
    const novel = await this.requireNovel(spaceId, ntId);
    if (novel.status !== NovelStatus.FINALIZED) {
      throw new AppError(ErrorCode.BAD_REQUEST, "novel is not finalized (status must be 16)", {
        reason: "not_finalized",
        status: novel.status,
        nt_id: String(novel.id),
      });
    }
    const episodes = await db
      .select()
      .from(novelEpisodes)
      .where(eq(novelEpisodes.novelId, novel.id))
      .orderBy(asc(novelEpisodes.episodeNo));
    if (episodes.length === 0) {
      throw new AppError(ErrorCode.BAD_REQUEST, "finalized novel has no episodes", { reason: "episodes_empty" });
    }
    const episodeScripts = episodes.map((episode) => ({
      epNo: episode.episodeNo,
      title: episode.title,
      text: episode.scriptText,
    }));
    return {
      title: novel.title,
      sourceText: episodeScripts.map((row) => `【第${row.epNo}集 ${row.title}】\n${row.text}`).join("\n\n"),
      episodeCount: episodeScripts.length,
      episodeScripts,
    };
  }
}
