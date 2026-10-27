import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, Put, Query, Req } from "@nestjs/common";
import { z } from "zod";
import {
  AppError,
  ErrorCode,
  chapterOutlinesPutSchema,
  createNovelSchema,
  episodeOutlinesPutSchema,
  novelCharacterCreateSchema,
  novelCharacterPatchSchema,
  novelCharactersConfirmSchema,
  novelEpisodePatchSchema,
  novelFinalizeSchema,
  novelPatchSchema,
  novelScriptGenerateSchema,
  novelSplitSchema,
  worldviewPutSchema,
} from "@app/shared";
import type { AuthedRequest } from "../../common/auth.types";
import { parseOrThrow } from "../../common/zod";
import { NovelService } from "./novel.service";
import {
  chapterListQuerySchema,
  reopenSchema,
  chapterOutlineGenerateSchema,
  charactersGenerateSchema,
  contentAnalysisSchema,
  coreCharacterGenerateSchema,
  episodeOutlineGenerateSchema,
  listQuerySchema,
  outlinePatchSchema,
} from "./novel.schemas";

/**
 * 小说改编链主控制器 —— `/v1/novel/*`。
 *
 * 路由划分沿用 ADR-009：竞品是 `/web/v1/df/novel/:nt_id/...`，我方按 ADR-009
 * 把 `df` 拆成 `script`/`canvas`/`novel`（`_acceptance/_gap/f1-domain-contract-overview.md:40`），
 * 故前缀是 `novel` 而不是 `df/novel`；子路径保持竞品形状（`content-analysis` /
 * `chapter_outline` / `episode_outline` / `core_character` / `script-generate` …），
 * 便于逐条做覆盖核对（`rea-reelmate/routes.txt:515-580`）。
 *
 * 三层分工（与 `kds` 模板一致）：控制器只做**取 auth + 解析参数 + 转发**，
 * 权限与业务判断全在 service；错误一律 `AppError`，由全局 filter 转成信封。
 */
@Controller("novel")
export class NovelController {
  constructor(@Inject(NovelService) private readonly novels: NovelService) {}

  /** 取调用者上下文；未登录是 META 错误（AuthGuard 已拦，这里兜底防御） */
  private ctx(req: AuthedRequest): { spaceId: string; userId: string } {
    const auth = req.auth;
    if (!auth) throw new AppError(ErrorCode.UNAUTHORIZED, "login required");
    return { spaceId: auth.spaceId, userId: auth.userId };
  }

  // ── 本子 CRUD ──────────────────────────────────────────────

  /** 新建本子（`source_text` 非空时同时完成分章，对齐竞品"上传即拆解"） */
  @Post()
  async create(@Req() req: AuthedRequest, @Body() body: unknown) {
    const { spaceId } = this.ctx(req);
    return this.novels.create(spaceId, parseOrThrow(createNovelSchema, body ?? {}));
  }

  /** 列表（竞品 `novel list`；默认不返回归档） */
  @Get("list")
  async list(@Req() req: AuthedRequest, @Query() query: unknown) {
    const { spaceId } = this.ctx(req);
    return this.novels.list(spaceId, parseOrThrow(listQuerySchema, query ?? {}));
  }

  /** 详情（带各阶段进度计数，工作台首屏一次拿全） */
  @Get(":ntId")
  async detail(@Req() req: AuthedRequest, @Param("ntId") ntId: string) {
    const { spaceId } = this.ctx(req);
    return this.novels.detail(spaceId, ntId);
  }

  @Patch(":ntId")
  async patch(@Req() req: AuthedRequest, @Param("ntId") ntId: string, @Body() body: unknown) {
    const { spaceId } = this.ctx(req);
    return this.novels.patch(spaceId, ntId, parseOrThrow(novelPatchSchema, body ?? {}));
  }

  /** 删除 = 归档（理由见 service.archive 注释） */
  @Delete(":ntId")
  async archive(@Req() req: AuthedRequest, @Param("ntId") ntId: string) {
    const { spaceId } = this.ctx(req);
    return this.novels.archive(spaceId, ntId);
  }

  // ── 1. 分章解析（split 子链）────────────────────────────────

  @Post(":ntId/split")
  async split(@Req() req: AuthedRequest, @Param("ntId") ntId: string, @Body() body: unknown) {
    const { spaceId } = this.ctx(req);
    return this.novels.split(spaceId, ntId, parseOrThrow(novelSplitSchema, body ?? {}));
  }

