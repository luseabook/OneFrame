import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, Put, Query, Req } from "@nestjs/common";
import { z } from "zod";
import {
  charactersGenerateSchema,
  createProjectSchema,
  episodePatchSchema,
  generateVideosBatchSchema,
  outlineConfirmSchema,
  portraitGenerateSchema,
  portraitRebindSchema,
  portraitSelectSchema,
  projectAssetCreateSchema,
  projectAssetImageGenerateSchema,
  projectAssetImageSelectSchema,
  projectAssetKindSchema,
  projectAssetPatchSchema,
  projectAssetsExtractSchema,
  projectPatchSchema,
  scriptDraftGenerateSchema,
  splitEpisodesRequestSchema,
  storyboardAssetsPutSchema,
  storyboardsGenerateSchema,
  storyboardPatchSchema,
} from "@app/shared";
import type { AuthedRequest } from "../../common/auth.types";
import { parseOrThrow } from "../../common/zod";
import { AssetMatchService } from "./asset-match.service";
import { FilmSynthesisService } from "./film-synthesis.service";
import { ParseService } from "./parse.service";
import { PublishService } from "./publish.service";
import { QualityCheckService } from "./quality-check.service";
import { ScriptService } from "./script.service";
import { timelinePutSchema } from "./timeline.schema";

/** 上传剧本解析请求：前端把文件读成 base64 提交（不依赖 multipart 依赖） */
const parseScriptSchema = z.object({
  file_name: z.string().min(1).max(255),
  file_base64: z.string().min(1).max(12_000_000),
});

/** P2 项目资产列表过滤：kind 省略时返回该项目全部资产（含角色） */
const projectAssetsQuerySchema = z.object({ kind: projectAssetKindSchema.optional() });

/**
 * 拆集来源（completion-plan §3.3 衔接契约）：传了 `source.kind=novel` 就走小说链，
 * 只接受已定稿（status=16）的本子，由 `NovelService.assertSplittable` 判定；
 * 不传则保持原有行为（用脚本正文/项目原文拆集）。
 */
const splitWithSourceSchema = splitEpisodesRequestSchema.extend({
  source: z
    .object({
      kind: z.literal("novel"),
      nt_id: z.string().min(1),
    })
    .optional(),
});

const matchDryRunSchema = z.object({ dry_run: z.boolean().optional() });

/** 匹配项：`resource_id` 是项目资产 id；`name` 可选（服务端以资产名为准） */
const matchResourceEntrySchema = z.object({
  resource_id: z.string().min(1),
  name: z.string().max(80).optional(),
});

/**
 * `save-resource-matches` 的**完整快照**入参（`episode.md:368-388`）：
 * 三个数组必须同时给，空类别显式传 `[]`；漏传类别一律 400101（不会被清空）。
 */
const saveResourceMatchesSchema = z.object({
  resources: z.object({
    characters: z.array(matchResourceEntrySchema).max(100),
    scenes: z.array(matchResourceEntrySchema).max(100),
    props: z.array(matchResourceEntrySchema).max(100),
  }),
});

const supplementMissingSchema = z.object({
  asset_ids: z.array(z.string().min(1)).max(100).optional(),
  dry_run: z.boolean().optional(),
});

/** 分镜表一行（贴表解析）：镜号/描述/提示词/时长，后两项可缺 */
const parseTableRowSchema = z.object({
  shot_no: z.number().int().min(1).max(999),
  shot_desc: z.string().min(1).max(500),
  video_prompt: z.string().max(2000).optional(),
  duration_s: z.number().int().min(1).max(30).optional(),
  ratio: z.string().max(16).optional(),
  resolution: z.string().max(16).optional(),
});

const episodeParseSchema = z.object({
  episode_id: z.string().min(1),
  table: z.array(parseTableRowSchema).min(1).max(200).optional(),
  /** 纯文本分镜表（Markdown/TSV）：镜号 | 描述 | 提示词 | 时长 */
  text: z.string().max(200_000).optional(),
  mode: z.enum(["replace", "merge"]).optional(),
  dry_run: z.boolean().optional(),
});

