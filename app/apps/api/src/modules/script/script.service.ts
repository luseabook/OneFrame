import { Inject, Injectable } from "@nestjs/common";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import {
  assets,
  episodes,
  exportJobs,
  freezeCredits,
  models,
  projectAssets,
  scriptProjects,
  storyboardAssets,
  storyboards,
  taskEvents,
  tasks,
} from "@app/db";
import {
  AppError,
  ErrorCode,
  TaskStatus,
  newId,
  type CharactersGenerateRequest,
  type GenerateVideosBatchRequest,
  type GenerationRequest,
  type OutlineConfirmRequest,
  type PortraitGenerateRequest,
  type ScriptDraftGenerateRequest,
  type SplitEpisodesRequest,
  type StoryboardPatchRequest,
  type StoryboardsGenerateRequest,
} from "@app/shared";
import { db } from "../../db/database";
import { QueueService } from "../../queue/queue.service";
import { CreditsService } from "../credits/credits.service";
import { GenerationsService } from "../generations/generations.service";
import { ModelsService } from "../models/models.service";
import { StorageService } from "../../storage/storage.service";
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

function storyboardDto(row: StoryboardRow, characterIds: string[] = []) {
  return {
    id: String(row.id),
    shot_no: row.shotNo,
    shot_desc: row.shotDesc,
    video_prompt: row.videoPrompt,
    duration_s: row.durationS,
    ratio: row.ratio,
    resolution: row.resolution,
    status: row.status,
    character_ids: characterIds,
  };
}

function assetDto(row: ProjectAssetRow, portraitUrl: string | null = null) {
  return {
    id: String(row.id),
    kind: row.kind,
    name: row.name,
    description: row.description,
    prompt: row.prompt,
    ref_image_uri: row.refImageUri,
    portrait_asset_id: row.portraitAssetId ? String(row.portraitAssetId) : null,
    portrait_url: portraitUrl,
    source_task_id: row.sourceTaskId ? String(row.sourceTaskId) : null,
    status: row.status,
  };
}

@Injectable()
export class ScriptService {
  constructor(
    @Inject(LlmService) private readonly llm: LlmService,
    @Inject(GenerationsService) private readonly generations: GenerationsService,
    @Inject(CreditsService) private readonly credits: CreditsService,
    @Inject(ModelsService) private readonly models: ModelsService,
    @Inject(QueueService) private readonly queue: QueueService,
    @Inject(StorageService) private readonly storage: StorageService,
  ) {}

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
      .orderBy(projectAssets.createdAt, projectAssets.id);
    const characters = await Promise.all(
      chars.map(async (row) =>
        assetDto(row, row.refImageUri ? await this.storage.signDownload(row.refImageUri, 3600) : null),
      ),
    );
    return { project: projectDto(project), episodes: eps.map(episodeDto), characters };
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
    return rows.map((row) => assetDto(row));
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
    const characters = await db
      .select()
      .from(projectAssets)
      .where(and(eq(projectAssets.projectId, project.id), eq(projectAssets.kind, "character"))).orderBy(projectAssets.createdAt, projectAssets.id);
    const result = await this.llm.storyboards({
      title: episode.title ?? `第${episode.epNo}集`,
      synopsis: episode.synopsis ?? "",
      scriptText: episode.scriptText ?? "",
      shotCount: input.shot_count,
      characterNames: characters.map((c) => c.name),
    });

