import { Inject, Injectable } from "@nestjs/common";
import { and, asc, eq } from "drizzle-orm";
import { novelChapters, novelCharacters, novelEpisodeOutlines, novels } from "@app/db";
import {
  AppError,
  ErrorCode,
  NOVEL_LIMITS,
  NovelSourceType,
  newId,
  type NovelCharacterCreateRequest,
  type NovelCharacterPatchRequest,
  type NovelEpisodePatchRequest,
  type NovelFinalizeRequest,
  type NovelScriptGenerateRequest,
} from "@app/shared";
import { db } from "../../db/database";
import { NovelLlmService, type OriginalIdeaItem, type OriginalSummaryOutline } from "./novel-llm.service";
import { NovelService } from "./novel.service";
import { asRecord, novelDto, type NovelRow } from "./novel.dto";
import type {
  CharacterBatchRenameRequest,
  CharactersGenerateRequest,
  OriginalChapterOutlineGenerateRequest,
  OriginalEpisodeOutlineGenerateRequest,
  OriginalIdeaGenerateRequest,
  OriginalIdeaPatch,
  OriginalMaterialCreateRequest,
  OriginalMaterialGenerateRequest,
  OriginalMaterialPatch,
  OriginalOutlineGenerateRequest,
  OriginalOutlinePatch,
} from "./novel.schemas";

/**
 * 原创剧本链（`/v1/novel/:nt/original_script/*`）—— 对照竞品
 * `_acceptance/_gap/cli-skill/reelmate-cli-skill/commands/novel.md`
 * 的 `novel create / idea set / material / outline / chapter / episode / script / finalize`
 * 七段（行号见各方法注释），以及 `rea-reelmate/routes.txt:547-564` 的 18 条路由。
 *
 * 与**裂变链**（`novel-variant.service.ts` 的 `fission_script/*`）的本质区别：
 *
 * | | 裂变 | 原创 |
 * |---|---|---|
 * | 来源 | 必须有一个已定稿（status=16）的源本子 | **不需要任何源本子**，入口是一句创作灵感 |
 * | `source_type` | 4 (FISSION) | **2 (IDEA)** |
 * | 起点 | 从源本子的剧本里派生创意方案 | 从 `user_input` 直接生成创意方案 |
 * | 存档位 | `novels.meta.fission` | `novels.meta.original` |
 *
 * 两者都**不新增表**：创意方案/素材/总纲是"生成过程快照"（不是需要 join 或约束的实体），
 * 存 `novels.meta` 的 jsonb 自由字段；分卡章纲 / 集纲 / 分集剧本则落在既有
 * `novel_chapter_outlines` / `novel_episode_outlines` / `novel_episodes`（含版本），
 * 与改编链共用同一套写入与版本不变式（`episode.version == max(version_no)`）。
 *
 * 为什么章纲从总纲节拍派生而不单独调一次 LLM：竞品 CLI 只说"触发分卡章纲生成"
 * （`novel.md:597-617`），未取证输出形状；总纲节拍本身就是分卡边界（5 节拍 / 12 集），
 * 派生能保证"章纲与总纲永远一致"，且省一次模型调用（也省一次抖动）。用户可再逐条编辑。
 */
@Injectable()
export class NovelOriginalService {
  /** 显式 `@Inject` 见 `NovelService` 构造函数注释（esbuild 不产 decorator metadata） */
  constructor(
    @Inject(NovelService) private readonly novels: NovelService,
    @Inject(NovelLlmService) private readonly llm: NovelLlmService,
  ) {}

  // ── 状态读写 ────────────────────────────────────────────────

  private state(novel: NovelRow): Record<string, unknown> {
    return asRecord(asRecord(novel.meta).original);
  }

  private async patchState(novel: NovelRow, patch: Record<string, unknown>): Promise<void> {
    const meta = asRecord(novel.meta);
    await db
      .update(novels)
      .set({ meta: { ...meta, original: { ...asRecord(meta.original), ...patch } }, updatedAt: new Date() })
      .where(eq(novels.id, novel.id));
  }

  /**
   * 原创链只对 `source_type=2`（IDEA）的本子开放。
   *
   * 不把这条合并进"任何本子都能走原创链"的原因：改编本子里已经有章节与剧本，
   * 再走一遍"从灵感生成方案"会让两套内容在同一本子上打架，用户也无法判断
   * 最终定稿用的是哪一条链。
   */
  private async requireOriginal(spaceId: string, ntId: string): Promise<NovelRow> {
    const novel = await this.novels.requireNovel(spaceId, ntId);
    if (novel.sourceType !== NovelSourceType.IDEA) {
      throw new AppError(ErrorCode.BAD_REQUEST, "original_script chain requires a source_type=2 (idea) novel", {
        reason: "not_original_novel",
        source_type: novel.sourceType,
      });
    }
    return novel;
  }