const episodeParseResetSchema = z.object({
  episode_id: z.string().min(1),
  backup_key: z.string().min(1).max(300).optional(),
  dry_run: z.boolean().optional(),
});

const episodeParseRetrySchema = z.object({ episode_id: z.string().min(1) });

const publishSchema = z.object({
  title: z.string().trim().max(100).optional(),
  slice: z
    .object({
      start_ms: z.number().int().min(0).optional(),
      end_ms: z.number().int().min(1).optional(),
      clip_ids: z.array(z.string().min(1).max(64)).max(100).optional(),
    })
    .optional(),
  export_id: z.string().min(1).optional(),
  dry_run: z.boolean().optional(),
});

const publicationListQuery = z.object({
  status: z.coerce.number().int().min(1).max(5).optional(),
  page: z.coerce.number().int().min(1).optional(),
  page_size: z.coerce.number().int().min(1).max(100).optional(),
});

const clipAssetsSchema = z.object({
  asset_ids: z.array(z.string().min(1)).max(20).optional(),
  task_id: z.string().min(1).optional(),
  clear: z.boolean().optional(),
});

/** 作品库查询：形态（tab/kind）+ 状态 + 时间 + 关键词 + 四态 */
const worksQuerySchema = z.object({
  tab: z.enum(["workshop", "canvas", "all"]).optional(),
  kind: z.enum(["workshop", "canvas"]).optional(),
  status: z.enum(["archived", "active", "all"]).optional(),
  state: z.enum(["draft", "producing", "ready", "archived"]).optional(),
  keyword: z.string().max(80).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  page: z.coerce.number().int().min(1).optional(),
  page_size: z.coerce.number().int().min(1).max(60).optional(),
});

@Controller()
export class ScriptController {
  constructor(
    @Inject(ScriptService) private readonly script: ScriptService,
    @Inject(AssetMatchService) private readonly match: AssetMatchService,
    @Inject(QualityCheckService) private readonly quality: QualityCheckService,
    @Inject(FilmSynthesisService) private readonly synthesis: FilmSynthesisService,
    @Inject(ParseService) private readonly parser: ParseService,
    @Inject(PublishService) private readonly publish: PublishService,
  ) {}

  @Post("projects")
  async create(@Req() req: AuthedRequest, @Body() body: unknown) {
    const input = parseOrThrow(createProjectSchema, body);
    return this.script.createProject(req.auth?.spaceId ?? "", input);
  }

  /** 新建项目「上传剧本」：解析 txt/md/csv/docx/xlsx（只解析、不入库） */
  @Post("projects/parse-script")
  async parseScript(@Body() body: unknown) {
    const input = parseOrThrow(parseScriptSchema, body);
    return this.script.parseScript(input.file_name, input.file_base64);
  }

  @Get("projects")
  async list(@Req() req: AuthedRequest, @Query("page") page?: string, @Query("page_size") pageSize?: string) {
    return this.script.listProjects(req.auth?.spaceId ?? "", Number(page ?? 1), Number(pageSize ?? 20));
  }

  /**
   * 作品库（PRD 增补 §1.3 / task-10 §2）：工坊项目 + 画布项目聚合。
   * 支持形态（tab/kind）、状态、四态、关键词、时间区间筛选与 has_more。
   */
  @Get("works")
  async works(@Req() req: AuthedRequest, @Query() query: unknown) {
    const q = parseOrThrow(worksQuerySchema, query ?? {});
    return this.script.listWorks(req.auth?.spaceId ?? "", {
      tab: q.tab,
      kind: q.kind,
      status: q.status,
      state: q.state,
      keyword: q.keyword,
      from: q.from,
      to: q.to,
      page: q.page ?? 1,
      pageSize: q.page_size ?? 24,
    });
  }

