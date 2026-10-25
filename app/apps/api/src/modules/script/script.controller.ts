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
import { ScriptService } from "./script.service";

/** 上传剧本解析请求：前端把文件读成 base64 提交（不依赖 multipart 依赖） */
const parseScriptSchema = z.object({
  file_name: z.string().min(1).max(255),
  file_base64: z.string().min(1).max(12_000_000),
});

/** P2 项目资产列表过滤：kind 省略时返回该项目全部资产（含角色） */
const projectAssetsQuerySchema = z.object({ kind: projectAssetKindSchema.optional() });

@Controller()
export class ScriptController {
  constructor(@Inject(ScriptService) private readonly script: ScriptService) {}

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

  /** 作品库（PRD 增补 §1.3）：以「剧」为单位聚合成果 */
  @Get("works")
  async works(
    @Req() req: AuthedRequest,
    @Query("status") status?: string,
    @Query("page") page?: string,
    @Query("page_size") pageSize?: string,
  ) {
    return this.script.listWorks(req.auth?.spaceId ?? "", {
      status,
      page: Number(page ?? 1),
      pageSize: Number(pageSize ?? 24),
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
    const input = parseOrThrow(splitEpisodesRequestSchema, body ?? {});
    return this.script.splitEpisodes(req.auth?.spaceId ?? "", id, input);
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
}
