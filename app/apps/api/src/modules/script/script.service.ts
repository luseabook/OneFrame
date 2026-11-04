import { Inject, Injectable } from "@nestjs/common";
import { and, desc, eq, ilike, inArray, isNull, sql } from "drizzle-orm";
import {
  assets,
  directorScenes,
  episodeResources,
  episodes,
  exportJobs,
  extractionTasks,
  freezeCredits,
  models,
  projectAssets,
  projectResourceDirs,
  projectTimelines,
  scriptProjects,
  storyboardAssets,
  storyboards,
  taskEvents,
  tasks,
  teamGroups,
  timelineExports,
  timelinePublications,
} from "@app/db";
import {
  AppError,
  ErrorCode,
  LIMITS,
  PROJECT_ASSETS_EXTRACT_MAX,
  ProjectAssetStatus,
  ProjectSourceType,
  TaskStatus,
  newId,
  type CharactersGenerateRequest,
  type GenerateVideosBatchRequest,
  type GenerationRequest,
  type OutlineConfirmRequest,
  type PortraitGenerateRequest,
  type ProjectAssetCreateRequest,
  type ProjectAssetImageGenerateRequest,
  type ProjectAssetImageSelectRequest,
  type ProjectAssetKind,
  type ProjectAssetPatchRequest,
  type ProjectAssetsExtractRequest,
  type ScriptDraftGenerateRequest,
  type SplitEpisodesRequest,
  type StoryboardPatchRequest,
  type StoryboardCreateRequest,
  type StoryboardBatchCreateRequest,
  type StoryboardRenumberRequest,
  type StoryboardsGenerateRequest,
  type StoryboardVideoMode,
} from "@app/shared";
import { clampToNovelLimit, decodeBase64Upload, parseScriptFile } from "./script-parser";
import { db } from "../../db/database";
import { QueueService } from "../../queue/queue.service";
import { CreditsService } from "../credits/credits.service";
import { GenerationsService } from "../generations/generations.service";
import { ModelsService } from "../models/models.service";
import { NovelService } from "../novel/novel.service";
import { StorageService } from "../../storage/storage.service";
import { ModerationService } from "../moderation/moderation.service";
import { AssetGatesService } from "./asset-gates.service";
import { WorksService } from "./works.service";
import { LlmService } from "./llm.service";
import type { TimelineClipAssetDto, TimelineClipDto, TimelineClipInput, TimelinePutRequest } from "./timeline.schema";