  /** 章节列表（不含正文；竞品 `novel_chapters/list`） */
  @Get(":ntId/chapters")
  async chapters(@Req() req: AuthedRequest, @Param("ntId") ntId: string, @Query() query: unknown) {
    const { spaceId } = this.ctx(req);
    return this.novels.listChapters(spaceId, ntId, parseOrThrow(chapterListQuerySchema, query ?? {}));
  }

  /** 单章正文 */
  @Get(":ntId/chapters/:chapterNo")
  async chapter(
    @Req() req: AuthedRequest,
    @Param("ntId") ntId: string,
    @Param("chapterNo") chapterNo: string,
  ) {
    const { spaceId } = this.ctx(req);
    const no = parseOrThrow(noSchema, { no: chapterNo }).no;
    return this.novels.getChapter(spaceId, ntId, no);
  }

  // ── 2. 内容分析：世界观 + 角色卡（content-analysis 子链）──────

  @Post(":ntId/content-analysis")
  async analyze(@Req() req: AuthedRequest, @Param("ntId") ntId: string, @Body() body: unknown) {
    const { spaceId } = this.ctx(req);
    return this.novels.analyze(spaceId, ntId, parseOrThrow(contentAnalysisSchema, body ?? {}));
  }

  @Get(":ntId/content-analysis/detail")
  async analysisDetail(@Req() req: AuthedRequest, @Param("ntId") ntId: string) {
    const { spaceId } = this.ctx(req);
    return this.novels.analysisDetail(spaceId, ntId);
  }

  @Get(":ntId/content-analysis/worldview")
  async getWorldview(@Req() req: AuthedRequest, @Param("ntId") ntId: string) {
    const { spaceId } = this.ctx(req);
    return this.novels.getWorldview(spaceId, ntId);
  }

  /** 世界观覆盖写（LLM 结果与人工编辑共用同一形状） */
  @Put(":ntId/content-analysis/worldview")
  async putWorldview(@Req() req: AuthedRequest, @Param("ntId") ntId: string, @Body() body: unknown) {
    const { spaceId } = this.ctx(req);
    return this.novels.putWorldview(spaceId, ntId, parseOrThrow(worldviewPutSchema, body ?? {}));
  }

  /**
   * 角色卡重生成。
   *
   * 静态段 `generate` 必须放在 `:nccId` 参数路由之前（Nest 按声明顺序注册，
   * 而 find-my-way 对同层的静态段优先 —— 两条保险都留着，避免以后有人调换顺序）。
   */
  @Post(":ntId/content-analysis/novel_character_cards/generate")
  async generateCards(@Req() req: AuthedRequest, @Param("ntId") ntId: string, @Body() body: unknown) {
    const { spaceId } = this.ctx(req);
    return this.novels.generateCharacters(spaceId, ntId, parseOrThrow(charactersGenerateSchema, body ?? {}));
  }

  /** 批量确认 LLM 草稿 */
  @Post(":ntId/content-analysis/novel_character_cards/confirm")
  async confirmCards(@Req() req: AuthedRequest, @Param("ntId") ntId: string, @Body() body: unknown) {
    const { spaceId } = this.ctx(req);
    return this.novels.confirmCharacters(spaceId, ntId, parseOrThrow(novelCharactersConfirmSchema, body ?? {}));
  }

  /** 新建单张角色卡（同名即覆盖 → 幂等；响应 replayed 标明是不是重放） */
  @Post(":ntId/content-analysis/novel_character_cards")
  async createCard(@Req() req: AuthedRequest, @Param("ntId") ntId: string, @Body() body: unknown) {
    const { spaceId } = this.ctx(req);
    return this.novels.createCharacter(spaceId, ntId, parseOrThrow(novelCharacterCreateSchema, body ?? {}));
  }

  @Patch(":ntId/content-analysis/novel_character_cards/:nccId")
  async patchCard(
    @Req() req: AuthedRequest,
    @Param("ntId") ntId: string,
    @Param("nccId") nccId: string,
    @Body() body: unknown,
  ) {
    const { spaceId } = this.ctx(req);
    return this.novels.patchCharacter(spaceId, ntId, nccId, parseOrThrow(novelCharacterPatchSchema, body ?? {}));
  }

