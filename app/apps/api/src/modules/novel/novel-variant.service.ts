import { Inject, Injectable } from "@nestjs/common";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { novelChapterOutlines, novelCharacters, novelEpisodeOutlines, novelEpisodes, novels } from "@app/db";
import {
  AppError,
  ErrorCode,
  NOVEL_LIMITS,
  NovelSourceType,
  NovelStatus,
  newId,
  type NovelScriptGenerateRequest,
} from "@app/shared";
import { db } from "../../db/database";
import { NovelLlmService } from "./novel-llm.service";
import { NovelService } from "./novel.service";
import {
  asRecord,
  chapterOutlineDto,
  characterDto,
  episodeOutlineDto,
  novelDto,
  type NovelEpisodeOutlineRow,
  type NovelRow,
} from "./novel.dto";
import type {
  CharactersGenerateRequest,
  ChapterOutlineGenerateRequest,
  FissionCreateRequest,
  OverseasRequest,
} from "./novel.schemas";

/** 裂变角度候选（确定性派生；竞品未给枚举，故为开放语义而非白名单） */
const ANGLES = [
  { key: "flip", label: "换视角重讲", logline: "把同一条主线换到对手视角，观众已知的结论被重新解释。" },
  { key: "villain", label: "反派做主角", logline: "让原来的阻力人物成为叙事中心，动机合法化，代价前置。" },
  { key: "after", label: "十年后重启", logline: "原故事的结局成为新故事的起点，旧人物带着后遗症返场。" },
  { key: "parallel", label: "平行时空重来", logline: "同一场关键抉择在另一条时空分支里重复，但资源与信任被重置。" },
] as const;

function seedOf(text: string): number {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash >>> 0;
}

/**
 * 变体服务：创意裂变（derivative）与海外改编（overseas）。
 *
 * 为什么单独一个 service：
 * 这两条链的**产物都是"另一个本子"**，而不是修改当前本子。
 * 它们要读源本子的正文/剧本、要写一个新 `novels` 行（+ 大纲），
 * 与 `NovelService` 的"就地推进"语义相反，混在一起会让 `assertDraft` 这类
 * "已定稿不可改"的判断在两条语义之间来回摇摆。
 *
 * ⚠️ 裂变的中间产物（创意方案 / 总纲）没有独立表（第 2 批数据层只落了 novel* 11 张），
 * 故存在 `novels.meta.fission` 里。这是 jsonb 自由字段的正当用途：
 * 它们是"生成过程快照"，不是需要被 join / 约束的实体。
 */
@Injectable()
export class NovelVariantService {
  /** 显式 `@Inject` 见 `NovelService` 构造函数注释（esbuild 不产 decorator metadata） */
  constructor(
    @Inject(NovelService) private readonly novels: NovelService,
    @Inject(NovelLlmService) private readonly llm: NovelLlmService,
  ) {}

  // ══════════════════════════════════════════════════════════════
  // 1. 创意裂变（对照竞品 fission_script/* 9 端点，routes.txt:534-544）
  // ══════════════════════════════════════════════════════════════

