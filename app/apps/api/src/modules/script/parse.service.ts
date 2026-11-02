import { Inject, Injectable } from "@nestjs/common";
import { and, eq, inArray } from "drizzle-orm";
import { episodes, scriptProjects, storyboardAssets, storyboards } from "@app/db";
import { AppError, ErrorCode, newId } from "@app/shared";
import { db } from "../../db/database";
import { StorageService } from "../../storage/storage.service";

/**
 * 分镜表解析子链（贴表 → 解析成 storyboards → 可重置/重试）。
 *
 * 竞品证据：
 * - `rea-reelmate/routes.txt:440-444`：`/web/v1/df/episode/:ep_id/process/parse/{generate,info,upload,delete}`
 *   —— 解析有独立的 generate/info/delete 三条通道；
 * - `cmd/episode.md:407-429`：`parse-retry` 与 `parse` **是两个端点**，不能互相替代
 *   （parse 首次下单，retry 针对已失败任务；重复 parse 只会拿回同一个错误）；
 * - `cmd/storyboard.md:302-330`：`storyboard draft-import` 按 `shot_no` 更新已有草稿、
 *   不会按镜号重复新增 —— 我方 `merge` 模式与它同义。
 *
 * ## 为什么必须先备份再覆盖
 *
 * `parse-reset`（竞品 `process/parse/delete`）的语义是"重新拆解"，即把分镜恢复到
 * **解析前**的样子。如果不先备份，覆盖之后原分镜与绑定关系就永久丢失，
 * reset 只能变成"清空"——那不是重置，是删除。因此每次覆盖前把
 * `storyboards + storyboard_assets + 本次输入` 写一份 JSON 快照到 storage：
 *
 * - `u/<space>/parse-backups/<episode>/<ts>.json` —— 不可变审计快照（每次覆盖一份）；
 * - `u/<space>/parse-backups/<episode>/latest.json` —— 指针副本，`parse-reset` 与
 *   `parse-retry` 都读它（= 撤销最近一次解析）。
 *
 * 为什么用 storage 而不是新表：本轮不改 schema/迁移（迁移由 Lead 独占），
 * 而快照是"一次解析的完整产物"，天然适合对象存储；后续若要按集查历史，
 * 再把 `latest.json` 的索引落到表里即可（契约不变）。
 */

export interface ParseTableRow {
  shot_no: number;
  shot_desc: string;
  video_prompt?: string;
  duration_s?: number;
  ratio?: string;
  resolution?: string;
}

export interface ParseInput {
  episode_id: string;
  /** 结构化分镜表（优先级高于 text） */
  table?: ParseTableRow[];
  /** 纯文本分镜表（Markdown/TSV：镜号 | 描述 | 提示词 | 时长） */
  text?: string;
  /** replace 覆盖（默认）/ merge 按镜号合并（同 storyboard draft-import） */
  mode?: "replace" | "merge";
  dry_run?: boolean;
}

interface BackupStoryboard {
  id: string;
  shot_no: number;
  shot_desc: string | null;
  video_prompt: string | null;
  duration_s: number | null;
  ratio: string | null;
  resolution: string | null;
  status: number;
  first_frame_uri: string | null;
  last_frame_uri: string | null;
  image_task_id: string | null;
  video_task_id: string | null;
}

interface ParseBackup {
  version: 1;
  project_id: string;
  episode_id: string;
  ep_no: number;
  created_at: string;
  storyboards: BackupStoryboard[];
  assets: Array<{ storyboard_id: string; project_asset_id: string }>;
  /** 本次解析输入，供 parse-retry 原样重放 */
  last_input: { mode: "replace" | "merge"; table: ParseTableRow[] };
}

const BACKUP_VERSION = 1;
const PROMPT_MAX = 2000;
const DURATION_MIN = 1;
const DURATION_MAX = 30;

@Injectable()
export class ParseService {
  constructor(@Inject(StorageService) private readonly storage: StorageService) {}

