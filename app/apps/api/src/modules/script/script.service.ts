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
  LIMITS,
  PROJECT_ASSETS_EXTRACT_MAX,
  ProjectAssetStatus,
  TaskStatus,
  newId,
  type CharactersGenerateRequest,
  type GenerateVideosBatchRequest,
  type GenerationRequest,
  type OutlineConfirmRequest,
  type PortraitGenerateRequest,
  type ProjectAssetCreateRequest,
  type ProjectAssetKind,
  type ProjectAssetPatchRequest,
  type ProjectAssetsExtractRequest,
  type ScriptDraftGenerateRequest,
  type SplitEpisodesRequest,
  type StoryboardPatchRequest,
  type StoryboardsGenerateRequest,
} from "@app/shared";
import { clampToNovelLimit, decodeBase64Upload, parseScriptFile } from "./script-parser";
import { db } from "../../db/database";
import { QueueService } from "../../queue/queue.service";
import { CreditsService } from "../credits/credits.service";
import { GenerationsService } from "../generations/generations.service";
import { ModelsService } from "../models/models.service";
import { StorageService } from "../../storage/storage.service";
import { ModerationService } from "../moderation/moderation.service";
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
    source_file_name: row.sourceFileName ?? null,
    status: row.status,
    archived_at: row.archivedAt ? row.archivedAt.toISOString() : null,
    is_sample: row.isSample === 1,
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
    image_task_id: row.imageTaskId ? String(row.imageTaskId) : null,
    video_task_id: row.videoTaskId ? String(row.videoTaskId) : null,
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

/**
 * P2 项目资产 DTO：在 assetDto 基础上补 finalized_at / bound_shot_count。
 * kind=character 时与 GET /projects/{id} 的 characters 字段同构（仅多这两个字段）。
 */
function projectAssetDto(row: ProjectAssetRow, portraitUrl: string | null, boundShotCount: number) {
  return {
    ...assetDto(row, portraitUrl),
    finalized_at: row.finalizedAt ? row.finalizedAt.toISOString() : null,
    bound_shot_count: boundShotCount,
  };
}

