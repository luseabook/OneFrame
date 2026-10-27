import { Inject, Injectable } from "@nestjs/common";
import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { projectAssets, scriptProjects, subjectFiles, subjects, tasks } from "@app/db";
import { AppError, ErrorCode, newId } from "@app/shared";
import { db } from "../../db/database";
import { StorageService } from "../../storage/storage.service";

/**
 * 主体库（subject）—— 「角色跨镜一致性」的载体。
 *
 * 竞品证据：
 * - `cmd/subject.md:3` 生成模型按 `subject_id` 保持同一角色在不同分镜里长得一样；
 * - `cmd/subject.md:11` `save-from-resource` 用 `sp_res_id` 绑定**原资产**、不新建资产；
 * - `cmd/subject.md:204-216` 审核三态 `reviewing/approved/rejected`，**驳回 retryable=false、
 *   禁止自动重试**（误当 internal 重试会触发风控）；找不到状态字段时标 unknown，不得默认 approved；
 * - `cmd/subject.md:97` `business_list` 非空厂商编号数组，Seedance 为 `[3]`。
 *
 * 为什么审核态落库而不是服务层算：未过审主体投递要直接拒（不排队不扣费），
 * 多副本/重启下算出来的状态会漂移（schema.ts:1907-1913 已记同因）。
 */

/** 主体分类：与 `subjects.kind` 对齐（竞品 `subject_type` 里角色=1） */
export const SubjectKind = {
  CHARACTER: 1,
  SCENE: 2,
  PROP: 3,
} as const;

/** 审核三态（与 `subjects.review_status` 对齐） */
export const SubjectReviewStatus = {
  REVIEWING: 1,
  APPROVED: 2,
  REJECTED: 3,
} as const;

const KIND_NAMES: Record<number, string> = {
  1: "character",
  2: "scene",
  3: "prop",
};

const REVIEW_NAMES: Record<number, string> = {
  1: "reviewing",
  2: "approved",
  3: "rejected",
};

/** 竞品 `subject_type`(0..5) → 我方 kind；角色为 1（cmd/subject.md:95） */
const SUBJECT_TYPE_TO_KIND: Record<number, number> = {
  0: SubjectKind.CHARACTER,
  1: SubjectKind.CHARACTER,
  2: SubjectKind.SCENE,
  3: SubjectKind.PROP,
  4: SubjectKind.CHARACTER,
  5: SubjectKind.CHARACTER,
};

const PROJECT_ASSET_KIND_TO_SUBJECT_KIND: Record<string, number> = {
  character: SubjectKind.CHARACTER,
  scene: SubjectKind.SCENE,
  prop: SubjectKind.PROP,
  other: SubjectKind.SCENE,
};

/** Seedance 的主体业务线编号（cmd/subject.md:97 `business_list=[3]`） */
const DEFAULT_BUSINESS_LIST = [3];

type SubjectRow = typeof subjects.$inferSelect;
type SubjectFileRow = typeof subjectFiles.$inferSelect;

export interface SubjectFileInput {
  uri: string;
  role?: number;
  sort?: number;
  /** 来源资产（`assets.id`）——`save-from-resource` 用它绑定原资产，不新建资产 */
  asset_id?: string;
}

export interface SubjectListQuery {
  kind?: number;
  review_status?: number;
  project_id?: string;
  q?: string;
  page?: number;
  page_size?: number;
}

export interface SubjectCreateInput {
  name: string;
  kind?: number;
  desc?: string | null;
  cover_uri?: string | null;
  project_id?: string | null;
  business_list?: number[];
  tags?: string[];
  files?: SubjectFileInput[];
}

export interface SubjectPatchInput {
  name?: string;
  kind?: number;
  desc?: string | null;
  cover_uri?: string | null;
  project_id?: string | null;
  business_list?: number[];
  tags?: string[];
  review_status?: number;
  reject_reason?: string | null;
  files?: SubjectFileInput[];
  remove_file_ids?: string[];
}

export interface SubjectFromAssetInput {
  project_id: string;
  asset_id: string;
  name?: string;
  generate_id?: string;
  subject_type?: number;
  files?: Array<string | SubjectFileInput>;
  business_list?: number[];
  src_subject_id?: string;
  mate_data?: Record<string, unknown>;
}

