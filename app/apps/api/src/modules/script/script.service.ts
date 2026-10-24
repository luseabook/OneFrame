import { Inject, Injectable } from "@nestjs/common";
import { and, desc, eq, sql } from "drizzle-orm";
import {
  episodes,
  projectAssets,
  scriptProjects,
  storyboards,
} from "@app/db";
import {
  AppError,
  ErrorCode,
  newId,
  type CharactersGenerateRequest,
  type OutlineConfirmRequest,
  type ScriptDraftGenerateRequest,
  type SplitEpisodesRequest,
  type StoryboardPatchRequest,
  type StoryboardsGenerateRequest,
} from "@app/shared";
import { db } from "../../db/database";
import { LlmService } from "./llm.service";

type ProjectRow = typeof scriptProjects.$inferSelect;
type EpisodeRow = typeof episodes.$inferSelect;
type StoryboardRow = typeof storyboards.$inferSelect;
type ProjectAssetRow = typeof projectAssets.$inferSelect;

function projectDto(row: ProjectRow) {
  return {
    id: String(row.id),
    title: row.title,
    genre: row.genre,
    drama_type: row.dramaType,
    ratio: row.ratio,
    source_type: row.sourceType,
    source_text: row.sourceText,
    status: row.status,
    created_at: row.createdAt.toISOString(),
  };
}

function episodeDto(row: EpisodeRow) {
  return {
    id: String(row.id),
    ep_no: row.epNo,
    title: row.title,
    synopsis: row.synopsis,
    script_text: row.scriptText,
    status: row.status,
  };
}

function storyboardDto(row: StoryboardRow) {
  return {
    id: String(row.id),
    shot_no: row.shotNo,
    shot_desc: row.shotDesc,
    video_prompt: row.videoPrompt,
    duration_s: row.durationS,
    ratio: row.ratio,
    resolution: row.resolution,
    status: row.status,
    character_ids: [] as string[],
  };
}

function assetDto(row: ProjectAssetRow) {
  return {
    id: String(row.id),
    kind: row.kind,
    name: row.name,
    description: row.description,
    prompt: row.prompt,
    ref_image_uri: row.refImageUri,
    portrait_asset_id: row.portraitAssetId ? String(row.portraitAssetId) : null,
    status: row.status,
  };
}

@Injectable()
export class ScriptService {
  constructor(@Inject(LlmService) private readonly llm: LlmService) {}

  async createProject(
    spaceId: string,
    input: { title: string; drama_type?: number; ratio?: string; source_type?: number; source_text?: string },
  ) {
    const [row] = await db
      .insert(scriptProjects)
      .values({
        id: newId(),
        spaceId: BigInt(spaceId),
        title: input.title,
        dramaType: input.drama_type ?? 1,
        ratio: input.ratio ?? "9:16",
        sourceType: input.source_type ?? 1,
        sourceText: input.source_text ?? "",
      })
      .returning();
    if (!row) throw new AppError(ErrorCode.INTERNAL, "create project failed");
    return projectDto(row);
  }

  async listProjects(spaceId: string, page = 1, pageSize = 20) {
    const p = Math.max(1, page);
    const ps = Math.min(100, Math.max(1, pageSize));
    const where = eq(scriptProjects.spaceId, BigInt(spaceId));
    const rows = await db
      .select()
      .from(scriptProjects)
      .where(where)
      .orderBy(desc(scriptProjects.createdAt))
      .limit(ps)
      .offset((p - 1) * ps);
    const [countRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(scriptProjects)
      .where(where);
    return { list: rows.map(projectDto), total: countRow?.count ?? 0, page: p, page_size: ps };
  }

  async getProject(spaceId: string, projectId: string) {
    const project = await this.findProject(spaceId, projectId);
    const eps = await db
      .select()
      .from(episodes)
      .where(eq(episodes.projectId, project.id))
      .orderBy(episodes.epNo);
    const chars = await db
      .select()
      .from(projectAssets)
      .where(and(eq(projectAssets.projectId, project.id), eq(projectAssets.kind, "character")))
      .orderBy(projectAssets.createdAt);
    return { project: projectDto(project), episodes: eps.map(episodeDto), characters: chars.map(assetDto) };
  }

  async patchProject(spaceId: string, projectId: string, input: { title?: string; genre?: string }) {
    const project = await this.findProject(spaceId, projectId);
    const [row] = await db
      .update(scriptProjects)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(scriptProjects.id, project.id))
      .returning();
    if (!row) throw new AppError(ErrorCode.NOT_FOUND, "project not found");
    return projectDto(row);
  }

  async archiveProject(spaceId: string, projectId: string) {
    const project = await this.findProject(spaceId, projectId);
    await db
      .update(scriptProjects)
      .set({ status: 2, updatedAt: new Date() })
      .where(eq(scriptProjects.id, project.id));
    return { ok: true };
  }