  /**
   * 从已定稿本子派生一个新本子（竞品 `novel derive --nt-id`，语义见 `novel.md:300-347`）。
   *
   * 要求源本子 `status=16`：竞品 `derive` 的剧库来源只接受"已定稿源剧本"；
   * 未定稿就裂变等于把一个半成品复制一份，用户会在两个半成品之间来回改。
   */
  async createFission(spaceId: string, ntId: string, input: FissionCreateRequest) {
    const source = await this.novels.requireNovel(spaceId, ntId);
    if (source.status !== NovelStatus.FINALIZED) {
      throw new AppError(ErrorCode.BAD_REQUEST, "source novel must be finalized before fission", {
        reason: "source_not_finalized",
        status: source.status,
      });
    }
    const seed = seedOf([source.title, input.direction ?? "", String(input.episode_count)].join("\n"));
    const ideas = Array.from({ length: 3 }, (_, i) => {
      const angle = ANGLES[(seed + i * 3) % ANGLES.length]!;
      return {
        ni_id: `ni_${((seed + i * 104729) >>> 0).toString(16)}`,
        title: `${source.title}·${angle.label}`,
        logline: `${angle.logline}${input.direction ? `方向补充：${input.direction}` : ""}`,
        angle: angle.key,
        selected: false,
      };
    });
    const title = (input.name ?? `${source.title}·裂变`).trim();
    // 源本摘录（裂变本子的"素材"）：取不到就留空，让后续步骤给出明确错误而不是崩溃
    const sourceExcerpt = await this.novels
      .analysisText(source)
      .then((text) => text.slice(0, NOVEL_LIMITS.SOURCE_TEXT_MAX))
      .catch(() => "");
    const [dup] = await db
      .select({ id: novels.id })
      .from(novels)
      .where(and(eq(novels.spaceId, source.spaceId), eq(novels.title, title), isNull(novels.archivedAt)));
    if (dup) {
      throw new AppError(ErrorCode.BAD_REQUEST, "novel title already exists", {
        reason: "duplicate_title",
        field: "name",
      });
    }

    const [created] = await db
      .insert(novels)
      .values({
        id: newId(),
        spaceId: source.spaceId,
        title,
        sourceType: NovelSourceType.FISSION,
        status: NovelStatus.DRAFT,
        ratio: source.ratio,
        episodeCount: input.episode_count,
        meta: {
          // 裂变本子没有自己的章节，但后续内容分析/角色生成需要文本 ——
          // 存一份源本摘录，否则 generateCharacters 会以"无源文本"400101 失败。
          source_text: sourceExcerpt,
          fission: {
            source_nt_id: String(source.id),
            direction: input.direction ?? "",
            ideas,
            selected_ni_id: null,
            summary_outline: null,
          },
        },
      })
      .returning();
    return { novel: novelDto(created!), ideas, count: ideas.length, llm_mode: this.llm.mode };
  }

  private fissionState(novel: NovelRow): Record<string, unknown> {
    return asRecord(asRecord(novel.meta).fission);
  }

  private async patchFissionState(novel: NovelRow, patch: Record<string, unknown>): Promise<void> {
    const meta = asRecord(novel.meta);
    await db
      .update(novels)
      .set({
        meta: { ...meta, fission: { ...asRecord(meta.fission), ...patch } },
        updatedAt: new Date(),
      })
      .where(eq(novels.id, novel.id));
  }

  async listIdeas(spaceId: string, ntId: string) {
    const novel = await this.novels.requireNovel(spaceId, ntId);
    const state = this.fissionState(novel);
    const ideas = Array.isArray(state.ideas) ? state.ideas : [];
    return {
      list: ideas,
      total: ideas.length,
      selected_ni_id: typeof state.selected_ni_id === "string" ? state.selected_ni_id : null,
      source_nt_id: typeof state.source_nt_id === "string" ? state.source_nt_id : null,
    };
  }

  /** 选定一条创意方案（竞品 `idea/select-op`：只提交当前 ni_id + selected=true） */
  async selectIdea(spaceId: string, ntId: string, niId: string) {
    const novel = await this.novels.requireNovel(spaceId, ntId);
    this.novels.assertDraftLike(novel, "fission/idea/select");
    const state = this.fissionState(novel);
    const ideas = (Array.isArray(state.ideas) ? state.ideas : []) as Array<Record<string, unknown>>;
    if (ideas.length === 0) {
      throw new AppError(ErrorCode.INVALID_PARAM, "no fission idea yet", { reason: "idea_empty" });
    }
    if (!ideas.some((idea) => idea.ni_id === niId)) {
      throw new AppError(ErrorCode.NOT_FOUND, "idea not found", { reason: "idea_not_found" });
    }
    const next = ideas.map((idea) => ({ ...idea, selected: idea.ni_id === niId }));
    await this.patchFissionState(novel, { ideas: next, selected_ni_id: niId });
    return { selected_ni_id: niId, list: next, action: "selected" };
  }

  async listCharacters(spaceId: string, ntId: string) {
    const novel = await this.novels.requireNovel(spaceId, ntId);
    const rows = await db
      .select()
      .from(novelCharacters)
      .where(eq(novelCharacters.novelId, novel.id))
      .orderBy(asc(novelCharacters.roleType), asc(novelCharacters.createdAt));
    return { list: rows.map(characterDto), total: rows.length };
  }

