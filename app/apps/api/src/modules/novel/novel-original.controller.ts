import { Body, Controller, Get, Inject, Param, Patch, Post, Req } from "@nestjs/common";
import { AppError, ErrorCode, novelCharacterCreateSchema, novelCharacterPatchSchema, novelEpisodePatchSchema, novelFinalizeSchema, novelScriptGenerateSchema } from "@app/shared";
import type { AuthedRequest } from "../../common/auth.types";
import { parseOrThrow } from "../../common/zod";
import { NovelOriginalService } from "./novel-original.service";
import {
  characterBatchRenameSchema,
  charactersGenerateSchema,
  originalChapterOutlineGenerateSchema,
  originalEpisodeOutlineGenerateSchema,
  originalIdeaGenerateSchema,
  originalIdeaPatchSchema,
  originalIdeaSelectSchema,
  originalMaterialCreateSchema,
  originalMaterialGenerateSchema,
  originalMaterialPatchSchema,
  originalMaterialSelectSchema,
  originalOutlineGenerateSchema,
  originalOutlinePatchSchema,
  outlinePatchSchema,
} from "./novel.schemas";

/**
 * 原创剧本链 —— `/v1/novel/:ntId/original_script/*`（20 路由）。
 *
 * 路径与竞品逐条对齐（`rea-reelmate/routes.txt:547-564` 的 18 条 original_script 路由中，
 * 除 `characters/*` 5 条外的全部形状），行为证据来自
 * `_acceptance/_gap/cli-skill/reelmate-cli-skill/commands/novel.md`：
 *   - `idea`（`:433-480`）、`material`（`:504-573`）、`outline`（`:575-595`）
 *   - `chapter`（`:597-617`）、`episode`（`:619-639`）、`script`（`:641-661`）、`finalize`（`:663-683`）
 *
 * **`characters/*` 5 条未单列**（偏离，已登记）：原创本子的角色卡走既有
 * `POST /novel/:nt/content-analysis`（世界观 + 角色卡）与 `/core_character/*` —— 
 * 那两条链对 `source_type=2` 同样成立（上下文回落到 `meta.source_text` 的创作灵感），
 * 重复实现一套 characters 路由只会产生第二份"角色卡怎么生成"的真相。
 */
@Controller("novel/:ntId/original_script")
export class NovelOriginalController {
  constructor(@Inject(NovelOriginalService) private readonly original: NovelOriginalService) {}

  private ctx(req: AuthedRequest): { spaceId: string; userId: string } {
    const auth = req.auth;
    if (!auth) throw new AppError(ErrorCode.UNAUTHORIZED, "login required");
    return { spaceId: auth.spaceId, userId: auth.userId };
  }

  // ── 链状态（前端一次拿全七步进度）──────────────────────────

  /** 原创链七步进度（idea → 选定 → 素材 → 总纲 → 分卡章纲 → 集纲 → 剧本 → 定稿） */
  @Get("state")
  async state(@Req() req: AuthedRequest, @Param("ntId") ntId: string) {
    const { spaceId } = this.ctx(req);
    return this.original.chainState(spaceId, ntId);
  }

  // ── 1. 创意方案 ────────────────────────────────────────────

  /** 生成创意方案（竞品 `novel create` 创建即启动，`novel.md:84-88`） */
  @Post("idea")
  async generateIdeas(@Req() req: AuthedRequest, @Param("ntId") ntId: string, @Body() body: unknown) {
    const { spaceId } = this.ctx(req);
    return this.original.generateIdeas(spaceId, ntId, parseOrThrow(originalIdeaGenerateSchema, body ?? {}));
  }

  /** 方案列表（竞品 `novel idea list`，`novel.md:433-455`） */
  @Get("idea")
  async listIdeas(@Req() req: AuthedRequest, @Param("ntId") ntId: string) {
    const { spaceId } = this.ctx(req);
    return this.original.listIdeas(spaceId, ntId);
  }

  /** 选定方案（竞品 `novel idea set`，`novel.md:457-480`：只提交 ni_id + selected=true） */
  @Post("idea/select-op")
  async selectIdea(@Req() req: AuthedRequest, @Param("ntId") ntId: string, @Body() body: unknown) {
    const { spaceId } = this.ctx(req);
    const input = parseOrThrow(originalIdeaSelectSchema, body ?? {});
    return this.original.selectIdea(spaceId, ntId, input.ni_id);
  }

