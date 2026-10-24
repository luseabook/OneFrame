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
  projectPatchSchema,
  scriptDraftGenerateSchema,
  splitEpisodesRequestSchema,
  storyboardsGenerateSchema,
  storyboardPatchSchema,
} from "@app/shared";
import type { AuthedRequest } from "../../common/auth.types";
import { parseOrThrow } from "../../common/zod";
import { ScriptService } from "./script.service";

@Controller()
export class ScriptController {
  constructor(@Inject(ScriptService) private readonly script: ScriptService) {}

  @Post("projects")
  async create(@Req() req: AuthedRequest, @Body() body: unknown) {
    const input = parseOrThrow(createProjectSchema, body);
    return this.script.createProject(req.auth?.spaceId ?? "", input);
  }

  @Get("projects")
  async list(@Req() req: AuthedRequest, @Query("page") page?: string, @Query("page_size") pageSize?: string) {
    return this.script.listProjects(req.auth?.spaceId ?? "", Number(page ?? 1), Number(pageSize ?? 20));
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