  /** `POST /projects/{id}/episodes/parse` */
  async parse(spaceId: string, projectId: string, input: ParseInput) {
    const project = await this.findProject(spaceId, projectId);
    const episode = await this.findEpisode(project.id, input.episode_id);
    const rows = this.normalizeRows(input);
    const mode: "replace" | "merge" = input.mode ?? "replace";

    if (input.dry_run === true) {
      const existing = await this.loadStoryboards(episode.id);
      const byNo = new Map(existing.map((row) => [row.shotNo, row]));
      return {
        dry_run: true,
        ep_id: String(episode.id),
        mode,
        parsed: rows.length,
        would_create: rows.filter((row) => !byNo.has(row.shot_no)).length,
        would_update: rows.filter((row) => byNo.has(row.shot_no)).length,
        preview: rows.slice(0, 5),
        backup_key: null,
      };
    }

    // ① 先备份（覆盖前）：分镜 + 绑定 + 本次输入
    const backupKey = await this.writeBackup(spaceId, project, episode, mode, rows);

    // ② 再覆盖：整个解析在单事务里，避免"删了一半失败"留下空集
    const result = await db.transaction(async (tx) => {
      const existing = await tx.select().from(storyboards).where(eq(storyboards.episodeId, episode.id));
      const existingIds = existing.map((row) => row.id);
      if (existingIds.length > 0) {
        // 先解绑定：storyboard_assets 有外键，直接删分镜会触发约束错误
        await tx.delete(storyboardAssets).where(inArray(storyboardAssets.storyboardId, existingIds));
      }
      let created = 0;
      let updated = 0;
      let removed = 0;
      if (mode === "replace") {
        if (existingIds.length > 0) {
          await tx.delete(storyboards).where(eq(storyboards.episodeId, episode.id));
          removed = existingIds.length;
        }
        if (rows.length > 0) {
          await tx.insert(storyboards).values(
            rows.map((row) => ({
              id: newId(),
              episodeId: episode.id,
              shotNo: row.shot_no,
              shotDesc: row.shot_desc,
              videoPrompt: row.video_prompt ?? row.shot_desc,
              durationS: row.duration_s ?? 5,
              ratio: row.ratio ?? project.ratio,
              resolution: row.resolution ?? "720p",
              status: 1,
            })),
          );
          created = rows.length;
        }
      } else {
        const byNo = new Map(existing.map((row) => [row.shotNo, row]));
        for (const row of rows) {
          const hit = byNo.get(row.shot_no);
          if (hit) {
            await tx
              .update(storyboards)
              .set({
                shotDesc: row.shot_desc,
                videoPrompt: row.video_prompt ?? row.shot_desc,
                durationS: row.duration_s ?? hit.durationS ?? 5,
                ratio: row.ratio ?? hit.ratio ?? project.ratio,
                resolution: row.resolution ?? hit.resolution ?? "720p",
                updatedAt: new Date(),
              })
              .where(eq(storyboards.id, hit.id));
            updated += 1;
          } else {
            await tx.insert(storyboards).values({
              id: newId(),
              episodeId: episode.id,
              shotNo: row.shot_no,
              shotDesc: row.shot_desc,
              videoPrompt: row.video_prompt ?? row.shot_desc,
              durationS: row.duration_s ?? 5,
              ratio: row.ratio ?? project.ratio,
              resolution: row.resolution ?? "720p",
              status: 1,
            });
            created += 1;
          }
        }
      }
      return { created, updated, removed };
    });

    const shots = await this.loadStoryboards(episode.id);
    return {
      dry_run: false,
      ep_id: String(episode.id),
      mode,
      parsed: rows.length,
      ...result,
      backup_key: backupKey,
      storyboards: shots.map((row) => this.shotDto(row)),
    };
  }