  /** 单条创意方案详情（竞品 `routes.txt:558` `original_script/idea/:ni_id`） */
  @Get("idea/:niId")
  async getIdea(@Req() req: AuthedRequest, @Param("ntId") ntId: string, @Param("niId") niId: string) {
    const { spaceId } = this.ctx(req);
    return this.original.getIdea(spaceId, ntId, niId);
  }

  /** 编辑单条方案（标题/卖点/题材/基调）；已选中也可改，下游已生成时回显 downstream_stale */
  @Patch("idea/:niId")
  async patchIdea(
    @Req() req: AuthedRequest,
    @Param("ntId") ntId: string,
    @Param("niId") niId: string,
    @Body() body: unknown,
  ) {
    const { spaceId } = this.ctx(req);
    return this.original.patchIdea(spaceId, ntId, niId, parseOrThrow(originalIdeaPatchSchema, body ?? {}));
  }

  // ── 2. 素材 ────────────────────────────────────────────────

  /** 生成素材（竞品 `novel material`，`novel.md:504-526`） */
  @Post("materials/generate")
  async generateMaterials(@Req() req: AuthedRequest, @Param("ntId") ntId: string, @Body() body: unknown) {
    const { spaceId } = this.ctx(req);
    return this.original.generateMaterials(spaceId, ntId, parseOrThrow(originalMaterialGenerateSchema, body ?? {}));
  }

  /** 素材列表（竞品 `novel material list`，`novel.md:528-548`） */
  @Get("materials")
  async listMaterials(@Req() req: AuthedRequest, @Param("ntId") ntId: string) {
    const { spaceId } = this.ctx(req);
    return this.original.listMaterials(spaceId, ntId);
  }

  /**
   * 手工新增一条素材（第 90 批；竞品 `POST /df/novel/:nt_id/original_script/materials`）。
   *
   * 与 `materials/generate` 的分工写在 service 里；这里只强调一条路由约定：
   * **静态段 `generate`/`select-op` 必须在参数路由之前声明**，而这条是精确路径
   * `materials`，与 `materials/:nmId`（下一条 GET）不冲突（方法不同、深度不同）。
   */
  @Post("materials")
  async createMaterial(@Req() req: AuthedRequest, @Param("ntId") ntId: string, @Body() body: unknown) {
    const { spaceId } = this.ctx(req);
    return this.original.createMaterial(spaceId, ntId, parseOrThrow(originalMaterialCreateSchema, body ?? {}));
  }

  /** 单条素材（第 90 批；竞品同族路径） */
  @Get("materials/:nmId")
  async getMaterial(@Req() req: AuthedRequest, @Param("ntId") ntId: string, @Param("nmId") nmId: string) {
    const { spaceId } = this.ctx(req);
    return this.original.getMaterial(spaceId, ntId, nmId);
  }

  /** 勾选素材（竞品 `novel material set`，`novel.md:550-573`：加法语义，不取消其它） */
  @Post("materials/select-op")
  async selectMaterial(@Req() req: AuthedRequest, @Param("ntId") ntId: string, @Body() body: unknown) {
    const { spaceId } = this.ctx(req);
    const input = parseOrThrow(originalMaterialSelectSchema, body ?? {});
    return this.original.selectMaterial(spaceId, ntId, input.nm_id);
  }

  /** 编辑单条素材（标题/内容/勾选态） */
  @Patch("materials/:nmId")
  async patchMaterial(
    @Req() req: AuthedRequest,
    @Param("ntId") ntId: string,
    @Param("nmId") nmId: string,
    @Body() body: unknown,
  ) {
    const { spaceId } = this.ctx(req);
    return this.original.patchMaterial(spaceId, ntId, nmId, parseOrThrow(originalMaterialPatchSchema, body ?? {}));
  }

  // ── 3. 总纲及设定 ──────────────────────────────────────────

  /** 生成总纲（竞品 `novel outline`，`novel.md:575-595`） */
  @Post("summary_outline")
  async generateSummaryOutline(@Req() req: AuthedRequest, @Param("ntId") ntId: string, @Body() body: unknown) {
    const { spaceId } = this.ctx(req);
    return this.original.generateSummaryOutline(spaceId, ntId, parseOrThrow(originalOutlineGenerateSchema, body ?? {}));
  }

  @Get("summary_outline")
  async getSummaryOutline(@Req() req: AuthedRequest, @Param("ntId") ntId: string) {
    const { spaceId } = this.ctx(req);
    return this.original.getSummaryOutline(spaceId, ntId);
  }