  async splitEpisodes(spaceId: string, projectId: string, input: SplitEpisodesRequest) {
    const project = await this.findProject(spaceId, projectId);
    const sourceText = (input.source_text ?? project.sourceText ?? "").trim();
    if (!sourceText) throw new AppError(ErrorCode.INVALID_PARAM, "source_text is empty", { field: "source_text" });
    if (sourceText.length > 50_000) throw new AppError(ErrorCode.SOURCE_TOO_LONG, "source text exceeds 50000 chars");

    const chunks = this.splitSource(sourceText, input.ep_count);
    const created = await db.transaction(async (tx) => {
      const existing = await tx.select().from(episodes).where(eq(episodes.projectId, project.id));
      if (existing.some((ep) => ep.status >= 2)) {
        throw new AppError(ErrorCode.INVALID_PARAM, "project already has confirmed episodes");
      }
      await tx.delete(episodes).where(eq(episodes.projectId, project.id));
      const rows = await tx
        .insert(episodes)
        .values(
          chunks.map((chunk, index) => ({
            id: newId(),
            projectId: project.id,
            epNo: index + 1,
            title: `第${index + 1}集`,
            synopsis: chunk.slice(0, 120),
            scriptText: chunk,
            status: 1,
          })),
        )
        .returning();
      return rows;
    });
    return created.map(episodeDto);
  }

  async generateOutline(spaceId: string, projectId: string) {
    const project = await this.findProject(spaceId, projectId);
    const sourceText = (project.sourceText ?? "").trim();
    if (!sourceText) throw new AppError(ErrorCode.INVALID_PARAM, "source_text is empty", { field: "source_text" });
    const outline = await this.llm.outline(sourceText);

    const rows = await db.transaction(async (tx) => {
      const existing = await tx.select().from(episodes).where(eq(episodes.projectId, project.id));
      if (existing.some((ep) => ep.status >= 2)) {
        throw new AppError(ErrorCode.INVALID_PARAM, "outline already confirmed; reopen before regenerate");
      }
      await tx.delete(episodes).where(eq(episodes.projectId, project.id));
      return tx
        .insert(episodes)
        .values(
          outline.episodes.map((ep) => ({
            id: newId(),
            projectId: project.id,
            epNo: ep.ep_no,
            title: ep.title,
            synopsis: ep.synopsis,
            status: 1,
          })),
        )
        .returning();
    });
    return rows.map(episodeDto);
  }

  async confirmOutline(spaceId: string, projectId: string, input: OutlineConfirmRequest) {
    const project = await this.findProject(spaceId, projectId);
    const rows = await db.transaction(async (tx) => {
      const result: EpisodeRow[] = [];
      for (const ep of input.episodes) {
        const [row] = await tx
          .insert(episodes)
          .values({
            id: newId(),
            projectId: project.id,
            epNo: ep.ep_no,
            title: ep.title,
            synopsis: ep.synopsis,
            status: 2,
          })
          .onConflictDoUpdate({
            target: [episodes.projectId, episodes.epNo],
            set: { title: ep.title, synopsis: ep.synopsis, status: 2, updatedAt: new Date() },
          })
          .returning();
        if (row) result.push(row);
      }
      return result;
    });
    return rows.sort((a, b) => a.epNo - b.epNo).map(episodeDto);
  }

  async generateCharacters(spaceId: string, projectId: string, input: CharactersGenerateRequest) {
    const project = await this.findProject(spaceId, projectId);
    const eps = await db.select().from(episodes).where(eq(episodes.projectId, project.id));
    const context = [
      project.sourceText ?? "",
      ...eps.map((ep) => `${ep.title ?? ""}: ${ep.synopsis ?? ""}`),
    ].join("\n");
    const result = await this.llm.characters(context, input.count);

    const rows = await db.transaction(async (tx) => {
      await tx
        .delete(projectAssets)
        .where(
          and(
            eq(projectAssets.projectId, project.id),
            eq(projectAssets.kind, "character"),
            eq(projectAssets.status, 1),
          ),
        );
      return tx
        .insert(projectAssets)
        .values(
          result.characters.map((c) => ({
            id: newId(),
            projectId: project.id,
            kind: "character",
            name: c.name,
            description: c.description,
            prompt: c.prompt,
            status: 1,
          })),
        )
        .returning();
    });
    return rows.map(assetDto);
  }