@Injectable()
export class SubjectsService {
  constructor(@Inject(StorageService) private readonly storage: StorageService) {}

  // ── 读 ──────────────────────────────────────────────────────────────

  async list(spaceId: string, query: SubjectListQuery) {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, query.page_size ?? 20));
    const where = and(
      eq(subjects.spaceId, BigInt(spaceId)),
      isNull(subjects.deletedAt),
      query.kind ? eq(subjects.kind, query.kind) : undefined,
      query.review_status ? eq(subjects.reviewStatus, query.review_status) : undefined,
      query.project_id ? eq(subjects.projectId, this.parseId(query.project_id, "project_id")) : undefined,
      query.q ? sql`${subjects.name} ilike ${`%${query.q}%`}` : undefined,
    );
    const rows = await db
      .select()
      .from(subjects)
      .where(where)
      .orderBy(desc(subjects.createdAt), desc(subjects.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize);
    const [countRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(subjects)
      .where(where);
    const filesBySubject = await this.loadFiles(rows.map((row) => row.id));
    return {
      list: await Promise.all(
        rows.map((row) => this.toDto(row, filesBySubject.get(String(row.id)) ?? [])),
      ),
      total: countRow?.count ?? 0,
      page,
      page_size: pageSize,
    };
  }

  async detail(spaceId: string, subjectId: string) {
    const row = await this.findSubject(spaceId, subjectId);
    const files = await this.filesOf(row.id);
    return this.toDto(row, files);
  }

  // ── 写 ──────────────────────────────────────────────────────────────

  async create(spaceId: string, userId: string, input: SubjectCreateInput) {
    const projectId = input.project_id
      ? (await this.assertProject(spaceId, input.project_id)).id
      : null;
    const kind = input.kind ?? SubjectKind.CHARACTER;
    this.assertKind(kind);
    const [row] = await db
      .insert(subjects)
      .values({
        id: newId(),
        spaceId: BigInt(spaceId),
        name: input.name.trim(),
        kind,
        desc: input.desc ?? null,
        coverUri: input.cover_uri ?? input.files?.[0]?.uri ?? null,
        reviewStatus: SubjectReviewStatus.REVIEWING,
        businessList: input.business_list ?? DEFAULT_BUSINESS_LIST,
        tags: (input.tags ?? []).slice(0, 20),
        projectId,
        createdBy: userId ? BigInt(userId) : null,
      })
      .returning();
    if (!row) throw new AppError(ErrorCode.INTERNAL, "failed to create subject");
    const files = await this.appendFiles(row, input.files ?? []);
    return this.toDto(row, files);
  }

  /**
   * `save-from-resource` 语义（cmd/subject.md:73-106）：把**已存在的项目资产**及用户选中的
   * 生成记录保存为主体，通过 `sp_res_id` 绑定原资产，**不新建资产**。
   *
   * 与 `subject create` 的边界：本方法不写 `project_assets` / `assets`，只写 `subjects` 与
   * `subject_files`（`subject_files.asset_id` 指回原资产），因此重复调用是幂等的——同一资产
   * 已绑定过主体时返回既有主体（`created=false`），不产生第二个主体。
   */
  async fromAsset(spaceId: string, userId: string, input: SubjectFromAssetInput) {
    const project = await this.assertProject(spaceId, input.project_id);
    let assetId: bigint;
    try {
      assetId = BigInt(input.asset_id);
    } catch {
      throw new AppError(ErrorCode.INVALID_PARAM, "invalid asset id", { field: "asset_id" });
    }
    const [asset] = await db
      .select()
      .from(projectAssets)
      .where(and(eq(projectAssets.id, assetId), eq(projectAssets.projectId, project.id)));
    if (!asset) throw new AppError(ErrorCode.NOT_FOUND, "asset not found");

    // 定稿闸门：只有已定稿且有参考图文件的资产才能存为主体（与生成侧 400105 同口径）。
    // 我方「file_id」等价物是 `ref_image_uri`（storage key）+ 可选的 `portrait_asset_id`
    // （assets 行）；只上传了参考图、还没进 assets 表的资产也要能存主体，所以不强制后者。
    if (asset.status !== 2 || !asset.refImageUri) {
      throw new AppError(
        ErrorCode.ASSET_NOT_READY,
        "asset must be finalized with a reference image before saving as subject",
        { field: "asset_id", asset_status: asset.status, retryable: true },
      );
    }

    // 幂等：同一资产（同 assets 行或同参考图 URI）已绑定主体 → 直接返回，不重复建主体
    const [existingLink] = await db
      .select({ subjectId: subjectFiles.subjectId })
      .from(subjectFiles)
      .innerJoin(subjects, eq(subjects.id, subjectFiles.subjectId))
      .where(
        and(
          eq(subjectFiles.spaceId, BigInt(spaceId)),
          isNull(subjects.deletedAt),
          asset.portraitAssetId
            ? or(
                eq(subjectFiles.assetId, asset.portraitAssetId),
                eq(subjectFiles.uri, asset.refImageUri),
              )
            : eq(subjectFiles.uri, asset.refImageUri),
        ),
      )
      .limit(1);
    if (existingLink) {
      const existing = await this.findSubject(spaceId, String(existingLink.subjectId));
      const files = await this.filesOf(existing.id);
      return { ...(await this.toDto(existing, files)), created: false };
    }

    // 兼容显式传入的 generate_id（用户选中的生成记录）——只做存在性校验，不改写原资产
    if (input.generate_id) {
      let taskId: bigint;
      try {
        taskId = BigInt(input.generate_id);
      } catch {
        throw new AppError(ErrorCode.INVALID_PARAM, "invalid generate_id", { field: "generate_id" });
      }
      const [task] = await db
        .select({ id: tasks.id })
        .from(tasks)
        .where(and(eq(tasks.id, taskId), eq(tasks.spaceId, BigInt(spaceId))));
      if (!task) throw new AppError(ErrorCode.NOT_FOUND, "generate record not found", { field: "generate_id" });
    }

    const kind = input.subject_type
      ? (SUBJECT_TYPE_TO_KIND[input.subject_type] ?? this.kindOfProjectAsset(asset.kind))
      : this.kindOfProjectAsset(asset.kind);
    this.assertKind(kind);
    const businessList = input.business_list ?? DEFAULT_BUSINESS_LIST;
    if (businessList.length === 0) {
      throw new AppError(ErrorCode.INVALID_PARAM, "business_list must not be empty", {
        field: "business_list",
      });
    }

    const inheritedFiles = input.src_subject_id
      ? (await this.filesOf((await this.findSubject(spaceId, input.src_subject_id)).id)).map((file) => ({
          uri: file.uri,
          role: file.role,
          sort: file.sort,
          asset_id: file.assetId ? String(file.assetId) : undefined,
        }))
      : [];
    const requestedFiles: SubjectFileInput[] = (input.files ?? []).map((file) =>
      typeof file === "string" ? { uri: file } : file,
    );
    const fileInputs: SubjectFileInput[] = [
      // 原资产的参考图自动纳入（竞品 files 必填非空，我方以原资产图兜底），并绑定原资产
      {
        uri: asset.refImageUri!,
        role: 1,
        sort: 0,
        ...(asset.portraitAssetId ? { asset_id: String(asset.portraitAssetId) } : {}),
      },
      ...requestedFiles,
      ...inheritedFiles,
    ].filter((file) => typeof file.uri === "string" && file.uri.trim().length > 0);

    const [row] = await db
      .insert(subjects)
      .values({
        id: newId(),
        spaceId: BigInt(spaceId),
        name: (input.name ?? asset.name).trim(),
        kind,
        desc: asset.description,
        coverUri: asset.refImageUri,
        // 竞品「from-resource 返回成功不代表审核通过，必须再查 subject status」（subject.md:278）
        reviewStatus: SubjectReviewStatus.REVIEWING,
        businessList,
        tags: [],
        projectId: project.id,
        createdBy: userId ? BigInt(userId) : null,
      })
      .returning();
    if (!row) throw new AppError(ErrorCode.INTERNAL, "failed to save subject from asset");
    const files = await this.appendFiles(row, fileInputs);
    return { ...(await this.toDto(row, files)), created: true };
  }

  async patch(spaceId: string, subjectId: string, input: SubjectPatchInput) {
    const row = await this.findSubject(spaceId, subjectId);
    const projectId =
      input.project_id === undefined
        ? row.projectId
        : input.project_id === null
          ? null
          : (await this.assertProject(spaceId, input.project_id)).id;

    if (input.review_status !== undefined) {
      this.assertReviewStatus(input.review_status);
      // 驳回必须带原因；从驳回回到审核中等于人工申诉，允许但需显式传 status
      if (
        input.review_status === SubjectReviewStatus.REJECTED &&
        !(input.reject_reason ?? "").trim() &&
        !(row.rejectReason ?? "").trim()
      ) {
        throw new AppError(ErrorCode.INVALID_PARAM, "reject_reason is required when rejecting", {
          field: "reject_reason",
        });
      }
    }

    const [updated] = await db
      .update(subjects)
      .set({
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.kind !== undefined ? { kind: input.kind } : {}),
        ...(input.desc !== undefined ? { desc: input.desc } : {}),
        ...(input.cover_uri !== undefined ? { coverUri: input.cover_uri } : {}),
        ...(input.business_list !== undefined ? { businessList: input.business_list } : {}),
        ...(input.tags !== undefined ? { tags: input.tags.slice(0, 20) } : {}),
        ...(input.project_id !== undefined ? { projectId } : {}),
        ...(input.review_status !== undefined ? { reviewStatus: input.review_status } : {}),
        ...(input.review_status === SubjectReviewStatus.APPROVED ? { rejectReason: null } : {}),
        ...(input.reject_reason !== undefined ? { rejectReason: input.reject_reason } : {}),
        updatedAt: new Date(),
      })
      .where(eq(subjects.id, row.id))
      .returning();
    if (!updated) throw new AppError(ErrorCode.NOT_FOUND, "subject not found");

    if (input.files && input.files.length > 0) {
      await this.appendFiles(updated, input.files);
    }
    if (input.remove_file_ids && input.remove_file_ids.length > 0) {
      const ids = input.remove_file_ids.map((id) => this.parseId(id, "remove_file_ids"));
      await db.delete(subjectFiles).where(inArray(subjectFiles.id, ids));
    }
    const files = await this.filesOf(updated.id);
    return this.toDto(updated, files);
  }

  /** 软删（`subject_files` 保留，便于审计/恢复；列表与生成侧一律过滤 deleted_at） */
  async remove(spaceId: string, subjectId: string) {
    const row = await this.findSubject(spaceId, subjectId);
    await db
      .update(subjects)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(subjects.id, row.id), isNull(subjects.deletedAt)));
    return { ok: true };
  }

  // ── 生成侧闸门（供别的模块调用）─────────────────────────────────────

  /**
   * 未过审主体不得用于生成（`cmd/subject.md:204-216`）。
   *
   * 三态语义：
   * - `reviewing` → 400105 + retryable=true（等审核，可稍后重试）；
   * - `rejected`  → 400105 + retryable=false（人工申诉，**禁止自动重试**）；
   * - `unknown`（主体不存在/已删）→ 400105 + retryable=false，不默认当 approved。
   */
  async assertApproved(spaceId: string, subjectIds: string[]) {
    if (subjectIds.length === 0) return [];
    const ids = subjectIds.map((id) => this.parseId(id, "subject_ids"));
    const rows = await db
      .select()
      .from(subjects)
      .where(
        and(
          eq(subjects.spaceId, BigInt(spaceId)),
          inArray(subjects.id, ids),
          isNull(subjects.deletedAt),
        ),
      );
    const byId = new Map(rows.map((row) => [String(row.id), row]));
    const blocked: Array<{ subject_id: string; review_status: string; retryable: boolean }> = [];
    for (const id of ids) {
      const row = byId.get(String(id));
      if (!row) {
        blocked.push({ subject_id: String(id), review_status: "unknown", retryable: false });
        continue;
      }
      if (row.reviewStatus !== SubjectReviewStatus.APPROVED) {
        blocked.push({
          subject_id: String(row.id),
          review_status: REVIEW_NAMES[row.reviewStatus] ?? "unknown",
          // 驳回不可自动重试；审核中可等待后重试
          retryable: row.reviewStatus === SubjectReviewStatus.REVIEWING,
        });
      }
    }
    if (blocked.length > 0) {
      const hasRejected = blocked.some((item) => item.review_status !== "reviewing");
      throw new AppError(
        ErrorCode.ASSET_NOT_READY,
        hasRejected
          ? "subject not approved: rejected subjects cannot be retried automatically"
          : "subject still under review",
        {
          reason: hasRejected ? "moderation" : "subject_reviewing",
          retryable: !hasRejected,
          subjects: blocked,
        },
      );
    }
    return rows;
  }

  /**
   * 找出与「项目资产」显式绑定的主体（供生成侧判未过审），并**逐资产对应**返回。
   * 只认显式绑定（同 `subject_files.asset_id` 或同 URI），不按名称猜——同名主体可能是另一个人。
   */
  async subjectsOfAssetFiles(
    spaceId: string,
    items: Array<{ assetId: bigint | null; uri: string | null }>,
  ): Promise<Array<{ asset_id: string | null; uri: string | null; subject: SubjectRow }>> {
    const assetIds = items.map((item) => item.assetId).filter((id): id is bigint => Boolean(id));
    const uris = [...new Set(items.map((item) => item.uri).filter((uri): uri is string => Boolean(uri)))];
    if (assetIds.length === 0 && uris.length === 0) return [];
    const links = await db
      .select({ file: subjectFiles, subject: subjects })
      .from(subjectFiles)
      .innerJoin(subjects, eq(subjects.id, subjectFiles.subjectId))
      .where(
        and(
          eq(subjectFiles.spaceId, BigInt(spaceId)),
          isNull(subjects.deletedAt),
          assetIds.length > 0 && uris.length > 0
            ? or(inArray(subjectFiles.assetId, assetIds), inArray(subjectFiles.uri, uris))
            : assetIds.length > 0
              ? inArray(subjectFiles.assetId, assetIds)
              : inArray(subjectFiles.uri, uris),
        ),
      );
    const results: Array<{ asset_id: string | null; uri: string | null; subject: SubjectRow }> = [];
    for (const item of items) {
      const match = links.find(
        (link) =>
          (item.assetId && link.file.assetId === item.assetId) ||
          (item.uri && link.file.uri === item.uri),
      );
      if (!match) continue;
      results.push({
        asset_id: item.assetId ? String(item.assetId) : null,
        uri: item.uri,
        subject: match.subject,
      });
    }
    return results;
  }

  // ── 内部 ──────────────────────────────────────────────────────────────

  private async findSubject(spaceId: string, subjectId: string): Promise<SubjectRow> {
    const id = this.parseId(subjectId, "id");
    const [row] = await db
      .select()
      .from(subjects)
      .where(
        and(eq(subjects.id, id), eq(subjects.spaceId, BigInt(spaceId)), isNull(subjects.deletedAt)),
      );
    if (!row) throw new AppError(ErrorCode.NOT_FOUND, "subject not found");
    return row;
  }

  private async assertProject(spaceId: string, projectId: string) {
    const id = this.parseId(projectId, "project_id");
    const [row] = await db
      .select()
      .from(scriptProjects)
      .where(and(eq(scriptProjects.id, id), eq(scriptProjects.spaceId, BigInt(spaceId))));
    if (!row) throw new AppError(ErrorCode.NOT_FOUND, "project not found");
    return row;
  }

  private async loadFiles(subjectIds: bigint[]): Promise<Map<string, SubjectFileRow[]>> {
    const map = new Map<string, SubjectFileRow[]>();
    if (subjectIds.length === 0) return map;
    const rows = await db
      .select()
      .from(subjectFiles)
      .where(inArray(subjectFiles.subjectId, subjectIds))
      .orderBy(subjectFiles.sort, subjectFiles.id);
    for (const row of rows) {
      const key = String(row.subjectId);
      const list = map.get(key) ?? [];
      list.push(row);
      map.set(key, list);
    }
    return map;
  }

  private async filesOf(subjectId: bigint): Promise<SubjectFileRow[]> {
    return db
      .select()
      .from(subjectFiles)
      .where(eq(subjectFiles.subjectId, subjectId))
      .orderBy(subjectFiles.sort, subjectFiles.id);
  }

  /** 追加参考图：按 (subject_id, uri) 唯一索引幂等，重复 URI 不报错也不重复挂 */
  private async appendFiles(
    subject: SubjectRow,
    files: SubjectFileInput[],
  ): Promise<SubjectFileRow[]> {
    const seen = new Set<string>();
    const values = files
      .map((file) => ({ ...file, uri: file.uri.trim() }))
      .filter((file) => {
        if (!file.uri || seen.has(file.uri)) return false;
        seen.add(file.uri);
        return true;
      })
      .map((file) => ({
        id: newId(),
        subjectId: subject.id,
        spaceId: subject.spaceId,
        assetId: file.asset_id ? this.parseId(file.asset_id, "files[].asset_id") : null,
        uri: file.uri,
        role: file.role ?? 1,
        sort: file.sort ?? 0,
      }));
    if (values.length > 0) {
      await db.insert(subjectFiles).values(values).onConflictDoNothing();
    }
    return this.filesOf(subject.id);
  }

  private kindOfProjectAsset(kind: string): number {
    return PROJECT_ASSET_KIND_TO_SUBJECT_KIND[kind] ?? SubjectKind.CHARACTER;
  }

  private assertKind(kind: number) {
    if (!KIND_NAMES[kind]) {
      throw new AppError(ErrorCode.INVALID_PARAM, "kind must be 1(character) / 2(scene) / 3(prop)", {
        field: "kind",
      });
    }
  }

  private assertReviewStatus(status: number) {
    if (!REVIEW_NAMES[status]) {
      throw new AppError(
        ErrorCode.INVALID_PARAM,
        "review_status must be 1(reviewing) / 2(approved) / 3(rejected)",
        { field: "review_status" },
      );
    }
  }

  private parseId(value: string, field: string): bigint {
    try {
      return BigInt(value);
    } catch {
      throw new AppError(ErrorCode.INVALID_PARAM, `invalid ${field}`, { field });
    }
  }

  private async toDto(row: SubjectRow, files: SubjectFileRow[]) {
    return {
      id: String(row.id),
      name: row.name,
      kind: row.kind,
      kind_name: KIND_NAMES[row.kind] ?? "unknown",
      desc: row.desc,
      cover_uri: row.coverUri,
      review_status: row.reviewStatus,
      review_status_name: REVIEW_NAMES[row.reviewStatus] ?? "unknown",
      // 驳回不可自动重试（subject.md:212）：把语义放在返回里，避免调用方当成 internal 重试
      retryable: row.reviewStatus !== SubjectReviewStatus.REJECTED,
      reject_reason: row.rejectReason,
      business_list: (row.businessList as number[] | null) ?? [],
      tags: row.tags,
      project_id: row.projectId ? String(row.projectId) : null,
      files: await Promise.all(
        files.map(async (file) => ({
          id: String(file.id),
          uri: file.uri,
          url: await this.storage.signDownload(file.uri, 3600),
          role: file.role,
          sort: file.sort,
          asset_id: file.assetId ? String(file.assetId) : null,
        })),
      ),
      created_at: row.createdAt.toISOString(),
      updated_at: row.updatedAt.toISOString(),
    };
  }

  /** 供 asset 侧只读复用：按 space 列出「可用于生成」的主体（approved） */
  async listApproved(spaceId: string, kind?: number) {
    const rows = await db
      .select()
      .from(subjects)
      .where(
        and(
          eq(subjects.spaceId, BigInt(spaceId)),
          isNull(subjects.deletedAt),
          eq(subjects.reviewStatus, SubjectReviewStatus.APPROVED),
          kind ? eq(subjects.kind, kind) : undefined,
        ),
      )
      .orderBy(desc(subjects.createdAt));
    return rows.map((row) => ({
      id: String(row.id),
      name: row.name,
      kind: row.kind,
      kind_name: KIND_NAMES[row.kind] ?? "unknown",
      cover_uri: row.coverUri,
      business_list: (row.businessList as number[] | null) ?? [],
    }));
  }

  /** 只读：某 `assets.id` 对应的主体（生成侧注入参考图时可回溯） */
  async findByAssetFile(spaceId: string, assetId: string) {
    const id = this.parseId(assetId, "asset_id");
    const [link] = await db
      .select({ subjectId: subjectFiles.subjectId })
      .from(subjectFiles)
      .where(and(eq(subjectFiles.assetId, id), eq(subjectFiles.spaceId, BigInt(spaceId))))
      .limit(1);
    if (!link) return null;
    const [row] = await db
      .select()
      .from(subjects)
      .where(and(eq(subjects.id, link.subjectId), isNull(subjects.deletedAt)));
    if (!row) return null;
    return {
      subject_id: String(row.id),
      name: row.name,
      review_status: row.reviewStatus,
      review_status_name: REVIEW_NAMES[row.reviewStatus] ?? "unknown",
    };
  }
}