  /** `POST /projects/{id}/episodes/parse-reset`：恢复到最近一次解析前的快照 */
  async reset(
    spaceId: string,
    projectId: string,
    input: { episode_id: string; backup_key?: string; dry_run?: boolean },
  ) {
    const project = await this.findProject(spaceId, projectId);
    const episode = await this.findEpisode(project.id, input.episode_id);
    const key = input.backup_key?.trim() || this.latestKey(spaceId, episode.id);
    const backup = await this.readBackup(spaceId, key);

    const current = await this.loadStoryboards(episode.id);
    if (input.dry_run === true) {
      return {
        dry_run: true,
        ep_id: String(episode.id),
        backup_key: key,
        backup_created_at: backup.created_at,
        would_remove: current.length,
        would_restore: backup.storyboards.length,
        would_restore_bindings: backup.assets.length,
      };
    }

    const restored = await db.transaction(async (tx) => {
      const currentIds = current.map((row) => row.id);
      if (currentIds.length > 0) {
        await tx.delete(storyboardAssets).where(inArray(storyboardAssets.storyboardId, currentIds));
        await tx.delete(storyboards).where(eq(storyboards.episodeId, episode.id));
      }
      if (backup.storyboards.length > 0) {
        // 用**原始 id** 还原：storyboard_assets 绑定与时间线片段都按 id 引用，
        // 换新 id 会让"恢复"变成"假恢复"（绑定还在指向已删除的行）
        await tx.insert(storyboards).values(
          backup.storyboards.map((row) => ({
            id: BigInt(row.id),
            episodeId: episode.id,
            shotNo: row.shot_no,
            shotDesc: row.shot_desc,
            videoPrompt: row.video_prompt,
            durationS: row.duration_s,
            ratio: row.ratio,
            resolution: row.resolution,
            status: row.status,
            firstFrameUri: row.first_frame_uri,
            lastFrameUri: row.last_frame_uri,
            imageTaskId: row.image_task_id ? BigInt(row.image_task_id) : null,
            videoTaskId: row.video_task_id ? BigInt(row.video_task_id) : null,
          })),
        );
      }
      let bindings = 0;
      if (backup.assets.length > 0) {
        const inserted = await tx
          .insert(storyboardAssets)
          .values(
            backup.assets.map((row) => ({
              storyboardId: BigInt(row.storyboard_id),
              projectAssetId: BigInt(row.project_asset_id),
            })),
          )
          .onConflictDoNothing()
          .returning();
        bindings = inserted.length;
      }
      return { restored: backup.storyboards.length, bindings };
    });

    return {
      dry_run: false,
      ep_id: String(episode.id),
      backup_key: key,
      backup_created_at: backup.created_at,
      ...restored,
    };
  }

  /** `POST /projects/{id}/episodes/parse-retry`：按最近一次输入原样重跑 */
  async retry(spaceId: string, projectId: string, input: { episode_id: string }) {
    const project = await this.findProject(spaceId, projectId);
    const episode = await this.findEpisode(project.id, input.episode_id);
    const key = this.latestKey(spaceId, episode.id);
    let backup: ParseBackup;
    try {
      backup = await this.readBackup(spaceId, key);
    } catch {
      throw new AppError(
        ErrorCode.INVALID_PARAM,
        "no previous parse to retry (run POST /episodes/parse first)",
        { field: "episode_id", reason: "no_previous_parse" },
      );
    }
    if (backup.last_input.table.length === 0) {
      throw new AppError(ErrorCode.INVALID_PARAM, "previous parse had no usable input", {
        field: "episode_id",
        reason: "no_previous_input",
      });
    }
    const result = await this.parse(spaceId, projectId, {
      episode_id: input.episode_id,
      table: backup.last_input.table,
      mode: backup.last_input.mode,
    });
    return { ...result, retried: true, retried_from_backup: key };
  }

  // ── 内部 ──────────────────────────────────────────────────────────────