  /** 归档 / 恢复作品 */
  @Post("projects/:id/archive")
  async setArchived(@Req() req: AuthedRequest, @Param("id") id: string, @Body() body: unknown) {
    const archived = Boolean((body as { archived?: boolean } | null)?.archived ?? true);
    return this.script.setArchived(req.auth?.spaceId ?? "", id, archived);
  }

  /** 二次创作：新增空集（复用已定稿角色） */
  @Post("projects/:id/episodes")
  async createEpisodes(@Req() req: AuthedRequest, @Param("id") id: string, @Body() body: unknown) {
    const count = Number((body as { count?: number } | null)?.count ?? 1);
    return this.script.addEpisodes(req.auth?.spaceId ?? "", id, count);
  }

  /** 复制为我的项目（示例作品体验，PRD 增补 §3.2） */
  @Post("projects/:id/duplicate")
  async duplicate(@Req() req: AuthedRequest, @Param("id") id: string) {
    return this.script.duplicateProject(req.auth?.spaceId ?? "", id);
  }

  @Get("projects/:id")
  async detail(@Req() req: AuthedRequest, @Param("id") id: string) {
    return this.script.getProject(req.auth?.spaceId ?? "", id);
  }

  @Patch("projects/:id")
  async patch(@Req() req: AuthedRequest, @Param("id") id: string, @Body() body: unknown) {
    const input = parseOrThrow(projectPatchSchema, body);
    return this.script.patchProject(req.auth?.spaceId ?? "", id, input);
  }

  @Delete("projects/:id")
  async archive(@Req() req: AuthedRequest, @Param("id") id: string) {
    return this.script.archiveProject(req.auth?.spaceId ?? "", id);
  }


  @Post("projects/:id/episodes/split")
  async split(@Req() req: AuthedRequest, @Param("id") id: string, @Body() body: unknown) {
    const input = parseOrThrow(splitWithSourceSchema, body ?? {});
    const { source, ...rest } = input;
    return this.script.splitEpisodes(req.auth?.spaceId ?? "", id, rest, source);
  }

  // ── 分镜表解析子链（竞品 process/parse/{generate,delete} + parse-retry）────

  /**
   * 贴表解析成 storyboards（竞品 `df/episode/:ep_id/process/parse/generate`）。
   * **覆盖前先备份**：没有备份 `parse-reset` 就还原不回来。
   */
  @Post("projects/:id/episodes/parse")
  async parseStoryboards(@Req() req: AuthedRequest, @Param("id") id: string, @Body() body: unknown) {
    const input = parseOrThrow(episodeParseSchema, body);
    return this.parser.parse(req.auth?.spaceId ?? "", id, input);
  }

  /** 解析重置（竞品 `process/parse/delete`）：恢复到最近一次解析前的快照 */
  @Post("projects/:id/episodes/parse-reset")
  async parseReset(@Req() req: AuthedRequest, @Param("id") id: string, @Body() body: unknown) {
    const input = parseOrThrow(episodeParseResetSchema, body);
    return this.parser.reset(req.auth?.spaceId ?? "", id, input);
  }

  /** 解析重试（竞品 `episode parse-retry`）：按最近一次输入原样重跑 */
  @Post("projects/:id/episodes/parse-retry")
  async parseRetry(@Req() req: AuthedRequest, @Param("id") id: string, @Body() body: unknown) {
    const input = parseOrThrow(episodeParseRetrySchema, body);
    return this.parser.retry(req.auth?.spaceId ?? "", id, input);
  }

  // ── 分集质量检查（只读）+ 分集合成导出 ─────────────────────────────────

  /**
   * 质量检查（竞品 `routes.txt:445` `/df/episode/:ep_id/quality-check`）：**只读**，
   * 返回 issues[] + score；评分口径（每项权重与理由）见 `quality-check.service.ts` 注释。
   */
  @Post("projects/:id/episodes/:eid/quality-check")
  async qualityCheck(
    @Req() req: AuthedRequest,
    @Param("id") id: string,
    @Param("eid") eid: string,
  ) {
    return this.quality.check(req.auth?.spaceId ?? "", id, eid);
  }