  @Delete(":ntId/content-analysis/novel_character_cards/:nccId")
  async deleteCard(@Req() req: AuthedRequest, @Param("ntId") ntId: string, @Param("nccId") nccId: string) {
    const { spaceId } = this.ctx(req);
    return this.novels.deleteCharacter(spaceId, ntId, nccId);
  }

  // ── 3. 章节大纲（chapter_outline 子链 / nco_id）──────────────

  @Post(":ntId/chapter_outline/generate")
  async generateChapterOutlines(@Req() req: AuthedRequest, @Param("ntId") ntId: string, @Body() body: unknown) {
    const { spaceId } = this.ctx(req);
    return this.novels.generateChapterOutlines(spaceId, ntId, parseOrThrow(chapterOutlineGenerateSchema, body ?? {}));
  }

  @Get(":ntId/chapter_outline/list")
  async listChapterOutlines(@Req() req: AuthedRequest, @Param("ntId") ntId: string) {
    const { spaceId } = this.ctx(req);
    return this.novels.listChapterOutlines(spaceId, ntId);
  }

  /** 整体替换（用户批量编辑 / 确认 LLM 结果） */
  @Post(":ntId/chapter_outline")
  async putChapterOutlines(@Req() req: AuthedRequest, @Param("ntId") ntId: string, @Body() body: unknown) {
    const { spaceId } = this.ctx(req);
    return this.novels.putChapterOutlines(spaceId, ntId, parseOrThrow(chapterOutlinesPutSchema, body ?? {}));
  }

  @Patch(":ntId/chapter_outline/:ncoId")
  async patchChapterOutline(
    @Req() req: AuthedRequest,
    @Param("ntId") ntId: string,
    @Param("ncoId") ncoId: string,
    @Body() body: unknown,
  ) {
    const { spaceId } = this.ctx(req);
    return this.novels.patchChapterOutline(spaceId, ntId, ncoId, parseOrThrow(outlinePatchSchema, body ?? {}));
  }

  // ── 4. 分集大纲（episode_outline 子链 / neo_id）─────────────

  @Post(":ntId/episode_outline/generate")
  async generateEpisodeOutlines(@Req() req: AuthedRequest, @Param("ntId") ntId: string, @Body() body: unknown) {
    const { spaceId } = this.ctx(req);
    return this.novels.generateEpisodeOutlines(spaceId, ntId, parseOrThrow(episodeOutlineGenerateSchema, body ?? {}));
  }

  @Get(":ntId/episode_outline/list")
  async listEpisodeOutlines(@Req() req: AuthedRequest, @Param("ntId") ntId: string) {
    const { spaceId } = this.ctx(req);
    return this.novels.listEpisodeOutlines(spaceId, ntId);
  }

  @Post(":ntId/episode_outline")
  async putEpisodeOutlines(@Req() req: AuthedRequest, @Param("ntId") ntId: string, @Body() body: unknown) {
    const { spaceId } = this.ctx(req);
    return this.novels.putEpisodeOutlines(spaceId, ntId, parseOrThrow(episodeOutlinesPutSchema, body ?? {}));
  }

  @Patch(":ntId/episode_outline/:neoId")
  async patchEpisodeOutline(
    @Req() req: AuthedRequest,
    @Param("ntId") ntId: string,
    @Param("neoId") neoId: string,
    @Body() body: unknown,
  ) {
    const { spaceId } = this.ctx(req);
    return this.novels.patchEpisodeOutline(spaceId, ntId, neoId, parseOrThrow(outlinePatchSchema, body ?? {}));
  }

  // ── 5. 核心角色（core_character 子链）───────────────────────

  @Post(":ntId/core_character/generate")
  async generateCoreCharacters(@Req() req: AuthedRequest, @Param("ntId") ntId: string, @Body() body: unknown) {
    const { spaceId } = this.ctx(req);
    return this.novels.generateCoreCharacters(spaceId, ntId, parseOrThrow(coreCharacterGenerateSchema, body ?? {}));
  }

  @Get(":ntId/core_character/list")
  async listCoreCharacters(@Req() req: AuthedRequest, @Param("ntId") ntId: string) {
    const { spaceId } = this.ctx(req);
    return this.novels.listCoreCharacters(spaceId, ntId);
  }