  /** 结构化表或文本表 → 归一化行（校验失败零写入：先全部校验再解析） */
  private normalizeRows(input: ParseInput): ParseTableRow[] {
    const rows = input.table && input.table.length > 0 ? input.table : this.parseText(input.text);
    if (!rows || rows.length === 0) {
      throw new AppError(
        ErrorCode.INVALID_PARAM,
        "storyboard table is empty: pass `table[]` or `text` with rows",
        { field: "table" },
      );
    }
    if (rows.length > 200) {
      throw new AppError(ErrorCode.INVALID_PARAM, "too many rows (max 200)", { field: "table" });
    }
    const seen = new Set<number>();
    return rows.map((row, index) => {
      const shotNo = Number(row.shot_no);
      if (!Number.isInteger(shotNo) || shotNo < 1 || shotNo > 999) {
        throw new AppError(ErrorCode.INVALID_PARAM, `table[${index}].shot_no must be 1..999`, {
          field: `table[${index}].shot_no`,
        });
      }
      if (seen.has(shotNo)) {
        throw new AppError(ErrorCode.INVALID_PARAM, `duplicated shot_no: ${shotNo}`, {
          field: `table[${index}].shot_no`,
        });
      }
      seen.add(shotNo);
      const shotDesc = String(row.shot_desc ?? "").trim();
      if (!shotDesc) {
        throw new AppError(ErrorCode.INVALID_PARAM, `table[${index}].shot_desc is required`, {
          field: `table[${index}].shot_desc`,
        });
      }
      const prompt = String(row.video_prompt ?? "").trim();
      if (prompt.length > PROMPT_MAX) {
        throw new AppError(ErrorCode.INVALID_PARAM, `table[${index}].video_prompt exceeds ${PROMPT_MAX}`, {
          field: `table[${index}].video_prompt`,
        });
      }
      const duration = row.duration_s === undefined ? undefined : Number(row.duration_s);
      if (duration !== undefined && (!Number.isInteger(duration) || duration < DURATION_MIN || duration > DURATION_MAX)) {
        throw new AppError(
          ErrorCode.INVALID_PARAM,
          `table[${index}].duration_s must be ${DURATION_MIN}..${DURATION_MAX}`,
          { field: `table[${index}].duration_s` },
        );
      }
      return {
        shot_no: shotNo,
        shot_desc: shotDesc,
        ...(prompt ? { video_prompt: prompt } : {}),
        ...(duration === undefined ? {} : { duration_s: duration }),
        ...(row.ratio ? { ratio: String(row.ratio) } : {}),
        ...(row.resolution ? { resolution: String(row.resolution) } : {}),
      };
    });
  }

  /**
   * 纯文本表解析：支持 Markdown 表格与 TSV/逗号分隔。
   * 列序：镜号 | 画面描述 | 视频提示词 | 时长（后两列可缺）。
   * 表头行与 `|---|` 分隔行自动跳过——用户从 Excel/文档粘贴过来时通常带这两行。
   */
  private parseText(text?: string): ParseTableRow[] {
    const raw = (text ?? "").trim();
    if (!raw) return [];
    const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const rows: ParseTableRow[] = [];
    for (const [index, line] of lines.entries()) {
      if (/^\|?[\s:-]+\|[\s:|-]*$/.test(line)) continue; // markdown 分隔行
      const cells = line
        .replace(/^\|/, "")
        .replace(/\|$/, "")
        .split(/\s*\|\s*|\t+|,\s*/)
        .map((cell) => cell.trim());
      if (cells.length < 2) continue;
      const first = cells[0] ?? "";
      // 表头："镜号 / shot_no / 序号"
      if (index === 0 && /镜号|shot[_ ]?no|序号|编号/i.test(first) && !/^\d+$/.test(first)) continue;
      const shotNo = Number(first);
      if (!Number.isInteger(shotNo) || shotNo < 1) continue;
      const desc = cells[1] ?? "";
      if (!desc) continue;
      const prompt = cells[2] ?? "";
      const durationRaw = cells[3] ?? "";
      const duration = Number(durationRaw);
      rows.push({
        shot_no: shotNo,
        shot_desc: desc,
        ...(prompt ? { video_prompt: prompt } : {}),
        ...(Number.isInteger(duration) && duration >= DURATION_MIN && duration <= DURATION_MAX
          ? { duration_s: duration }
          : {}),
      });
    }
    return rows;
  }

  private latestKey(spaceId: string, episodeId: bigint): string {
    return `u/${spaceId}/parse-backups/${episodeId}/latest.json`;
  }