  /**
   * 分集合成导出：同步判 80% 闸门（不足 → 400106），通过后同时下发
   * zip 包（exports 四态）与成片 mp4（timeline_exports，含 AI 水印）两个 job。
   */
  @Post("projects/:id/episodes/:eid/film-synthesis-export")
  async filmSynthesisExport(
    @Req() req: AuthedRequest,
    @Param("id") id: string,
    @Param("eid") eid: string,
  ) {
    return this.synthesis.filmSynthesisExport(req.auth?.spaceId ?? "", id, eid);
  }

  // ── 环节 4：资产 × 分镜匹配（asset-match）────────────────────────────

  /**
   * 执行本集资产匹配（竞品 `episode match-resources` 的「资产匹配」半段）。
   * 组合任务里服务端匹配完会自动拆镜；我方拆镜仍由
   * `POST .../storyboards/generate` 显式触发（偏离已登记）。
   */
  @Post("projects/:id/episodes/:eid/match-resources")
  async matchResources(
    @Req() req: AuthedRequest,
    @Param("id") id: string,
    @Param("eid") eid: string,
    @Body() body: unknown,
  ) {
    const input = parseOrThrow(matchDryRunSchema, body ?? {});
    return this.match.matchResources(req.auth?.spaceId ?? "", id, eid, input);
  }

  /** 匹配结果：characters/scenes/props 三数组 + 三态统计 + 智能补充三选项 */
  @Get("projects/:id/episodes/:eid/match-result")
  async matchResult(
    @Req() req: AuthedRequest,
    @Param("id") id: string,
    @Param("eid") eid: string,
  ) {
    return this.match.matchResult(req.auth?.spaceId ?? "", id, eid);
  }

  /** 匹配重置（破坏性；`dry_run=true` 只预演不写） */
  @Post("projects/:id/episodes/:eid/match-reset")
  async matchReset(
    @Req() req: AuthedRequest,
    @Param("id") id: string,
    @Param("eid") eid: string,
    @Body() body: unknown,
  ) {
    const input = parseOrThrow(matchDryRunSchema, body ?? {});
    return this.match.resetMatches(req.auth?.spaceId ?? "", id, eid, input);
  }

  /** 保存匹配关系（**完整快照**：三类数组必须同时给，空类别显式 `[]`） */
  @Post("projects/:id/episodes/:eid/save-resource-matches")
  async saveResourceMatches(
    @Req() req: AuthedRequest,
    @Param("id") id: string,
    @Param("eid") eid: string,
    @Body() body: unknown,
  ) {
    const input = parseOrThrow(saveResourceMatchesSchema, body);
    return this.match.saveResourceMatches(req.auth?.spaceId ?? "", id, eid, input);
  }

  /**
   * 缺失资产智能补充（7 条件全满足才进候选；三选项默认「保持现状」）。
   * 生图不在本端点扣费：需要生图的目标以 `next_actions` 返回，由既有
   * `POST /projects/{id}/assets/{aid}/generate-image` 走报价确认。
   */
  @Post("projects/:id/episodes/:eid/supplement-missing")
  async supplementMissing(
    @Req() req: AuthedRequest,
    @Param("id") id: string,
    @Param("eid") eid: string,
    @Body() body: unknown,
  ) {
    const input = parseOrThrow(supplementMissingSchema, body ?? {});
    return this.match.supplementMissing(req.auth?.spaceId ?? "", id, eid, input);
  }

  @Post("projects/:id/outline/generate")
  async outline(@Req() req: AuthedRequest, @Param("id") id: string) {
    return this.script.generateOutline(req.auth?.spaceId ?? "", id);
  }

  @Put("projects/:id/outline")
  async confirmOutline(@Req() req: AuthedRequest, @Param("id") id: string, @Body() body: unknown) {
    const input = parseOrThrow(outlineConfirmSchema, body);
    return this.script.confirmOutline(req.auth?.spaceId ?? "", id, input);
  }