  @Post(":ntId/core_character")
  async createCoreCharacter(@Req() req: AuthedRequest, @Param("ntId") ntId: string, @Body() body: unknown) {
    const { spaceId } = this.ctx(req);
    return this.novels.createCoreCharacter(spaceId, ntId, parseOrThrow(novelCharacterCreateSchema, body ?? {}));
  }

  @Patch(":ntId/core_character/:nccId")
  async patchCoreCharacter(
    @Req() req: AuthedRequest,
    @Param("ntId") ntId: string,
    @Param("nccId") nccId: string,
    @Body() body: unknown,
  ) {
    const { spaceId } = this.ctx(req);
    return this.novels.patchCoreCharacter(spaceId, ntId, nccId, parseOrThrow(novelCharacterPatchSchema, body ?? {}));
  }

  // ── 6. 分集剧本（script-generate + episode/*）───────────────

  /** 多集批量生成（竞品 `script-generate`） */
  @Post(":ntId/script-generate")
  async generateScripts(@Req() req: AuthedRequest, @Param("ntId") ntId: string, @Body() body: unknown) {
    const { spaceId, userId } = this.ctx(req);
    return this.novels.generateScripts(spaceId, ntId, userId, parseOrThrow(novelScriptGenerateSchema, body ?? {}));
  }

  @Get(":ntId/episode/list")
  async listEpisodes(@Req() req: AuthedRequest, @Param("ntId") ntId: string) {
    const { spaceId } = this.ctx(req);
    return this.novels.listEpisodes(spaceId, ntId);
  }

  @Get(":ntId/episode/:neId")
  async getEpisode(@Req() req: AuthedRequest, @Param("ntId") ntId: string, @Param("neId") neId: string) {
    const { spaceId } = this.ctx(req);
    return this.novels.getEpisode(spaceId, ntId, neId);
  }

  @Patch(":ntId/episode/:neId")
  async patchEpisode(
    @Req() req: AuthedRequest,
    @Param("ntId") ntId: string,
    @Param("neId") neId: string,
    @Body() body: unknown,
  ) {
    const { spaceId } = this.ctx(req);
    return this.novels.patchEpisode(spaceId, ntId, neId, parseOrThrow(novelEpisodePatchSchema, body ?? {}));
  }

  /** 人工确认单集（status=2） */
  @Post(":ntId/episode/:neId/confirm")
  async confirmEpisode(@Req() req: AuthedRequest, @Param("ntId") ntId: string, @Param("neId") neId: string) {
    const { spaceId } = this.ctx(req);
    return this.novels.confirmEpisode(spaceId, ntId, neId);
  }

  // ── 7. 汇总 / 定稿 / 版本 ──────────────────────────────────

  @Get(":ntId/summary")
  async summary(@Req() req: AuthedRequest, @Param("ntId") ntId: string) {
    const { spaceId } = this.ctx(req);
    return this.novels.summary(spaceId, ntId);
  }

  /** 整本定稿 → status=16（§3.3 衔接契约入口；重复调用幂等） */
  @Post(":ntId/finalize")
  async finalize(@Req() req: AuthedRequest, @Param("ntId") ntId: string, @Body() body: unknown) {
    const { spaceId, userId } = this.ctx(req);
    return this.novels.finalize(spaceId, ntId, parseOrThrow(novelFinalizeSchema, body ?? {}), userId);
  }

  /**
   * 撤回定稿：status 16 → 1。
   *
   * 被拆集引用时返回 **400105** + `reason=referenced_by_split`（不回退、不静默），
   * 理由与判据见 `NovelService.reopen` 的注释。
   */
  @Post(":ntId/reopen")
  async reopen(@Req() req: AuthedRequest, @Param("ntId") ntId: string, @Body() body: unknown) {
    const { spaceId } = this.ctx(req);
    return this.novels.reopen(spaceId, ntId, parseOrThrow(reopenSchema, body ?? {}));
  }

  @Get(":ntId/version/list")
  async versions(@Req() req: AuthedRequest, @Param("ntId") ntId: string, @Query() query: unknown) {
    const { spaceId } = this.ctx(req);
    return this.novels.listVersions(spaceId, ntId, parseOrThrow(listQuerySchema, query ?? {}));
  }
}

/** 路径里的正整数（章号）—— 单独一条，避免为它引入整个 query schema */
const noSchema = z.object({ no: z.coerce.number().int().min(1).max(100_000) });