  /** 生成本子角色（裂变/海外共用的"角色阶段"） */
  async generateCharacters(spaceId: string, ntId: string, input: CharactersGenerateRequest) {
    const novel = await this.novels.requireNovel(spaceId, ntId);
    this.novels.assertDraftLike(novel, "characters/generate");
    const sourceText = await this.novels.analysisText(novel);
    const existing = await db.select().from(novelCharacters).where(eq(novelCharacters.novelId, novel.id));
    const generated = await this.llm.characters({
      title: novel.title,
      sourceText,
      count: input.count,
      existingNames: existing.map((row) => row.name),
    });
    const cards = await this.novels.mergeCharacters(novel.id, generated.characters);
    return { characters: cards, count: cards.length, llm_mode: this.llm.mode };
  }

  /** 总纲（裂变链的 summary_outline；存 meta.fission.summary_outline） */
  async generateSummaryOutline(spaceId: string, ntId: string, input: ChapterOutlineGenerateRequest) {
    const novel = await this.novels.requireNovel(spaceId, ntId);
    this.novels.assertDraftLike(novel, "fission/summary_outline");
    const state = this.fissionState(novel);
    const ideas = (Array.isArray(state.ideas) ? state.ideas : []) as Array<Record<string, unknown>>;
    // 必须先显式选定方案：竞品链路是「创意方案 → 选定 → 角色 → 总纲」（`novel.md:437-455`），
    // 自动取第一条会让用户以为自己选过，且后续重生成时目标会静默变化。
    const chosen = ideas.find((idea) => idea.ni_id === state.selected_ni_id);
    if (!chosen) {
      throw new AppError(ErrorCode.INVALID_PARAM, "select an idea before generating summary outline", {
        reason: "idea_not_selected",
      });
    }
    const seed = seedOf([novel.title, String(chosen.ni_id), input.instructions ?? ""].join("\n"));
    const beats = ["开局钩子", "第一次反转", "关系崩解", "代价结算", "终局与余波"];
    const outline = {
      title: `${novel.title} 故事总纲`,
      logline: String(chosen.logline ?? ""),
      theme: ["选择的代价", "记忆与真相", "忠诚的边界"][seed % 3],
      beats: beats.map((beat, i) => ({
        no: i + 1,
        beat,
        summary: `第 ${i + 1} 个节拍：${beat}。${["以旧物为引子把矛盾摆上台面。", "让盟友做出一次不可逆的背叛。", "把最初的承诺变成需要偿还的债。"][i % 3]}`,
      })),
      structure: "三幕式（5 个节拍 / 12 集）",
      generated_at: new Date().toISOString(),
    };
    await this.patchFissionState(novel, { summary_outline: outline });
    return { summary_outline: outline, llm_mode: this.llm.mode };
  }

  async generateEpisodesOutline(spaceId: string, ntId: string, input: { episode_count?: number; instructions?: string }) {
    const novel = await this.novels.requireNovel(spaceId, ntId);
    this.novels.assertDraftLike(novel, "fission/episodes_outline");
    const state = this.fissionState(novel);
    const outline = asRecord(state.summary_outline);
    const beats = Array.isArray(outline.beats) ? outline.beats : [];
    const episodeCount = Math.max(1, Math.min(input.episode_count ?? (novel.episodeCount > 0 ? novel.episodeCount : 12), 100));
    const result = await this.llm.episodeOutlines({
      title: novel.title,
      episodeCount,
      chapterOutlines: beats.map((beat, i) => ({
        chapterNo: i + 1,
        title: String(asRecord(beat).beat ?? `节拍${i + 1}`),
        synopsis: String(asRecord(beat).summary ?? ""),
      })),
      instructions: input.instructions,
    });
    const rows = await this.novels.replaceEpisodeOutlines(
      novel.id,
      result.episodes.map((e, i) => ({ episodeNo: e.episode_no, title: e.title, synopsis: e.synopsis, sort: i })),
    );
    await db.update(novels).set({ episodeCount: rows.length, updatedAt: new Date() }).where(eq(novels.id, novel.id));
    return { list: rows, count: rows.length, llm_mode: this.llm.mode };
  }