  @Post("projects/:id/characters/generate")
  async characters(@Req() req: AuthedRequest, @Param("id") id: string, @Body() body: unknown) {
    const input = parseOrThrow(charactersGenerateSchema, body ?? {});
    return this.script.generateCharacters(req.auth?.spaceId ?? "", id, input);
  }

  @Post("projects/:id/episodes/:eid/script-draft/generate")
  async scriptDraft(
    @Req() req: AuthedRequest,
    @Param("id") id: string,
    @Param("eid") eid: string,
    @Body() body: unknown,
  ) {
    const input = parseOrThrow(scriptDraftGenerateSchema, body ?? {});
    return this.script.generateScriptDraft(req.auth?.spaceId ?? "", id, eid, input);
  }

  @Post("projects/:id/episodes/:eid/storyboards/generate")
  async storyboards(
    @Req() req: AuthedRequest,
    @Param("id") id: string,
    @Param("eid") eid: string,
    @Body() body: unknown,
  ) {
    const input = parseOrThrow(storyboardsGenerateSchema, body ?? {});
    return this.script.generateStoryboards(req.auth?.spaceId ?? "", id, eid, input);
  }

  @Post("projects/:id/characters/:cid/to-asset")
  async characterToAsset(
    @Req() req: AuthedRequest,
    @Param("id") id: string,
    @Param("cid") cid: string,
  ) {
    return this.script.characterToAsset(req.auth?.spaceId ?? "", id, cid);
  }

  @Get("projects/:id/shot-materials")
  async shotMaterials(@Req() req: AuthedRequest, @Param("id") id: string) {
    return this.script.listShotMaterials(req.auth?.spaceId ?? "", id);
  }

  @Post("projects/:id/shot-materials")
  async addShotMaterial(@Req() req: AuthedRequest, @Param("id") id: string, @Body() body: unknown) {
    const input = parseOrThrow(z.object({ task_id: z.string().min(1) }), body);
    return this.script.addShotMaterial(req.auth?.spaceId ?? "", id, input.task_id);
  }

  @Get("projects/:id/matrix")
  async matrix(@Req() req: AuthedRequest, @Param("id") id: string) {
    return this.script.projectMatrix(req.auth?.spaceId ?? "", id);
  }

  @Get("projects/:id/episodes/:eid")
  async episode(@Req() req: AuthedRequest, @Param("id") id: string, @Param("eid") eid: string) {
    return this.script.episodeDetail(req.auth?.spaceId ?? "", id, eid);
  }

  @Patch("projects/:id/episodes/:eid")
  async patchEpisode(
    @Req() req: AuthedRequest,
    @Param("id") id: string,
    @Param("eid") eid: string,
    @Body() body: unknown,
  ) {
    return this.script.patchEpisode(req.auth?.spaceId ?? "", id, eid, parseOrThrow(episodePatchSchema, body));
  }

  @Patch("projects/:id/episodes/:eid/storyboards/:sid")
  async patchStoryboard(
    @Req() req: AuthedRequest,
    @Param("id") id: string,
    @Param("eid") eid: string,
    @Param("sid") sid: string,
    @Body() body: unknown,
  ) {
    const input = parseOrThrow(storyboardPatchSchema, body);
    return this.script.patchStoryboard(req.auth?.spaceId ?? "", id, eid, sid, input);
  }

  @Post("projects/:id/characters/:cid/portrait")
  async portrait(
    @Req() req: AuthedRequest,
    @Param("id") id: string,
    @Param("cid") cid: string,
    @Body() body: unknown,
  ) {
    const input = parseOrThrow(portraitGenerateSchema, body ?? {});
    return this.script.generatePortrait(
      req.auth?.spaceId ?? "",
      req.auth?.userId ?? "",
      id,
      cid,
      input,
    );
  }