  async generateScriptDraft(
    spaceId: string,
    projectId: string,
    episodeId: string,
    input: ScriptDraftGenerateRequest,
  ) {
    const project = await this.findProject(spaceId, projectId);
    const episode = await this.findEpisode(project.id, episodeId);
    const draft = await this.llm.scriptDraft({
      title: episode.title ?? `第${episode.epNo}集`,
      synopsis: episode.synopsis ?? "",
      sourceText: project.sourceText ?? "",
      instructions: input.instructions,
    });
    const [row] = await db
      .update(episodes)
      .set({ scriptText: draft.script_text, updatedAt: new Date() })
      .where(eq(episodes.id, episode.id))
      .returning();
    if (!row) throw new AppError(ErrorCode.NOT_FOUND, "episode not found");
    return episodeDto(row);
  }

  async generateStoryboards(
    spaceId: string,
    projectId: string,
    episodeId: string,
    input: StoryboardsGenerateRequest,
  ) {
    const project = await this.findProject(spaceId, projectId);
    const episode = await this.findEpisode(project.id, episodeId);
    const result = await this.llm.storyboards({
      title: episode.title ?? `第${episode.epNo}集`,
      synopsis: episode.synopsis ?? "",
      scriptText: episode.scriptText ?? "",
      shotCount: input.shot_count,
    });

    const rows = await db.transaction(async (tx) => {
      await tx.delete(storyboards).where(eq(storyboards.episodeId, episode.id));
      return tx
        .insert(storyboards)
        .values(
          result.storyboards.map((shot) => ({
            id: newId(),
            episodeId: episode.id,
            shotNo: shot.shot_no,
            shotDesc: shot.shot_desc,
            videoPrompt: shot.video_prompt,
            durationS: shot.duration_s ?? 5,
            ratio: shot.ratio ?? project.ratio,
            resolution: shot.resolution ?? "720p",
            status: 1,
          })),
        )
        .returning();
    });
    return rows.map(storyboardDto);
  }

  async episodeDetail(spaceId: string, projectId: string, episodeId: string) {
    const project = await this.findProject(spaceId, projectId);
    const episode = await this.findEpisode(project.id, episodeId);
    const shots = await db
      .select()
      .from(storyboards)
      .where(eq(storyboards.episodeId, episode.id))
      .orderBy(storyboards.shotNo);
    return { episode: episodeDto(episode), storyboards: shots.map(storyboardDto) };
  }

  async patchStoryboard(
    spaceId: string,
    projectId: string,
    episodeId: string,
    storyboardId: string,
    input: StoryboardPatchRequest,
  ) {
    const project = await this.findProject(spaceId, projectId);
    const episode = await this.findEpisode(project.id, episodeId);
    const [row] = await db
      .update(storyboards)
      .set({
        ...(input.shot_desc !== undefined ? { shotDesc: input.shot_desc } : {}),
        ...(input.video_prompt !== undefined ? { videoPrompt: input.video_prompt } : {}),
        ...(input.duration_s !== undefined ? { durationS: input.duration_s } : {}),
        ...(input.ratio !== undefined ? { ratio: input.ratio } : {}),
        ...(input.resolution !== undefined ? { resolution: input.resolution } : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(storyboards.id, BigInt(storyboardId)), eq(storyboards.episodeId, episode.id)))
      .returning();
    if (!row) throw new AppError(ErrorCode.NOT_FOUND, "storyboard not found");
    return storyboardDto(row);
  }

  private async findProject(spaceId: string, projectId: string): Promise<ProjectRow> {
    let id: bigint;
    try {
      id = BigInt(projectId);
    } catch {
      throw new AppError(ErrorCode.INVALID_PARAM, "invalid project id", { field: "id" });
    }
    const [row] = await db
      .select()
      .from(scriptProjects)
      .where(and(eq(scriptProjects.id, id), eq(scriptProjects.spaceId, BigInt(spaceId))));
    if (!row) throw new AppError(ErrorCode.NOT_FOUND, "project not found");
    return row;
  }

  private async findEpisode(projectId: bigint, episodeId: string): Promise<EpisodeRow> {
    let id: bigint;
    try {
      id = BigInt(episodeId);
    } catch {
      throw new AppError(ErrorCode.INVALID_PARAM, "invalid episode id", { field: "eid" });
    }
    const [row] = await db
      .select()
      .from(episodes)
      .where(and(eq(episodes.id, id), eq(episodes.projectId, projectId)));
    if (!row) throw new AppError(ErrorCode.NOT_FOUND, "episode not found");
    return row;
  }

  private splitSource(text: string, epCount?: number): string[] {
    const byMarker = text
      .split(/(?=第[一二三四五六七八九十百\d]+[集章回])/)
      .map((chunk) => chunk.trim())
      .filter(Boolean);
    if (byMarker.length > 1) return byMarker.slice(0, 20);

    const target = Math.max(1, Math.min(epCount ?? 3, 20));
    const size = Math.ceil(text.length / target);
    return Array.from({ length: target }, (_, i) => text.slice(i * size, (i + 1) * size)).filter(
      (chunk) => chunk.trim().length > 0,
    );
  }
}