  /** 创作灵感（`user_input`）：原文本子没有章节，唯一上下文就是它 */
  private userInputOf(novel: NovelRow): string {
    return this.novels.sourceTextOf(novel).trim();
  }

  /** 稳定 id：同一输入重跑得到同一 ni_id/nm_id，前端不必因为"重生成"而整片重渲染 */
  private stableId(prefix: string, seedText: string, index: number): string {
    let hash = 2166136261;
    const text = `${seedText}#${index}`;
    for (let i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619) >>> 0;
    }
    return `${prefix}_${hash.toString(16)}`;
  }

  // ══════════════════════════════════════════════════════════════
  // 1. 创意方案（竞品 `novel create` 启动生成 / `idea list` / `idea set`）
  //    `novel.md:84-88`（创建即启动创意规划方案生成）、`:433-455`（idea list）、
  //    `:457-480`（idea set：只提交 ni_id + selected=true）
  // ══════════════════════════════════════════════════════════════

  async generateIdeas(spaceId: string, ntId: string, input: OriginalIdeaGenerateRequest) {
    const novel = await this.requireOriginal(spaceId, ntId);
    this.novels.assertDraftLike(novel, "original_script/idea");
    const userInput = (input.user_input ?? this.userInputOf(novel)).trim();
    if (!userInput) {
      // 竞品 create 的 user_input 必填（`novel.md:95`）；没有灵感的"原创"只能生成套话
      throw new AppError(ErrorCode.INVALID_PARAM, "user_input is empty", {
        field: "user_input",
        hint: "创建原创本子时把创作灵感放进 source_text，或在本接口传 user_input",
      });
    }
    if (input.user_input) {
      // 补齐 meta.source_text：后续所有步骤都要读它，不落库就会"这一步能用、下一步 400101"
      const meta = asRecord(novel.meta);
      await db
        .update(novels)
        .set({ meta: { ...meta, source_text: userInput }, updatedAt: new Date() })
        .where(eq(novels.id, novel.id));
    }

    const result = await this.llm.originalIdeas({ title: novel.title, userInput, count: input.count });
    const seed = `${novel.title}\n${userInput}`;
    const ideas = result.ideas.map((idea, i) => ({
      ni_id: this.stableId("ni", seed, i),
      title: idea.title,
      logline: idea.logline,
      genre: idea.genre,
      tone: idea.tone,
      selected: false,
    }));
    const previous = asRecord(novel.meta).original;
    const hadDownstream =
      Array.isArray(asRecord(previous).materials) && (asRecord(previous).materials as unknown[]).length > 0;
    // 方案是整条链的根：重新生成等于换故事，下游（素材/总纲/章纲/集纲/剧本）必须一起清掉，
    // 否则会出现"总纲还是旧方案的、素材却是新方案的"这种无法自洽的中间态。
    await this.patchState(novel, {
      ideas,
      selected_ni_id: null,
      materials: [],
      summary_outline: null,
      step: "idea",
    });
    return {
      list: ideas,
      total: ideas.length,
      selected_ni_id: null as string | null,
      reset_downstream: hadDownstream,
      llm_mode: this.llm.mode,
    };
  }

  async listIdeas(spaceId: string, ntId: string) {
    const novel = await this.requireOriginal(spaceId, ntId);
    const state = this.state(novel);
    const ideas = Array.isArray(state.ideas) ? state.ideas : [];
    return {
      list: ideas,
      total: ideas.length,
      selected_ni_id: typeof state.selected_ni_id === "string" ? state.selected_ni_id : null,
      user_input: this.userInputOf(novel),
    };
  }

  async selectIdea(spaceId: string, ntId: string, niId: string) {
    const novel = await this.requireOriginal(spaceId, ntId);
    this.novels.assertDraftLike(novel, "original_script/idea/select");
    const ideas = (this.state(novel).ideas as Array<Record<string, unknown>> | undefined) ?? [];
    if (ideas.length === 0) {
      throw new AppError(ErrorCode.INVALID_PARAM, "no idea yet; generate ideas first", { reason: "idea_empty" });
    }
    if (!ideas.some((idea) => idea.ni_id === niId)) {
      throw new AppError(ErrorCode.NOT_FOUND, "idea not found", { reason: "idea_not_found" });
    }
    const next: Array<Record<string, unknown>> = ideas.map((idea) => ({ ...idea, selected: idea.ni_id === niId }));
    await this.patchState(novel, { ideas: next, selected_ni_id: niId, step: "idea_selected" });
    const chosen = next.find((idea) => idea.ni_id === niId)!;
    return { selected_ni_id: niId, idea: chosen, list: next, action: "selected" };
  }

  /** 当前选定的方案（内部用；未选定直接报错，避免用"第一条"静默代替用户选择） */
  private requireSelectedIdea(novel: NovelRow): OriginalIdeaItem & { ni_id: string } {
    const state = this.state(novel);
    const ideas = (Array.isArray(state.ideas) ? state.ideas : []) as Array<Record<string, unknown>>;
    const chosen = ideas.find((idea) => idea.ni_id === state.selected_ni_id);
    if (!chosen) {
      throw new AppError(ErrorCode.INVALID_PARAM, "select an idea first", {
        reason: "idea_not_selected",
        hint: "POST /original_script/idea/select-op",
      });
    }
    return {
      ni_id: String(chosen.ni_id),
      title: String(chosen.title ?? ""),
      logline: String(chosen.logline ?? ""),
      genre: String(chosen.genre ?? ""),
      tone: String(chosen.tone ?? ""),
    };
  }

  // ══════════════════════════════════════════════════════════════
  // 1b. 创意方案详情 / 编辑（竞品 `routes.txt:558` 的 `idea/:ni_id`）
  //
  // 读写都在 `novels.meta.original.ideas[]`（本文件是唯一写者），不落表：
  // 创意方案是"生成过程快照"，没有需要 join/约束的实体属性。
  // ══════════════════════════════════════════════════════════════

  /** `GET /original_script/idea/:ni_id` —— 单条方案详情（含是否当前选中） */
  async getIdea(spaceId: string, ntId: string, niId: string) {
    const novel = await this.requireOriginal(spaceId, ntId);
    const state = this.state(novel);
    const ideas = (Array.isArray(state.ideas) ? state.ideas : []) as Array<Record<string, unknown>>;
    const idea = ideas.find((row) => row.ni_id === niId);
    if (!idea) throw new AppError(ErrorCode.NOT_FOUND, "idea not found", { reason: "idea_not_found" });
    return {
      idea,
      selected: state.selected_ni_id === niId,
      total: ideas.length,
      user_input: this.userInputOf(novel),
    };
  }

  /**
   * `PATCH /original_script/idea/:ni_id` —— 编辑单条方案的标题/卖点/题材/基调。
   *
   * 允许编辑已选中的方案（用户就是想改个措辞），但如果下游（素材/总纲/章纲/集纲/剧本）
   * 已经生成，会回显 `downstream_stale: true` 提醒"下游是按旧方案生成的"——
   * 这里**不自动级联重置**：删掉用户已经改过的总纲比留一个提示更糟。
   */
  async patchIdea(spaceId: string, ntId: string, niId: string, input: OriginalIdeaPatch) {
    const novel = await this.requireOriginal(spaceId, ntId);
    this.novels.assertDraftLike(novel, "original_script/idea/patch");
    const state = this.state(novel);
    const ideas = (Array.isArray(state.ideas) ? state.ideas : []) as Array<Record<string, unknown>>;
    if (!ideas.some((row) => row.ni_id === niId)) {
      throw new AppError(ErrorCode.NOT_FOUND, "idea not found", { reason: "idea_not_found" });
    }
    const next = ideas.map((row) =>
      row.ni_id === niId
        ? {
            ...row,
            ...(input.title !== undefined ? { title: input.title } : {}),
            ...(input.logline !== undefined ? { logline: input.logline } : {}),
            ...(input.genre !== undefined ? { genre: input.genre } : {}),
            ...(input.tone !== undefined ? { tone: input.tone } : {}),
            edited_at: new Date().toISOString(),
          }
        : row,
    );
    await this.patchState(novel, { ideas: next });
    const materials = Array.isArray(state.materials) ? state.materials : [];
    const hasOutline = Object.keys(asRecord(state.summary_outline)).length > 0;
    return {
      idea: next.find((row) => row.ni_id === niId),
      selected: state.selected_ni_id === niId,
      // 只提示、不级联：下游要不要重生成由用户决定
      downstream_stale: materials.length > 0 || hasOutline,
      list: next,
    };
  }
  // ══════════════════════════════════════════════════════════════
  // 2. 素材（竞品 `novel material` 生成 / `material list` / `material set`）
  //    `novel.md:504-526`（触发素材生成）、`:528-548`（列表，标题就是「素材1/素材2」）、
  //    `:550-573`（勾选：只提交 nm_id + selected=true，**不会取消其它已勾选项**）
  // ══════════════════════════════════════════════════════════════

  async generateMaterials(spaceId: string, ntId: string, input: OriginalMaterialGenerateRequest) {
    const novel = await this.requireOriginal(spaceId, ntId);
    this.novels.assertDraftLike(novel, "original_script/materials");
    const idea = this.requireSelectedIdea(novel);
    const result = await this.llm.originalMaterials({ title: novel.title, idea, count: input.count });
    const seed = `${novel.title}\n${idea.ni_id}`;
    const materials = result.materials.map((material, i) => ({
      nm_id: this.stableId("nm", seed, i),
      title: material.title,
      content: material.content,
      selected: false,
    }));
    await this.patchState(novel, { materials, step: "materials" });
    return {
      list: materials,
      total: materials.length,
      selected_nm_ids: [] as string[],
      llm_mode: this.llm.mode,
      instructions: input.instructions ?? "",
    };
  }

  async listMaterials(spaceId: string, ntId: string) {
    const novel = await this.requireOriginal(spaceId, ntId);
    const materials = (this.state(novel).materials as Array<Record<string, unknown>> | undefined) ?? [];
    return {
      list: materials,
      total: materials.length,
      // 竞品「下一步」不强制勾选（`novel.md:554`），故勾选态只作提示，不作闸门
      selected_nm_ids: materials.filter((row) => row.selected === true).map((row) => String(row.nm_id)),
    };
  }

  async patchMaterial(spaceId: string, ntId: string, nmId: string, input: OriginalMaterialPatch) {
    const novel = await this.requireOriginal(spaceId, ntId);
    this.novels.assertDraftLike(novel, "original_script/materials/patch");
    const materials = (this.state(novel).materials as Array<Record<string, unknown>> | undefined) ?? [];
    if (!materials.some((row) => row.nm_id === nmId)) {
      throw new AppError(ErrorCode.NOT_FOUND, "material not found", { reason: "material_not_found" });
    }
    const next = materials.map((row) =>
      row.nm_id === nmId
        ? {
            ...row,
            ...(input.title !== undefined ? { title: input.title } : {}),
            ...(input.content !== undefined ? { content: input.content } : {}),
            ...(input.selected !== undefined ? { selected: input.selected } : {}),
          }
        : row,
    );
    await this.patchState(novel, { materials: next });
    return { material: next.find((row) => row.nm_id === nmId), list: next, total: next.length };
  }

  /** 勾选素材：加法语义（不取消其它），与竞品 `material set` 一致（`novel.md:554`） */
  async selectMaterial(spaceId: string, ntId: string, nmId: string) {
    const novel = await this.requireOriginal(spaceId, ntId);
    this.novels.assertDraftLike(novel, "original_script/materials/select");
    const materials = (this.state(novel).materials as Array<Record<string, unknown>> | undefined) ?? [];
    if (!materials.some((row) => row.nm_id === nmId)) {
      throw new AppError(ErrorCode.NOT_FOUND, "material not found", { reason: "material_not_found" });
    }
    const next = materials.map((row) => (row.nm_id === nmId ? { ...row, selected: true } : row));
    await this.patchState(novel, { materials: next, step: "materials_selected" });
    return {
      action: "selected",
      selected_nm_ids: next.filter((row) => row.selected === true).map((row) => String(row.nm_id)),
      list: next,
      total: next.length,
    };
  }

  // ══════════════════════════════════════════════════════════════
  // 3. 总纲及设定（竞品 `novel outline`，`novel.md:575-595`）
  // ══════════════════════════════════════════════════════════════

  async generateSummaryOutline(spaceId: string, ntId: string, input: OriginalOutlineGenerateRequest) {
    const novel = await this.requireOriginal(spaceId, ntId);
    this.novels.assertDraftLike(novel, "original_script/summary_outline");
    const state = this.state(novel);
    const idea = this.requireSelectedIdea(novel);
    const materials = (Array.isArray(state.materials) ? state.materials : []) as Array<Record<string, unknown>>;
    // 竞品：进总纲前不强制勾选素材（`novel.md:554`）；已勾选的优先作为上下文
    const selected = materials.filter((row) => row.selected === true);
    const picked = (selected.length > 0 ? selected : materials).map((row) => String(row.content ?? ""));
    const outline = await this.llm.originalSummaryOutline({ title: novel.title, idea, materials: picked });
    const summaryOutline: OriginalSummaryOutline = outline;
    await this.patchState(novel, { summary_outline: summaryOutline, step: "summary_outline" });
    return {
      summary_outline: summaryOutline,
      llm_mode: this.llm.mode,
      materials_used: selected.length > 0 ? selected.length : picked.length,
      instructions: input.instructions ?? "",
    };
  }

  async getSummaryOutline(spaceId: string, ntId: string) {
    const novel = await this.requireOriginal(spaceId, ntId);
    const outline = asRecord(this.state(novel).summary_outline);
    return { summary_outline: Object.keys(outline).length > 0 ? outline : null };
  }

  async patchSummaryOutline(spaceId: string, ntId: string, input: OriginalOutlinePatch) {
    const novel = await this.requireOriginal(spaceId, ntId);
    this.novels.assertDraftLike(novel, "original_script/summary_outline/patch");
    const current = asRecord(this.state(novel).summary_outline);
    if (Object.keys(current).length === 0) {
      throw new AppError(ErrorCode.INVALID_PARAM, "summary outline is empty; generate it first", {
        reason: "summary_outline_empty",
      });
    }
    const next = {
      ...current,
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.logline !== undefined ? { logline: input.logline } : {}),
      ...(input.theme !== undefined ? { theme: input.theme } : {}),
      ...(input.structure !== undefined ? { structure: input.structure } : {}),
      ...(input.beats !== undefined ? { beats: input.beats } : {}),
      edited_at: new Date().toISOString(),
    };
    await this.patchState(novel, { summary_outline: next });
    return { summary_outline: next };
  }

  // ══════════════════════════════════════════════════════════════
  // 4. 分卡章纲（竞品 `novel chapter`，`novel.md:597-617`）
  //    落在 `novel_chapter_outlines`（与改编链同一张表），章号 = 总纲节拍号
  // ══════════════════════════════════════════════════════════════

  async generateChapterOutlines(spaceId: string, ntId: string, input: OriginalChapterOutlineGenerateRequest) {
    const novel = await this.requireOriginal(spaceId, ntId);
    this.novels.assertDraftLike(novel, "original_script/chapters_outline");
    const outline = asRecord(this.state(novel).summary_outline);
    const beats = Array.isArray(outline.beats) ? (outline.beats as Array<Record<string, unknown>>) : [];
    if (beats.length === 0) {
      throw new AppError(ErrorCode.INVALID_PARAM, "generate summary outline before chapters", {
        reason: "summary_outline_empty",
      });
    }
    const rows = await this.novels.replaceChapterOutlines(
      novel.id,
      beats.map((beat, i) => ({
        chapterNo: Number(beat.no ?? i + 1),
        title: String(beat.beat ?? `分卡${i + 1}`),
        synopsis: String(beat.summary ?? ""),
        sort: i,
      })),
    );
    await this.patchState(novel, { step: "chapters_outline" });
    return {
      list: rows,
      count: rows.length,
      derived_from: "summary_outline.beats",
      instructions: input.instructions ?? "",
    };
  }

  async listChapterOutlines(spaceId: string, ntId: string) {
    // 复用改编链的列表实现（同一张表、同一排序口径），少一份会漂的代码
    await this.requireOriginal(spaceId, ntId);
    return this.novels.listChapterOutlines(spaceId, ntId);
  }

  async patchChapterOutline(
    spaceId: string,
    ntId: string,
    ncoId: string,
    input: { title?: string; synopsis?: string },
  ) {
    await this.requireOriginal(spaceId, ntId);
    return this.novels.patchChapterOutline(spaceId, ntId, ncoId, input);
  }

  // ══════════════════════════════════════════════════════════════
  // 5. 集纲 + 分集剧本（竞品 `novel episode`：集纲，`novel.md:619-639`；
  //    `novel script`：分集剧本，`novel.md:641-661`）
  // ══════════════════════════════════════════════════════════════

  async generateEpisodeOutlines(spaceId: string, ntId: string, input: OriginalEpisodeOutlineGenerateRequest) {
    const novel = await this.requireOriginal(spaceId, ntId);
    this.novels.assertDraftLike(novel, "original_script/episodes_outline");
    const outline = asRecord(this.state(novel).summary_outline);
    const beats = Array.isArray(outline.beats) ? (outline.beats as Array<Record<string, unknown>>) : [];
    if (beats.length === 0) {
      throw new AppError(ErrorCode.INVALID_PARAM, "generate summary outline before episode outline", {
        reason: "summary_outline_empty",
      });
    }
    const chapters = await db
      .select()
      .from(novelChapters)
      .where(eq(novelChapters.novelId, novel.id))
      .orderBy(asc(novelChapters.chapterNo));
    const chapterOutlines = (await this.novels.listChapterOutlines(spaceId, ntId)).list;
    const wanted = input.episode_count ?? (novel.episodeCount > 0 ? novel.episodeCount : 0);
    const episodeCount = Math.max(
      1,
      Math.min(wanted > 0 ? wanted : Math.max(beats.length * 2, 6), NOVEL_LIMITS.EPISODE_MAX),
    );
    const generated = await this.llm.episodeOutlines({
      title: novel.title,
      episodeCount,
      // 章纲优先（竞品顺序：总纲 → 分卡章纲 → 集纲）；没有章纲就退回总纲节拍
      chapterOutlines:
        chapterOutlines.length > 0
          ? chapterOutlines.map((row) => ({
              chapterNo: row.chapter_no,
              title: row.title,
              synopsis: row.synopsis,
            }))
          : beats.map((beat, i) => ({
              chapterNo: Number(beat.no ?? i + 1),
              title: String(beat.beat ?? `节拍${i + 1}`),
              synopsis: String(beat.summary ?? ""),
            })),
      instructions: input.instructions,
    });
    const rows = await this.novels.replaceEpisodeOutlines(
      novel.id,
      generated.episodes.map((episode, i) => ({
        episodeNo: episode.episode_no,
        title: episode.title,
        synopsis: episode.synopsis,
        sort: i,
      })),
    );
    await db.update(novels).set({ episodeCount: rows.length, updatedAt: new Date() }).where(eq(novels.id, novel.id));
    await this.patchState(novel, { step: "episodes_outline" });
    return { list: rows, count: rows.length, llm_mode: this.llm.mode, chapters_available: chapters.length };
  }

  async listEpisodeOutlines(spaceId: string, ntId: string) {
    await this.requireOriginal(spaceId, ntId);
    return this.novels.listEpisodeOutlines(spaceId, ntId);
  }

  /** 分集剧本生成：直接复用改编链的写正文/版本逻辑（不许两套代码写同一个不变式） */
  async generateEpisodes(spaceId: string, ntId: string, userId: string, input: NovelScriptGenerateRequest) {
    const novel = await this.requireOriginal(spaceId, ntId);
    const result = await this.novels.generateScripts(spaceId, ntId, userId, input);
    await this.patchState(novel, { step: "episodes" });
    return result;
  }

  async patchEpisode(spaceId: string, ntId: string, neId: string, input: NovelEpisodePatchRequest) {
    await this.requireOriginal(spaceId, ntId);
    return this.novels.patchEpisode(spaceId, ntId, neId, input);
  }

  async confirmEpisode(spaceId: string, ntId: string, neId: string) {
    await this.requireOriginal(spaceId, ntId);
    return this.novels.confirmEpisode(spaceId, ntId, neId);
  }

  // ══════════════════════════════════════════════════════════════
  // 5b. 角色卡薄路径（竞品 `routes.txt:549-553` 的 `original_script/characters/*`）
  //
  // ⚠️ **全部是路径别名，不复制任何业务逻辑**：
  // - 列表  → `NovelService.listCharacters`（与 content-analysis/detail 同一份查询）
  // - 生成  → `NovelService.generateCharacters`（与 novel_character_cards/generate 同一实现）
  // - 新增  → `NovelService.createCharacter`（同名即覆盖 → 幂等）
  // - 编辑  → `NovelService.patchCharacter`（同一张 novel_characters 行、同一套字段）
  // - 确认  → `NovelService.confirmCharacter`（= 置 is_core，与 core_character 子链同字段）
  //
  // 竞品给原创链单列这 5 条，是因为它的原创/改编是两个独立工程；我方两条链共用
  // `novel_characters`，若在这里再实现一套"角色卡怎么生成/怎么确认"，就会出现第二份真相
  // （同一张卡在两个入口表现不同、`is_core` 互相打架）。故这里只做前缀转发。
  // ══════════════════════════════════════════════════════════════

  /** `GET /original_script/characters` —— 路径别名，语义同 `GET /content-analysis/detail` 的 characters */
  async listCharacters(spaceId: string, ntId: string) {
    await this.requireOriginal(spaceId, ntId);
    return this.novels.listCharacters(spaceId, ntId);
  }

  /** `POST /original_script/characters/generate` —— 路径别名，语义同 `novel_character_cards/generate` */
  async generateCharacters(spaceId: string, ntId: string, input: CharactersGenerateRequest) {
    await this.requireOriginal(spaceId, ntId);
    return this.novels.generateCharacters(spaceId, ntId, input);
  }

  /** `POST /original_script/characters` —— 路径别名，语义同 `POST content-analysis/novel_character_cards` */
  async createCharacter(spaceId: string, ntId: string, input: NovelCharacterCreateRequest) {
    await this.requireOriginal(spaceId, ntId);
    return this.novels.createCharacter(spaceId, ntId, input);
  }

  /** `PATCH /original_script/characters/:nc_id` —— 路径别名，语义同 `PATCH .../novel_character_cards/:ncc_id` */
  async patchCharacter(spaceId: string, ntId: string, ncId: string, input: NovelCharacterPatchRequest) {
    await this.requireOriginal(spaceId, ntId);
    return this.novels.patchCharacter(spaceId, ntId, ncId, input);
  }

  /** `POST /original_script/characters/:nc_id/confirm` —— 路径别名，语义同 `core_character`（置 is_core） */
  async confirmCharacter(spaceId: string, ntId: string, ncId: string) {
    await this.requireOriginal(spaceId, ntId);
    return this.novels.confirmCharacter(spaceId, ntId, ncId);
  }

  // ══════════════════════════════════════════════════════════════
  // 5c. 第 90 批复核竞品 102 条 novel 路由后补的 6 条形状
  //
  // 这 6 条的共同点：竞品给了「单个对象」的读写形状，我方原先只有集合/批量版本。
  // **没有一条需要新表** —— 角色卡在 `novel_characters`、素材在 `novels.meta.original.materials`、
  // 集纲在 `novel_episode_outlines`，缺的只是"按 id 拿一条 / 改一条"的入口。
  // 反过来说，这 6 条不是"新能力"，是**同能力的另一种调用形状**，故不加分（见台账第 90 批）。
  // ══════════════════════════════════════════════════════════════

  /** `GET /original_script/characters/:nc_id` —— 单张角色卡（与列表同一 dto，不多不少） */
  async getCharacter(spaceId: string, ntId: string, ncId: string) {
    await this.requireOriginal(spaceId, ntId);
    const { list } = (await this.novels.listCharacters(spaceId, ntId)) as { list: Array<{ id: string }> };
    const found = list.find((row) => row.id === ncId);
    if (!found) throw new AppError(ErrorCode.NOT_FOUND, "character not found", { reason: "character_not_found" });
    return { character: found };
  }

  /** `POST /original_script/characters/:nc_id/delete` —— 删一张角色卡（竞品用 POST 不是 DELETE） */
  async deleteCharacter(spaceId: string, ntId: string, ncId: string) {
    const novel = await this.requireOriginal(spaceId, ntId);
    this.novels.assertDraftLike(novel, "original_script/characters/delete");
    const { list } = (await this.novels.listCharacters(spaceId, ntId)) as {
      list: Array<{ id: string; name: string }>;
    };
    const target = list.find((row) => row.id === ncId);
    if (!target) throw new AppError(ErrorCode.NOT_FOUND, "character not found", { reason: "character_not_found" });
    await db
      .delete(novelCharacters)
      .where(and(eq(novelCharacters.id, BigInt(target.id)), eq(novelCharacters.novelId, novel.id)));
    return { deleted: { id: target.id, name: target.name }, remaining: Math.max(0, list.length - 1) };
  }

  /** `POST /original_script/characters/batch-rename` —— 批量改名（**只改 name**，改别的走单条 PATCH） */
  async batchRenameCharacters(spaceId: string, ntId: string, input: CharacterBatchRenameRequest) {
    const novel = await this.requireOriginal(spaceId, ntId);
    this.novels.assertDraftLike(novel, "original_script/characters/batch-rename");
    const { list } = (await this.novels.listCharacters(spaceId, ntId)) as {
      list: Array<{ id: string; name: string }>;
    };
    const byId = new Map(list.map((row) => [row.id, row]));
    const unknown = input.items.filter((item) => !byId.has(item.nc_id)).map((item) => item.nc_id);
    if (unknown.length > 0) {
      throw new AppError(ErrorCode.NOT_FOUND, "character not found", {
        reason: "character_not_found",
        ids: unknown,
      });
    }
    const renamed: Array<{ id: string; from: string; to: string }> = [];
    for (const item of input.items) {
      const row = byId.get(item.nc_id)!;
      if (row.name === item.name) continue;
      await db
        .update(novelCharacters)
        .set({ name: item.name, updatedAt: new Date() })
        .where(and(eq(novelCharacters.id, BigInt(row.id)), eq(novelCharacters.novelId, novel.id)));
      renamed.push({ id: row.id, from: row.name, to: item.name });
    }
    const after = (await this.novels.listCharacters(spaceId, ntId)) as { list: unknown };
    return { renamed, count: renamed.length, list: after.list };
  }

  /** `GET /original_script/materials/:nm_id` —— 单条素材 */
  async getMaterial(spaceId: string, ntId: string, nmId: string) {
    const novel = await this.requireOriginal(spaceId, ntId);
    const materials = (this.state(novel).materials as Array<Record<string, unknown>> | undefined) ?? [];
    const found = materials.find((row) => row.nm_id === nmId);
    if (!found) throw new AppError(ErrorCode.NOT_FOUND, "material not found", { reason: "material_not_found" });
    return { material: found, selected: found.selected === true, total: materials.length };
  }

  /**
   * `POST /original_script/materials` —— **手工**新增一条素材（不调模型）。
   *
   * 与 `materials/generate` 的分工：生成是"让我替你想"，这条是"我自己写一条"。
   * 竞品有这两个入口但两个 schema 都是 `{}`，故只收我方 schema 里已有的三个字段，
   * 并额外落一个 `manual: true` —— 下游若要区分"模型产出"与"人手写"，有据可依。
   */
  async createMaterial(spaceId: string, ntId: string, input: OriginalMaterialCreateRequest) {
    const novel = await this.requireOriginal(spaceId, ntId);
    this.novels.assertDraftLike(novel, "original_script/materials/create");
    const materials = (this.state(novel).materials as Array<Record<string, unknown>> | undefined) ?? [];
    const row = {
      nm_id: `nm_${String(newId())}`,
      title: input.title?.trim() || `素材${materials.length + 1}`,
      content: input.content,
      selected: input.selected ?? false,
      manual: true,
      created_at: new Date().toISOString(),
    };
    await this.patchState(novel, { materials: [...materials, row], step: "materials" });
    return { material: row, total: materials.length + 1 };
  }

  /** `PATCH /original_script/episodes_outline/:neo_id` —— 单条集纲编辑（复用改编链同一实现） */
  async patchEpisodeOutline(spaceId: string, ntId: string, neoId: string, input: { title?: string; synopsis?: string }) {
    await this.requireOriginal(spaceId, ntId);
    return this.novels.patchEpisodeOutline(spaceId, ntId, neoId, input);
  }
  // ══════════════════════════════════════════════════════════════
  // 6. 定稿（竞品 `novel finalize`，`novel.md:663-683`）
  // ══════════════════════════════════════════════════════════════

  /**
   * 原创链定稿 = 与改编链同一个动作（`status=16`，写整本快照）。
   *
   * 为什么单列一条 `original_script/finalize` 路径：竞品把定稿归在整任务级
   * （`/novel/:nt_id/finalize`），而原创链的前端是按 `original_script/*` 前缀组织的；
   * 多这一条薄路由，前端不必在"链内按钮"和"链外按钮"之间跳前缀。
   * 语义完全委托给 `NovelService.finalize`（含幂等、快照、memo）。
   */
  async finalize(spaceId: string, ntId: string, input: NovelFinalizeRequest, userId: string) {
    await this.requireOriginal(spaceId, ntId);
    const result = await this.novels.finalize(spaceId, ntId, input, userId);
    const novel = await this.requireOriginal(spaceId, ntId);
    await this.patchState(novel, { step: "finalized" });
    return result;
  }

  // ══════════════════════════════════════════════════════════════
  // 7. 链状态（给前端一次性渲染七步进度，不用打七次）
  // ══════════════════════════════════════════════════════════════

  async chainState(spaceId: string, ntId: string) {
    const novel = await this.requireOriginal(spaceId, ntId);
    const state = this.state(novel);
    const ideas = Array.isArray(state.ideas) ? state.ideas : [];
    const materials = Array.isArray(state.materials) ? state.materials : [];
    const outline = asRecord(state.summary_outline);
    const chapterOutlines = (await this.novels.listChapterOutlines(spaceId, ntId)).list;
    const episodeOutlines = await db
      .select()
      .from(novelEpisodeOutlines)
      .where(eq(novelEpisodeOutlines.novelId, novel.id))
      .orderBy(asc(novelEpisodeOutlines.episodeNo));
    const episodes = (await this.novels.listEpisodes(spaceId, ntId)).list;
    const step = (done: boolean, hint: string) => ({ done, hint });
    return {
      novel: novelDto(novel),
      source_type: novel.sourceType,
      user_input: this.userInputOf(novel),
      selected_ni_id: typeof state.selected_ni_id === "string" ? state.selected_ni_id : null,
      steps: {
        idea: step(ideas.length > 0, ideas.length > 0 ? `${ideas.length} 个创意方案` : "生成创意方案"),
        idea_selected: step(
          typeof state.selected_ni_id === "string",
          typeof state.selected_ni_id === "string" ? "已选定方案" : "选定一个创意方案",
        ),
        materials: step(materials.length > 0, materials.length > 0 ? `${materials.length} 条素材` : "生成剧本素材"),
        summary_outline: step(Object.keys(outline).length > 0, Object.keys(outline).length > 0 ? "总纲已生成" : "生成总纲及设定"),
        chapters_outline: step(
          chapterOutlines.length > 0,
          chapterOutlines.length > 0 ? `${chapterOutlines.length} 个分卡章纲` : "生成分卡章纲",
        ),
        episodes_outline: step(
          episodeOutlines.length > 0,
          episodeOutlines.length > 0 ? `${episodeOutlines.length} 集大纲` : "生成集纲",
        ),
        episodes: step(episodes.length > 0, episodes.length > 0 ? `${episodes.length} 集剧本` : "生成分集剧本"),
        finalize: step(novel.status === 16, novel.status === 16 ? "已定稿（status=16）" : "定稿完成剧本"),
      },
      counts: {
        ideas: ideas.length,
        materials: materials.length,
        chapter_outlines: chapterOutlines.length,
        episode_outlines: episodeOutlines.length,
        episodes: episodes.length,
      },
      llm_mode: this.llm.mode,
    };
  }

}