  @Post("projects/:id/characters/:cid/portrait/rebind")
  async rebind(
    @Req() req: AuthedRequest,
    @Param("id") id: string,
    @Param("cid") cid: string,
    @Body() body: unknown,
  ) {
    const input = parseOrThrow(portraitRebindSchema, body);
    return this.script.rebindCharacter(req.auth?.spaceId ?? "", id, cid, input.asset_id);
  }

  @Get("projects/:id/characters/:cid/portrait/candidates")
  async candidates(@Req() req: AuthedRequest, @Param("id") id: string, @Param("cid") cid: string) {
    return this.script.portraitCandidates(req.auth?.spaceId ?? "", id, cid);
  }

  @Post("projects/:id/characters/:cid/portrait/select")
  async selectPortrait(
    @Req() req: AuthedRequest,
    @Param("id") id: string,
    @Param("cid") cid: string,
    @Body() body: unknown,
  ) {
    const input = parseOrThrow(portraitSelectSchema, body);
    return this.script.selectPortrait(req.auth?.spaceId ?? "", id, cid, input.task_id, input.index);
  }

  @Post("projects/:id/characters/:cid/finalize")
  async finalize(@Req() req: AuthedRequest, @Param("id") id: string, @Param("cid") cid: string) {
    return this.script.finalizeCharacter(req.auth?.spaceId ?? "", id, cid);
  }

  // ── P2：项目资产（场景/道具/其他）CRUD + 分镜资产绑定 ──────────────────

  /** 资产列表：kind=scene|prop|other|character；按 createdAt 升序，含 bound_shot_count */
  @Get("projects/:id/assets")
  async listProjectAssets(
    @Req() req: AuthedRequest,
    @Param("id") id: string,
    @Query("kind") kind?: string,
  ) {
    const query = parseOrThrow(projectAssetsQuerySchema, { kind });
    return this.script.listProjectAssets(req.auth?.spaceId ?? "", id, query.kind);
  }

  /** 新建场景/道具/其他资产（角色走 /characters/generate，kind=character → 400101） */
  @Post("projects/:id/assets")
  async createProjectAsset(
    @Req() req: AuthedRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const input = parseOrThrow(projectAssetCreateSchema, body);
    return this.script.createProjectAsset(req.auth?.spaceId ?? "", id, input);
  }

  /** P3 AI 提取资产：从分集/项目文本抽取场景/道具（可选角色）落库为草稿 */
  @Post("projects/:id/assets/extract")
  async extractProjectAssets(
    @Req() req: AuthedRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const input = parseOrThrow(projectAssetsExtractSchema, body ?? {});
    return this.script.extractProjectAssets(req.auth?.spaceId ?? "", id, input);
  }

  // ── P3.5：项目资产参考图（generate-image → candidates → select）──────────

  /** 为非角色资产生成参考图（mode=studio_asset_image 走任务系统；kind=character → 400101） */
  @Post("projects/:id/assets/:assetId/generate-image")
  async generateProjectAssetImage(
    @Req() req: AuthedRequest,
    @Param("id") id: string,
    @Param("assetId") assetId: string,
    @Body() body: unknown,
  ) {
    const input = parseOrThrow(projectAssetImageGenerateSchema, body ?? {});
    return this.script.generateProjectAssetImage(
      req.auth?.spaceId ?? "",
      req.auth?.userId ?? "",
      id,
      assetId,
      input,
    );
  }

  /** 生图任务候选（与 portrait candidates 同构；未生成/未成功 → 400105） */
  @Get("projects/:id/assets/:assetId/candidates")
  async projectAssetImageCandidates(
    @Req() req: AuthedRequest,
    @Param("id") id: string,
    @Param("assetId") assetId: string,
  ) {
    return this.script.projectAssetImageCandidates(req.auth?.spaceId ?? "", id, assetId);
  }

  /** 选定候选图：落 assets 行 + 回填 portrait_asset_id/ref_image_uri/status=2/finalized_at */
  @Post("projects/:id/assets/:assetId/select")
  async selectProjectAssetImage(
    @Req() req: AuthedRequest,
    @Param("id") id: string,
    @Param("assetId") assetId: string,
    @Body() body: unknown,
  ) {
    const input = parseOrThrow(projectAssetImageSelectSchema, body);
    return this.script.selectProjectAssetImage(req.auth?.spaceId ?? "", id, assetId, input);
  }

