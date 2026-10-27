import { Body, Controller, Get, Inject, Param, Patch, Post, Req } from "@nestjs/common";
import { z } from "zod";
import { AppError, ErrorCode, novelScriptGenerateSchema } from "@app/shared";
import type { AuthedRequest } from "../../common/auth.types";
import { parseOrThrow } from "../../common/zod";
import { NovelVariantService } from "./novel-variant.service";
import {
  chapterOutlineGenerateSchema,
  charactersGenerateSchema,
  outlinePatchSchema,
  episodeOutlineGenerateSchema,
  fissionCreateSchema,
  overseasSchema,
} from "./novel.schemas";

/** 选定创意方案（竞品 `idea/select-op`：只提交当前 ni_id + selected=true） */
const ideaSelectSchema = z.object({ ni_id: z.string().min(1).max(40) });

function ctx(req: AuthedRequest): { spaceId: string; userId: string } {
  const auth = req.auth;
  if (!auth) throw new AppError(ErrorCode.UNAUTHORIZED, "login required");
  return { spaceId: auth.spaceId, userId: auth.userId };
}

/**
 * 创意裂变 —— `/v1/novel/:ntId/fission_script/*`（9 路由）。
 *
 * 对照竞品 `routes.txt:534-544` 的 `fission_script` 子域。产品语义（`novel.md:300-347`）：
 * 从一个**已定稿**的源本子派生新本子，链路是
 * 创意方案（idea）→ 角色 → 总纲（summary_outline）→ 集纲（episodes_outline）→ 分集剧本。
 *
 * 与竞品的一处偏离（已在回报登记）：竞品的 `fission_script/create` 是**集合级**端点
 * （`POST /df/novel/fission_script/create`），我方挂在本子级
 * （`POST /novel/:ntId/fission_script`）—— "从哪个本子裂变"是必填语义，
 * 放集合级会让来源在两处都能指定（两处都可能写错）。
 */
@Controller("novel/:ntId/fission_script")
export class NovelFissionController {
  constructor(@Inject(NovelVariantService) private readonly variants: NovelVariantService) {}

  /** 从本子派生裂变新本子（源本子必须 status=16，否则 400100） */
  @Post()
  async create(@Req() req: AuthedRequest, @Param("ntId") ntId: string, @Body() body: unknown) {
    const { spaceId } = ctx(req);
    return this.variants.createFission(spaceId, ntId, parseOrThrow(fissionCreateSchema, body ?? {}));
  }

  /** 创意方案列表（竞品 `idea`） */
  @Get("idea")
  async listIdeas(@Req() req: AuthedRequest, @Param("ntId") ntId: string) {
    const { spaceId } = ctx(req);
    return this.variants.listIdeas(spaceId, ntId);
  }

  /** 选定一条创意方案（竞品 `idea/select-op`） */
  @Post("idea/select-op")
  async selectIdea(@Req() req: AuthedRequest, @Param("ntId") ntId: string, @Body() body: unknown) {
    const { spaceId } = ctx(req);
    const input = parseOrThrow(ideaSelectSchema, body ?? {});
    return this.variants.selectIdea(spaceId, ntId, input.ni_id);
  }

  /** 裂变本子的角色卡列表 */
  @Get("characters")
  async characters(@Req() req: AuthedRequest, @Param("ntId") ntId: string) {
    const { spaceId } = ctx(req);
    return this.variants.listCharacters(spaceId, ntId);
  }

  /** 生成本子角色（竞品 `characters`） */
  @Post("characters")
  async generateCharacters(@Req() req: AuthedRequest, @Param("ntId") ntId: string, @Body() body: unknown) {
    const { spaceId } = ctx(req);
    return this.variants.generateCharacters(spaceId, ntId, parseOrThrow(charactersGenerateSchema, body ?? {}));
  }

  /** 总纲及设定（竞品 `summary_outline`） */
  @Post("summary_outline")
  async summaryOutline(@Req() req: AuthedRequest, @Param("ntId") ntId: string, @Body() body: unknown) {
    const { spaceId } = ctx(req);
    return this.variants.generateSummaryOutline(
      spaceId,
      ntId,
      parseOrThrow(chapterOutlineGenerateSchema, body ?? {}),
    );
  }