  async listEpisodesOutline(spaceId: string, ntId: string) {
    const novel = await this.novels.requireNovel(spaceId, ntId);
    const rows: NovelEpisodeOutlineRow[] = await db
      .select()
      .from(novelEpisodeOutlines)
      .where(eq(novelEpisodeOutlines.novelId, novel.id))
      .orderBy(asc(novelEpisodeOutlines.episodeNo));
    return { list: rows.map(episodeOutlineDto), total: rows.length };
  }

  // ══════════════════════════════════════════════════════════════
  // 薄路径补完（路径级 1:1）—— 竞品 `routes.txt:535,542,537,540`
  //
  // 上一轮这 4 条竞品路径由"同语义端点"覆盖（列表接口 + select-op），
  // 本轮补成独立路径，目的只有两个：
  //  1. 覆盖核对时能逐条对上（不用解释"这条其实等价于那条"）；
  //  2. 前端按竞品形状取详情时少一次"拉全表再 find"。
  // 每条都**只读**（唯一的写是 `episodes_outline/:neo_id` 的单条编辑，
  // 与其它大纲编辑同一口径），不新增任何状态。
  // ══════════════════════════════════════════════════════════════

  /**
   * `GET /fission_script/chapters_outline`（竞品 `routes.txt:535`）。
   *
   * 裂变链在竞品里同时有 `summary_outline`（总纲）与 `chapters_outline`（分卡章纲）两个产物。
   * 我方裂变链把分卡边界放在 `summary_outline.beats` 里；所以这里：
   * - 本子上有真实 `novel_chapter_outlines` 行（用户跑过 chapter_outline/generate 或本链生成过）→ 直接返回；
   * - 没有 → 返回由节拍**派生**的只读投影，并明确标 `derived_from`，
   *   让调用方知道"这些条没有 id、不可 PATCH"，而不是拿到一堆假 id 再去 PATCH 404。
   */
  async fissionChapterOutlines(spaceId: string, ntId: string) {
    const novel = await this.novels.requireNovel(spaceId, ntId);
    const rows = await db
      .select()
      .from(novelChapterOutlines)
      .where(eq(novelChapterOutlines.novelId, novel.id))
      .orderBy(asc(novelChapterOutlines.chapterNo));
    if (rows.length > 0) {
      return { list: rows.map(chapterOutlineDto), total: rows.length, derived_from: "novel_chapter_outlines" };
    }
    const state = asRecord(asRecord(novel.meta).fission);
    const outline = asRecord(state.summary_outline);
    const beats = Array.isArray(outline.beats) ? (outline.beats as Array<Record<string, unknown>>) : [];
    return {
      list: beats.map((beat, i) => ({
        id: null,
        chapter_no: Number(beat.no ?? i + 1),
        title: String(beat.beat ?? `分卡${i + 1}`),
        synopsis: String(beat.summary ?? ""),
        sort: i,
        readonly: true,
      })),
      total: beats.length,
      derived_from: "meta.fission.summary_outline.beats",
      hint:
        beats.length === 0
          ? "还没有章纲：先 POST summary_outline 生成总纲，或 POST /chapter_outline/generate"
          : "这些条目由总纲节拍派生、没有独立主键，只能读；要持久化请调用 POST /chapter_outline/generate",
    };
  }

  /** `GET /fission_script/idea/:ni_id`（竞品 `routes.txt:542`） */
  async getIdea(spaceId: string, ntId: string, niId: string) {
    const novel = await this.novels.requireNovel(spaceId, ntId);
    const state = this.fissionState(novel);
    const ideas = (Array.isArray(state.ideas) ? state.ideas : []) as Array<Record<string, unknown>>;
    const idea = ideas.find((row) => row.ni_id === niId);
    if (!idea) throw new AppError(ErrorCode.NOT_FOUND, "idea not found", { reason: "idea_not_found" });
    return {
      idea,
      selected: state.selected_ni_id === niId,
      source_nt_id: typeof state.source_nt_id === "string" ? state.source_nt_id : null,
    };
  }