  /** 备份：写不可变快照 + 覆盖 latest 指针 */
  private async writeBackup(
    spaceId: string,
    project: typeof scriptProjects.$inferSelect,
    episode: typeof episodes.$inferSelect,
    mode: "replace" | "merge",
    rows: ParseTableRow[],
  ): Promise<string> {
    const existing = await this.loadStoryboards(episode.id);
    const existingIds = existing.map((row) => row.id);
    const links = existingIds.length
      ? await db
          .select()
          .from(storyboardAssets)
          .where(inArray(storyboardAssets.storyboardId, existingIds))
      : [];
    const backup: ParseBackup = {
      version: BACKUP_VERSION,
      project_id: String(project.id),
      episode_id: String(episode.id),
      ep_no: episode.epNo,
      created_at: new Date().toISOString(),
      storyboards: existing.map((row) => ({
        id: String(row.id),
        shot_no: row.shotNo,
        shot_desc: row.shotDesc,
        video_prompt: row.videoPrompt,
        duration_s: row.durationS,
        ratio: row.ratio,
        resolution: row.resolution,
        status: row.status,
        first_frame_uri: row.firstFrameUri,
        last_frame_uri: row.lastFrameUri,
        image_task_id: row.imageTaskId ? String(row.imageTaskId) : null,
        video_task_id: row.videoTaskId ? String(row.videoTaskId) : null,
      })),
      assets: links.map((link) => ({
        storyboard_id: String(link.storyboardId),
        project_asset_id: String(link.projectAssetId),
      })),
      last_input: { mode, table: rows },
    };
    const body = Buffer.from(JSON.stringify(backup), "utf8");
    const ts = backup.created_at.replace(/[:.]/g, "-");
    const snapshotKey = `u/${spaceId}/parse-backups/${episode.id}/${ts}.json`;
    await this.storage.put(spaceId, snapshotKey, body, "application/json");
    await this.storage.put(
      spaceId,
      this.latestKey(spaceId, episode.id),
      body,
      "application/json",
    );
    return snapshotKey;
  }

  private async readBackup(spaceId: string, key: string): Promise<ParseBackup> {
    let buffer: Buffer;
    try {
      buffer = await this.storage.read(spaceId, key);
    } catch {
      throw new AppError(ErrorCode.INVALID_PARAM, "parse backup not found", {
        field: "backup_key",
        reason: "no_backup",
        backup_key: key,
      });
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(buffer.toString("utf8"));
    } catch {
      throw new AppError(ErrorCode.INTERNAL, "parse backup is corrupted", { backup_key: key });
    }
    const backup = parsed as ParseBackup;
    if (backup?.version !== BACKUP_VERSION || !Array.isArray(backup.storyboards)) {
      throw new AppError(ErrorCode.INTERNAL, "unsupported parse backup version", { backup_key: key });
    }
    return backup;
  }

  private async loadStoryboards(episodeId: bigint) {
    return db
      .select()
      .from(storyboards)
      .where(eq(storyboards.episodeId, episodeId))
      .orderBy(storyboards.shotNo);
  }

  private shotDto(row: typeof storyboards.$inferSelect) {
    return {
      id: String(row.id),
      shot_no: row.shotNo,
      shot_desc: row.shotDesc,
      video_prompt: row.videoPrompt,
      duration_s: row.durationS,
      ratio: row.ratio,
      resolution: row.resolution,
      status: row.status,
    };
  }

  private async findProject(spaceId: string, projectId: string) {
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

  private async findEpisode(projectId: bigint, episodeId: string) {
    let id: bigint;
    try {
      id = BigInt(episodeId);
    } catch {
      throw new AppError(ErrorCode.INVALID_PARAM, "invalid episode_id", { field: "episode_id" });
    }
    const [row] = await db
      .select()
      .from(episodes)
      .where(and(eq(episodes.id, id), eq(episodes.projectId, projectId)));
    if (!row) throw new AppError(ErrorCode.NOT_FOUND, "episode not found");
    return row;
  }
}