  /** 更新资产：改名/描述/提示词/参考图/定稿状态（status=2 写 finalized_at，=1 清空） */
  @Patch("projects/:id/assets/:assetId")
  async patchProjectAsset(
    @Req() req: AuthedRequest,
    @Param("id") id: string,
    @Param("assetId") assetId: string,
    @Body() body: unknown,
  ) {
    const input = parseOrThrow(projectAssetPatchSchema, body);
    return this.script.patchProjectAsset(req.auth?.spaceId ?? "", id, assetId, input);
  }

  /** 删除资产：同事务解除 storyboard_assets 绑定 */
  @Delete("projects/:id/assets/:assetId")
  async deleteProjectAsset(
    @Req() req: AuthedRequest,
    @Param("id") id: string,
    @Param("assetId") assetId: string,
  ) {
    return this.script.deleteProjectAsset(req.auth?.spaceId ?? "", id, assetId);
  }

  /** 分镜资产绑定：整体替换（入参含角色与场景/道具，0..20），返回落库顺序 */
  @Put("projects/:id/episodes/:eid/storyboards/:sid/assets")
  async replaceStoryboardAssets(
    @Req() req: AuthedRequest,
    @Param("id") id: string,
    @Param("eid") eid: string,
    @Param("sid") sid: string,
    @Body() body: unknown,
  ) {
    const input = parseOrThrow(storyboardAssetsPutSchema, body);
    return this.script.replaceStoryboardAssets(req.auth?.spaceId ?? "", id, eid, sid, input.asset_ids);
  }

  @Post("projects/:id/episodes/:eid/exports")
  async createExport(@Req() req: AuthedRequest, @Param("id") id: string, @Param("eid") eid: string) {
    return this.script.createExport(req.auth?.spaceId ?? "", id, eid);
  }

  @Get("projects/:id/episodes/:eid/exports/:xid")
  async getExport(
    @Req() req: AuthedRequest,
    @Param("id") id: string,
    @Param("eid") eid: string,
    @Param("xid") xid: string,
  ) {
    return this.script.getExport(req.auth?.spaceId ?? "", id, eid, xid);
  }

  @Post("projects/:id/episodes/:eid/exports/:xid/retry")
  async retryExport(
    @Req() req: AuthedRequest,
    @Param("id") id: string,
    @Param("eid") eid: string,
    @Param("xid") xid: string,
  ) {
    return this.script.retryExport(req.auth?.spaceId ?? "", id, eid, xid);
  }

  @Post("projects/:id/episodes/:eid/storyboards/generate-videos")
  async generateVideos(
    @Req() req: AuthedRequest,
    @Param("id") id: string,
    @Param("eid") eid: string,
    @Body() body: unknown,
  ) {
    const input = parseOrThrow(generateVideosBatchSchema, body);
    return this.script.batchGenerateVideos(
      req.auth?.spaceId ?? "",
      req.auth?.userId ?? "",
      id,
      eid,
      input,
    );
  }

  // ── P7：时间线持久化 + 成片合成导出 ─────────────────────────────────────

  /** 读取分集时间线（无记录返回 { clips: [] }） */
  @Get("projects/:id/episodes/:eid/timeline")
  async getTimeline(
    @Req() req: AuthedRequest,
    @Param("id") id: string,
    @Param("eid") eid: string,
  ) {
    return this.script.getTimeline(req.auth?.spaceId ?? "", id, eid);
  }

  /** 覆盖写分集时间线（≤100 条；clip_id 缺失由服务端生成） */
  @Put("projects/:id/episodes/:eid/timeline")
  async putTimeline(
    @Req() req: AuthedRequest,
    @Param("id") id: string,
    @Param("eid") eid: string,
    @Body() body: unknown,
  ) {
    const input = parseOrThrow(timelinePutSchema, body);
    return this.script.putTimeline(req.auth?.spaceId ?? "", id, eid, input);
  }