  /** 集纲生成（竞品 `episodes_outline`） */
  @Post("episodes_outline")
  async episodesOutline(@Req() req: AuthedRequest, @Param("ntId") ntId: string, @Body() body: unknown) {
    const { spaceId } = ctx(req);
    return this.variants.generateEpisodesOutline(
      spaceId,
      ntId,
      parseOrThrow(episodeOutlineGenerateSchema, body ?? {}),
    );
  }

  /** 集纲列表 */
  @Get("episodes_outline")
  async listEpisodesOutline(@Req() req: AuthedRequest, @Param("ntId") ntId: string) {
    const { spaceId } = ctx(req);
    return this.variants.listEpisodesOutline(spaceId, ntId);
  }

  // ── 薄路径（路径级 1:1，竞品 routes.txt:535,542,537,540）──────────

  /** 分卡章纲（竞品 `fission_script/chapters_outline`）：真实行优先，否则由总纲节拍派生投影 */
  @Get("chapters_outline")
  async chaptersOutline(@Req() req: AuthedRequest, @Param("ntId") ntId: string) {
    const { spaceId } = ctx(req);
    return this.variants.fissionChapterOutlines(spaceId, ntId);
  }

  /** 单条创意方案（竞品 `fission_script/idea/:ni_id`） */
  @Get("idea/:niId")
  async idea(@Req() req: AuthedRequest, @Param("ntId") ntId: string, @Param("niId") niId: string) {
    const { spaceId } = ctx(req);
    return this.variants.getIdea(spaceId, ntId, niId);
  }

  /** 单个角色（竞品 `fission_script/characters/:nc_id`） */
  @Get("characters/:ncId")
  async character(@Req() req: AuthedRequest, @Param("ntId") ntId: string, @Param("ncId") ncId: string) {
    const { spaceId } = ctx(req);
    return this.variants.getCharacter(spaceId, ntId, ncId);
  }

  /** 单条集纲（竞品 `fission_script/episodes_outline/:neo_id`） */
  @Get("episodes_outline/:neoId")
  async episodeOutline(@Req() req: AuthedRequest, @Param("ntId") ntId: string, @Param("neoId") neoId: string) {
    const { spaceId } = ctx(req);
    return this.variants.getEpisodeOutline(spaceId, ntId, neoId);
  }

  /** 单条集纲编辑（同路径的写动作；与其它大纲编辑同口径） */
  @Patch("episodes_outline/:neoId")
  async patchEpisodeOutline(
    @Req() req: AuthedRequest,
    @Param("ntId") ntId: string,
    @Param("neoId") neoId: string,
    @Body() body: unknown,
  ) {
    const { spaceId } = ctx(req);
    return this.variants.patchEpisodeOutline(spaceId, ntId, neoId, parseOrThrow(outlinePatchSchema, body ?? {}));
  }

  /** 分集剧本（复用主链写正文/版本逻辑） */
  @Post("episodes")
  async episodes(@Req() req: AuthedRequest, @Param("ntId") ntId: string, @Body() body: unknown) {
    const { spaceId, userId } = ctx(req);
    return this.variants.generateEpisodes(spaceId, userId, ntId, parseOrThrow(novelScriptGenerateSchema, body ?? {}));
  }
}

/**
 * 海外改编 —— `/v1/novel/:ntId/overseas`（2 端点）。
 *
 * 竞品入口是配置项 `ai_noval_overseas_adaptation` + `novel overseas` 命令
 * （`novel.md:349-374`）：从已有剧本转成海外剧本。我方表达成
 * "派生一个新本子（source_type=5）+ 复制本地化后的分集大纲"，
 * 并用 `meta.overseas.source_nt_id` 做幂等键（重试不会产生第二个海外本）。
 */
@Controller("novel/:ntId/overseas")
export class NovelOverseasController {
  constructor(@Inject(NovelVariantService) private readonly variants: NovelVariantService) {}

  @Post()
  async create(@Req() req: AuthedRequest, @Param("ntId") ntId: string, @Body() body: unknown) {
    const { spaceId } = ctx(req);
    return this.variants.overseas(spaceId, ntId, parseOrThrow(overseasSchema, body ?? {}));
  }

  @Get()
  async list(@Req() req: AuthedRequest, @Param("ntId") ntId: string) {
    const { spaceId } = ctx(req);
    return this.variants.listOverseas(spaceId, ntId);
  }
}