  /** 总纲编辑（标题/卖点/主题/结构/节拍都可改） */
  @Patch("summary_outline")
  async patchSummaryOutline(@Req() req: AuthedRequest, @Param("ntId") ntId: string, @Body() body: unknown) {
    const { spaceId } = this.ctx(req);
    return this.original.patchSummaryOutline(spaceId, ntId, parseOrThrow(originalOutlinePatchSchema, body ?? {}));
  }

  // ── 4. 分卡章纲 ────────────────────────────────────────────

  /** 生成分卡章纲（竞品 `novel chapter`，`novel.md:597-617`）；由总纲节拍派生 */
  @Post("chapters_outline")
  async generateChapterOutlines(@Req() req: AuthedRequest, @Param("ntId") ntId: string, @Body() body: unknown) {
    const { spaceId } = this.ctx(req);
    return this.original.generateChapterOutlines(
      spaceId,
      ntId,
      parseOrThrow(originalChapterOutlineGenerateSchema, body ?? {}),
    );
  }

  @Get("chapters_outline")
  async listChapterOutlines(@Req() req: AuthedRequest, @Param("ntId") ntId: string) {
    const { spaceId } = this.ctx(req);
    return this.original.listChapterOutlines(spaceId, ntId);
  }

  @Patch("chapters_outline/:ncoId")
  async patchChapterOutline(
    @Req() req: AuthedRequest,
    @Param("ntId") ntId: string,
    @Param("ncoId") ncoId: string,
    @Body() body: unknown,
  ) {
    const { spaceId } = this.ctx(req);
    return this.original.patchChapterOutline(spaceId, ntId, ncoId, parseOrThrow(outlinePatchSchema, body ?? {}));
  }

  // ── 4b. 角色卡（5 条**路径别名**，见 service 注释：语义同 content-analysis / core_character）──

  /** 角色卡列表（路径别名，语义同 `GET /content-analysis/detail` 的 characters） */
  @Get("characters")
  async listCharacters(@Req() req: AuthedRequest, @Param("ntId") ntId: string) {
    const { spaceId } = this.ctx(req);
    return this.original.listCharacters(spaceId, ntId);
  }

  /** 单张角色卡（第 90 批；竞品同族路径。与列表同一 dto，不多不少） */
  @Get("characters/:ncId")
  async getCharacter(@Req() req: AuthedRequest, @Param("ntId") ntId: string, @Param("ncId") ncId: string) {
    const { spaceId } = this.ctx(req);
    return this.original.getCharacter(spaceId, ntId, ncId);
  }

  /**
   * 批量改名（第 90 批；竞品 `POST .../characters/batch-rename`）。
   * 声明在 `characters/:ncId/confirm` 之前：两条都是 2~3 段 POST，
   * 但 `batch-rename` 是静态段，必须先被匹配到，否则会被当成 nc_id。
   */
  @Post("characters/batch-rename")
  async batchRenameCharacters(@Req() req: AuthedRequest, @Param("ntId") ntId: string, @Body() body: unknown) {
    const { spaceId } = this.ctx(req);
    return this.original.batchRenameCharacters(spaceId, ntId, parseOrThrow(characterBatchRenameSchema, body ?? {}));
  }

  /**
   * 生成角色卡（路径别名，语义同 `POST /content-analysis/novel_character_cards/generate`）。
   * 静态段 `generate` 必须声明在 `:ncId` 参数路由之前，避免被当成 nc_id。
   */
  @Post("characters/generate")
  async generateCharacters(@Req() req: AuthedRequest, @Param("ntId") ntId: string, @Body() body: unknown) {
    const { spaceId } = this.ctx(req);
    return this.original.generateCharacters(spaceId, ntId, parseOrThrow(charactersGenerateSchema, body ?? {}));
  }

  /** 新增单张角色卡（路径别名，语义同 `POST /content-analysis/novel_character_cards`；同名即覆盖） */
  @Post("characters")
  async createCharacter(@Req() req: AuthedRequest, @Param("ntId") ntId: string, @Body() body: unknown) {
    const { spaceId } = this.ctx(req);
    return this.original.createCharacter(spaceId, ntId, parseOrThrow(novelCharacterCreateSchema, body ?? {}));
  }