/** 第 68 批：分镜增删改要用事务（改号 + 删绑定 + 删行必须原子）。 */
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

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
    /**
     * 拆集来源本子（迁移 0026）：`POST /episodes/split` 的 novel 分支写入，**只写一次不覆盖**。
     * 对外透出是为了让 novel 侧 `reopen` 能先按本子精确判断"这本有没有被拆过"，
     * 而不是拿正文快照比对——项目正文被改写后快照就会漏判。
     */
    source_novel_id: row.sourceNovelId ? String(row.sourceNovelId) : null,
    /**
     * 项目编排模式（迁移 0031）：1 普通剧本 / 2 广告剧 / 3 视频转绘。
     * 必须透出——否则前端「我的广告剧/转绘项目」列表只能靠猜（`source_type` 猜不准：
     * 广告剧与普通项目都用 `source_type=2`）。
     */
    project_mode: row.projectMode,
    status: row.status,
    archived_at: row.archivedAt ? row.archivedAt.toISOString() : null,
    is_sample: row.isSample === 1,
    created_at: row.createdAt.toISOString(),
    // 列表页要展示「最后编辑于 …」：用项目行的 updatedAt（任何写操作都会刷新它）
    updated_at: row.updatedAt.toISOString(),
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
    /**
     * 产物级「这份文本是不是 mock 假文案」（api-spec §33.1 新增，2026-11-03）。
     *
     * 与 `GET /v1/me` 的 `llm_mode` **不是同一个问题**：
     * - `llm_mode` 是**进程级**：这台机器现在在跑什么；
     * - `llm_mock` 是**产物级**：我手上这一集的大纲/正文是不是假的。
     * 切到 real 之后 `llm_mode` 立刻变 `real`，而库里 mock 期生成的产物依然是假的 ——
     * 只有产物级字段能标出这一点（这也是为什么导出 manifest 里要一并带上）。
     */
    llm_mock: row.llmMock,
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
    // P9：3D 定格图 storage key（*_url 由 service 层签名后补充）
    first_frame_uri: row.firstFrameUri ?? null,
    last_frame_uri: row.lastFrameUri ?? null,
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
function projectAssetDto(
  row: ProjectAssetRow,
  portraitUrl: string | null,
  boundShotCount: number,
  fileUrl: string | null,
) {
  return {
    ...assetDto(row, portraitUrl),
    // 竞品 `/df/resources/list` 的 resource_type（生成列，见 schema 注释）
    resource_type: row.resourceType,
    dir_id: row.dirId ? String(row.dirId) : null,
    file_uri: row.fileUri ?? null,
    /** file_uri 的签名 URL（仅 storage key 可签；外链保持 null，前端回退 file_uri） */
    file_url: fileUrl,
    content_type: row.contentType ?? null,
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
    @Inject(AssetGatesService) private readonly gates: AssetGatesService,
    @Inject(NovelService) private readonly novels: NovelService,
    @Inject(WorksService) private readonly works: WorksService,
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
  /**
   * 作品库（PRD 增补 §1.3 / task-10 §2「全部项目聚合」）：
   * 工坊项目与画布项目在同一清单里，跨域**只读投影**。
   *
   * 聚合口径与筛选全部下沉到 WorksService（SQL），这里只做参数收敛，
   * 保留原签名让既有调用方（作品墙）零改动。
   */
  async listWorks(
    spaceId: string,
    opts: {
      status?: string;
      page?: number;
      pageSize?: number;
      tab?: "workshop" | "canvas" | "all";
      kind?: "workshop" | "canvas";
      projectMode?: number;
      groupId?: string;
      state?: "draft" | "producing" | "ready" | "archived";
      keyword?: string;
      from?: string;
      to?: string;
    } = {},
  ) {
    return this.works.list(spaceId, {
      tab: opts.tab,
      kind: opts.kind,
      projectMode: opts.projectMode,
      groupId: opts.groupId,
      // status 兼容旧值 archived / 其它（active）；all 表示不过滤归档
      status: opts.status === "archived" ? "archived" : opts.status === "all" ? "all" : "active",
      state: opts.state,
      keyword: opts.keyword,
      from: opts.from,
      to: opts.to,
      page: opts.page,
      pageSize: opts.pageSize,
    });
  }

  /**
   * 换组：项目归属组变更（对齐竞品 `POST /df/script_project/:sp_id/group/edit`）。
   *
   * 三个校验，缺一不可：
   * 1. 项目必须属于当前 space（`findProject` 已做）；
   * 2. 目标组必须存在且属于当前 space —— 不校验就会出现"把项目挂到别的空间的组上"，
   *    分组名会跟着列表接口泄露出去（跨空间信息泄露）；
   * 3. 目标组必须 `status=1`（停用的组不该再接新项目）。
   *
   * `groupId` 传 null / "0" / "" = 移出分组（写 null），不是写 0 —— `team_groups.id` 是真实 ID，
   * 写 0 会变成悬空外键（外键约束直接报错，反而暴露实现细节）。
   */
  async setProjectGroup(spaceId: string, projectId: string, groupId: string | null) {
    const project = await this.findProject(spaceId, projectId);
    const raw = (groupId ?? "").trim();
    if (raw === "" || raw === "0") {
      await db
        .update(scriptProjects)
        .set({ groupId: null, updatedAt: new Date() })
        .where(eq(scriptProjects.id, project.id));
      return { id: String(project.id), group_id: "0", group_name: null };
    }
    if (!/^\d{1,20}$/.test(raw)) {
      throw new AppError(ErrorCode.INVALID_PARAM, "group_id must be a numeric id or 0", {
        field: "group_id",
      });
    }
    const [group] = await db
      .select({ id: teamGroups.id, name: teamGroups.name, status: teamGroups.status })
      .from(teamGroups)
      .where(and(eq(teamGroups.id, BigInt(raw)), eq(teamGroups.spaceId, BigInt(spaceId))))
      .limit(1);
    if (!group) {
      throw new AppError(ErrorCode.NOT_FOUND, "group not found in this space", { field: "group_id" });
    }
    if (Number(group.status) !== 1) {
      throw new AppError(ErrorCode.INVALID_PARAM, "group is disabled", { field: "group_id" });
    }
    await db
      .update(scriptProjects)
      .set({ groupId: group.id, updatedAt: new Date() })
      .where(eq(scriptProjects.id, project.id));
    return { id: String(project.id), group_id: String(group.id), group_name: group.name };
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
        assetDto(
          row,
          row.refImageUri
            ? await this.storage
                .signDownload(spaceId, row.refImageUri, 3600)
                .catch(() => null)
            : null,
        ),
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

  /**
   * `POST /projects/:id/episodes/split` —— 拆集。
   *
   * 两种来源（completion-plan §3.3 衔接口径）：
   * 1. 默认：用请求里的 `source_text`，没有则用项目原文；按 `第N集/章/回` 标记或等分切；
   * 2. `source = {kind:'novel', nt_id}`：调 `NovelService.assertSplittable(spaceId, nt_id)`
   *    校验并取已定稿剧本。**只有 `status=16`（已定稿）的本子可作拆集源**，否则
   *    novel 侧抛 `AppError`（未定稿 / 不是该 space 的本子 / 不存在），这里原样透出——
   *    不要在 script 侧重写一遍判定，否则两处口径一定会漂。
   *
   * 为什么优先用返回的 `episodeScripts[]` 而不是把 `sourceText` 再切一次：剧本工厂的
   * 集边界是用户确认过的，再切一次必然对不上（novel 侧注释同因）。
   */
  async splitEpisodes(
    spaceId: string,
    projectId: string,
    input: SplitEpisodesRequest,
    source?: { kind: "novel"; nt_id: string },
  ) {
    const project = await this.findProject(spaceId, projectId);

    let chunks: Array<{ title?: string; text: string }>;
    if (source?.kind === "novel") {
      const novel = await this.novels.assertSplittable(spaceId, source.nt_id);
      const scripts = novel.episodeScripts;
      chunks =
        scripts.length > 0
          ? scripts.map((episode) => ({
              title: episode.title?.trim() || `第${episode.epNo}集`,
              text: episode.text,
            }))
          : this.splitSource(novel.sourceText, input.ep_count ?? novel.episodeCount).map((text) => ({
              text,
            }));
      if (chunks.length === 0) {
        throw new AppError(ErrorCode.INVALID_PARAM, "novel has no splittable episode text", {
          field: "source",
          nt_id: source.nt_id,
          reason: "episodes_empty",
        });
      }
    } else {
      const sourceText = (input.source_text ?? project.sourceText ?? "").trim();
      if (!sourceText) {
        throw new AppError(ErrorCode.INVALID_PARAM, "source_text is empty", { field: "source_text" });
      }
      if (sourceText.length > 50_000) {
        throw new AppError(ErrorCode.SOURCE_TOO_LONG, "source text exceeds 50000 chars");
      }
      chunks = this.splitSource(sourceText, input.ep_count).map((text) => ({ text }));
    }

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
            title: chunk.title ?? `第${index + 1}集`,
            synopsis: chunk.text.slice(0, 120),
            scriptText: chunk.text,
            status: 1,
          })),
        )
        .returning();
      // 小说来源：① 来源标记（详情页区分来源）② 记录来源本子（迁移 0026）。
      // `source_novel_id` 只写一次、**已存在不覆盖**：一个项目若先后被两个本子拆过，
      // 保留最初来源才与"这本被拆过"的判据一致；覆盖会让 novel 侧 reopen 判错本子。
      if (source?.kind === "novel") {
        const alreadyBound = project.sourceNovelId !== null;
        await tx
          .update(scriptProjects)
          .set({
            sourceType: ProjectSourceType.NOVEL,
            ...(alreadyBound ? {} : { sourceNovelId: this.parseBigId(source.nt_id, "source.nt_id") }),
            updatedAt: new Date(),
          })
          .where(eq(scriptProjects.id, project.id));
      }
      return rows;
    });
    return created.map(episodeDto);
  }

  /** 数字 id 解析（novel 侧已在 assertSplittable 校验过，这里仍防御性归一） */
  private parseBigId(raw: string, field: string): bigint {
    try {
      return BigInt(raw);
    } catch {
      throw new AppError(ErrorCode.INVALID_PARAM, `invalid ${field}`, { field });
    }
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
            // N-12：把"这份大纲是不是假文案"落到行级，导出时随 manifest 走
            llmMock: this.llm.isMock(),
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
    input: { title?: string; synopsis?: string; script_text?: string; status?: 1 | 2 },
  ) {
    const project = await this.findProject(spaceId, projectId);
    const episode = await this.findEpisode(project.id, episodeId);
    const [row] = await db
      .update(episodes)
      .set({
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.synopsis !== undefined ? { synopsis: input.synopsis } : {}),
        ...(input.script_text !== undefined ? { scriptText: input.script_text } : {}),
        // 第 91 批：竞品 `POST /df/episode/status` 就是改这一列（1 草稿 / 2 确认），
        // 列早就有、只是没有入口；这里不额外做状态机校验 —— 竞品没有给出流转证据。
        ...(input.status !== undefined ? { status: input.status } : {}),
        updatedAt: new Date(),
      })
      .where(eq(episodes.id, episode.id))
      .returning();
    if (!row) throw new AppError(ErrorCode.NOT_FOUND, "episode not found");
    return episodeDto(row);
  }

  /**
   * 第 71 批：删除单集。
   *
   * 竞品证据：`POST /web/v1/df/episode/delete`（`ApiDfEpisodeDeletePOST`，params 里没有 id，
   * 说明集 id 在 body）；CLI 侧竞品 `commands/episode.md:21` 是 `reelmate episode delete EPISODE_ID`。
   *
   * 指向 `episodes.id` 的外键一共 8 张表，全部是 RESTRICT —— 不先清子表，删集会被数据库直接挡下。
   * 清表顺序按依赖从叶子往根走；`storyboard_assets` 引用的是 `storyboards.id`（不是 episode），
   * 所以要先按本集的分镜 id 把它的行删掉（与第 68 批删分镜同一套口径）。
   *
   * **不重排 ep_no**：竞品文档只写「删除该集」，没有重排证据；重排还会让外部已引用的
   * 「第 N 集」漂移，是破坏性副作用。留空洞是两端一致的可见结果。
   */
  async deleteEpisode(spaceId: string, projectId: string, episodeId: string) {
    const project = await this.findProject(spaceId, projectId);
    const episode = await this.findEpisode(project.id, episodeId);
    const cleared = await db.transaction(async (tx) => {
      const shots = await tx
        .select({ id: storyboards.id })
        .from(storyboards)
        .where(eq(storyboards.episodeId, episode.id));
      const shotIds = shots.map((row) => row.id);
      if (shotIds.length > 0) {
        await tx.delete(storyboardAssets).where(inArray(storyboardAssets.storyboardId, shotIds));
      }
      await tx.delete(storyboards).where(eq(storyboards.episodeId, episode.id));
      // 下面 7 张表此前没有任何删除路径，是本批第一次清出来的；全部 references episodes.id。
      await tx.delete(episodeResources).where(eq(episodeResources.episodeId, episode.id));
      await tx.delete(exportJobs).where(eq(exportJobs.episodeId, episode.id));
      await tx.delete(projectTimelines).where(eq(projectTimelines.episodeId, episode.id));
      await tx.delete(timelineExports).where(eq(timelineExports.episodeId, episode.id));
      await tx.delete(extractionTasks).where(eq(extractionTasks.episodeId, episode.id));
      await tx.delete(directorScenes).where(eq(directorScenes.episodeId, episode.id));
      await tx.delete(timelinePublications).where(eq(timelinePublications.episodeId, episode.id));
      await tx.delete(episodes).where(eq(episodes.id, episode.id));
      await tx
        .update(scriptProjects)
        .set({ updatedAt: new Date() })
        .where(eq(scriptProjects.id, project.id));
      return { storyboards: shotIds.length };
    });
    return { deleted: true, episode_id: String(episode.id), ep_no: episode.epNo, cleared };
  }

  /**
   * 第 91 批：批量删集（竞品 `POST /web/v1/df/episode/batch-delete`）。
   *
   * 竞品把 ids 放 body、一次删多集；我方此前只有单集 `DELETE …/episodes/:eid`。
   * 清理口径与单集删除完全一致（8 张 RESTRICT 外键表 + 先按分镜 id 清 `storyboard_assets`），
   * 但**整批一个事务**：要么全删、要么一条都不动 —— 半批成功比失败更难收拾。
   *
   * 先校验「每个 id 都属于本项目」再动手：否则会出现"删掉了 3 个、第 4 个不存在"的部分结果。
   * 不重排 `ep_no`（理由同单集删除：竞品无重排证据，重排会让外部引用的「第 N 集」漂移）。
   */
  async deleteEpisodes(spaceId: string, projectId: string, episodeIds: string[]) {
    const project = await this.findProject(spaceId, projectId);
    const ids = this.parseIdList(episodeIds, "episode_ids");
    const targets = await db
      .select({ id: episodes.id, epNo: episodes.epNo })
      .from(episodes)
      .where(and(eq(episodes.projectId, project.id), inArray(episodes.id, ids)));
    if (targets.length !== ids.length) {
      const known = new Set(targets.map((row) => String(row.id)));
      const missing = ids.filter((id) => !known.has(String(id))).map((id) => String(id));
      throw new AppError(ErrorCode.NOT_FOUND, "episode not found in this project", {
        reason: "episode_not_found",
        ids: missing,
      });
    }
    const cleared = await db.transaction(async (tx) => {
      const shots = await tx
        .select({ id: storyboards.id })
        .from(storyboards)
        .where(inArray(storyboards.episodeId, ids));
      const shotIds = shots.map((row) => row.id);
      if (shotIds.length > 0) {
        await tx.delete(storyboardAssets).where(inArray(storyboardAssets.storyboardId, shotIds));
      }
      await tx.delete(storyboards).where(inArray(storyboards.episodeId, ids));
      await tx.delete(episodeResources).where(inArray(episodeResources.episodeId, ids));
      await tx.delete(exportJobs).where(inArray(exportJobs.episodeId, ids));
      await tx.delete(projectTimelines).where(inArray(projectTimelines.episodeId, ids));
      await tx.delete(timelineExports).where(inArray(timelineExports.episodeId, ids));
      await tx.delete(extractionTasks).where(inArray(extractionTasks.episodeId, ids));
      await tx.delete(directorScenes).where(inArray(directorScenes.episodeId, ids));
      await tx.delete(timelinePublications).where(inArray(timelinePublications.episodeId, ids));
      const removed = await tx.delete(episodes).where(inArray(episodes.id, ids)).returning({ id: episodes.id });
      await tx
        .update(scriptProjects)
        .set({ updatedAt: new Date() })
        .where(eq(scriptProjects.id, project.id));
      return { storyboards: shotIds.length, episodes: removed.length };
    });
    return {
      deleted: cleared.episodes,
      episode_ids: targets.map((row) => String(row.id)),
      ep_nos: targets.map((row) => row.epNo),
      cleared,
    };
  }

  /**
   * 第 71 批：批量建集。
   *
   * 竞品证据：`POST /web/v1/df/episode/batch-create`；竞品 CLI `commands/episode.md:142`
   * 的入参是 `--set @episodes.json`，`items` 每项 `{"sort":1,"name":"第1集","s_script_id":"…"}`，
   * 返回 `succeeded`/`failed`/`unconfirmed`（异步时 `succeeded[]` 只含已确认项）。
   *
   * 我方是同步实现：要么整批落库、要么抛错，没有 `unconfirmed` 这种中间态；
   * `s_script_id`（竞品「拆解结果 ID」）在我方没有对应实体（拆集结果直接落 episodes），
   * 故**不接收该字段**（zod 拒收未知字段会报错，故在 controller 里只声明三个已知字段）。
   * `sort` 给了就用它（撞号 400101，不静默改号）；不给则排到当前最大集号之后，标题回落 `第N集`。
   */
  async batchCreateEpisodes(
    spaceId: string,
    projectId: string,
    input: { items: Array<{ name?: string; sort?: number; synopsis?: string }> },
  ) {
    const project = await this.findProject(spaceId, projectId);
    const existing = await db
      .select({ epNo: episodes.epNo })
      .from(episodes)
      .where(eq(episodes.projectId, project.id));
    const used = new Set(existing.map((row) => row.epNo));
    let nextNo = existing.reduce((max, row) => Math.max(max, row.epNo), 0) + 1;
    const prepared: Array<{ epNo: number; title: string; synopsis: string | null }> = [];
    for (const item of input.items) {
      let epNo: number;
      if (item.sort !== undefined) {
        if (used.has(item.sort)) {
          throw new AppError(ErrorCode.INVALID_PARAM, `ep_no ${item.sort} already used in this project`, {
            field: "sort",
          });
        }
        epNo = item.sort;
      } else {
        while (used.has(nextNo)) nextNo += 1;
        epNo = nextNo;
      }
      used.add(epNo);
      prepared.push({ epNo, title: item.name?.trim() || `第${epNo}集`, synopsis: item.synopsis ?? null });
    }

    const created = await db.transaction(async (tx) => {
      const rows: Array<{ id: string; ep_no: number; title: string }> = [];
      for (const item of prepared) {
        const idBig = newId();
        await tx.insert(episodes).values({
          id: idBig,
          projectId: project.id,
          epNo: item.epNo,
          title: item.title,
          synopsis: item.synopsis,
          status: 1,
        });
        rows.push({ id: String(idBig), ep_no: item.epNo, title: item.title });
      }
      await tx
        .update(scriptProjects)
        .set({ updatedAt: new Date() })
        .where(eq(scriptProjects.id, project.id));
      return rows;
    });
    return { created };
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
      .set({
        scriptText: draft.script_text,
        // N-12：正文同样要标"是否假文案"（大纲与正文可能在不同进程/不同时间生成，
        // 所以两处都写，不靠"大纲是 mock 就推定正文也是"）
        llmMock: this.llm.isMock(),
        updatedAt: new Date(),
      })
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
    return Promise.all(
      rows.map((row) =>
        this.storyboardDtoWithUrls(spaceId, row, linkMap.get(String(row.id)) ?? []),
      ),
    );
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
            // 绑定顺序是契约（images[] 注入的 [[@imgN]] 编号依赖它）：显式按 sort 排，不依赖堆序
            .orderBy(storyboardAssets.storyboardId, storyboardAssets.sort, storyboardAssets.projectAssetId)
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
      storyboards: await Promise.all(
        shots.map((shot) =>
          this.storyboardDtoWithUrls(spaceId, shot, linkMap.get(String(shot.id)) ?? []),
        ),
      ),
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
    const firstFrameUri = normalizeOptionalText(input.first_frame_uri);
    const lastFrameUri = normalizeOptionalText(input.last_frame_uri);
    if (firstFrameUri) {
      this.storage.assertOwnedKey(spaceId, firstFrameUri, "first_frame_uri");
    }
    if (lastFrameUri) {
      this.storage.assertOwnedKey(spaceId, lastFrameUri, "last_frame_uri");
    }
    const [row] = await db
      .update(storyboards)
      .set({
        ...(input.shot_desc !== undefined ? { shotDesc: input.shot_desc } : {}),
        ...(input.video_prompt !== undefined ? { videoPrompt: input.video_prompt } : {}),
        ...(input.duration_s !== undefined ? { durationS: input.duration_s } : {}),
        ...(input.ratio !== undefined ? { ratio: input.ratio } : {}),
        ...(input.resolution !== undefined ? { resolution: input.resolution } : {}),
        // P9：3D 定格图；null/"" → 清空（回退到绑定资产逻辑）
        ...(input.first_frame_uri !== undefined
          ? { firstFrameUri }
          : {}),
        ...(input.last_frame_uri !== undefined
          ? { lastFrameUri }
          : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(storyboards.id, BigInt(storyboardId)), eq(storyboards.episodeId, episode.id)))
      .returning();
    if (!row) throw new AppError(ErrorCode.NOT_FOUND, "storyboard not found");
    return this.storyboardDtoWithUrls(spaceId, row);
  }

  /**
   * 第 68 批：手动新增一条分镜。
   *
   * 缺口来自 CLI skeleton（`storyboard add` 的 reason 写着「我方无单条新增分镜」），
   * 竞品有 `POST /web/v1/df/episode/:ep_id/storyboard-add`。竞品不给字段名，
   * 所以入参口径是我方自定的（见 `storyboardCreateSchema`），待取证。
   *
   * 追加是最常见路径，直接取 max(shot_no)+1，不产生 N 次更新；
   * 只有显式插到中间（`insert_after`/`shot_no`）才整体重排一次。
   */
  async createStoryboard(
    spaceId: string,
    projectId: string,
    episodeId: string,
    input: StoryboardCreateRequest,
  ) {
    const project = await this.findProject(spaceId, projectId);
    const episode = await this.findEpisode(project.id, episodeId);
    if (input.shot_no !== undefined && input.insert_after !== undefined) {
      throw new AppError(ErrorCode.INVALID_PARAM, "shot_no and insert_after are mutually exclusive", {
        field: "insert_after",
      });
    }
    const fields = {
      shotDesc: input.shot_desc ?? "",
      // 与 parse.service 的解析口径一致：没给提示词就用分镜描述兜底，时长/比例回落到项目默认
      videoPrompt: input.video_prompt ?? input.shot_desc ?? "",
      durationS: input.duration_s ?? 5,
      ratio: input.ratio ?? project.ratio,
      ...(input.resolution !== undefined ? { resolution: input.resolution } : {}),
    };
    const row = await db.transaction(async (tx) => {
      const shots = await tx
        .select({ id: storyboards.id, shotNo: storyboards.shotNo })
        .from(storyboards)
        .where(eq(storyboards.episodeId, episode.id))
        .orderBy(storyboards.shotNo);
      if (input.insert_after === undefined && input.shot_no === undefined) {
        const nextNo = shots.reduce((max, shot) => Math.max(max, shot.shotNo), 0) + 1;
        const [created] = await tx
          .insert(storyboards)
          .values({ id: newId(), episodeId: episode.id, shotNo: nextNo, ...fields })
          .returning();
        return created!;
      }
      let at = shots.length;
      if (input.insert_after !== undefined) {
        const index = shots.findIndex((shot) => String(shot.id) === input.insert_after);
        if (index < 0) {
          throw new AppError(ErrorCode.NOT_FOUND, "insert_after storyboard not found in this episode", {
            field: "insert_after",
          });
        }
        at = index + 1;
      } else if (input.shot_no !== undefined) {
        if (shots.some((shot) => shot.shotNo === input.shot_no)) {
          throw new AppError(ErrorCode.INVALID_PARAM, "shot_no already used in this episode", {
            field: "shot_no",
          });
        }
        at = Math.min(input.shot_no - 1, shots.length);
      }
      // 先落一个临时号再整体重排：既有行此刻都占着正数号，0 一定空着，
      // 于是不需要先给谁腾位（重排见 applyShotOrder）。
      const [created] = await tx
        .insert(storyboards)
        .values({ id: newId(), episodeId: episode.id, shotNo: 0, ...fields })
        .returning();
      const order = shots.map((shot) => shot.id);
      order.splice(at, 0, created!.id);
      await this.applyShotOrder(tx, order, 1);
      const [fresh] = await tx.select().from(storyboards).where(eq(storyboards.id, created!.id));
      return fresh ?? created!;
    });
    return this.storyboardDtoWithUrls(spaceId, row);
  }

  /**
   * 第 68 批：批量删除分镜。
   *
   * 竞品有 `POST /df/episode/:ep_id/storyboard/delete`（它的路径里有个双斜杠笔误，
   * 且分镜 id 只能放在 body）。我方 `storyboards` 没有软删列，
   * `storyboard_assets` 是唯一指向 `storyboards.id` 的外键 —— 所以走事务硬删：
   * 先删绑定再删行（顺序与 `parse.service` 重新解析时一致）。
   * 已投递的任务（`image_task_id`/`video_task_id`）不在此处回收：它们有自己的生命周期。
   */
  async deleteStoryboards(
    spaceId: string,
    projectId: string,
    episodeId: string,
    shotIds: string[],
  ) {
    const project = await this.findProject(spaceId, projectId);
    const episode = await this.findEpisode(project.id, episodeId);
    const ids = this.parseIdList(shotIds, "shot_ids");
    return db.transaction(async (tx) => {
      await tx.delete(storyboardAssets).where(inArray(storyboardAssets.storyboardId, ids));
      const removed = await tx
        .delete(storyboards)
        .where(and(eq(storyboards.episodeId, episode.id), inArray(storyboards.id, ids)))
        .returning({ id: storyboards.id });
      return { deleted: removed.length, shot_ids: removed.map((item) => String(item.id)) };
    });
  }

  /**
   * 第 91 批：读单条分镜（竞品 `GET /web/v1/df/episode/:ep_id/storyboard/:id/info`）。
   *
   * 此前只有「整集详情（含全部分镜）」一个读口 —— 前端编辑单镜要拉整集，镜头多的集很浪费。
   * 返回形状与 `episodeDetail().storyboards[]` 的**同一行完全一致**（含 `[[@imgN]]` 依赖的绑定顺序），
   * 只多一层 `{ storyboard }` 包装：单条与列表必须能互换，否则前端要写两套渲染。
   */
  async storyboardDetail(spaceId: string, projectId: string, episodeId: string, storyboardId: string) {
    const project = await this.findProject(spaceId, projectId);
    const episode = await this.findEpisode(project.id, episodeId);
    const shotId = this.parseIdList([storyboardId], "storyboard_id")[0]!;
    const [row] = await db
      .select()
      .from(storyboards)
      .where(and(eq(storyboards.episodeId, episode.id), eq(storyboards.id, shotId)));
    if (!row) {
      throw new AppError(ErrorCode.NOT_FOUND, "storyboard not found in this episode", {
        reason: "storyboard_not_found",
      });
    }
    const links = await db
      .select({ assetId: storyboardAssets.projectAssetId })
      .from(storyboardAssets)
      .where(eq(storyboardAssets.storyboardId, row.id))
      // 与 episodeDetail 同一顺序：绑定顺序是契约（images[] 的 [[@imgN]] 编号依赖它）
      .orderBy(storyboardAssets.sort, storyboardAssets.projectAssetId);
    return {
      storyboard: await this.storyboardDtoWithUrls(
        spaceId,
        row,
        links.map((link) => String(link.assetId)),
      ),
    };
  }

  /**
   * 第 91 批：批量追加分镜（竞品 `POST /web/v1/df/storyboard/:storyboard_id/info/batch-add`）。
   *
   * 竞品是「给一个 storyboard 批量加 info 条目」；我方没有 info 层（一行 `storyboards` 就是一个镜头），
   * 语义对齐为「给这一集按给定顺序追加若干镜头」。**只在末尾追加**：带序号的批量插入一旦中途撞号，
   * "部分成功"会让后面的序号全污染 —— 要插中间请走单条 `createStoryboard`（它有插位与重排）。
   * 默认值口径与单条创建完全一致（空描述、描述兜底提示词、5 秒、项目比例）。
   */
  async createStoryboards(
    spaceId: string,
    projectId: string,
    episodeId: string,
    input: StoryboardBatchCreateRequest,
  ) {
    const project = await this.findProject(spaceId, projectId);
    const episode = await this.findEpisode(project.id, episodeId);
    const rows = await db.transaction(async (tx) => {
      const shots = await tx
        .select({ shotNo: storyboards.shotNo })
        .from(storyboards)
        .where(eq(storyboards.episodeId, episode.id));
      let nextNo = shots.reduce((max, shot) => Math.max(max, shot.shotNo), 0) + 1;
      const values = input.items.map((item) => ({
        id: newId(),
        episodeId: episode.id,
        shotNo: nextNo++,
        shotDesc: item.shot_desc ?? "",
        videoPrompt: item.video_prompt ?? item.shot_desc ?? "",
        durationS: item.duration_s ?? 5,
        ratio: item.ratio ?? project.ratio,
        ...(item.resolution !== undefined ? { resolution: item.resolution } : {}),
      }));
      return tx.insert(storyboards).values(values).returning();
    });
    return {
      storyboards: await Promise.all(
        rows.map((row) => this.storyboardDtoWithUrls(spaceId, row, [])),
      ),
      count: rows.length,
    };
  }

  /**
   * 第 68 批：重排分镜号。
   *
   * 竞品有 `POST /df/episode/:ep_id/storyboard/num-update`。传 `shot_ids` = 按给定顺序重排
   * （必须恰好覆盖该集全部分镜，否则拒绝 —— 否则"漏掉的那条"会被挤到末尾，等于静默改数据）；
   * 不传 = 按现有号压实成 `step, 2*step, …`。
   */
  async renumberStoryboards(
    spaceId: string,
    projectId: string,
    episodeId: string,
    input: StoryboardRenumberRequest,
  ) {
    const project = await this.findProject(spaceId, projectId);
    const episode = await this.findEpisode(project.id, episodeId);
    const rows = await db.transaction(async (tx) => {
      const shots = await tx
        .select({ id: storyboards.id, shotNo: storyboards.shotNo })
        .from(storyboards)
        .where(eq(storyboards.episodeId, episode.id))
        .orderBy(storyboards.shotNo);
      let order = shots.map((shot) => shot.id);
      if (input.shot_ids !== undefined) {
        const given = this.parseIdList(input.shot_ids, "shot_ids");
        const known = new Set(order.map((id) => String(id)));
        const unique = new Set(given.map((id) => String(id)));
        if (unique.size !== given.length) {
          throw new AppError(ErrorCode.INVALID_PARAM, "shot_ids contains duplicates", {
            field: "shot_ids",
          });
        }
        if (given.length !== order.length || given.some((id) => !known.has(String(id)))) {
          throw new AppError(
            ErrorCode.INVALID_PARAM,
            "shot_ids must list every storyboard of this episode exactly once",
            { field: "shot_ids" },
          );
        }
        order = given;
      }
      await this.applyShotOrder(tx, order, input.step);
      return tx
        .select({ id: storyboards.id, shotNo: storyboards.shotNo })
        .from(storyboards)
        .where(eq(storyboards.episodeId, episode.id))
        .orderBy(storyboards.shotNo);
    });
    return { list: rows.map((row) => ({ id: String(row.id), shot_no: row.shotNo })) };
  }

  /**
   * 两段式改号：`uq_storyboards_episode_shot` 是 (episode_id, shot_no) 唯一索引，
   * 逐条改成目标号会在中途撞车（把 1 改成 2 时 2 还没让位）。因此先把所有号改成负数
   * 腾空正数区间，再写终值 —— 负号段本身也唯一，任一步都不会违反约束。
   */
  private async applyShotOrder(tx: Tx, ordered: bigint[], step: number) {
    for (let index = 0; index < ordered.length; index += 1) {
      await tx
        .update(storyboards)
        .set({ shotNo: -(index + 1), updatedAt: new Date() })
        .where(eq(storyboards.id, ordered[index]!));
    }
    for (let index = 0; index < ordered.length; index += 1) {
      await tx
        .update(storyboards)
        .set({ shotNo: step * (index + 1), updatedAt: new Date() })
        .where(eq(storyboards.id, ordered[index]!));
    }
  }

  private parseIdList(raw: string[], field: string): bigint[] {
    return raw.map((value) => {
      if (!/^\d{1,20}$/.test(value)) {
        throw new AppError(ErrorCode.INVALID_PARAM, `${field} must be numeric ids`, { field });
      }
      return BigInt(value);
    });
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
        .map(async ({ item, index }) => ({
          index,
          url: await this.storage.signDownload(spaceId, item.uri!, 3600).catch(() => null),
        })),
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
    const pickedUri = this.storage.assertResultUri(spaceId, picked.uri, "result_uri");

    const assetId = newId();
    await db.transaction(async (tx) => {
      await tx.insert(assets).values({
        id: assetId,
        spaceId: BigInt(spaceId),
        kind: "image",
        uri: pickedUri,
        sourceTaskId: task.id,
        name: character.name,
        tags: ["portrait"],
        meta: { project_id: String(project.id), project_asset_id: String(character.id), candidate_index: index },
      });
      await tx
        .update(projectAssets)
        .set({
          portraitAssetId: assetId,
          refImageUri: pickedUri,
          status: 2,
          finalizedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(projectAssets.id, character.id));
    });
    const [updated] = await db.select().from(projectAssets).where(eq(projectAssets.id, character.id));
    return assetDto(
      updated,
      await this.storage.signDownload(spaceId, pickedUri, 3600).catch(() => null),
    );
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
      ...assetDto(
        character,
        await this.storage
          .signDownload(spaceId, character.refImageUri, 3600)
          .catch(() => null),
      ),
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
    const list = await Promise.all(
      rows.map((row) => this.projectAssetDtoOf(spaceId, row, counts)),
    );
    return { list };
  }

  /**
   * 通用资源列表（对齐竞品 `GET /web/v1/df/resources/list`，第 136 批）。
   *
   * 竞品参数：`sp_id / page / page_size / resource_type / status / sort_field / sort_direction / name`。
   * 我方用 `project_assets.resource_type`（生成列，由 kind 派生）承载，项目 id 即 `sp_id`；
   * 返回 `{list,total,user_total}`（user_total 与 total 同值，保留竞品字段名）。
   */
  async listProjectResources(
    spaceId: string,
    projectId: string,
    opts: {
      page?: number;
      pageSize?: number;
      resourceType?: number;
      status?: number;
      name?: string;
      /** 目录过滤：id / "none"（未归档）/ 省略（全部） */
      dirId?: string;
    } = {},
  ) {
    const project = await this.findProject(spaceId, projectId);
    const page = Math.max(1, opts.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, opts.pageSize ?? 20));
    const conds = [eq(projectAssets.projectId, project.id)];
    if (opts.resourceType !== undefined) conds.push(eq(projectAssets.resourceType, opts.resourceType));
    if (opts.status !== undefined) conds.push(eq(projectAssets.status, opts.status));
    if (opts.dirId !== undefined) {
      if (opts.dirId === "none" || opts.dirId === "root" || opts.dirId === "") {
        conds.push(isNull(projectAssets.dirId));
      } else {
        conds.push(eq(projectAssets.dirId, await this.resolveDirId(project.id, opts.dirId)));
      }
    }
    const name = normalizeOptionalText(opts.name);
    if (name) conds.push(ilike(projectAssets.name, `%${name}%`));
    const rows = await db
      .select()
      .from(projectAssets)
      .where(and(...conds))
      .orderBy(desc(projectAssets.createdAt), desc(projectAssets.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize);
    const [agg] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(projectAssets)
      .where(and(...conds));
    const counts = await this.boundShotCounts(rows.map((row) => row.id));
    const list = await Promise.all(rows.map((row) => this.projectAssetDtoOf(spaceId, row, counts)));
    const total = Number(agg?.n ?? 0);
    return { list, total, user_total: total, page, page_size: pageSize };
  }

  /** ── 资源目录（df/resources/dir）──────────────────────────────── */
  async listResourceDirs(spaceId: string, projectId: string) {
    const project = await this.findProject(spaceId, projectId);
    const dirs = await db
      .select()
      .from(projectResourceDirs)
      .where(eq(projectResourceDirs.projectId, project.id))
      .orderBy(desc(projectResourceDirs.createdAt));
    const counts = await db
      .select({ dirId: projectAssets.dirId, n: sql<number>`count(*)::int` })
      .from(projectAssets)
      .where(eq(projectAssets.projectId, project.id))
      .groupBy(projectAssets.dirId);
    const countMap = new Map(counts.map((row) => [row.dirId ? String(row.dirId) : "", Number(row.n)]));
    return {
      list: dirs.map((dir) => ({
        id: String(dir.id),
        name: dir.name,
        parent_id: dir.parentId ? String(dir.parentId) : null,
        resource_count: countMap.get(String(dir.id)) ?? 0,
      })),
    };
  }

  async createResourceDir(spaceId: string, projectId: string, input: { name: string; parent_id?: string }) {
    const project = await this.findProject(spaceId, projectId);
    const parent = input.parent_id ? await this.resolveDirId(project.id, input.parent_id) : null;
    const [row] = await db
      .insert(projectResourceDirs)
      .values({ id: newId(), projectId: project.id, parentId: parent, name: input.name })
      .returning();
    return { id: String(row!.id), name: row!.name, parent_id: row!.parentId ? String(row!.parentId) : null };
  }

  async renameResourceDir(spaceId: string, projectId: string, dirId: string, name: string) {
    const project = await this.findProject(spaceId, projectId);
    const id = await this.resolveDirId(project.id, dirId);
    const [row] = await db
      .update(projectResourceDirs)
      .set({ name, updatedAt: new Date() })
      .where(eq(projectResourceDirs.id, id))
      .returning();
    return { id: String(row!.id), name: row!.name };
  }

  async moveResourceDir(spaceId: string, projectId: string, dirId: string, parentId?: string) {
    const project = await this.findProject(spaceId, projectId);
    const id = await this.resolveDirId(project.id, dirId);
    const parent = parentId ? await this.resolveDirId(project.id, parentId) : null;
    if (parent !== null) {
      // 禁止把目录移动到自身或其后代下（否则形成环）
      let cursor: bigint | null = parent;
      const seen = new Set<string>();
      while (cursor !== null) {
        if (String(cursor) === String(id)) {
          throw new AppError(ErrorCode.INVALID_PARAM, "cannot move a directory into itself", {
            field: "parent_id",
          });
        }
        if (seen.has(String(cursor))) break;
        seen.add(String(cursor));
        const [row] = await db
          .select({ parentId: projectResourceDirs.parentId })
          .from(projectResourceDirs)
          .where(eq(projectResourceDirs.id, cursor));
        cursor = row?.parentId ?? null;
      }
    }
    await db
      .update(projectResourceDirs)
      .set({ parentId: parent, updatedAt: new Date() })
      .where(eq(projectResourceDirs.id, id));
    return { ok: true };
  }

  async deleteResourceDir(spaceId: string, projectId: string, dirId: string) {
    const project = await this.findProject(spaceId, projectId);
    const id = await this.resolveDirId(project.id, dirId);
    const [dir] = await db.select().from(projectResourceDirs).where(eq(projectResourceDirs.id, id));
    await db.transaction(async (tx) => {
      // 子目录上移到被删目录的父级；资源回到未归档（不级联删素材）
      await tx
        .update(projectResourceDirs)
        .set({ parentId: dir?.parentId ?? null, updatedAt: new Date() })
        .where(eq(projectResourceDirs.parentId, id));
      await tx.update(projectAssets).set({ dirId: null, updatedAt: new Date() }).where(eq(projectAssets.dirId, id));
      await tx.delete(projectResourceDirs).where(eq(projectResourceDirs.id, id));
    });
    return { ok: true };
  }

  async batchMoveProjectResources(
    spaceId: string,
    projectId: string,
    resourceIds: string[],
    dirId?: string,
  ) {
    const project = await this.findProject(spaceId, projectId);
    const ids = await this.resolveResourceIds(project.id, resourceIds);
    const target = dirId ? await this.resolveDirId(project.id, dirId) : null;
    await db
      .update(projectAssets)
      .set({ dirId: target, updatedAt: new Date() })
      .where(inArray(projectAssets.id, ids));
    return { moved: ids.length };
  }

  private async resolveDirId(projectId: bigint, raw: string): Promise<bigint> {
    let id: bigint;
    try {
      id = BigInt(raw);
    } catch {
      throw new AppError(ErrorCode.INVALID_PARAM, "invalid dir id", { field: "dir_id" });
    }
    const [row] = await db
      .select({ id: projectResourceDirs.id })
      .from(projectResourceDirs)
      .where(and(eq(projectResourceDirs.id, id), eq(projectResourceDirs.projectId, projectId)));
    if (!row) throw new AppError(ErrorCode.NOT_FOUND, "dir not found", { field: "dir_id" });
    return row.id;
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
    const refImageUri = normalizeOptionalText(input.ref_image_uri);
    if (refImageUri) this.storage.assertOwnedKey(spaceId, refImageUri, "ref_image_uri");
    const fileUri = normalizeOptionalText(input.file_uri);
    const isReference = input.kind === "reference_video" || input.kind === "reference_image";
    if (isReference && !fileUri) {
      throw new AppError(ErrorCode.INVALID_PARAM, "reference assets require file_uri", { field: "file_uri" });
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
        refImageUri,
        fileUri,
        contentType: normalizeOptionalText(input.content_type),
        status: ProjectAssetStatus.DRAFT,
      })
      .returning();
    if (!row) throw new AppError(ErrorCode.INTERNAL, "failed to create project asset");
    return this.projectAssetDtoOf(spaceId, row);
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
    if (input.ref_image_uri !== undefined) {
      const next = normalizeOptionalText(input.ref_image_uri);
      if (next) this.storage.assertOwnedKey(spaceId, next, "ref_image_uri");
      patch.refImageUri = next;
    }
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
    return this.projectAssetDtoOf(spaceId, row);
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
   * 通用资源批量操作（竞品 `/df/resources/batch-*`，第 137 批）。
   * 仅接受**本项目内**的 id；任一 id 不属于本项目即整批 400102（不静默跳过）。
   */
  async batchDeleteProjectResources(spaceId: string, projectId: string, resourceIds: string[]) {
    const project = await this.findProject(spaceId, projectId);
    const ids = await this.resolveResourceIds(project.id, resourceIds);
    await db.transaction(async (tx) => {
      await tx.delete(storyboardAssets).where(inArray(storyboardAssets.projectAssetId, ids));
      await tx.delete(projectAssets).where(inArray(projectAssets.id, ids));
    });
    return { deleted: ids.length };
  }

  async batchConfirmProjectResources(spaceId: string, projectId: string, resourceIds: string[]) {
    const project = await this.findProject(spaceId, projectId);
    const ids = await this.resolveResourceIds(project.id, resourceIds);
    await db
      .update(projectAssets)
      .set({ status: ProjectAssetStatus.FINALIZED, finalizedAt: new Date(), updatedAt: new Date() })
      .where(inArray(projectAssets.id, ids));
    return { confirmed: ids.length };
  }

  async batchUpdateProjectResources(
    spaceId: string,
    projectId: string,
    items: Array<{ resource_id: string; name?: string; description?: string }>,
  ) {
    const project = await this.findProject(spaceId, projectId);
    const ids = await this.resolveResourceIds(
      project.id,
      items.map((item) => item.resource_id),
    );
    const byId = new Map(ids.map((id) => [String(id), id]));
    await db.transaction(async (tx) => {
      for (const item of items) {
        const id = byId.get(item.resource_id);
        if (!id) continue;
        const patch: Partial<typeof projectAssets.$inferInsert> = { updatedAt: new Date() };
        if (item.name !== undefined) patch.name = item.name;
        if (item.description !== undefined) patch.description = normalizeOptionalText(item.description);
        await tx.update(projectAssets).set(patch).where(eq(projectAssets.id, id));
      }
    });
    return { updated: items.length };
  }

  /** 批量 id 解析：全部必须是本项目资源，否则整批 400102（与 batch-confirm/delete 的严格口径一致） */
  private async resolveResourceIds(projectId: bigint, resourceIds: string[]): Promise<bigint[]> {
    const ids: bigint[] = [];
    for (const raw of resourceIds) {
      try {
        ids.push(BigInt(raw));
      } catch {
        throw new AppError(ErrorCode.INVALID_PARAM, `invalid resource id: ${raw}`, { field: "resource_ids" });
      }
    }
    if (ids.length === 0) return [];
    const found = await db
      .select({ id: projectAssets.id })
      .from(projectAssets)
      .where(and(eq(projectAssets.projectId, projectId), inArray(projectAssets.id, ids)));
    if (found.length !== new Set(ids.map(String)).size) {
      throw new AppError(ErrorCode.NOT_FOUND, "resource not found in this project", { field: "resource_ids" });
    }
    return ids;
  }

  /**
   * GET /projects/{id}/assets/{assetId}：单个资产详情。
   * 竞品是 GET /web/v1/df/resources/{sp_id}/{resource_id}/info；我方沿用集合风格把 id 放路径尾，
   * 与 PATCH/DELETE projects/:id/assets/:assetId 同形。
   */
  async getProjectAsset(spaceId: string, projectId: string, assetId: string) {
    const project = await this.findProject(spaceId, projectId);
    const asset = await this.findProjectAsset(project.id, assetId);
    return this.projectAssetDtoOf(spaceId, asset);
  }

  /**
   * POST /projects/{id}/assets/batch-info：批量查详情（只读，对应竞品 resources/batch-info）。
   *
   * 刻意**不**因为某个 id 找不到就整体报错：批量查询的用途是「一次渲染一屏」，
   * 一个已失效的 id 不该让整屏变成错误页。缺的那些进 `missing`，由调用方决定怎么显示。
   * 与 batch-confirm（写）的严格校验刻意相反，见下。
   */
  async batchInfoProjectAssets(spaceId: string, projectId: string, assetIds: string[]) {
    const project = await this.findProject(spaceId, projectId);
    const ids = this.parseIdList(assetIds, "asset_ids");
    const rows = await db
      .select()
      .from(projectAssets)
      .where(and(eq(projectAssets.projectId, project.id), inArray(projectAssets.id, ids)))
      .orderBy(projectAssets.createdAt, projectAssets.id);
    const counts = await this.boundShotCounts(rows.map((row) => row.id));
    const list = await Promise.all(
      rows.map((row) => this.projectAssetDtoOf(spaceId, row, counts)),
    );
    const found = new Set(rows.map((row) => String(row.id)));
    const missing = ids.map((id) => String(id)).filter((id) => !found.has(id));
    return { list, missing };
  }

  /**
   * POST /projects/{id}/assets/batch-confirm：批量定稿（对应竞品 resources/batch-confirm）。
   *
   * 与 batch-info 相反，写操作**严格**：若部分成功、部分失败，调用方无法从一次响应里判断
   * 到底改了哪些，只能重新查一遍；所以任一 id 不属于本项目即整批 400102 且一条都不落库。
   */
  async batchConfirmProjectAssets(spaceId: string, projectId: string, assetIds: string[]) {
    const project = await this.findProject(spaceId, projectId);
    const ids = this.parseIdList(assetIds, "asset_ids");
    const rows = await db
      .select({ id: projectAssets.id })
      .from(projectAssets)
      .where(and(eq(projectAssets.projectId, project.id), inArray(projectAssets.id, ids)));
    const found = new Set(rows.map((row) => String(row.id)));
    const missing = ids.map((id) => String(id)).filter((id) => !found.has(id));
    if (missing.length > 0) {
      throw new AppError(
        ErrorCode.NOT_FOUND,
        `asset not found in this project: ${missing.join(",")}`,
        { field: "asset_ids" },
      );
    }
    const now = new Date();
    const updated = await db
      .update(projectAssets)
      .set({
        status: ProjectAssetStatus.FINALIZED,
        // 定稿幂等：已定稿的行保留原 finalized_at（与 patchProjectAsset 同一规则）
        finalizedAt: sql`coalesce(${projectAssets.finalizedAt}, ${now})`,
        updatedAt: now,
      })
      .where(and(eq(projectAssets.projectId, project.id), inArray(projectAssets.id, ids)))
      .returning({ id: projectAssets.id });
    return { confirmed: updated.length, asset_ids: updated.map((row) => String(row.id)) };
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
            orderedBigints.map((projectAssetId, index) => ({
              storyboardId: storyboard.id,
              projectAssetId,
              // 显式落顺序：无 ORDER BY 的堆序在 DELETE 后会被空槽复用打乱（见 schema 注释）
              sort: index,
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
    const items = await Promise.all(
      changedRows.map((row) => this.projectAssetDtoOf(spaceId, row, counts)),
    );
    return { created, updated, skipped, items, truncated };
  }

  // ── P3.5：项目资产参考图（generate-image → candidates → select）──────────

  /**
   * POST /projects/{id}/assets/:assetId/generate-image：
   * 与角色定妆图链路同构（mode=studio_asset_image 走任务系统），仅允许 scene|prop|other。
   * prompt 优先级：body.prompt > asset.prompt > asset.description > asset.name。
   */
  async generateProjectAssetImage(
    spaceId: string,
    userId: string,
    projectId: string,
    assetId: string,
    input: ProjectAssetImageGenerateRequest,
  ) {
    const project = await this.findProject(spaceId, projectId);
    const asset = await this.findProjectAsset(project.id, assetId);
    if (asset.kind === "character") {
      throw new AppError(
        ErrorCode.INVALID_PARAM,
        "character images must be generated via POST /projects/{id}/characters/{cid}/portrait",
        { field: "assetId" },
      );
    }

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

    const prompt =
      normalizeOptionalText(input.prompt) ??
      normalizeOptionalText(asset.prompt) ??
      normalizeOptionalText(asset.description) ??
      asset.name;
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
      { userId, spaceId, jti: "script-asset-image" },
      request,
      `asset-image:${asset.id}:${Date.now()}`,
    );
    // 新一轮生图：清空旧参考图/定稿状态（与 portrait 保持一致），等待 select 回填
    await db
      .update(projectAssets)
      .set({
        sourceTaskId: BigInt(created.task_id),
        prompt,
        status: ProjectAssetStatus.DRAFT,
        portraitAssetId: null,
        refImageUri: null,
        finalizedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(projectAssets.id, asset.id));
    return { task_id: created.task_id, model: model.name, project_asset_id: String(asset.id) };
  }

  /** GET /projects/{id}/assets/:assetId/candidates：与 portrait 候选同构（签名 URL 1h） */
  async projectAssetImageCandidates(spaceId: string, projectId: string, assetId: string) {
    const project = await this.findProject(spaceId, projectId);
    const asset = await this.findProjectAsset(project.id, assetId);
    if (!asset.sourceTaskId) {
      throw new AppError(ErrorCode.ASSET_NOT_READY, "asset image not generated yet");
    }
    const [task] = await db
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, asset.sourceTaskId), eq(tasks.spaceId, BigInt(spaceId))));
    if (!task || task.status !== TaskStatus.SUCCEEDED) {
      throw new AppError(ErrorCode.ASSET_NOT_READY, "asset image task not succeeded");
    }
    const results = Array.isArray(task.results) ? (task.results as Array<{ uri?: string }>) : [];
    const candidates = await Promise.all(
      results
        .map((item, index) => ({ item, index }))
        .filter(({ item }) => Boolean(item.uri))
        .map(async ({ item, index }) => ({
          index,
          url: await this.storage.signDownload(spaceId, item.uri!, 3600).catch(() => null),
        })),
    );
    return { task_id: String(task.id), candidates };
  }

  /**
   * POST /projects/{id}/assets/:assetId/select：
   * 落 assets 行（kind=image，tags=[asset.kind]，meta 记录来源）并回填
   * portrait_asset_id/ref_image_uri/status=2/finalized_at，返回 P2 ProjectAssetDto。
   */
  async selectProjectAssetImage(
    spaceId: string,
    projectId: string,
    assetId: string,
    input: ProjectAssetImageSelectRequest,
  ) {
    const project = await this.findProject(spaceId, projectId);
    const asset = await this.findProjectAsset(project.id, assetId);
    let bigTaskId: bigint;
    try {
      bigTaskId = BigInt(input.task_id);
    } catch {
      throw new AppError(ErrorCode.INVALID_PARAM, "invalid task_id", { field: "task_id" });
    }
    const [task] = await db
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, bigTaskId), eq(tasks.spaceId, BigInt(spaceId))));
    if (!task || task.status !== TaskStatus.SUCCEEDED) {
      throw new AppError(ErrorCode.ASSET_NOT_READY, "asset image task not succeeded");
    }
    const results = Array.isArray(task.results) ? (task.results as Array<{ uri?: string }>) : [];
    const picked = results[input.index];
    if (!picked?.uri) throw new AppError(ErrorCode.NOT_FOUND, "candidate not found");
    const pickedUri = this.storage.assertResultUri(spaceId, picked.uri, "result_uri");

    const imageAssetId = newId();
    await db.transaction(async (tx) => {
      await tx.insert(assets).values({
        id: imageAssetId,
        spaceId: BigInt(spaceId),
        kind: "image",
        uri: pickedUri,
        sourceTaskId: task.id,
        name: asset.name,
        tags: [asset.kind],
        meta: {
          project_id: String(project.id),
          project_asset_id: String(asset.id),
          candidate_index: input.index,
        },
      });
      await tx
        .update(projectAssets)
        .set({
          portraitAssetId: imageAssetId,
          refImageUri: pickedUri,
          status: ProjectAssetStatus.FINALIZED,
          finalizedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(projectAssets.id, asset.id));
    });
    const [updated] = await db
      .select()
      .from(projectAssets)
      .where(eq(projectAssets.id, asset.id));
    if (!updated) throw new AppError(ErrorCode.NOT_FOUND, "asset not found");
    return this.projectAssetDtoOf(spaceId, updated);
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
    input: GenerateVideosBatchRequest & { prompt_inject_mode?: "append" | "replace" },
  ) {
    const project = await this.findProject(spaceId, projectId);
    const episode = await this.findEpisode(project.id, episodeId);
    const model = await this.models.findByName(input.model);

    // P5-1：生成模式（默认参考生视频）。单镜=批量只传 1 个 shot_id，走同一套逻辑。
    const generateMode: StoryboardVideoMode = input.mode ?? "universal_reference";
    if (generateMode === "video_edit") {
      throw new AppError(ErrorCode.INVALID_PARAM, "暂不支持 AI 改视频（需源视频输入）", {
        field: "mode",
      });
    }
    const modelModes = (model.modes ?? {}) as Record<string, unknown>;
    if (!Object.prototype.hasOwnProperty.call(modelModes, generateMode)) {
      throw new AppError(
        ErrorCode.INVALID_PARAM,
        `模型 ${model.name} 不支持 mode ${generateMode}`,
        { field: "mode" },
      );
    }

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
            // 同上：矩阵/匹配视图也按绑定顺序出图，避免同一份数据两次渲染顺序不同
            .orderBy(storyboardAssets.storyboardId, storyboardAssets.sort, storyboardAssets.projectAssetId)
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
      frameSource?: { first: "shot_frame" | "asset"; last: "shot_frame" | "asset" };
    };
    const candidates: Candidate[] = [];
    const items: Array<{
      shot_id: string;
      task_id: string | null;
      submitted: boolean;
      code?: number;
      reason?: string;
      duration_adjusted?: { from: number; to: number };
      /** 一致性三闸门定位（只有被闸门拦下的项才有） */
      gate?: "finalize" | "match" | "subject" | "generate";
      blocked?: unknown;
      retryable?: boolean;
    }> = [];
    let balance = 0;

    // ── 一致性三闸门（completion-plan §2 任务 1.4）────────────────────────
    // 闸门 2「匹配」只对参考生视频生效：图生视频/文生视频可以用分镜定格图或纯提示词，
    // 此时没有「集级资产匹配」这回事，硬拦会把 P9 定格图链路打坏。
    const matchGate =
      generateMode === "universal_reference"
        ? await this.gates.matchGate(project.id, episode.id)
        : null;
    // 闸门 1.5「主体审核」批量判一次：逐镜查会退化成 N+1
    const batchLinkedAssets = input.shot_ids.flatMap((shotId) =>
      (linkMap.get(shotId) ?? [])
        .map((id) => assetById.get(id))
        .filter((asset): asset is ProjectAssetRow => Boolean(asset)),
    );
    const subjectGate = await this.gates.subjectGate(spaceId, batchLinkedAssets);

    for (const shotId of input.shot_ids) {
      const shot = shotById.get(shotId);
      if (!shot) {
        items.push({ shot_id: shotId, task_id: null, submitted: false, code: ErrorCode.NOT_FOUND });
        continue;
      }
      const linked = (linkMap.get(shotId) ?? [])
        .map((id) => assetById.get(id))
        .filter((asset): asset is ProjectAssetRow => Boolean(asset))
        // 绑定表无排序列：按项目资产创建顺序稳定排序，保证「第一个/前两个」可复现
        .sort((a, b) =>
          a.createdAt.getTime() - b.createdAt.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
        );
      const readyAssets = linked.filter((asset) => asset.status === 2 && Boolean(asset.refImageUri));
      const refs = readyAssets.map((asset) => asset.refImageUri!);

      // 闸门 1.5 · 主体审核：绑定的资产若显式关联了未过审主体 → 400105
      // （reviewing 可等待重试；rejected 明确 retryable=false，禁止自动重试）
      if (!subjectGate.ok) {
        const shotAssetIds = new Set(linked.map((asset) => String(asset.id)));
        const blockedHere = subjectGate.blocked.filter((item) => shotAssetIds.has(item.resource_id));
        if (blockedHere.length > 0) {
          items.push({
            shot_id: shotId,
            task_id: null,
            submitted: false,
            code: ErrorCode.ASSET_NOT_READY,
            reason: "subject_not_approved",
            gate: "subject",
            blocked: blockedHere,
            retryable: blockedHere.some((item) => item.retryable),
          });
          continue;
        }
      }

      // 各模式的资产/提示词前置条件（沿用既有逐镜 400105 语义）
      // P9：3D 导演台定格图优先——shot.firstFrameUri/lastFrameUri 为空才回退绑定资产；
      //     storage key 与资产 refImageUri 同口径直接写入 input（由下游按现有约定处理）
      const shotFirstFrame = normalizeOptionalText(shot.firstFrameUri);
      const shotLastFrame = normalizeOptionalText(shot.lastFrameUri);
      let prompt = shot.videoPrompt ?? shot.shotDesc ?? "";
      let firstFrameUri: string | null = null;
      let lastFrameUri: string | null = null;
      let frameSource: { first: "shot_frame" | "asset"; last: "shot_frame" | "asset" } | null = null;
      if (generateMode === "universal_reference") {
        // 闸门 1 · 定稿：绑定资产必须全部 status=2 且有参考图文件（file_id）
        const finalizeGate = this.gates.finalizeGate(linked);
        if (refs.length === 0 || linked.length !== readyAssets.length || !finalizeGate.ok) {
          items.push({
            shot_id: shotId,
            task_id: null,
            submitted: false,
            code: ErrorCode.ASSET_NOT_READY,
            reason: "asset_not_ready",
            gate: "finalize",
            blocked: finalizeGate.blocked,
          });
          continue;
        }
        // 闸门 2 · 匹配：本集必须已跑过资产匹配（status 1/2/3），否则一致性无保障
        if (matchGate && !matchGate.ok) {
          items.push({
            shot_id: shotId,
            task_id: null,
            submitted: false,
            code: ErrorCode.ASSET_NOT_READY,
            reason: "asset_not_ready",
            gate: "match",
            blocked: { match_status: matchGate.status, hint: matchGate.reason ?? null },
          });
          continue;
        }
      } else if (generateMode === "first_frame") {
        // 首帧生视频：优先分镜定格首帧，其次第一个合格绑定资产
        firstFrameUri = shotFirstFrame ?? refs[0] ?? null;
        if (!firstFrameUri) {
          items.push({
            shot_id: shotId,
            task_id: null,
            submitted: false,
            code: ErrorCode.ASSET_NOT_READY,
            reason: "asset_not_ready",
          });
          continue;
        }
        frameSource = { first: shotFirstFrame ? "shot_frame" : "asset", last: "asset" };
      } else if (generateMode === "first_last_frame") {
        // 首尾帧生视频：first/last 各自优先分镜定格图，缺失再回退合格绑定资产
        firstFrameUri = shotFirstFrame ?? refs[0] ?? null;
        lastFrameUri = shotLastFrame ?? refs[1] ?? null;
        if (!firstFrameUri || !lastFrameUri) {
          items.push({
            shot_id: shotId,
            task_id: null,
            submitted: false,
            code: ErrorCode.ASSET_NOT_READY,
            reason: "need_two_assets",
          });
          continue;
        }
        frameSource = {
          first: shotFirstFrame ? "shot_frame" : "asset",
          last: shotLastFrame ? "shot_frame" : "asset",
        };
      } else {
        // text2video：不要求绑定资产，但必须有分镜提示词（video_prompt 优先，退化 shot_desc）
        prompt = (shot.videoPrompt ?? "").trim() || (shot.shotDesc ?? "").trim();
        if (!prompt) {
          throw new AppError(ErrorCode.INVALID_PARAM, "text2video 需要分镜提示词", {
            field: "shot_ids",
          });
        }
      }

      // duration 就近取低：参考生视频按 scene 配置，其它模式按 models.modes[mode] 配置
      const durationCfg =
        generateMode === "universal_reference"
          ? (model.sceneModes as Record<string, { durations?: number[] } | undefined>)
              .storyboard_reference_video
          : (model.modes as Record<string, { durations?: number[] } | undefined>)[generateMode];
      const allowedDurations = durationCfg?.durations ?? [];
      const requestedDuration = shot.durationS ?? 5;
      let duration = requestedDuration;
      if (allowedDurations.length > 0 && !allowedDurations.includes(requestedDuration)) {
        const lower = [...allowedDurations]
          .filter((value) => value <= requestedDuration)
          .sort((a, b) => b - a)[0];
        duration = lower ?? Math.min(...allowedDurations);
      }
      let durationAdjusted =
        duration !== requestedDuration ? { from: requestedDuration, to: duration } : undefined;
      // 闸门 3 · 生成注入：已定稿资产按绑定顺序展开成 images[]，并给出
      // 「名称 → [[@imgN]]」映射（storyboard.md:308-310）。
      // `prompt_inject_mode=replace` 时才把标记版当 video_prompt 注入；
      // 默认 append 保持现状（原 prompt 不被改写，标记版只作附加字段）。
      // replace 与竞品形态一致但会改变用户可见提示词 → **需产品确认，默认不启用**。
      const injection =
        generateMode === "universal_reference" ? this.gates.injectImages(prompt, linked) : null;
      const injectMode = input.prompt_inject_mode ?? "append";
      const effectivePrompt =
        injection && injectMode === "replace" ? injection.prompt_with_images : prompt;
      const request: GenerationRequest = {
        mode: generateMode,
        model: model.name,
        scene: generateMode === "universal_reference" ? "storyboard_reference_video" : null,
        input:
          generateMode === "first_frame"
            ? { prompt, reference_uris: [], first_frame_uri: firstFrameUri! }
            : generateMode === "first_last_frame"
              ? {
                  prompt,
                  reference_uris: [],
                  first_frame_uri: firstFrameUri!,
                  last_frame_uri: lastFrameUri!,
                }
              : {
                  prompt: effectivePrompt,
                  reference_uris: generateMode === "universal_reference" ? refs : [],
                  ...(injection
                    ? {
                        images: injection.images,
                        image_subjects: injection.image_subjects,
                        prompt_with_images: injection.prompt_with_images,
                        prompt_inject_mode: injectMode,
                      }
                    : {}),
                } as GenerationRequest["input"],
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
        ...(frameSource ? { frameSource } : {}),
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
          mode: generateMode,
          scene: candidate.request.scene ?? null,
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
            mode: generateMode,
            ...(candidate.frameSource ? { frame_source: candidate.frameSource } : {}),
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
    const resultUri = this.storage.assertResultUri(spaceId, uri, "result_uri");

    const [existing] = await db
      .select()
      .from(projectAssets)
      .where(and(eq(projectAssets.projectId, project.id), eq(projectAssets.sourceTaskId, bigId)));
    if (existing) {
      return assetDto(
        existing,
        existing.refImageUri
          ? await this.storage
              .signDownload(spaceId, existing.refImageUri, 3600)
              .catch(() => null)
          : null,
      );
    }

    const assetId = newId();
    await db.insert(assets).values({
      id: assetId,
      spaceId: BigInt(spaceId),
      kind: task.capability === "image" ? "image" : "video",
      uri: resultUri,
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
        refImageUri: resultUri,
        sourceTaskId: task.id,
        portraitAssetId: assetId,
        status: 1,
      })
      .returning();
    if (!row) throw new AppError(ErrorCode.INTERNAL, "add shot material failed");
    return assetDto(
      row,
      await this.storage.signDownload(spaceId, resultUri, 3600).catch(() => null),
    );
  }

  async listShotMaterials(spaceId: string, projectId: string) {
    const project = await this.findProject(spaceId, projectId);
    const rows = await db
      .select()
      .from(projectAssets)
      .where(and(eq(projectAssets.projectId, project.id), eq(projectAssets.kind, "shot_material")))
      .orderBy(desc(projectAssets.createdAt));
    return Promise.all(
      rows.map(async (row) =>
        assetDto(
          row,
          row.refImageUri
            ? await this.storage
                .signDownload(spaceId, row.refImageUri, 3600)
                .catch(() => null)
            : null,
        ),
      ),
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

  /**
   * 项目级导出日志（对齐竞品 `GET /df/script_project/export-log`，
   * query 为 `page / page_size / sp_id / scene_type / scene_id`）。
   *
   * 为什么是「投影」而不是新表：我方导出分两条链——分镜导出落 `exports`（按 episode，
   * 没有 project_id）、成片合成落 `timeline_exports`（有 project_id）。两张表都能反查到
   * 项目（`exports` 经 `episodes.project_id`），所以日志可以是**只读视图**：既不需要迁移，
   * 也不会出现「同一份导出两个状态」的写放大。
   *
   * 竞品的 `scene_type` / `scene_id` 语义没有响应体证据（两个 schema 都是 `{}`），本实现取
   * 最小可判定口径：`scene_type` ∈ `storyboard`（分镜导出）/`timeline`（成片合成），
   * `scene_id` = episode id（竞品用「场景」指代某一集产物，我方一集就是一条时间线）。
   * 其它取值一律 400101 并说明待取证，不静默忽略。
   *
   * 上限：两条链各取最近 500 条后合并（导出是运营排查用的低频接口，不做全量分页的
   * `offset` 扫描）；命中上限时返回 `truncated: true`，调用方据此知道「还有更旧的」。
   */
  async listProjectExports(
    spaceId: string,
    projectId: string,
    opts: {
      sceneType?: "storyboard" | "timeline";
      sceneId?: string;
      page?: number;
      pageSize?: number;
    } = {},
  ) {
    const project = await this.findProject(spaceId, projectId);
    const spaceIdBig = BigInt(spaceId);
    const page = opts.page ?? 1;
    const pageSize = opts.pageSize ?? 20;
    // scene_id 先验证归属（不属于本项目 → 400102，而不是返回空列表让人以为「没有导出」）
    const sceneEpisode = opts.sceneId ? await this.findEpisode(project.id, opts.sceneId) : null;
    const episodeRows = await db
      .select({ id: episodes.id, epNo: episodes.epNo })
      .from(episodes)
      .where(eq(episodes.projectId, project.id));
    const epNoOf = new Map<string, number>();
    for (const row of episodeRows) epNoOf.set(String(row.id), row.epNo);
    const episodeIds = sceneEpisode
      ? [sceneEpisode.id]
      : episodeRows.map((row) => row.id);

    const wantStoryboard = opts.sceneType !== "timeline";
    const wantTimeline = opts.sceneType !== "storyboard";
    const CAP = 500;

    type Item = {
      export_id: string;
      kind: "storyboard" | "timeline";
      episode_id: string;
      episode_no: number | null;
      status: number;
      download_url: string | null;
      error: unknown;
      expires_at: string | null;
      created_at: string;
      clip_count?: number;
      skipped?: number;
      duration_s?: number;
      watermarked?: boolean;
    };
    const items: Item[] = [];
    let truncated = false;

    if (wantStoryboard && episodeIds.length > 0) {
      const rows = await db
        .select()
        .from(exportJobs)
        .where(and(eq(exportJobs.spaceId, spaceIdBig), inArray(exportJobs.episodeId, episodeIds)))
        .orderBy(desc(exportJobs.createdAt))
        .limit(CAP);
      if (rows.length >= CAP) truncated = true;
      for (const row of rows) {
        items.push({
          export_id: String(row.id),
          kind: "storyboard",
          episode_id: String(row.episodeId),
          episode_no: epNoOf.get(String(row.episodeId)) ?? null,
          status: row.status,
          download_url:
            row.status === 3 && row.fileUri
              ? await this.storage.signDownload(spaceId, row.fileUri, 3600).catch(() => null)
              : null,
          error: row.error,
          expires_at: row.expiresAt?.toISOString() ?? null,
          created_at: row.createdAt.toISOString(),
        });
      }
    }

    if (wantTimeline && episodeIds.length > 0) {
      const rows = await db
        .select()
        .from(timelineExports)
        .where(
          and(
            eq(timelineExports.spaceId, spaceIdBig),
            eq(timelineExports.projectId, project.id),
            inArray(timelineExports.episodeId, episodeIds),
          ),
        )
        .orderBy(desc(timelineExports.createdAt))
        .limit(CAP);
      if (rows.length >= CAP) truncated = true;
      for (const row of rows) {
        items.push({
          export_id: String(row.id),
          kind: "timeline",
          episode_id: String(row.episodeId),
          episode_no: epNoOf.get(String(row.episodeId)) ?? null,
          status: row.status,
          download_url:
            row.status === 3 && row.fileUri
              ? await this.storage.signDownload(spaceId, row.fileUri, 3600).catch(() => null)
              : null,
          error: row.error,
          expires_at: null,
          created_at: row.createdAt.toISOString(),
          clip_count: row.clipCount,
          skipped: row.skipped,
          duration_s: row.durationS,
          watermarked: row.watermarked,
        });
      }
    }

    // 两条链混排：按创建时间倒序（同毫秒时用 kind + export_id 兜底，保证分页稳定可复现）
    items.sort((a, b) => {
      if (a.created_at !== b.created_at) return a.created_at < b.created_at ? 1 : -1;
      if (a.kind !== b.kind) return a.kind < b.kind ? -1 : 1;
      return a.export_id < b.export_id ? 1 : -1;
    });
    const start = (page - 1) * pageSize;
    return {
      list: items.slice(start, start + pageSize),
      total: items.length,
      page,
      page_size: pageSize,
      scene_types: ["storyboard", "timeline"] as const,
      truncated,
    };
  }

  /**
   * 项目级导出日志单条（对齐竞品 `GET /df/script_project/export-log/{export_id}`）。
   *
   * 两张表的 id 各自独立自增，**同一个数字可能两边都有**：这时无法判定调用方问的是哪一条，
   * 返回 400101 要求显式带 `kind`（`?kind=storyboard|timeline`）。乱猜一条会让排查的人
   * 拿到别人的记录，比报错更坏。
   */
  async getProjectExport(
    spaceId: string,
    projectId: string,
    exportId: string,
    kind?: "storyboard" | "timeline",
  ) {
    const project = await this.findProject(spaceId, projectId);
    const spaceIdBig = BigInt(spaceId);
    let id: bigint;
    try {
      id = BigInt(exportId);
    } catch {
      throw new AppError(ErrorCode.INVALID_PARAM, "invalid export id", { field: "xid" });
    }
    const episodeRows = await db
      .select({ id: episodes.id, epNo: episodes.epNo })
      .from(episodes)
      .where(eq(episodes.projectId, project.id));
    const epNoOf = new Map<string, number>();
    for (const row of episodeRows) epNoOf.set(String(row.id), row.epNo);
    const episodeIds = episodeRows.map((row) => row.id);
    if (episodeIds.length === 0) throw new AppError(ErrorCode.NOT_FOUND, "export not found");

    const storyboardRow =
      kind === "timeline"
        ? undefined
        : (
            await db
              .select()
              .from(exportJobs)
              .where(
                and(
                  eq(exportJobs.id, id),
                  eq(exportJobs.spaceId, spaceIdBig),
                  inArray(exportJobs.episodeId, episodeIds),
                ),
              )
          )[0];
    const timelineRow =
      kind === "storyboard"
        ? undefined
        : (
            await db
              .select()
              .from(timelineExports)
              .where(
                and(
                  eq(timelineExports.id, id),
                  eq(timelineExports.spaceId, spaceIdBig),
                  eq(timelineExports.projectId, project.id),
                  inArray(timelineExports.episodeId, episodeIds),
                ),
              )
          )[0];

    if (storyboardRow && timelineRow) {
      throw new AppError(ErrorCode.INVALID_PARAM, "export id is ambiguous; pass kind", {
        field: "kind",
        reason: "ambiguous_export_id",
      });
    }
    if (!storyboardRow && !timelineRow) throw new AppError(ErrorCode.NOT_FOUND, "export not found");

    if (storyboardRow) {
      return {
        export: {
          export_id: String(storyboardRow.id),
          kind: "storyboard" as const,
          episode_id: String(storyboardRow.episodeId),
          episode_no: epNoOf.get(String(storyboardRow.episodeId)) ?? null,
          status: storyboardRow.status,
          download_url:
            storyboardRow.status === 3 && storyboardRow.fileUri
              ? await this.storage
                  .signDownload(spaceId, storyboardRow.fileUri, 3600)
                  .catch(() => null)
              : null,
          error: storyboardRow.error,
          expires_at: storyboardRow.expiresAt?.toISOString() ?? null,
          created_at: storyboardRow.createdAt.toISOString(),
        },
      };
    }
    const row = timelineRow!;
    return {
      export: {
        export_id: String(row.id),
        kind: "timeline" as const,
        episode_id: String(row.episodeId),
        episode_no: epNoOf.get(String(row.episodeId)) ?? null,
        status: row.status,
        download_url:
          row.status === 3 && row.fileUri
            ? await this.storage.signDownload(spaceId, row.fileUri, 3600).catch(() => null)
            : null,
        error: row.error,
        expires_at: null,
        created_at: row.createdAt.toISOString(),
        clip_count: row.clipCount,
        skipped: row.skipped,
        duration_s: row.durationS,
        watermarked: row.watermarked,
      },
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
      row.status === 3 && row.fileUri
        ? await this.storage.signDownload(spaceId, row.fileUri, 3600).catch(() => null)
        : null;
    return {
      export_id: String(row.id),
      status: row.status,
      download_url: downloadUrl,
      error: row.error,
      expires_at: row.expiresAt?.toISOString() ?? null,
    };
  }

  // ── P7：时间线持久化 + 成片合成导出 ─────────────────────────────────────

  /** GET /projects/{id}/episodes/{eid}/timeline → { clips }（无记录返回空数组） */
  async getTimeline(spaceId: string, projectId: string, episodeId: string) {
    const project = await this.findProject(spaceId, projectId);
    const episode = await this.findEpisode(project.id, episodeId);
    const [row] = await db
      .select()
      .from(projectTimelines)
      .where(eq(projectTimelines.episodeId, episode.id));
    return { clips: this.timelineClipsDto(row?.clips) };
  }

  /** PUT /projects/{id}/episodes/{eid}/timeline：整体覆盖写（同 episode upsert） */
  async putTimeline(
    spaceId: string,
    projectId: string,
    episodeId: string,
    input: TimelinePutRequest,
  ) {
    const project = await this.findProject(spaceId, projectId);
    const episode = await this.findEpisode(project.id, episodeId);
    const [existing] = await db
      .select()
      .from(projectTimelines)
      .where(eq(projectTimelines.episodeId, episode.id));
    const normalized = await this.normalizeTimelineClips(spaceId, episode.id, input.clips);
    // 片段资产绑定由专门端点维护：整体覆盖时按 clip_id 保留，避免"保存一次绑定就丢"
    const clips = this.preservedClipAssets(this.timelineClipsDto(existing?.clips), normalized);
    await db
      .insert(projectTimelines)
      .values({
        id: newId(),
        spaceId: BigInt(spaceId),
        projectId: project.id,
        episodeId: episode.id,
        clips,
      })
      .onConflictDoUpdate({
        target: projectTimelines.episodeId,
        set: {
          spaceId: BigInt(spaceId),
          projectId: project.id,
          clips,
          updatedAt: new Date(),
        },
      });
    return { clips };
  }

  /** DELETE /projects/{id}/episodes/{eid}/timeline → { ok: true } */
  async deleteTimeline(spaceId: string, projectId: string, episodeId: string) {
    const project = await this.findProject(spaceId, projectId);
    const episode = await this.findEpisode(project.id, episodeId);
    await db.delete(projectTimelines).where(eq(projectTimelines.episodeId, episode.id));
    return { ok: true };
  }

  /** POST /projects/{id}/episodes/{eid}/timeline/export：创建合成导出任务 */
  async createTimelineExport(spaceId: string, projectId: string, episodeId: string) {
    const project = await this.findProject(spaceId, projectId);
    const episode = await this.findEpisode(project.id, episodeId);
    const [timeline] = await db
      .select()
      .from(projectTimelines)
      .where(eq(projectTimelines.episodeId, episode.id));
    const clips = this.timelineClipsDto(timeline?.clips);
    if (clips.length === 0) {
      throw new AppError(ErrorCode.INVALID_PARAM, "timeline is empty, add clips before exporting", {
        field: "clips",
      });
    }
    const durationS = clips.reduce((sum, clip) => sum + clip.duration, 0);
    const id = newId();
    await db.insert(timelineExports).values({
      id,
      spaceId: BigInt(spaceId),
      projectId: project.id,
      episodeId: episode.id,
      status: 1,
      clipCount: clips.length,
      durationS,
    });
    await this.queue.enqueueTimelineExport(String(id));
    return { export_id: String(id), status: 1 };
  }

  /** GET /projects/{id}/episodes/{eid}/timeline/export/:exportId */
  async getTimelineExport(
    spaceId: string,
    projectId: string,
    episodeId: string,
    exportId: string,
  ) {
    const project = await this.findProject(spaceId, projectId);
    const episode = await this.findEpisode(project.id, episodeId);
    let id: bigint;
    try {
      id = BigInt(exportId);
    } catch {
      throw new AppError(ErrorCode.INVALID_PARAM, "invalid export id", { field: "exportId" });
    }
    const [row] = await db
      .select()
      .from(timelineExports)
      .where(
        and(
          eq(timelineExports.id, id),
          eq(timelineExports.episodeId, episode.id),
          eq(timelineExports.spaceId, BigInt(spaceId)),
        ),
      );
    if (!row) throw new AppError(ErrorCode.NOT_FOUND, "timeline export not found");
    const downloadUrl =
      row.status === 3 && row.fileUri
        ? await this.storage.signDownload(spaceId, row.fileUri, 3600).catch(() => null)
        : null;
    return {
      export_id: String(row.id),
      status: row.status,
      download_url: downloadUrl,
      error: row.error,
      // 附加信息（不影响契约字段）：被跳过的片段数（无源视频/不可解码且非 mock）
      skipped: row.skipped,
    };
  }

  /** 从 jsonb 读出 clips 并归一化（防御历史/脏数据）；片段资产绑定为可选字段 */
  private timelineClipsDto(raw: unknown): TimelineClipDto[] {
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
      .map((item) => {
        const assets = Array.isArray(item.assets)
          ? (item.assets as unknown[])
              .filter((asset): asset is Record<string, unknown> => typeof asset === "object" && asset !== null)
              .map((asset) => ({
                source: String(asset.source ?? "") as TimelineClipAssetDto["source"],
                id: String(asset.id ?? ""),
                name: String(asset.name ?? ""),
                uri: String(asset.uri ?? ""),
                task_id:
                  asset.task_id === null || asset.task_id === undefined ? null : String(asset.task_id),
              }))
              .filter((asset) => asset.id.length > 0 && asset.uri.length > 0 && asset.source.length > 0)
          : [];
        return {
          clip_id: String(item.clip_id ?? ""),
          shot_id: String(item.shot_id ?? ""),
          task_id: item.task_id === null || item.task_id === undefined ? null : String(item.task_id),
          name: String(item.name ?? ""),
          duration: Number(item.duration ?? 1),
          // 可选字段：无绑定时不出现（保持既有 clip 键集合不变）
          ...(assets.length > 0 ? { assets } : {}),
        };
      })
      .filter((clip) => clip.clip_id.length > 0 && clip.shot_id.length > 0);
  }

  /**
   * 片段资产绑定按 clip_id 保留：
   * PUT timeline 是"整体覆盖顺序/字段"，不应该把专门端点维护的绑定一并清掉
   * （否则用户在剪辑台点一下保存，刚绑的资产就没了）。
   */
  private preservedClipAssets(previous: TimelineClipDto[], next: TimelineClipDto[]): TimelineClipDto[] {
    const keep = new Map(
      previous.filter((clip) => clip.assets && clip.assets.length > 0).map((clip) => [clip.clip_id, clip.assets!]),
    );
    if (keep.size === 0) return next;
    return next.map((clip) => {
      const assets = keep.get(clip.clip_id);
      return assets ? { ...clip, assets } : clip;
    });
  }

  /** 校验并归一化 clips：shot 必须属于本集、task 必须属于本 space（且本集/本集镜头） */
  private async normalizeTimelineClips(
    spaceId: string,
    episodeId: bigint,
    input: TimelineClipInput[],
  ): Promise<TimelineClipDto[]> {
    const parseId = (raw: string, field: string): bigint => {
      try {
        return BigInt(raw);
      } catch {
        throw new AppError(ErrorCode.INVALID_PARAM, `invalid ${field}: ${raw}`, { field });
      }
    };

    const shotIds = new Set<string>();
    for (const [index, clip] of input.entries()) {
      const shotId = parseId(clip.shot_id, `clips[${index}].shot_id`).toString();
      shotIds.add(shotId);
    }
    const shotRows =
      shotIds.size > 0
        ? await db
            .select({ id: storyboards.id })
            .from(storyboards)
            .where(
              and(
                eq(storyboards.episodeId, episodeId),
                inArray(storyboards.id, [...shotIds].map((id) => BigInt(id))),
              ),
            )
        : [];
    const validShotIds = new Set(shotRows.map((row) => String(row.id)));
    for (const [index, clip] of input.entries()) {
      if (!validShotIds.has(parseId(clip.shot_id, `clips[${index}].shot_id`).toString())) {
        throw new AppError(
          ErrorCode.INVALID_PARAM,
          `clips[${index}].shot_id does not belong to this episode`,
          { field: `clips[${index}].shot_id` },
        );
      }
    }

    const taskIds = [...new Set(input.map((clip) => clip.task_id).filter((v): v is string => Boolean(v)))];
    const taskRows =
      taskIds.length > 0
        ? await db
            .select()
            .from(tasks)
            .where(
              and(
                eq(tasks.spaceId, BigInt(spaceId)),
                inArray(tasks.id, taskIds.map((id) => parseId(id, "clips[].task_id"))),
              ),
            )
        : [];
    const taskById = new Map(taskRows.map((row) => [String(row.id), row]));
    for (const [index, clip] of input.entries()) {
      if (!clip.task_id) continue;
      const taskId = parseId(clip.task_id, `clips[${index}].task_id`).toString();
      const task = taskById.get(taskId);
      const belongsToEpisode =
        task && (task.episodeId === episodeId || (task.shotId ? validShotIds.has(String(task.shotId)) : false));
      if (!task || !belongsToEpisode) {
        throw new AppError(
          ErrorCode.INVALID_PARAM,
          `clips[${index}].task_id does not belong to this episode/space`,
          { field: `clips[${index}].task_id` },
        );
      }
    }

    const usedClipIds = new Set<string>();
    return input.map((clip) => {
      let clipId = clip.clip_id?.trim() ?? "";
      if (!clipId || usedClipIds.has(clipId)) clipId = String(newId());
      usedClipIds.add(clipId);
      return {
        clip_id: clipId,
        shot_id: parseId(clip.shot_id, "clips[].shot_id").toString(),
        task_id: clip.task_id ? parseId(clip.task_id, "clips[].task_id").toString() : null,
        name: clip.name,
        duration: clip.duration,
      };
    });
  }

  /**
   * 分镜 DTO + 首/尾帧派生签名 URL（P9）：前端刷新后可直接显示定格缩略图，
   * 无需自己拼签名；storage key 原值仍通过 first_frame_uri/last_frame_uri 返回。
   */
  private async storyboardDtoWithUrls(
    spaceId: string,
    row: StoryboardRow,
    characterIds: string[] = [],
  ) {
    const dto = storyboardDto(row, characterIds);
    const [firstFrameUrl, lastFrameUrl] = await Promise.all([
      dto.first_frame_uri
        ? this.storage.signDownload(spaceId, dto.first_frame_uri, 3600).catch(() => null)
        : Promise.resolve(null),
      dto.last_frame_uri
        ? this.storage.signDownload(spaceId, dto.last_frame_uri, 3600).catch(() => null)
        : Promise.resolve(null),
    ]);
    return { ...dto, first_frame_url: firstFrameUrl, last_frame_url: lastFrameUrl };
  }

  /** 单个项目资产的 DTO（预签名参考图 + 被分镜引用次数）；counts 可批量预取避免 N+1 */
  private async projectAssetDtoOf(
    spaceId: string,
    row: ProjectAssetRow,
    counts?: Map<string, number>,
  ) {
    const boundCounts = counts ?? (await this.boundShotCounts([row.id]));
    const portraitUrl = row.refImageUri
      ? await this.storage.signDownload(spaceId, row.refImageUri, 3600).catch(() => null)
      : null;
    const fileUrl = row.fileUri
      ? await this.storage.signDownload(spaceId, row.fileUri, 3600).catch(() => null)
      : null;
    return projectAssetDto(row, portraitUrl, boundCounts.get(String(row.id)) ?? 0, fileUrl);
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