  /** 删除分集时间线 */
  @Delete("projects/:id/episodes/:eid/timeline")
  async deleteTimeline(
    @Req() req: AuthedRequest,
    @Param("id") id: string,
    @Param("eid") eid: string,
  ) {
    return this.script.deleteTimeline(req.auth?.spaceId ?? "", id, eid);
  }

  /** 按时间线创建成片合成导出任务（worker ffmpeg 合成） */
  @Post("projects/:id/episodes/:eid/timeline/export")
  async createTimelineExport(
    @Req() req: AuthedRequest,
    @Param("id") id: string,
    @Param("eid") eid: string,
  ) {
    return this.script.createTimelineExport(req.auth?.spaceId ?? "", id, eid);
  }

  /** 查询成片导出状态（1排队/2处理中/3完成/4失败） */
  @Get("projects/:id/episodes/:eid/timeline/export/:exportId")
  async getTimelineExport(
    @Req() req: AuthedRequest,
    @Param("id") id: string,
    @Param("eid") eid: string,
    @Param("exportId") exportId: string,
  ) {
    return this.script.getTimelineExport(req.auth?.spaceId ?? "", id, eid, exportId);
  }

  // ── 切片发布 + 片段资产（竞品 wf/publish、wf/clip-bind-asset、wf/video-slicing）──

  /**
   * 切片发布：写 `timeline_publications`，异步转码 1 排队 → 2 转码中 → 3 可播放（发 shareToken）
   * / 4 失败（落 error）。前置是本集已有一次成功成片（status=3），否则 400105。
   */
  @Post("projects/:id/episodes/:eid/timeline/publish")
  async publishTimeline(
    @Req() req: AuthedRequest,
    @Param("id") id: string,
    @Param("eid") eid: string,
    @Body() body: unknown,
  ) {
    const input = parseOrThrow(publishSchema, body ?? {});
    return this.publish.publish(req.auth?.spaceId ?? "", req.auth?.userId ?? "", id, eid, input);
  }

  /** 切片发布列表（含签名下载地址与 shareToken；下架(5) 的 token 不再返回） */
  @Get("projects/:id/episodes/:eid/timeline/publications")
  async listPublications(
    @Req() req: AuthedRequest,
    @Param("id") id: string,
    @Param("eid") eid: string,
    @Query() query: unknown,
  ) {
    const q = parseOrThrow(publicationListQuery, query ?? {});
    return this.publish.listPublications(req.auth?.spaceId ?? "", id, eid, {
      status: q.status,
      page: q.page,
      page_size: q.page_size,
    });
  }

  /** 下架（status=5）：保留记录便于审计，重复下架 → 400102 */
  @Delete("projects/:id/episodes/:eid/publications/:pubId")
  async unpublish(
    @Req() req: AuthedRequest,
    @Param("id") id: string,
    @Param("eid") eid: string,
    @Param("pubId") pubId: string,
  ) {
    return this.publish.unpublish(req.auth?.spaceId ?? "", id, eid, pubId);
  }

  /**
   * 片段资产绑定（竞品 `wf/clip-bind-asset`）：把空间资产/项目资产/镜头产物挂到时间线片段。
   * 快照语义：传 `asset_ids`+`task_id` 整体替换该片段绑定，`clear=true` 清空。
   */
  @Post("projects/:id/episodes/:eid/timeline/clips/:clipId/assets")
  async bindClipAssets(
    @Req() req: AuthedRequest,
    @Param("id") id: string,
    @Param("eid") eid: string,
    @Param("clipId") clipId: string,
    @Body() body: unknown,
  ) {
    const input = parseOrThrow(clipAssetsSchema, body ?? {});
    return this.publish.bindClipAssets(req.auth?.spaceId ?? "", id, eid, clipId, input);
  }
}