/** 可空文本归一：空白/空串 → null（PATCH 用空串表示清空） */
function normalizeOptionalText(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
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
    @Inject(ModerationService) private readonly moderation: ModerationService,
  ) {}

  async createProject(
    spaceId: string,
    input: {
      title: string;
      drama_type?: number;
      ratio?: string;
      source_type?: number;
      source_text?: string;
      source_file_name?: string;
    },
  ) {
    this.moderation.assertText(input.source_text, "source_text");
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
        sourceFileName: input.source_file_name ?? null,
      })
      .returning();
    if (!row) throw new AppError(ErrorCode.INTERNAL, "create project failed");
    return projectDto(row);
  }

  /**
   * 新建项目「上传剧本」：解析 txt/md/csv/docx/xlsx 为纯文本（不落盘）。
   * 返回文本交给前端回填到创建请求的 source_text；这里不出库、不扣积分。
   */
  async parseScript(fileName: string, fileBase64: string) {
    const buffer = decodeBase64Upload(fileBase64);
    const parsed = await parseScriptFile(fileName, buffer);
    const { text, truncated } = clampToNovelLimit(parsed.text);
    const warnings = [...parsed.warnings];
    if (truncated) warnings.push(`文本超过 ${LIMITS.NOVEL_MAX} 字上限，已截断；可在项目中继续编辑`);
    return {
      text,
      format: parsed.format,
      chars: text.length,
      truncated,
      warnings,
    };
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

  /**
   * 作品库（PRD 增补 §1.3）：以「剧」为单位的成果视图。
   * 作品 = 项目；聚合集数、已成功出片镜头数、封面与状态，供作品墙直接渲染。
   */
  async listWorks(spaceId: string, opts: { status?: string; page?: number; pageSize?: number } = {}) {
    const p = Math.max(1, opts.page ?? 1);
    const ps = Math.min(60, Math.max(1, opts.pageSize ?? 24));
    const conditions = [eq(scriptProjects.spaceId, BigInt(spaceId))];
    if (opts.status === "archived") {
      conditions.push(sql`${scriptProjects.archivedAt} is not null`);
    } else {
      conditions.push(sql`${scriptProjects.archivedAt} is null`);
    }
    const rows = await db
      .select()
      .from(scriptProjects)
      .where(and(...conditions))
      .orderBy(desc(scriptProjects.updatedAt))
      .limit(ps)
      .offset((p - 1) * ps);

    const [countRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(scriptProjects)
      .where(and(...conditions));

    const ids = rows.map((r) => r.id);
    // 聚合：集数、分镜数、成功镜头数、封面（首个成功结果的 asset uri）
    const stats = ids.length
      ? await db.execute(sql`
          select p.id as project_id,
                 (select count(*)::int from episodes e where e.project_id = p.id) as episode_count,
                 (select count(*)::int
                    from storyboards s
                    join episodes e2 on e2.id = s.episode_id
                   where e2.project_id = p.id) as shot_count,
                 (select count(*)::int
                    from tasks t
                    join storyboards s2 on s2.id = t.shot_id
                    join episodes e3 on e3.id = s2.episode_id
                   where e3.project_id = p.id and t.status = 3) as done_count,
                 (select a.uri
                    from assets a
                    join tasks t3 on t3.id::text = (a.meta->>'task_id')
                    join storyboards s4 on s4.id = t3.shot_id
                    join episodes e5 on e5.id = s4.episode_id
                   where e5.project_id = p.id and a.deleted_at is null
                     and coalesce(a.meta->>'content_type', '') like 'image/%'
                   order by a.id desc limit 1) as cover_uri,
                 (select ast.uri
                    from assets ast
                    join project_assets pa on pa.portrait_asset_id = ast.id
                   where pa.project_id = p.id and ast.deleted_at is null
                   order by ast.id desc limit 1) as portrait_uri
            from script_projects p
           where p.id in (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})
        `)
      : { rows: [] };

    const statMap = new Map<string, Record<string, unknown>>();
    for (const r of (stats as { rows?: Record<string, unknown>[] }).rows ?? []) {
      statMap.set(String(r.project_id), r);
    }

    const list = await Promise.all(
      rows.map(async (row) => {
        const s = statMap.get(String(row.id)) ?? {};
        const episodeCount = Number(s.episode_count ?? 0);
        const shotCount = Number(s.shot_count ?? 0);
        const doneCount = Number(s.done_count ?? 0);
        // 封面优先用已转存的图片资产，退化为角色定妆图；都签名成可直接访问的 URL
        const coverKey = (s.cover_uri as string | null) ?? (s.portrait_uri as string | null) ?? null;
        let coverUrl: string | null = null;
        if (coverKey) {
          try {
            coverUrl = await this.storage.signDownload(coverKey, 3600);
          } catch {
            coverUrl = null;
          }
        }
        return {
          ...projectDto(row),
          episode_count: episodeCount,
          shot_count: shotCount,
          done_count: doneCount,
          cover_uri: coverUrl,
          // 用户可理解的四态（PRD 增补 §1.2）
          work_state:
            row.archivedAt !== null
              ? "archived"
              : shotCount === 0
                ? "draft"
                : doneCount > 0 && doneCount >= shotCount
                  ? "ready"
                  : "producing",
        };
      }),
    );

    return { list, total: countRow?.count ?? 0, page: p, page_size: ps };
  }

  /** 归档 / 恢复作品（软标记） */
  async setArchived(spaceId: string, projectId: string, archived: boolean) {
    const project = await this.findProject(spaceId, projectId);
    await db
      .update(scriptProjects)
      .set({ archivedAt: archived ? new Date() : null, updatedAt: new Date() })
      .where(eq(scriptProjects.id, project.id));
    return { id: String(project.id), archived };
  }

  /**
   * 二次创作（PRD 增补 §2）：新增空集。
   * 复用已有角色的定妆图绑定关系，不复制分镜内容；一次最多 10 集。
   */
  async addEpisodes(spaceId: string, projectId: string, count: number) {
    const project = await this.findProject(spaceId, projectId);
    const n = Math.min(10, Math.max(1, Math.trunc(count)));
    const existing = await db
      .select({ epNo: episodes.epNo })
      .from(episodes)
      .where(eq(episodes.projectId, project.id));
    let maxNo = existing.reduce((m, r) => Math.max(m, r.epNo), 0);
    const created: { id: string; ep_no: number }[] = [];
    for (let i = 0; i < n; i += 1) {
      maxNo += 1;
      const idBig = newId();
      await db.insert(episodes).values({
        id: idBig,
        projectId: project.id,
        epNo: maxNo,
        title: `第${maxNo}集`,
        status: 1,
      });
      created.push({ id: String(idBig), ep_no: maxNo });
    }
    await db
      .update(scriptProjects)
      .set({ updatedAt: new Date() })
      .where(eq(scriptProjects.id, project.id));
    return { created };
  }

  /**
   * 复制为我的项目（PRD 增补 §3.2 示例作品体验）。
   * 复制项目骨架 + 角色（含定妆图绑定），不复制分镜与任务，避免费用与状态串扰。
   */
  async duplicateProject(spaceId: string, projectId: string) {
    const project = await this.findProject(spaceId, projectId);
    const newProjectId = newId();
    await db.insert(scriptProjects).values({
      id: BigInt(newProjectId),
      spaceId: BigInt(spaceId),
      title: `${project.title}（副本）`,
      genre: project.genre,
      dramaType: project.dramaType,
      ratio: project.ratio,
      sourceType: project.sourceType,
      sourceText: project.sourceText,
      status: 1,
      isSample: 0,
    });

    const eps = await db.select().from(episodes).where(eq(episodes.projectId, project.id));
    for (const ep of eps) {
      await db.insert(episodes).values({
        id: BigInt(newId()),
        projectId: BigInt(newProjectId),
        epNo: ep.epNo,
        title: ep.title,
        synopsis: ep.synopsis,
        scriptText: ep.scriptText,
        status: ep.status,
      });
    }

    const chars = await db
      .select()
      .from(projectAssets)
      .where(and(eq(projectAssets.projectId, project.id), eq(projectAssets.kind, "character")));
    for (const c of chars) {
      await db.insert(projectAssets).values({
        id: BigInt(newId()),
        projectId: BigInt(newProjectId),
        kind: c.kind,
        name: c.name,
        description: c.description,
        prompt: c.prompt,
        refImageUri: c.refImageUri,
        portraitAssetId: c.portraitAssetId,
        status: c.status,
      });
    }

    return { id: String(newProjectId), episodes: eps.length, characters: chars.length };
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
    this.moderation.assertText(sourceText, "source_text");
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
    this.moderation.assertText(context, "source_text");
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

  async patchEpisode(
    spaceId: string,
    projectId: string,
    episodeId: string,
    input: { title?: string; synopsis?: string; script_text?: string },
  ) {
    const project = await this.findProject(spaceId, projectId);
    const episode = await this.findEpisode(project.id, episodeId);
    const [row] = await db
      .update(episodes)
      .set({
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.synopsis !== undefined ? { synopsis: input.synopsis } : {}),
        ...(input.script_text !== undefined ? { scriptText: input.script_text } : {}),
        updatedAt: new Date(),
      })
      .where(eq(episodes.id, episode.id))
      .returning();
    if (!row) throw new AppError(ErrorCode.NOT_FOUND, "episode not found");
    return episodeDto(row);
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
    this.moderation.assertText(episode.scriptText, "script_text");
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

  async portraitCandidates(spaceId: string, projectId: string, characterId: string) {
    const project = await this.findProject(spaceId, projectId);
    const character = await this.findCharacter(project.id, characterId);
    if (!character.sourceTaskId) {
      throw new AppError(ErrorCode.ASSET_NOT_READY, "portrait not generated yet");
    }
    const [task] = await db
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, character.sourceTaskId), eq(tasks.spaceId, BigInt(spaceId))));
    if (!task || task.status !== TaskStatus.SUCCEEDED) {
      throw new AppError(ErrorCode.ASSET_NOT_READY, "portrait task not succeeded");
    }
    const results = Array.isArray(task.results) ? (task.results as Array<{ uri?: string }>) : [];
    const candidates = await Promise.all(
      results
        .map((item, index) => ({ item, index }))
        .filter(({ item }) => Boolean(item.uri))
        .map(async ({ item, index }) => ({ index, url: await this.storage.signDownload(item.uri!, 3600) })),
    );
    return { task_id: String(task.id), candidates };
  }

  async selectPortrait(spaceId: string, projectId: string, characterId: string, taskId: string, index: number) {
    const project = await this.findProject(spaceId, projectId);
    const character = await this.findCharacter(project.id, characterId);
    let bigTaskId: bigint;
    try {
      bigTaskId = BigInt(taskId);
    } catch {
      throw new AppError(ErrorCode.INVALID_PARAM, "invalid task_id", { field: "task_id" });
    }
    const [task] = await db
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, bigTaskId), eq(tasks.spaceId, BigInt(spaceId))));
    if (!task || task.status !== TaskStatus.SUCCEEDED) {
      throw new AppError(ErrorCode.ASSET_NOT_READY, "portrait task not succeeded");
    }
    const results = Array.isArray(task.results) ? (task.results as Array<{ uri?: string }>) : [];
    const picked = results[index];
    if (!picked?.uri) throw new AppError(ErrorCode.NOT_FOUND, "candidate not found");

    const assetId = newId();
    await db.transaction(async (tx) => {
      await tx.insert(assets).values({
        id: assetId,
        spaceId: BigInt(spaceId),
        kind: "image",
        uri: picked.uri!,
        sourceTaskId: task.id,
        name: character.name,
        tags: ["portrait"],
        meta: { project_id: String(project.id), project_asset_id: String(character.id), candidate_index: index },
      });
      await tx
        .update(projectAssets)
        .set({
          portraitAssetId: assetId,
          refImageUri: picked.uri!,
          status: 2,
          finalizedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(projectAssets.id, character.id));
    });
    const [updated] = await db.select().from(projectAssets).where(eq(projectAssets.id, character.id));
    return assetDto(updated, await this.storage.signDownload(picked.uri!, 3600));
  }

  // 定妆图转存为通用资产（跨项目复用，自动打 #角色 标签）
  async characterToAsset(spaceId: string, projectId: string, characterId: string) {
    const project = await this.findProject(spaceId, projectId);
    const character = await this.findCharacter(project.id, characterId);
    if (!character.portraitAssetId || !character.refImageUri) {
      throw new AppError(ErrorCode.ASSET_NOT_READY, "character portrait not finalized");
    }
    const tag = `#${character.name}`;
    const [current] = await db
      .select()
      .from(assets)
      .where(and(eq(assets.id, character.portraitAssetId), eq(assets.spaceId, BigInt(spaceId))));
    if (!current) throw new AppError(ErrorCode.NOT_FOUND, "portrait asset not found");
    const mergedTags = Array.from(new Set([...(current.tags ?? []), tag])).slice(0, 20);
    const [asset] = await db
      .update(assets)
      .set({
        name: character.name,
        tags: mergedTags,
        meta: {
          ...(typeof current.meta === "object" && current.meta ? current.meta : {}),
          promoted_to_general_asset: true,
          project_id: String(project.id),
          project_asset_id: String(character.id),
        },
        updatedAt: new Date(),
      })
      .where(and(eq(assets.id, character.portraitAssetId), eq(assets.spaceId, BigInt(spaceId))))
      .returning();
    if (!asset) throw new AppError(ErrorCode.NOT_FOUND, "portrait asset not found");
    return {
      ...assetDto(character, await this.storage.signDownload(character.refImageUri, 3600)),
      asset_id: String(asset.id),
      tags: asset.tags,
    };
  }

  // ── P2：项目资产（场景/道具/其他）CRUD + 分镜资产绑定 ───────────────────

  /** GET /projects/{id}/assets?kind=：按 createdAt 升序；kind 省略时返回全部四类（含角色） */
  async listProjectAssets(spaceId: string, projectId: string, kind?: ProjectAssetKind) {
    const project = await this.findProject(spaceId, projectId);
    const rows = await db
      .select()
      .from(projectAssets)
      .where(
        kind
          ? and(eq(projectAssets.projectId, project.id), eq(projectAssets.kind, kind))
          : eq(projectAssets.projectId, project.id),
      )
      .orderBy(projectAssets.createdAt, projectAssets.id);
    const counts = await this.boundShotCounts(rows.map((row) => row.id));
    const list = await Promise.all(rows.map((row) => this.projectAssetDtoOf(row, counts)));
    return { list };
  }

  /** POST /projects/{id}/assets：新建场景/道具/其他（角色必须走 characters/generate） */
  async createProjectAsset(spaceId: string, projectId: string, input: ProjectAssetCreateRequest) {
    const project = await this.findProject(spaceId, projectId);
    if (input.kind === "character") {
      throw new AppError(
        ErrorCode.INVALID_PARAM,
        "character assets must be generated via POST /projects/{id}/characters/generate",
        { field: "kind" },
      );
    }
    const [row] = await db
      .insert(projectAssets)
      .values({
        id: newId(),
        projectId: project.id,
        kind: input.kind,
        name: input.name,
        description: normalizeOptionalText(input.description),
        prompt: normalizeOptionalText(input.prompt),
        refImageUri: normalizeOptionalText(input.ref_image_uri),
        status: ProjectAssetStatus.DRAFT,
      })
      .returning();
    if (!row) throw new AppError(ErrorCode.INTERNAL, "failed to create project asset");
    return this.projectAssetDtoOf(row);
  }

  /** PATCH /projects/{id}/assets/{assetId}：改名/描述/提示词/参考图/定稿状态 */
  async patchProjectAsset(
    spaceId: string,
    projectId: string,
    assetId: string,
    input: ProjectAssetPatchRequest,
  ) {
    const project = await this.findProject(spaceId, projectId);
    const asset = await this.findProjectAsset(project.id, assetId);
    const patch: Partial<typeof projectAssets.$inferInsert> = { updatedAt: new Date() };
    if (input.name !== undefined) patch.name = input.name;
    if (input.description !== undefined) patch.description = normalizeOptionalText(input.description);
    if (input.prompt !== undefined) patch.prompt = normalizeOptionalText(input.prompt);
    if (input.ref_image_uri !== undefined) patch.refImageUri = normalizeOptionalText(input.ref_image_uri);
    if (input.status !== undefined) {
      patch.status = input.status;
      // 定稿幂等：已定稿再次置 2 时保留原 finalized_at；置 1 清空
      patch.finalizedAt =
        input.status === ProjectAssetStatus.FINALIZED ? (asset.finalizedAt ?? new Date()) : null;
    }
    const [row] = await db
      .update(projectAssets)
      .set(patch)
      .where(eq(projectAssets.id, asset.id))
      .returning();
    if (!row) throw new AppError(ErrorCode.NOT_FOUND, "asset not found");
    return this.projectAssetDtoOf(row);
  }

  /** DELETE /projects/{id}/assets/{assetId}：同事务解除分镜绑定后删除资产 */
  async deleteProjectAsset(spaceId: string, projectId: string, assetId: string) {
    const project = await this.findProject(spaceId, projectId);
    const asset = await this.findProjectAsset(project.id, assetId);
    await db.transaction(async (tx) => {
      await tx.delete(storyboardAssets).where(eq(storyboardAssets.projectAssetId, asset.id));
      await tx.delete(projectAssets).where(eq(projectAssets.id, asset.id));
    });
    return { ok: true };
  }

  /**
   * PUT /projects/{id}/episodes/{eid}/storyboards/{sid}/assets：
   * 整体替换该分镜的绑定（同事务 delete + insert），返回落库后的 id 顺序（=入参顺序，去重）。
   */
  async replaceStoryboardAssets(
    spaceId: string,
    projectId: string,
    episodeId: string,
    storyboardId: string,
    assetIds: string[],
  ) {
    const project = await this.findProject(spaceId, projectId);
    const episode = await this.findEpisode(project.id, episodeId);
    let sid: bigint;
    try {
      sid = BigInt(storyboardId);
    } catch {
      throw new AppError(ErrorCode.INVALID_PARAM, "invalid storyboard id", { field: "sid" });
    }
    const [storyboard] = await db
      .select()
      .from(storyboards)
      .where(and(eq(storyboards.id, sid), eq(storyboards.episodeId, episode.id)));
    if (!storyboard) throw new AppError(ErrorCode.NOT_FOUND, "storyboard not found");

    // 规范化 id 并按入参顺序去重（"01" 与 "1" 视为同一资产）
    const orderedIds: string[] = [];
    const orderedBigints: bigint[] = [];
    for (const raw of assetIds) {
      let id: bigint;
      try {
        id = BigInt(raw);
      } catch {
        throw new AppError(ErrorCode.INVALID_PARAM, `invalid asset id: ${raw}`, {
          field: "asset_ids",
        });
      }
      const key = String(id);
      if (orderedIds.includes(key)) continue;
      orderedIds.push(key);
      orderedBigints.push(id);
    }
    // 每个 id 都必须属于该项目且存在，否则 400101（不泄露其它项目资产是否存在）
    if (orderedBigints.length > 0) {
      const rows = await db
        .select({ id: projectAssets.id })
        .from(projectAssets)
        .where(
          and(
            eq(projectAssets.projectId, project.id),
            inArray(projectAssets.id, orderedBigints),
          ),
        );
      if (rows.length !== orderedBigints.length) {
        throw new AppError(ErrorCode.INVALID_PARAM, "some asset ids do not exist in this project", {
          field: "asset_ids",
        });
      }
    }

    await db.transaction(async (tx) => {
      await tx.delete(storyboardAssets).where(eq(storyboardAssets.storyboardId, storyboard.id));
      if (orderedBigints.length > 0) {
        await tx
          .insert(storyboardAssets)
          .values(
            orderedBigints.map((projectAssetId) => ({
              storyboardId: storyboard.id,
              projectAssetId,
            })),
          );
      }
    });
    return { asset_ids: orderedIds };
  }

  /**
   * POST /projects/{id}/assets/extract（P3 AI 提取资产）：
   * 从分集内容（episode_id）或项目 source_text 抽取场景/道具（可选角色），落库为草稿资产。
   * - 去重：同 project+kind+name(trim) 已存在 → overwrite=true 且 description/prompt 确有差异才更新，否则 skipped；
   * - 更新绝不改 status / finalized_at / ref_image_uri / portrait_asset_id；
   * - 单次最多落 20 个（按 scenes→props→characters 顺序截断，truncated=true）。
   */
  async extractProjectAssets(
    spaceId: string,
    projectId: string,
    input: ProjectAssetsExtractRequest,
  ) {
    const project = await this.findProject(spaceId, projectId);

    // 内容来源：episode_id → 该集 title/synopsis/script_text；否则项目 source_text + title
    let title = project.title;
    let synopsis: string | undefined;
    let scriptText: string | undefined;
    let sourceText: string | undefined;
    if (input.episode_id) {
      const episode = await this.findEpisode(project.id, input.episode_id);
      title = episode.title ?? project.title;
      synopsis = episode.synopsis ?? undefined;
      scriptText = episode.scriptText ?? undefined;
    } else {
      sourceText = project.sourceText ?? undefined;
    }

    const extracted = await this.llm.extractAssets({ title, synopsis, scriptText, sourceText });

    type Candidate = {
      kind: "scene" | "prop" | "character";
      name: string;
      description: string | null;
      prompt: string | null;
    };
    const candidates: Candidate[] = [
      ...extracted.scenes.map((item) => ({
        kind: "scene" as const,
        name: item.name,
        description: normalizeOptionalText(item.description),
        prompt: normalizeOptionalText(item.prompt),
      })),
      ...extracted.props.map((item) => ({
        kind: "prop" as const,
        name: item.name,
        description: normalizeOptionalText(item.description),
        prompt: normalizeOptionalText(item.prompt),
      })),
      ...(input.include_characters
        ? extracted.characters.map((item) => ({
            kind: "character" as const,
            name: item.name,
            description: normalizeOptionalText(item.description),
            prompt: normalizeOptionalText(item.prompt),
          }))
        : []),
    ].filter((candidate) => candidate.name.length > 0);

    const truncated = candidates.length > PROJECT_ASSETS_EXTRACT_MAX;
    const targets = candidates.slice(0, PROJECT_ASSETS_EXTRACT_MAX);

    const existingRows = await db
      .select()
      .from(projectAssets)
      .where(eq(projectAssets.projectId, project.id));
    const byKindAndName = new Map<string, ProjectAssetRow>(
      existingRows.map((row) => [`${row.kind}:${row.name.trim()}`, row]),
    );

    const changedRows: ProjectAssetRow[] = [];
    let created = 0;
    let updated = 0;
    let skipped = 0;

    await db.transaction(async (tx) => {
      for (const candidate of targets) {
        const key = `${candidate.kind}:${candidate.name}`;
        const existing = byKindAndName.get(key);
        if (!existing) {
          const [row] = await tx
            .insert(projectAssets)
            .values({
              id: newId(),
              projectId: project.id,
              kind: candidate.kind,
              name: candidate.name,
              description: candidate.description,
              prompt: candidate.prompt,
              status: ProjectAssetStatus.DRAFT,
            })
            .returning();
          if (!row) throw new AppError(ErrorCode.INTERNAL, "failed to create extracted asset");
          byKindAndName.set(key, row);
          changedRows.push(row);
          created += 1;
          continue;
        }
        // 同名已存在：不改 status/finalized_at/ref_image_uri；仅 overwrite 且有差异时更新文本
        const sameText =
          (existing.description ?? null) === candidate.description &&
          (existing.prompt ?? null) === candidate.prompt;
        if (!input.overwrite || sameText) {
          skipped += 1;
          continue;
        }
        const [row] = await tx
          .update(projectAssets)
          .set({
            description: candidate.description,
            prompt: candidate.prompt,
            updatedAt: new Date(),
          })
          .where(eq(projectAssets.id, existing.id))
          .returning();
        if (!row) throw new AppError(ErrorCode.NOT_FOUND, "asset not found");
        byKindAndName.set(key, row);
        changedRows.push(row);
        updated += 1;
      }
    });

    const counts = await this.boundShotCounts(changedRows.map((row) => row.id));
    const items = await Promise.all(changedRows.map((row) => this.projectAssetDtoOf(row, counts)));
    return { created, updated, skipped, items, truncated };
  }

  async retryExport(spaceId: string, projectId: string, episodeId: string, exportId: string) {
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
    if (row.status !== 4) throw new AppError(ErrorCode.INVALID_PARAM, "only failed exports can retry");
    await db
      .update(exportJobs)
      .set({ status: 1, error: null, fileUri: null, expiresAt: null, updatedAt: new Date() })
      .where(eq(exportJobs.id, id));
    await this.queue.enqueueExport(String(id));
    return { export_id: String(id), status: 1 };
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

    // P2：分镜绑定可包含角色 / 场景 / 道具 / 其他任意项目资产，统一按资产读参考图
    // （仍要求每个被绑定资产 status=2 且 ref_image_uri 非空，否则该镜 400105）
    const projectAssetRows = await db
      .select()
      .from(projectAssets)
      .where(eq(projectAssets.projectId, project.id))
      .orderBy(projectAssets.createdAt, projectAssets.id);
    const assetById = new Map(projectAssetRows.map((asset) => [String(asset.id), asset]));
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
      attemptNo: number;
      reusableTaskId: bigint | null;
      durationAdjusted?: { from: number; to: number };
    };
    const candidates: Candidate[] = [];
    const items: Array<{
      shot_id: string;
      task_id: string | null;
      submitted: boolean;
      code?: number;
      reason?: string;
      duration_adjusted?: { from: number; to: number };
    }> = [];
    let balance = 0;

    for (const shotId of input.shot_ids) {
      const shot = shotById.get(shotId);
      if (!shot) {
        items.push({ shot_id: shotId, task_id: null, submitted: false, code: ErrorCode.NOT_FOUND });
        continue;
      }
      const linked = (linkMap.get(shotId) ?? []).map((id) => assetById.get(id)).filter(Boolean);
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
      const sceneCfg = (model.sceneModes as Record<string, { durations?: number[] } | undefined>)
        .storyboard_reference_video;
      const allowedDurations = sceneCfg?.durations ?? [];
      const requestedDuration = shot.durationS ?? 5;
      let duration = requestedDuration;
      if (allowedDurations.length > 0 && !allowedDurations.includes(requestedDuration)) {
        const lower = [...allowedDurations]
          .filter((value) => value <= requestedDuration)
          .sort((a, b) => b - a)[0];
        duration = lower ?? Math.min(...allowedDurations);
      }
      let durationAdjusted =
        duration !== requestedDuration ? { from: requestedDuration, to: duration } : undefined;      const request: GenerationRequest = {
        mode: "universal_reference",
        model: model.name,
        scene: "storyboard_reference_video",
        input: { prompt: shot.videoPrompt ?? shot.shotDesc ?? "", reference_uris: refs },
        options: {
          ratio: input.ratio ?? shot.ratio ?? project.ratio,
          resolution: input.resolution ?? shot.resolution ?? "720p",
          duration,
          count: 1,
          enable_audio: true,
          mouth_drive: false,
        },
      };
      const priced = await this.credits.price(request, spaceId);
      balance = priced.balance;
      // PRD F2：价格表未覆盖该时长 → 就近低档计费并回写 duration_s
      if (priced.effectiveDurationS != null && priced.effectiveDurationS !== duration) {
        request.options.duration = priced.effectiveDurationS;
        duration = priced.effectiveDurationS;
        durationAdjusted = { from: requestedDuration, to: duration };
      }
      // 幂等：按 shot 维度取该镜最近一次任务
      // - 成功/在途 → 复用原任务（不重复扣费）
      // - 失败/取消 → 新一轮 attempt（dedupe 带 attempt 号）
      const [latestForShot] = await db
        .select()
        .from(tasks)
        .where(and(eq(tasks.spaceId, BigInt(spaceId)), eq(tasks.shotId, shot.id)))
        .orderBy(desc(tasks.attemptNo))
        .limit(1);
      const reusable =
        latestForShot &&
        (latestForShot.status === TaskStatus.SUCCEEDED ||
          latestForShot.status === TaskStatus.PENDING ||
          latestForShot.status === TaskStatus.RUNNING);
      const attemptNo = reusable ? (latestForShot?.attemptNo ?? 1) : (latestForShot?.attemptNo ?? 0) + 1;
      candidates.push({
        shotId,
        shot,
        request,
        cost: priced.credits,
        dedupeKey: `shot:${shot.id}:a${attemptNo}`,
        attemptNo,
        reusableTaskId: reusable ? latestForShot.id : null,
        ...(durationAdjusted ? { durationAdjusted } : {}),
      });
    }

    // 预算：先确定本轮可投递集合；余额不足则整单拒绝
    let spent = 0;
    const submittable: Candidate[] = [];
    for (const candidate of candidates) {
      // 幂等命中（同 attempt 已存在任务）→ 直接复用，不扣费
      const [existing] = await db
        .select()
        .from(tasks)
        .where(and(eq(tasks.spaceId, BigInt(spaceId)), eq(tasks.dedupeKey, candidate.dedupeKey)));
      if (existing) {
        items.push({ shot_id: candidate.shotId, task_id: String(existing.id), submitted: true });
        continue;
      }
      // 上一轮已成功/在途 → 复用原任务（断点续跑不重复扣费）
      if (candidate.reusableTaskId) {
        items.push({
          shot_id: candidate.shotId,
          task_id: String(candidate.reusableTaskId),
          submitted: true,
        });
        continue;
      }
      // 预算上限触顶 → 该镜跳过（逐镜部分成功，PRD F2）：先按预算再按可用余额判断
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
      // 可用余额不足 → 同样逐镜跳过，避免整单失败（新用户额度有限时仍能出一部分片）
      if (spent + candidate.cost > balance) {
        items.push({
          shot_id: candidate.shotId,
          task_id: null,
          submitted: false,
          code: ErrorCode.INSUFFICIENT_BALANCE,
          reason: "insufficient_balance",
        });
        continue;
      }
      spent += candidate.cost;
      submittable.push(candidate);
    }
    // 只有一分钱都投不出去（余额连最便宜的一镜都不够）才整单拒绝
    if (submittable.length === 0 && items.every((i) => !i.submitted)) {
      const anyByBalance = items.some((i) => i.code === ErrorCode.INSUFFICIENT_BALANCE);
      if (anyByBalance) {
        throw new AppError(ErrorCode.INSUFFICIENT_BALANCE, "Insufficient Balance");
      }
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
          attemptNo: candidate.attemptNo,
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
          payload: {
            shot_id: candidate.shotId,
            batch: true,
            ...(candidate.durationAdjusted ? { duration_adjusted: candidate.durationAdjusted } : {}),
          },
        });
        await tx
          .update(storyboards)
          .set({ status: 3, videoTaskId: taskId, updatedAt: new Date() })
          .where(eq(storyboards.id, candidate.shot.id));
      });
      await this.queue.enqueueTask(String(taskId));
      items.push({
        shot_id: candidate.shotId,
        task_id: String(taskId),
        submitted: true,
        ...(candidate.durationAdjusted ? { duration_adjusted: candidate.durationAdjusted } : {}),
      });
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

  async addShotMaterial(spaceId: string, projectId: string, taskId: string) {
    const project = await this.findProject(spaceId, projectId);
    let bigId: bigint;
    try {
      bigId = BigInt(taskId);
    } catch {
      throw new AppError(ErrorCode.INVALID_PARAM, "invalid task id", { field: "task_id" });
    }
    const [task] = await db
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, bigId), eq(tasks.spaceId, BigInt(spaceId))));
    if (!task) throw new AppError(ErrorCode.NOT_FOUND, "task not found");
    if (task.status !== TaskStatus.SUCCEEDED) {
      throw new AppError(ErrorCode.ASSET_NOT_READY, "task not succeeded yet");
    }
    const results = Array.isArray(task.results) ? (task.results as Array<{ uri?: string }>) : [];
    const uri = results[0]?.uri;
    if (!uri) throw new AppError(ErrorCode.NOT_FOUND, "result not found");

    const [existing] = await db
      .select()
      .from(projectAssets)
      .where(and(eq(projectAssets.projectId, project.id), eq(projectAssets.sourceTaskId, bigId)));
    if (existing) return assetDto(existing, await this.storage.signDownload(existing.refImageUri ?? "", 3600));

    const assetId = newId();
    await db.insert(assets).values({
      id: assetId,
      spaceId: BigInt(spaceId),
      kind: task.capability === "image" ? "image" : "video",
      uri,
      sourceTaskId: task.id,
      name: `material-${task.id}`,
      tags: ["shot-material"],
    });
    const [row] = await db
      .insert(projectAssets)
      .values({
        id: newId(),
        projectId: project.id,
        kind: "shot_material",
        name: `素材-${String(task.id).slice(-6)}`,
        refImageUri: uri,
        sourceTaskId: task.id,
        portraitAssetId: assetId,
        status: 1,
      })
      .returning();
    if (!row) throw new AppError(ErrorCode.INTERNAL, "add shot material failed");
    return assetDto(row, await this.storage.signDownload(uri, 3600));
  }

  async listShotMaterials(spaceId: string, projectId: string) {
    const project = await this.findProject(spaceId, projectId);
    const rows = await db
      .select()
      .from(projectAssets)
      .where(and(eq(projectAssets.projectId, project.id), eq(projectAssets.kind, "shot_material")))
      .orderBy(desc(projectAssets.createdAt));
    return Promise.all(
      rows.map(async (row) => assetDto(row, row.refImageUri ? await this.storage.signDownload(row.refImageUri, 3600) : null)),
    );
  }

  async projectMatrix(spaceId: string, projectId: string) {
    const project = await this.findProject(spaceId, projectId);
    const eps = await db
      .select()
      .from(episodes)
      .where(eq(episodes.projectId, project.id))
      .orderBy(episodes.epNo);
    if (eps.length === 0) return { project: projectDto(project), episodes: [] };
    const shots = await db
      .select()
      .from(storyboards)
      .where(
        inArray(
          storyboards.episodeId,
          eps.map((ep) => ep.id),
        ),
      )
      .orderBy(storyboards.shotNo);
    const taskIds = shots
      .flatMap((shot) => [shot.videoTaskId, shot.imageTaskId])
      .filter((id): id is bigint => id !== null);
    const taskRows =
      taskIds.length > 0
        ? await db
            .select({ id: tasks.id, status: tasks.status })
            .from(tasks)
            .where(inArray(tasks.id, taskIds))
        : [];
    const taskStatus = new Map(taskRows.map((row) => [String(row.id), row.status]));
    const byEpisode = new Map<string, typeof shots>();
    for (const shot of shots) {
      const key = String(shot.episodeId);
      const list = byEpisode.get(key) ?? [];
      list.push(shot);
      byEpisode.set(key, list);
    }
    return {
      project: projectDto(project),
      episodes: eps.map((ep) => ({
        id: String(ep.id),
        ep_no: ep.epNo,
        title: ep.title,
        shots: (byEpisode.get(String(ep.id)) ?? []).map((shot) => ({
          id: String(shot.id),
          shot_no: shot.shotNo,
          status: shot.status,
          task_status: shot.videoTaskId
            ? (taskStatus.get(String(shot.videoTaskId)) ?? null)
            : shot.imageTaskId
              ? (taskStatus.get(String(shot.imageTaskId)) ?? null)
              : null,
        })),
      })),
    };
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

  /** 单个项目资产的 DTO（预签名参考图 + 被分镜引用次数）；counts 可批量预取避免 N+1 */
  private async projectAssetDtoOf(row: ProjectAssetRow, counts?: Map<string, number>) {
    const boundCounts = counts ?? (await this.boundShotCounts([row.id]));
    const portraitUrl = row.refImageUri
      ? await this.storage.signDownload(row.refImageUri, 3600)
      : null;
    return projectAssetDto(row, portraitUrl, boundCounts.get(String(row.id)) ?? 0);
  }

  /** 聚合每个资产被多少分镜引用（storyboard_assets 计数；绑定表无 created_at，无需排序） */
  private async boundShotCounts(assetIds: bigint[]): Promise<Map<string, number>> {
    const counts = new Map<string, number>();
    if (assetIds.length === 0) return counts;
    const links = await db
      .select()
      .from(storyboardAssets)
      .where(inArray(storyboardAssets.projectAssetId, assetIds));
    for (const link of links) {
      const key = String(link.projectAssetId);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }

  /** 项目资产查找（任意 kind；必须属于该项目） */
  private async findProjectAsset(projectId: bigint, assetId: string): Promise<ProjectAssetRow> {
    let id: bigint;
    try {
      id = BigInt(assetId);
    } catch {
      throw new AppError(ErrorCode.INVALID_PARAM, "invalid asset id", { field: "assetId" });
    }
    const [row] = await db
      .select()
      .from(projectAssets)
      .where(and(eq(projectAssets.id, id), eq(projectAssets.projectId, projectId)));
    if (!row) throw new AppError(ErrorCode.NOT_FOUND, "asset not found");
    return row;
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