  /** `GET /fission_script/characters/:nc_id`（竞品 `routes.txt:537`；nc_id 即 novel_characters.id） */
  async getCharacter(spaceId: string, ntId: string, ncId: string) {
    const novel = await this.novels.requireNovel(spaceId, ntId);
    let id: bigint;
    try {
      id = BigInt(ncId);
    } catch {
      throw new AppError(ErrorCode.INVALID_PARAM, "invalid nc_id", { field: "nc_id" });
    }
    const [row] = await db
      .select()
      .from(novelCharacters)
      .where(and(eq(novelCharacters.id, id), eq(novelCharacters.novelId, novel.id)));
    if (!row) throw new AppError(ErrorCode.NOT_FOUND, "character not found", { reason: "character_not_found" });
    return { character: characterDto(row) };
  }

  /** `GET /fission_script/episodes_outline/:neo_id`（竞品 `routes.txt:540`） */
  async getEpisodeOutline(spaceId: string, ntId: string, neoId: string) {
    const novel = await this.novels.requireNovel(spaceId, ntId);
    let id: bigint;
    try {
      id = BigInt(neoId);
    } catch {
      throw new AppError(ErrorCode.INVALID_PARAM, "invalid neo_id", { field: "neo_id" });
    }
    const [row] = await db
      .select()
      .from(novelEpisodeOutlines)
      .where(and(eq(novelEpisodeOutlines.id, id), eq(novelEpisodeOutlines.novelId, novel.id)));
    if (!row) throw new AppError(ErrorCode.NOT_FOUND, "episode outline not found", { reason: "neo_not_found" });
    return { episode_outline: episodeOutlineDto(row) };
  }

  /** `PATCH /fission_script/episodes_outline/:neo_id`（同路径的编辑动作，与其它大纲编辑同口径） */
  async patchEpisodeOutline(spaceId: string, ntId: string, neoId: string, input: { title?: string; synopsis?: string }) {
    await this.novels.requireNovel(spaceId, ntId);
    return this.novels.patchEpisodeOutline(spaceId, ntId, neoId, input);
  }

  /** 分集剧本（裂变链的最后一步）直接复用主链的生成逻辑，避免两套写正文代码 */
  async generateEpisodes(spaceId: string, userId: string, ntId: string, input: NovelScriptGenerateRequest) {
    return this.novels.generateScripts(spaceId, ntId, userId, input);
  }

  // ══════════════════════════════════════════════════════════════
  // 2. 海外改编（对照竞品 `ai_noval_overseas_adaptation` 入口，2 端点）
  // ══════════════════════════════════════════════════════════════