  /** 编辑单张角色卡（路径别名，语义同 `PATCH /content-analysis/novel_character_cards/:ncc_id`） */
  @Patch("characters/:ncId")
  async patchCharacter(
    @Req() req: AuthedRequest,
    @Param("ntId") ntId: string,
    @Param("ncId") ncId: string,
    @Body() body: unknown,
  ) {
    const { spaceId } = this.ctx(req);
    return this.original.patchCharacter(spaceId, ntId, ncId, parseOrThrow(novelCharacterPatchSchema, body ?? {}));
  }

  /** 删除一张角色卡（第 90 批；竞品用 `POST .../characters/:nc_id/delete` 而非 DELETE） */
  @Post("characters/:ncId/delete")
  async deleteCharacter(@Req() req: AuthedRequest, @Param("ntId") ntId: string, @Param("ncId") ncId: string) {
    const { spaceId } = this.ctx(req);
    return this.original.deleteCharacter(spaceId, ntId, ncId);
  }

  /** 确认单张角色卡（路径别名，语义同 `core_character`：置 is_core=true，重复确认幂等） */
  @Post("characters/:ncId/confirm")
  async confirmCharacter(@Req() req: AuthedRequest, @Param("ntId") ntId: string, @Param("ncId") ncId: string) {
    const { spaceId } = this.ctx(req);
    return this.original.confirmCharacter(spaceId, ntId, ncId);
  }

  // ── 5. 集纲 → 分集剧本 ─────────────────────────────────────

  /** 生成集纲（竞品 `novel episode`，`novel.md:619-639`） */
  @Post("episodes_outline")
  async generateEpisodeOutlines(@Req() req: AuthedRequest, @Param("ntId") ntId: string, @Body() body: unknown) {
    const { spaceId } = this.ctx(req);
    return this.original.generateEpisodeOutlines(
      spaceId,
      ntId,
      parseOrThrow(originalEpisodeOutlineGenerateSchema, body ?? {}),
    );
  }

  @Get("episodes_outline")
  async listEpisodeOutlines(@Req() req: AuthedRequest, @Param("ntId") ntId: string) {
    const { spaceId } = this.ctx(req);
    return this.original.listEpisodeOutlines(spaceId, ntId);
  }

  /** 编辑单条集纲（第 90 批；竞品同族路径，语义与改编链 `PATCH /episode_outline/:neo_id` 一致） */
  @Patch("episodes_outline/:neoId")
  async patchEpisodeOutline(
    @Req() req: AuthedRequest,
    @Param("ntId") ntId: string,
    @Param("neoId") neoId: string,
    @Body() body: unknown,
  ) {
    const { spaceId } = this.ctx(req);
    return this.original.patchEpisodeOutline(spaceId, ntId, neoId, parseOrThrow(outlinePatchSchema, body ?? {}));
  }

  /** 生成分集剧本（竞品 `novel script`，`novel.md:641-661`） */
  @Post("episodes")
  async generateEpisodes(@Req() req: AuthedRequest, @Param("ntId") ntId: string, @Body() body: unknown) {
    const { spaceId, userId } = this.ctx(req);
    return this.original.generateEpisodes(spaceId, ntId, userId, parseOrThrow(novelScriptGenerateSchema, body ?? {}));
  }

  /** 编辑单集剧本（改正文产生新版本，与改编链同一不变式） */
  @Patch("episodes/:neId")
  async patchEpisode(
    @Req() req: AuthedRequest,
    @Param("ntId") ntId: string,
    @Param("neId") neId: string,
    @Body() body: unknown,
  ) {
    const { spaceId } = this.ctx(req);
    return this.original.patchEpisode(spaceId, ntId, neId, parseOrThrow(novelEpisodePatchSchema, body ?? {}));
  }

  /** 确认单集（status=2；重复确认幂等） */
  @Post("episodes/:neId/confirm")
  async confirmEpisode(@Req() req: AuthedRequest, @Param("ntId") ntId: string, @Param("neId") neId: string) {
    const { spaceId } = this.ctx(req);
    return this.original.confirmEpisode(spaceId, ntId, neId);
  }

  // ── 6. 定稿 ────────────────────────────────────────────────

  /** 定稿（竞品 `novel finalize`，`novel.md:663-683` → status=16） */
  @Post("finalize")
  async finalize(@Req() req: AuthedRequest, @Param("ntId") ntId: string, @Body() body: unknown) {
    const { spaceId, userId } = this.ctx(req);
    return this.original.finalize(spaceId, ntId, parseOrThrow(novelFinalizeSchema, body ?? {}), userId);
  }
}