    const byName = new Map(characters.map((c) => [c.name, c]));
    const linkMap = new Map<string, string[]>();
    const rows = await db.transaction(async (tx) => {
      await tx.delete(storyboards).where(eq(storyboards.episodeId, episode.id));
      const inserted = await tx
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

      for (let i = 0; i < inserted.length; i += 1) {
        const row = inserted[i]!;
        const names = result.storyboards[i]?.character_names ?? [];
        const ids: string[] = [];
        for (const name of names) {
          const asset = byName.get(name);
          if (!asset) continue;
          ids.push(String(asset.id));
          await tx.insert(storyboardAssets).values({ storyboardId: row.id, projectAssetId: asset.id });
        }
        linkMap.set(String(row.id), ids);
      }
      return inserted;
    });
    return rows.map((row) => storyboardDto(row, linkMap.get(String(row.id)) ?? []));
  }

  async episodeDetail(spaceId: string, projectId: string, episodeId: string) {
    const project = await this.findProject(spaceId, projectId);
    const episode = await this.findEpisode(project.id, episodeId);
    const shots = await db
      .select()
      .from(storyboards)
      .where(eq(storyboards.episodeId, episode.id))
      .orderBy(storyboards.shotNo);
    const links =
      shots.length > 0
        ? await db
            .select()
            .from(storyboardAssets)
            .where(
              inArray(
                storyboardAssets.storyboardId,
                shots.map((s) => s.id),
              ),
            )
        : [];
    const linkMap = new Map<string, string[]>();
    for (const link of links) {
      const key = String(link.storyboardId);
      const list = linkMap.get(key) ?? [];
      list.push(String(link.projectAssetId));
      linkMap.set(key, list);
    }
    return {
      episode: episodeDto(episode),
      storyboards: shots.map((shot) => storyboardDto(shot, linkMap.get(String(shot.id)) ?? [])),
    };
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

  async generatePortrait(
    spaceId: string,
    userId: string,
    projectId: string,
    characterId: string,
    input: PortraitGenerateRequest,
  ) {
    const project = await this.findProject(spaceId, projectId);
    const character = await this.findCharacter(project.id, characterId);

    const [model] = await db
      .select()
      .from(models)
      .where(and(eq(models.visible, true), sql`${models.modes} ? 'studio_asset_image'`))
      .orderBy(models.sort)
      .limit(1);
    if (!model) throw new AppError(ErrorCode.INVALID_PARAM, "no model supports studio_asset_image");
    const cfg = (model.modes as Record<string, {
      ratios?: string[];
      default_ratio?: string;
      resolution_options?: Array<{ value: string }>;
      default_resolution?: string;
    }>).studio_asset_image;
    const prompt = input.prompt ?? character.prompt ?? character.description ?? character.name;
    const request: GenerationRequest = {
      mode: "studio_asset_image",
      model: model.name,
      scene: null,
      input: { prompt, reference_uris: [] },
      options: {
        ratio: cfg?.default_ratio ?? cfg?.ratios?.[0] ?? "1:1",
        resolution: cfg?.default_resolution ?? cfg?.resolution_options?.[0]?.value ?? "1K",
        duration: 5,
        count: input.count,
        enable_audio: false,
        mouth_drive: false,
      },
    };
    const created = await this.generations.create(
      { userId, spaceId, jti: "script-portrait" },
      request,
      `portrait:${character.id}:${Date.now()}`,
    );
    await db
      .update(projectAssets)
      .set({
        sourceTaskId: BigInt(created.task_id),
        prompt,
        status: 1,
        portraitAssetId: null,
        refImageUri: null,
        finalizedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(projectAssets.id, character.id));
    return { ...created, character_id: String(character.id), model: model.name };
  }

  async finalizeCharacter(spaceId: string, projectId: string, characterId: string) {
    const project = await this.findProject(spaceId, projectId);
    const character = await this.findCharacter(project.id, characterId);
    if (!character.portraitAssetId) {
      throw new AppError(ErrorCode.ASSET_NOT_READY, "portrait not generated or not bound yet");
    }
    const [updated] = await db
      .update(projectAssets)
      .set({ status: 2, finalizedAt: new Date(), updatedAt: new Date() })
      .where(eq(projectAssets.id, character.id))
      .returning();
    if (!updated) throw new AppError(ErrorCode.NOT_FOUND, "character not found");
    return assetDto(updated);
  }

  async rebindCharacter(spaceId: string, projectId: string, characterId: string, assetId: string) {
    const project = await this.findProject(spaceId, projectId);
    const character = await this.findCharacter(project.id, characterId);
    let id: bigint;
    try {
      id = BigInt(assetId);
    } catch {
      throw new AppError(ErrorCode.INVALID_PARAM, "invalid asset_id", { field: "asset_id" });
    }
    const [asset] = await db
      .select()
      .from(assets)
      .where(and(eq(assets.id, id), eq(assets.spaceId, BigInt(spaceId))));
    if (!asset) throw new AppError(ErrorCode.NOT_FOUND, "asset not found");
    const [updated] = await db
      .update(projectAssets)
      .set({
        portraitAssetId: asset.id,
        refImageUri: asset.uri,
        status: 2,
        finalizedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(projectAssets.id, character.id))
      .returning();
    if (!updated) throw new AppError(ErrorCode.NOT_FOUND, "character not found");
    return assetDto(updated);
  }

  async batchGenerateVideos(
    spaceId: string,
    userId: string,
    projectId: string,
    episodeId: string,
    input: GenerateVideosBatchRequest,
  ) {
    const project = await this.findProject(spaceId, projectId);
    const episode = await this.findEpisode(project.id, episodeId);
    const model = await this.models.findByName(input.model);

    const ids = input.shot_ids.map((id) => {
      try {
        return BigInt(id);
      } catch {
        throw new AppError(ErrorCode.INVALID_PARAM, `invalid shot id: ${id}`, { field: "shot_ids" });
      }
    });
    const shots = await db
      .select()
      .from(storyboards)
      .where(and(eq(storyboards.episodeId, episode.id), inArray(storyboards.id, ids)));
    if (shots.length !== ids.length) throw new AppError(ErrorCode.NOT_FOUND, "some shots not found");
    const shotById = new Map(shots.map((s) => [String(s.id), s]));

    const characters = await db
      .select()
      .from(projectAssets)
      .where(and(eq(projectAssets.projectId, project.id), eq(projectAssets.kind, "character"))).orderBy(projectAssets.createdAt, projectAssets.id);
    const charById = new Map(characters.map((c) => [String(c.id), c]));
    const links =
      shots.length > 0
        ? await db
            .select()
            .from(storyboardAssets)
            .where(
              inArray(
                storyboardAssets.storyboardId,
                shots.map((s) => s.id),
              ),
            )
        : [];
    const linkMap = new Map<string, string[]>();
    for (const link of links) {
      const key = String(link.storyboardId);
      const list = linkMap.get(key) ?? [];
      list.push(String(link.projectAssetId));
      linkMap.set(key, list);
    }

    type Candidate = {
      shotId: string;
      shot: (typeof shots)[number];
      request: GenerationRequest;
      cost: number;
      dedupeKey: string;
    };
    const candidates: Candidate[] = [];
    const items: Array<{
      shot_id: string;
      task_id: string | null;
      submitted: boolean;
      code?: number;
      reason?: string;
    }> = [];
    let balance = 0;

    for (const shotId of input.shot_ids) {
      const shot = shotById.get(shotId);
      if (!shot) {
        items.push({ shot_id: shotId, task_id: null, submitted: false, code: ErrorCode.NOT_FOUND });
        continue;
      }
      const linked = (linkMap.get(shotId) ?? []).map((id) => charById.get(id)).filter(Boolean);
      const refs = linked
        .filter((c) => c && c.status === 2 && c.refImageUri)
        .map((c) => c!.refImageUri!)
        .filter(Boolean);
      if (refs.length === 0 || linked.some((c) => !c || c.status !== 2 || !c.refImageUri)) {
        items.push({
          shot_id: shotId,
          task_id: null,
          submitted: false,
          code: ErrorCode.ASSET_NOT_READY,
          reason: "asset_not_ready",
        });
        continue;
      }
      const request: GenerationRequest = {
        mode: "universal_reference",
        model: model.name,
        scene: "storyboard_reference_video",
        input: { prompt: shot.videoPrompt ?? shot.shotDesc ?? "", reference_uris: refs },
        options: {
          ratio: input.ratio ?? shot.ratio ?? project.ratio,
          resolution: input.resolution ?? shot.resolution ?? "720p",
          duration: shot.durationS ?? 5,
          count: 1,
          enable_audio: true,
          mouth_drive: false,
        },
      };
      const priced = await this.credits.price(request, spaceId);
      balance = priced.balance;
      candidates.push({
        shotId,
        shot,
        request,
        cost: priced.credits,
        dedupeKey: `shot:${shot.id}:v1`,
      });
    }

    // 预算：先确定本轮可投递集合；余额不足则整单拒绝
    let spent = 0;
    const submittable: Candidate[] = [];
    for (const candidate of candidates) {
      const [existing] = await db
        .select()
        .from(tasks)
        .where(and(eq(tasks.spaceId, BigInt(spaceId)), eq(tasks.dedupeKey, candidate.dedupeKey)));
      if (existing) {
        items.push({ shot_id: candidate.shotId, task_id: String(existing.id), submitted: true });
        continue;
      }
      if (spent + candidate.cost > input.budget_credits_max) {
        items.push({
          shot_id: candidate.shotId,
          task_id: null,
          submitted: false,
          code: ErrorCode.BUDGET_EXCEEDED,
          reason: "budget_exceeded",
        });
        continue;
      }
      spent += candidate.cost;
      submittable.push(candidate);
    }
    if (spent > balance) {
      throw new AppError(ErrorCode.INSUFFICIENT_BALANCE, "Insufficient Balance");
    }

    for (const candidate of submittable) {
      const taskId = newId();
      await db.transaction(async (tx) => {
        await tx.insert(tasks).values({
          id: taskId,
          spaceId: BigInt(spaceId),
          userId: BigInt(userId),
          episodeId: episode.id,
          shotId: candidate.shot.id,
          capability: "video",
          mode: "universal_reference",
          scene: "storyboard_reference_video",
          modelId: model.id,
          input: candidate.request.input,
          options: candidate.request.options,
          status: TaskStatus.PENDING,
          creditsFrozen: candidate.cost,
          dedupeKey: candidate.dedupeKey,
        });
        await freezeCredits(tx, {
          spaceId: BigInt(spaceId),
          cost: candidate.cost,
          taskId,
          memo: `freeze for shot ${candidate.shotId}`,
        });
        await tx.insert(taskEvents).values({
          id: newId(),
          taskId,
          type: "task.created",
          payload: { shot_id: candidate.shotId, batch: true },
        });
        await tx
          .update(storyboards)
          .set({ status: 3, videoTaskId: taskId, updatedAt: new Date() })
          .where(eq(storyboards.id, candidate.shot.id));
      });
      await this.queue.enqueueTask(String(taskId));
      items.push({ shot_id: candidate.shotId, task_id: String(taskId), submitted: true });
    }

    return {
      budget_exceeded: items.some((item) => item.code === ErrorCode.BUDGET_EXCEEDED),
      items,
    };
  }

  async createExport(spaceId: string, projectId: string, episodeId: string) {
    const project = await this.findProject(spaceId, projectId);
    const episode = await this.findEpisode(project.id, episodeId);
    const id = newId();
    await db.insert(exportJobs).values({
      id,
      spaceId: BigInt(spaceId),
      episodeId: episode.id,
      status: 1,
    });
    await this.queue.enqueueExport(String(id));
    return { export_id: String(id), status: 1 };
  }

  async getExport(spaceId: string, projectId: string, episodeId: string, exportId: string) {
    const project = await this.findProject(spaceId, projectId);
    const episode = await this.findEpisode(project.id, episodeId);
    let id: bigint;
    try {
      id = BigInt(exportId);
    } catch {
      throw new AppError(ErrorCode.INVALID_PARAM, "invalid export id", { field: "xid" });
    }
    const [row] = await db
      .select()
      .from(exportJobs)
      .where(
        and(
          eq(exportJobs.id, id),
          eq(exportJobs.episodeId, episode.id),
          eq(exportJobs.spaceId, BigInt(spaceId)),
        ),
      );
    if (!row) throw new AppError(ErrorCode.NOT_FOUND, "export not found");
    const downloadUrl =
      row.status === 3 && row.fileUri ? await this.storage.signDownload(row.fileUri, 3600) : null;
    return {
      export_id: String(row.id),
      status: row.status,
      download_url: downloadUrl,
      error: row.error,
      expires_at: row.expiresAt?.toISOString() ?? null,
    };
  }

  private async findCharacter(projectId: bigint, characterId: string): Promise<ProjectAssetRow> {
    let id: bigint;
    try {
      id = BigInt(characterId);
    } catch {
      throw new AppError(ErrorCode.INVALID_PARAM, "invalid character id", { field: "cid" });
    }
    const [row] = await db
      .select()
      .from(projectAssets)
      .where(
        and(
          eq(projectAssets.id, id),
          eq(projectAssets.projectId, projectId),
          eq(projectAssets.kind, "character"),
        ),
      );
    if (!row) throw new AppError(ErrorCode.NOT_FOUND, "character not found");
    return row;
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