  /**
   * 转海外剧本。
   *
   * **幂等**：同一源本子 + 同一目标语言 + 同一区域已存在未归档产物时直接返回它
   * （`replayed: true`）。竞品 `overseas` 每执行一次都会新建一个本子，
   * 用户在网络抖动下重试就会得到两个一模一样的海外本，这里从源头消掉这种重复。
   */
  async overseas(spaceId: string, ntId: string, input: OverseasRequest) {
    const source = await this.novels.requireNovel(spaceId, ntId);
    const episodes = await db
      .select()
      .from(novelEpisodes)
      .where(eq(novelEpisodes.novelId, source.id))
      .orderBy(asc(novelEpisodes.episodeNo));
    const outlines = await db
      .select()
      .from(novelEpisodeOutlines)
      .where(eq(novelEpisodeOutlines.novelId, source.id))
      .orderBy(asc(novelEpisodeOutlines.episodeNo));
    if (episodes.length === 0 && outlines.length === 0) {
      throw new AppError(ErrorCode.INVALID_PARAM, "source novel has neither episode outline nor script", {
        reason: "source_empty",
      });
    }

    const existing = await db
      .select()
      .from(novels)
      .where(
        and(
          eq(novels.spaceId, source.spaceId),
          isNull(novels.archivedAt),
          sql`${novels.meta}->'overseas'->>'source_nt_id' = ${String(source.id)}`,
          sql`${novels.meta}->'overseas'->>'lang' = ${input.lang}`,
          sql`coalesce(${novels.meta}->'overseas'->>'region', '') = ${input.region ?? ""}`,
        ),
      )
      .orderBy(desc(novels.createdAt))
      .limit(1);
    if (existing[0]) {
      return {
        novel: novelDto(existing[0]),
        replayed: true,
        episode_outline_count: (
          await db
            .select({ n: sql<number>`count(*)::int` })
            .from(novelEpisodeOutlines)
            .where(eq(novelEpisodeOutlines.novelId, existing[0]!.id))
        )[0]?.n ?? 0,
        llm_mode: this.llm.mode,
      };
    }

    const title = (input.name ?? `${source.title} · ${input.lang.toUpperCase()} 版`).trim();
    // 同裂变：海外本子没有自己的章节，但后续重写剧本需要素材文本
    const sourceExcerpt = episodes
      .map((episode) => episode.scriptText)
      .join("\n\n")
      .slice(0, NOVEL_LIMITS.SOURCE_TEXT_MAX);
    const [dup] = await db
      .select({ id: novels.id })
      .from(novels)
      .where(and(eq(novels.spaceId, source.spaceId), eq(novels.title, title), isNull(novels.archivedAt)));
    if (dup) {
      throw new AppError(ErrorCode.BAD_REQUEST, "novel title already exists", {
        reason: "duplicate_title",
        field: "name",
      });
    }

    const [created] = await db
      .insert(novels)
      .values({
        id: newId(),
        spaceId: source.spaceId,
        title,
        sourceType: NovelSourceType.OVERSEAS,
        status: NovelStatus.DRAFT,
        ratio: source.ratio,
        episodeCount: input.episode_count ?? (outlines.length || episodes.length),
        meta: {
          source_text: sourceExcerpt,
          overseas: {
            source_nt_id: String(source.id),
            source_title: source.title,
            lang: input.lang,
            region: input.region ?? "",
            created_at: new Date().toISOString(),
          },
        },
      })
      .returning();

    // 海外本子的可见产物：分集大纲（按目标语言/区域重写标题与梗概）。
    // 不给正文是因为"翻译现有剧本"与"用目标语言重写"是两条产品路径，
    // 后者必须让用户重新过一遍剧本生成（否则海外本的正文与大纲会互相矛盾）。
    const targetRows =
      outlines.length > 0
        ? outlines.map((row) => ({ episodeNo: row.episodeNo, title: row.title, synopsis: row.synopsis }))
        : episodes.map((row) => ({
            episodeNo: row.episodeNo,
            title: row.title,
            synopsis: row.scriptText.slice(0, 300),
          }));
    const localized = targetRows.map((row) => ({
      episodeNo: row.episodeNo,
      title: `[${input.lang.toUpperCase()}] ${row.title}`.slice(0, 200),
      synopsis: `${row.synopsis}${input.region ? `（目标区域：${input.region}）` : ""} 本地化要点：称呼、场景与法规表述按目标区域调整。`.slice(
        0,
        1_000,
      ),
      sort: row.episodeNo - 1,
    }));
    await this.novels.replaceEpisodeOutlines(created!.id, localized);
    return {
      novel: novelDto(created!),
      replayed: false,
      episode_outline_count: localized.length,
      llm_mode: this.llm.mode,
    };
  }

  /** 查询某本子的海外改编产物（列表 + 最近一条） */
  async listOverseas(spaceId: string, ntId: string) {
    const source = await this.novels.requireNovel(spaceId, ntId);
    const rows = await db
      .select()
      .from(novels)
      .where(
        and(
          eq(novels.spaceId, source.spaceId),
          isNull(novels.archivedAt),
          sql`${novels.meta}->'overseas'->>'source_nt_id' = ${String(source.id)}`,
        ),
      )
      .orderBy(desc(novels.createdAt));
    return {
      list: rows.map((row) => ({ ...novelDto(row), overseas: asRecord(asRecord(row.meta).overseas) })),
      total: rows.length,
      last: rows[0] ? novelDto(rows[0]) : null,
    };
  }
}
