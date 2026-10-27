import { Inject, Injectable } from "@nestjs/common";
import { and, desc, eq, inArray, isNull, sql, type SQL } from "drizzle-orm";
import { assets, episodes, extractionDrafts, extractionTasks, projectAssets, scriptProjects } from "@app/db";
import { AppError, ErrorCode, isAppError, newId } from "@app/shared";
import { db } from "../../db/database";
import { LlmService } from "../script/llm.service";

/**
 * 抽取流水线（extraction）—— 从项目/分集内容抽出角色、场景、道具的**草稿**。
 *
 * 竞品证据：
 * - `cmd/resource.md:536-568` `resource extract`：`POST /web/v1/df/extraction/task`，
 *   body `{sp_id, task_type, generate_mode}`，成功返回 `et_id`（=我方 task id）；
 *   `task_type` 1 清单 / 2 角色提示词 / 3 场景提示词 / 4 道具提示词 / 5 三合一；
 *   `generate_mode` 1 专业 / 2 快速，**只在 task_type=1 生效**；
 * - `cmd/resource.md:570-584` `extract-status`：四态 1 进行中 / 2 成功 / 3 失败 / 4 已删除或失效；
 * - `cmd/resource.md:602-617` `extract-redo`：**只用于失败或失效任务**；
 * - `cmd/resource.md:619-702` `draft-import`：`POST/PUT /web/v1/df/extraction/asset`，
 *   主形态先写、子形态用主形态返回的 `eed_id` 作 `parent_state_id`；
 *   同一调用只允许一种 `type`，混合类型 → `kind=usage` 且**零写请求**；
 *   未知类型/一组多个主形态/孤儿/跨组/循环/重复 state_id 一律 usage；
 * - `cmd/resource.md:704-727` `draft-list`：默认只返回主形态；`is_all=true` 时平铺返回，
 *   子形态用 `main_eed_id` 指向父形态（我方 `parent_state_id` 存父 `eed_id`）。
 *
 * 为什么草稿不直接落主体库/正式资产：抽错了不能污染主体库（schema.ts:2016）。
 */

export const ExtractionTaskStatus = {
  RUNNING: 1,
  SUCCEEDED: 2,
  FAILED: 3,
  INVALID: 4,
} as const;

export const ExtractionKind = {
  CHARACTER: 1,
  SCENE: 2,
  PROP: 3,
} as const;

const TASK_STATUS_NAMES: Record<number, string> = {
  1: "running",
  2: "succeeded",
  3: "failed",
  4: "invalid",
};

const DRAFT_STATE_NAMES: Record<number, string> = {
  1: "draft",
  2: "imported",
  3: "discarded",
};

const KIND_NAMES: Record<number, string> = {
  1: "character",
  2: "scene",
  3: "prop",
};

const KIND_NAME_TO_KIND: Record<string, number> = {
  character: ExtractionKind.CHARACTER,
  scene: ExtractionKind.SCENE,
  prop: ExtractionKind.PROP,
};

type TaskRow = typeof extractionTasks.$inferSelect;
type DraftRow = typeof extractionDrafts.$inferSelect;

export interface CreateTaskInput {
  project_id?: string;
  episode_id?: string;
  source_asset_id?: string;
  source_uri?: string;
  task_type?: number;
  generate_mode?: number;
  need_voice?: number;
}

export interface DraftListQuery {
  task_id?: string;
  eed_id?: string;
  kind?: number;
  state?: number;
  is_all?: boolean;
  episode_id?: string;
  project_id?: string;
  page?: number;
  page_size?: number;
}

export interface DraftImportItem {
  type?: string;
  kind?: number;
  name: string;
  prompt?: string;
  description?: string;
  group_id?: string;
  state_id?: string;
  parent_state_id?: string;
  eed_id?: string;
}

export interface DraftImportInput {
  task_id?: string;
  project_id?: string;
  episode_id?: string;
  items: DraftImportItem[];
}

@Injectable()
export class ExtractionService {
  constructor(@Inject(LlmService) private readonly llm: LlmService) {}

  // ── 任务 ──────────────────────────────────────────────────────────────

  /**
   * 创建项目级抽取任务并**同步执行**（我方无独立 worker 队列用于抽取，且抽取只是一次
   * LLM 结构化调用；同步执行让 `GET /extraction/tasks/:id` 的轮询语义天然成立）。
   *
   * 幂等：同 project+episode+task_type 仍有进行中任务时直接返回它（不重复下单）。
   */
  async createTask(spaceId: string, userId: string, input: CreateTaskInput) {
    const taskType = input.task_type ?? 4;
    this.assertTaskType(taskType);
    const project = input.project_id ? await this.findProject(spaceId, input.project_id) : null;
    const episode =
      project && input.episode_id ? await this.findEpisode(project.id, input.episode_id) : null;
    if (input.episode_id && !project) {
      throw new AppError(ErrorCode.INVALID_PARAM, "episode_id requires project_id", {
        field: "project_id",
      });
    }
    const sourceAssetId = input.source_asset_id
      ? await this.findAsset(spaceId, input.source_asset_id)
      : null;

    if (project) {
      const [running] = await db
        .select()
        .from(extractionTasks)
        .where(
          and(
            eq(extractionTasks.spaceId, BigInt(spaceId)),
            eq(extractionTasks.projectId, project.id),
            episode ? eq(extractionTasks.episodeId, episode.id) : isNull(extractionTasks.episodeId),
            eq(extractionTasks.taskType, taskType),
            eq(extractionTasks.status, ExtractionTaskStatus.RUNNING),
          ),
        )
        .orderBy(desc(extractionTasks.createdAt))
        .limit(1);
      if (running) {
        return { ...(await this.taskDto(running)), created: false, deduped: true };
      }
    }

    const [row] = await db
      .insert(extractionTasks)
      .values({
        id: newId(),
        spaceId: BigInt(spaceId),
        projectId: project?.id ?? null,
        episodeId: episode?.id ?? null,
        sourceAssetId: sourceAssetId?.id ?? null,
        sourceUri: input.source_uri ?? sourceAssetId?.uri ?? null,
        taskType,
        status: ExtractionTaskStatus.RUNNING,
        eedId: `eed_${newId().toString()}`,
        createdBy: userId ? BigInt(userId) : null,
        result: {
          generate_mode: taskType === 1 ? (input.generate_mode ?? 1) : null,
          need_voice: taskType === 5 ? (input.need_voice ?? 1) : null,
        },
      })
      .returning();
    if (!row) throw new AppError(ErrorCode.INTERNAL, "failed to create extraction task");
    const finished = await this.runTask(row, { project, episode, sourceAsset: sourceAssetId });
    return { ...(await this.taskDto(finished)), created: true, deduped: false };
  }

  async getTask(spaceId: string, taskId: string) {
    const row = await this.findTask(spaceId, taskId);
    const checked = await this.invalidateIfSourceGone(row);
    return this.taskDto(checked);
  }

  /** 重做：**只允许失败(3)或失效(4)** 的任务（resource.md:602-617） */
  async redoTask(spaceId: string, taskId: string) {
    const row = await this.findTask(spaceId, taskId);
    const checked = await this.invalidateIfSourceGone(row);
    if (
      checked.status !== ExtractionTaskStatus.FAILED &&
      checked.status !== ExtractionTaskStatus.INVALID
    ) {
      throw new AppError(
        ErrorCode.INVALID_PARAM,
        "redo is only allowed for failed(3) or invalid(4) extraction tasks",
        {
          field: "task_id",
          status: checked.status,
          status_name: TASK_STATUS_NAMES[checked.status] ?? "unknown",
          allowed_statuses: [ExtractionTaskStatus.FAILED, ExtractionTaskStatus.INVALID],
        },
      );
    }
    // 失效(4) 的成因若是「源资产已删」，重做只会一直失败：直接拒，不让用户白等
    // （schema.ts:1978-1982 已记：失效不能重试，重试只会一直失败）
    if (checked.status === ExtractionTaskStatus.INVALID && checked.sourceAssetId) {
      const [source] = await db.select().from(assets).where(eq(assets.id, checked.sourceAssetId));
      if (!source || source.deletedAt) {
        throw new AppError(
          ErrorCode.INVALID_PARAM,
          "invalid task cannot be redone: source asset was deleted",
          { field: "task_id", reason: "source_asset_gone", retryable: false },
        );
      }
    }
    // 失败/失效批次里的草稿不可信：只清未导入的草稿，已导入主体库的保留（不误删用户数据）
    await db
      .delete(extractionDrafts)
      .where(and(eq(extractionDrafts.taskId, checked.id), eq(extractionDrafts.state, 1)));
    const [reset] = await db
      .update(extractionTasks)
      .set({
        status: ExtractionTaskStatus.RUNNING,
        error: null,
        eedId: `eed_${newId().toString()}`,
        finishedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(extractionTasks.id, checked.id))
      .returning();
    if (!reset) throw new AppError(ErrorCode.NOT_FOUND, "extraction task not found");

    const project = reset.projectId
      ? ((await db.select().from(scriptProjects).where(eq(scriptProjects.id, reset.projectId)))[0] ?? null)
      : null;
    const episode = reset.episodeId
      ? ((await db.select().from(episodes).where(eq(episodes.id, reset.episodeId)))[0] ?? null)
      : null;
    const sourceAsset = reset.sourceAssetId
      ? ((await db.select().from(assets).where(eq(assets.id, reset.sourceAssetId)))[0] ?? null)
      : null;
    const finished = await this.runTask(reset, {
      project: project ?? null,
      episode: episode ?? null,
      sourceAsset: sourceAsset ?? null,
    });
    return { ...(await this.taskDto(finished)), redo: true };
  }

  // ── 草稿 ──────────────────────────────────────────────────────────────

  async listDrafts(spaceId: string, query: DraftListQuery) {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(500, Math.max(1, query.page_size ?? 20));
    const conds: SQL[] = [eq(extractionDrafts.spaceId, BigInt(spaceId))];
    if (query.task_id) conds.push(eq(extractionDrafts.taskId, this.parseId(query.task_id, "task_id")));
    if (query.eed_id) conds.push(eq(extractionDrafts.eedId, query.eed_id));
    if (query.kind) conds.push(eq(extractionDrafts.kind, query.kind));
    if (query.state) conds.push(eq(extractionDrafts.state, query.state));
    // 默认只返回主形态；is_all=true 时主/子平铺（resource.md:704-727）
    if (!query.is_all) conds.push(isNull(extractionDrafts.parentStateId));
    if (query.episode_id || query.project_id) {
      const taskConds: SQL[] = [eq(extractionTasks.spaceId, BigInt(spaceId))];
      if (query.episode_id) {
        taskConds.push(eq(extractionTasks.episodeId, this.parseId(query.episode_id, "episode_id")));
      }
      if (query.project_id) {
        taskConds.push(eq(extractionTasks.projectId, this.parseId(query.project_id, "project_id")));
      }
      const tasks = await db
        .select({ id: extractionTasks.id })
        .from(extractionTasks)
        .where(and(...taskConds));
      if (tasks.length === 0) {
        return {
          list: [],
          total: 0,
          count: 0,
          page,
          page_size: pageSize,
          has_more: false,
          next_page: null,
        };
      }
      conds.push(
        inArray(
          extractionDrafts.taskId,
          tasks.map((task) => task.id),
        ),
      );
    }
    const where = and(...conds);
    const rows = await db
      .select()
      .from(extractionDrafts)
      .where(where)
      .orderBy(desc(extractionDrafts.createdAt), desc(extractionDrafts.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize);
    const [countRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(extractionDrafts)
      .where(where);
    const total = countRow?.count ?? 0;
    return {
      list: rows.map((row) => this.draftDto(row)),
      total,
      count: total,
      page,
      page_size: pageSize,
      has_more: total > page * pageSize,
      next_page: total > page * pageSize ? page + 1 : null,
    };
  }

  /**
   * 草稿导入（竞品 `draft-import`，resource.md:619-702）。
   *
   * 校验顺序先行、**校验失败零写请求**：同一调用只允许一种 type；`state_id` 重复、
   * 一组多个主形态、孤儿/跨组/循环父引用一律 400101。
   */
  async importDrafts(spaceId: string, userId: string, input: DraftImportInput) {
    if (input.items.length === 0) {
      throw new AppError(ErrorCode.INVALID_PARAM, "items must not be empty", { field: "items" });
    }
    // 1) 类型归一 + 单类型校验
    const kinds = new Set<number>();
    for (const [index, item] of input.items.entries()) {
      const kind = this.resolveKind(item, index);
      kinds.add(kind);
    }
    if (kinds.size > 1) {
      throw new AppError(ErrorCode.INVALID_PARAM, "mixed asset types are not allowed in one call", {
        field: "items",
        kinds: [...kinds].map((kind) => KIND_NAMES[kind] ?? kind),
      });
    }
    const kind = [...kinds][0]!;

    // 2) state_id 唯一
    const stateIds = input.items
      .map((item) => item.state_id?.trim())
      .filter((id): id is string => Boolean(id));
    if (new Set(stateIds).size !== stateIds.length) {
      throw new AppError(ErrorCode.INVALID_PARAM, "duplicate state_id in items", { field: "state_id" });
    }

    // 3) 主子关系：每组恰好一个主形态；子形态父必须同组存在；不允许环
    const byStateId = new Map<string, DraftImportItem>();
    for (const item of input.items) {
      if (item.state_id) byStateId.set(item.state_id, item);
    }
    const groups = new Map<string, DraftImportItem[]>();
    for (const [index, item] of input.items.entries()) {
      const groupKey = item.group_id?.trim() || item.state_id?.trim() || `#${index}`;
      const list = groups.get(groupKey) ?? [];
      list.push(item);
      groups.set(groupKey, list);
    }
    for (const [groupKey, items] of groups) {
      const mains = items.filter((item) => !item.parent_state_id?.trim());
      if (items.length > 1 && mains.length !== 1) {
        throw new AppError(
          ErrorCode.INVALID_PARAM,
          `group ${groupKey} must have exactly one main form (parent_state_id empty)`,
          { field: "parent_state_id", group_id: groupKey, main_count: mains.length },
        );
      }
      for (const item of items) {
        const parentStateId = item.parent_state_id?.trim();
        if (!parentStateId) continue;
        const parent = byStateId.get(parentStateId);
        if (!parent) {
          throw new AppError(ErrorCode.INVALID_PARAM, `orphan parent_state_id: ${parentStateId}`, {
            field: "parent_state_id",
            state_id: item.state_id ?? null,
          });
        }
        const parentGroupKey = parent.group_id?.trim() || parent.state_id?.trim();
        const ownGroupKey = item.group_id?.trim() || item.state_id?.trim();
        if (parentGroupKey !== ownGroupKey) {
          throw new AppError(ErrorCode.INVALID_PARAM, "parent_state_id crosses groups", {
            field: "parent_state_id",
            state_id: item.state_id ?? null,
          });
        }
        if (parent.parent_state_id?.trim()) {
          throw new AppError(ErrorCode.INVALID_PARAM, "nested sub form is not allowed", {
            field: "parent_state_id",
            state_id: item.state_id ?? null,
          });
        }
      }
    }

    // 4) 任务容器：显式 task_id 优先；否则建一个「人工回填」任务承载草稿
    //    （extraction_drafts.task_id NOT NULL；竞品的草稿也始终挂在某次提取操作台上下文里）
    let task: TaskRow;
    if (input.task_id) {
      task = await this.findTask(spaceId, input.task_id);
    } else {
      const project = input.project_id ? await this.findProject(spaceId, input.project_id) : null;
      const episode =
        project && input.episode_id ? await this.findEpisode(project.id, input.episode_id) : null;
      const [created] = await db
        .insert(extractionTasks)
        .values({
          id: newId(),
          spaceId: BigInt(spaceId),
          projectId: project?.id ?? null,
          episodeId: episode?.id ?? null,
          taskType: 5,
          status: ExtractionTaskStatus.SUCCEEDED,
          eedId: `eed_${newId().toString()}`,
          createdBy: userId ? BigInt(userId) : null,
          result: { manual_import: true },
          finishedAt: new Date(),
        })
        .returning();
      if (!created) throw new AppError(ErrorCode.INTERNAL, "failed to create import task");
      task = created;
    }

    // 5) 写库：先主形态（拿到 eed_id），再子形态（parent_state_id = 父 eed_id）
    const succeeded: Array<{
      eed_id: string;
      state_id: string | null;
      group_id: string | null;
      is_sub: boolean;
      parent_eed_id: string | null;
      name: string;
      operation: "create" | "update";
    }> = [];
    const eedIdByStateId = new Map<string, string>();

    const mains = input.items.filter((item) => !item.parent_state_id?.trim());
    const subs = input.items.filter((item) => Boolean(item.parent_state_id?.trim()));

    for (const item of [...mains, ...subs]) {
      const parentStateId = item.parent_state_id?.trim();
      const parentEedId = parentStateId ? (eedIdByStateId.get(parentStateId) ?? null) : null;
      if (parentStateId && !parentEedId) {
        // 理论上已被上方校验拦住；这里兜底防止父 eed_id 解析失败时写出孤儿行
        throw new AppError(ErrorCode.INVALID_PARAM, "parent_state_id could not be resolved to eed_id", {
          field: "parent_state_id",
          state_id: item.state_id ?? null,
        });
      }
      const payload = {
        state_id: item.state_id ?? null,
        group_id: item.group_id ?? null,
        type: KIND_NAMES[kind],
        prompt: item.prompt ?? null,
        description: item.description ?? null,
        source: "manual_import",
      };
      let row: DraftRow | undefined;
      let operation: "create" | "update" = "create";
      if (item.eed_id) {
        const existing = await this.findDraftInTask(spaceId, task.id, item.eed_id);
        const [updated] = await db
          .update(extractionDrafts)
          .set({
            kind,
            name: item.name.trim(),
            payload,
            parentStateId: parentEedId,
            updatedAt: new Date(),
          })
          .where(eq(extractionDrafts.id, existing.id))
          .returning();
        row = updated;
        operation = "update";
      } else {
        const [created] = await db
          .insert(extractionDrafts)
          .values({
            id: newId(),
            spaceId: BigInt(spaceId),
            taskId: task.id,
            eedId: `eed_${newId().toString()}`,
            kind,
            name: item.name.trim(),
            payload,
            state: 1,
            parentStateId: parentEedId,
          })
          .returning();
        row = created;
      }
      if (!row) throw new AppError(ErrorCode.INTERNAL, "failed to write extraction draft");
      if (item.state_id) eedIdByStateId.set(item.state_id, row.eedId);
      succeeded.push({
        eed_id: row.eedId,
        state_id: item.state_id ?? null,
        group_id: item.group_id ?? null,
        is_sub: Boolean(row.parentStateId),
        parent_eed_id: row.parentStateId ?? null,
        name: row.name,
        operation,
      });
    }

    await db
      .update(extractionTasks)
      .set({
        result: {
          ...((task.result as Record<string, unknown> | null) ?? {}),
          imported: { count: succeeded.length, kind: KIND_NAMES[kind] },
        },
        updatedAt: new Date(),
      })
      .where(eq(extractionTasks.id, task.id));

    return { task_id: String(task.id), eed_id: task.eedId, succeeded, failed: [] };
  }

  /** 草稿 → 项目资产（人工确认后落到项目资产库，仍是草稿状态，需再定稿） */
  async promoteDrafts(spaceId: string, input: { eed_ids: string[]; project_id: string }) {
    const project = await this.findProject(spaceId, input.project_id);
    // 按 `eed_id`（草稿对外标识）取，而不是主键 id：竞品 `batch-draft-generate` 只认 eed_id，
    // 调用方不应该看到/使用内部主键
    const eedIds = [...new Set(input.eed_ids.map((id) => id.trim()).filter(Boolean))];
    const rows = await db
      .select({ draft: extractionDrafts })
      .from(extractionDrafts)
      .innerJoin(extractionTasks, eq(extractionTasks.id, extractionDrafts.taskId))
      .where(
        and(
          eq(extractionDrafts.spaceId, BigInt(spaceId)),
          eq(extractionTasks.spaceId, BigInt(spaceId)),
          inArray(extractionDrafts.eedId, eedIds),
        ),
      );
    if (rows.length !== eedIds.length) {
      throw new AppError(ErrorCode.NOT_FOUND, "draft not found", {
        field: "eed_ids",
        missing: eedIds.filter((id) => !rows.some(({ draft }) => draft.eedId === id)),
      });
    }
    const existing = await db
      .select()
      .from(projectAssets)
      .where(eq(projectAssets.projectId, project.id));
    const byKindName = new Map(existing.map((row) => [`${row.kind}:${row.name.trim()}`, row]));

    const items: Array<{ eed_id: string; asset_id: string; created: boolean }> = [];
    for (const { draft } of rows) {
      const kind = draft.kind === 1 ? "character" : draft.kind === 2 ? "scene" : "prop";
      const payload = (draft.payload as Record<string, unknown> | null) ?? {};
      const prompt = typeof payload.prompt === "string" ? payload.prompt : null;
      const description = typeof payload.description === "string" ? payload.description : null;
      const key = `${kind}:${draft.name.trim()}`;
      const found = byKindName.get(key);
      if (found) {
        items.push({ eed_id: draft.eedId, asset_id: String(found.id), created: false });
      } else {
        const [created] = await db
          .insert(projectAssets)
          .values({
            id: newId(),
            projectId: project.id,
            kind,
            name: draft.name.trim(),
            description,
            prompt,
            status: 1,
          })
          .returning();
        if (!created) throw new AppError(ErrorCode.INTERNAL, "failed to create project asset");
        byKindName.set(key, created);
        items.push({ eed_id: draft.eedId, asset_id: String(created.id), created: true });
      }
      await db
        .update(extractionDrafts)
        .set({ state: 2, updatedAt: new Date() })
        .where(eq(extractionDrafts.id, draft.id));
    }
    return { items };
  }

  // ── 任务列表 / 取消 / 统计（竞品 rt:512-514 task/progress + versions 的服务端聚合）──

  /**
   * `GET /extraction/tasks`：分页 + 状态/类型/项目/分集筛选。
   *
   * 竞品没有一条独立的"任务列表"端点（只有 `df/extraction/task` 创建、`task/progress`
   * 单任务进度、`versions` 版本表，见 `routes.txt:512-518`）；我方列表是这些语义的
   * **服务端聚合**，不新增字段、不臆造竞品参数。
   */
  async listTasks(
    spaceId: string,
    query: {
      status?: number;
      task_type?: number;
      project_id?: string;
      episode_id?: string;
      page?: number;
      page_size?: number;
    },
  ) {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, query.page_size ?? 20));
    const conds = [eq(extractionTasks.spaceId, BigInt(spaceId))];
    if (query.status) conds.push(eq(extractionTasks.status, query.status));
    if (query.task_type) conds.push(eq(extractionTasks.taskType, query.task_type));
    if (query.project_id) conds.push(eq(extractionTasks.projectId, this.parseId(query.project_id, "project_id")));
    if (query.episode_id) conds.push(eq(extractionTasks.episodeId, this.parseId(query.episode_id, "episode_id")));
    const where = and(...conds);
    const rows = await db
      .select()
      .from(extractionTasks)
      .where(where)
      .orderBy(desc(extractionTasks.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize);
    const [countRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(extractionTasks)
      .where(where);
    const total = countRow?.count ?? 0;

    // 草稿计数一次聚合（避免逐任务 N+1）
    const taskIds = rows.map((row) => row.id);
    const mainCount = new Map<string, number>();
    const subCount = new Map<string, number>();
    if (taskIds.length > 0) {
      const grouped = await db
        .select({
          taskId: extractionDrafts.taskId,
          parent: sql<boolean>`${extractionDrafts.parentStateId} is not null`,
          count: sql<number>`count(*)::int`,
        })
        .from(extractionDrafts)
        .where(inArray(extractionDrafts.taskId, taskIds))
        .groupBy(extractionDrafts.taskId, sql`${extractionDrafts.parentStateId} is not null`);
      for (const row of grouped) {
        const key = String(row.taskId);
        if (row.parent) subCount.set(key, Number(row.count));
        else mainCount.set(key, Number(row.count));
      }
    }

    return {
      list: rows.map((row) => ({
        id: String(row.id),
        et_id: String(row.id),
        project_id: row.projectId ? String(row.projectId) : null,
        episode_id: row.episodeId ? String(row.episodeId) : null,
        task_type: row.taskType,
        status: row.status,
        status_name: TASK_STATUS_NAMES[row.status] ?? "unknown",
        // 只有失败(3)/失效(4)可重做（resource.md:602-617）
        retryable:
          row.status === ExtractionTaskStatus.FAILED || row.status === ExtractionTaskStatus.INVALID,
        eed_id: row.eedId,
        draft_count: mainCount.get(String(row.id)) ?? 0,
        sub_draft_count: subCount.get(String(row.id)) ?? 0,
        error: row.error,
        finished_at: row.finishedAt ? row.finishedAt.toISOString() : null,
        created_at: row.createdAt.toISOString(),
        updated_at: row.updatedAt.toISOString(),
      })),
      total,
      page,
      page_size: pageSize,
      has_more: total > page * pageSize,
    };
  }

  /**
   * `POST /extraction/tasks/:id/cancel`：取消进行中的抽取任务。
   *
   * 四态里没有"已取消"，取消落到 **失效(4)**（竞品 `df/extraction/task/delete` 同义：
   * 删掉的抽取任务不可再重试）。未确认的草稿标记为已丢弃（`state=3`）而不是物理删除，
   * 便于审计"这次抽取其实跑过"。
   */
  async cancelTask(spaceId: string, taskId: string) {
    const row = await this.findTask(spaceId, taskId);
    if (row.status !== ExtractionTaskStatus.RUNNING) {
      throw new AppError(ErrorCode.INVALID_PARAM, "only running(1) extraction tasks can be cancelled", {
        field: "task_id",
        status: row.status,
        status_name: TASK_STATUS_NAMES[row.status] ?? "unknown",
      });
    }
    const [updated] = await db
      .update(extractionTasks)
      .set({
        status: ExtractionTaskStatus.INVALID,
        error: { code: ErrorCode.NOT_FOUND, message: "cancelled by user", reason: "cancelled" },
        finishedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(extractionTasks.id, row.id))
      .returning();
    if (!updated) throw new AppError(ErrorCode.NOT_FOUND, "extraction task not found");
    await db
      .update(extractionDrafts)
      .set({ state: 3, updatedAt: new Date() })
      .where(and(eq(extractionDrafts.taskId, row.id), eq(extractionDrafts.state, 1)));
    return {
      ...(await this.taskDto(updated)),
      cancelled: true,
      // 取消 = 失效，不可重做（重做只会再跑一次同样的取消/删除）
      retryable: false,
    };
  }

  /**
   * `GET /extraction/stats`：按 `task_type` 的成功/失败率。
   *
   * 竞品只有单任务 `task/progress`（`routes.txt:512`），没有跨任务聚合端点；
   * 我方统计是服务端聚合（复用四态定义），不新增状态码/枚举。
   */
  async stats(spaceId: string) {
    const rows = await db
      .select({
        taskType: extractionTasks.taskType,
        status: extractionTasks.status,
        count: sql<number>`count(*)::int`,
      })
      .from(extractionTasks)
      .where(eq(extractionTasks.spaceId, BigInt(spaceId)))
      .groupBy(extractionTasks.taskType, extractionTasks.status);
    const byType = new Map<
      number,
      { task_type: number; total: number; running: number; succeeded: number; failed: number; invalid: number }
    >();
    for (const row of rows) {
      const item =
        byType.get(row.taskType) ??
        { task_type: row.taskType, total: 0, running: 0, succeeded: 0, failed: 0, invalid: 0 };
      const count = Number(row.count);
      item.total += count;
      if (row.status === ExtractionTaskStatus.RUNNING) item.running += count;
      else if (row.status === ExtractionTaskStatus.SUCCEEDED) item.succeeded += count;
      else if (row.status === ExtractionTaskStatus.FAILED) item.failed += count;
      else item.invalid += count;
      byType.set(row.taskType, item);
    }
    const items = [...byType.values()]
      .sort((a, b) => a.task_type - b.task_type)
      .map((item) => ({
        ...item,
        // 成功率分母只算终态（进行中的既不算成功也不算失败，否则刚提交就"成功率 0%"）
        success_rate:
          item.succeeded + item.failed + item.invalid > 0
            ? Number(
                (item.succeeded / (item.succeeded + item.failed + item.invalid)).toFixed(4),
              )
            : 0,
      }));
    const totals = items.reduce(
      (acc, item) => ({
        total: acc.total + item.total,
        running: acc.running + item.running,
        succeeded: acc.succeeded + item.succeeded,
        failed: acc.failed + item.failed,
        invalid: acc.invalid + item.invalid,
      }),
      { total: 0, running: 0, succeeded: 0, failed: 0, invalid: 0 },
    );
    const terminal = totals.succeeded + totals.failed + totals.invalid;
    return {
      items,
      totals: {
        ...totals,
        success_rate: terminal > 0 ? Number((totals.succeeded / terminal).toFixed(4)) : 0,
      },
    };
  }

  // ── 内部 ──────────────────────────────────────────────────────────────

  /** 执行一次抽取（task_type 决定抽哪几类、是否带提示词） */
  private async runTask(
    task: TaskRow,
    ctx: {
      project: typeof scriptProjects.$inferSelect | null;
      episode: typeof episodes.$inferSelect | null;
      sourceAsset: typeof assets.$inferSelect | null;
    },
  ): Promise<TaskRow> {
    try {
      const content = await this.resolveContent(ctx);
      const wantedKinds = this.kindsOfTaskType(task.taskType);
      const wantPrompt = task.taskType !== 1;
      const extracted = await this.llm.extractAssets({
        title: ctx.episode?.title ?? ctx.project?.title ?? "短剧",
        synopsis: ctx.episode?.synopsis ?? undefined,
        scriptText: ctx.episode?.scriptText ?? undefined,
        sourceText: content,
      });
      const candidates = [
        ...extracted.characters.map((item) => ({ kind: ExtractionKind.CHARACTER, ...item })),
        ...extracted.scenes.map((item) => ({ kind: ExtractionKind.SCENE, ...item })),
        ...extracted.props.map((item) => ({ kind: ExtractionKind.PROP, ...item })),
      ].filter((item) => wantedKinds.includes(item.kind) && item.name.trim().length > 0);

      await db.transaction(async (tx) => {
        if (candidates.length > 0) {
          await tx.insert(extractionDrafts).values(
            candidates.map((item) => ({
              id: newId(),
              spaceId: task.spaceId,
              taskId: task.id,
              eedId: `eed_${newId().toString()}`,
              kind: item.kind,
              name: item.name.trim(),
              payload: {
                description: item.description ?? null,
                // 清单提取(task_type=1)只要名单，不写提示词（resource.md:552-568 的分工）
                prompt: wantPrompt ? (item.prompt ?? null) : null,
                source: "ai",
                task_type: task.taskType,
              },
              state: 1,
            })),
          );
        }
        const counts = {
          characters: candidates.filter((item) => item.kind === ExtractionKind.CHARACTER).length,
          scenes: candidates.filter((item) => item.kind === ExtractionKind.SCENE).length,
          props: candidates.filter((item) => item.kind === ExtractionKind.PROP).length,
        };
        await tx
          .update(extractionTasks)
          .set({
            status: ExtractionTaskStatus.SUCCEEDED,
            result: {
              ...((task.result as Record<string, unknown> | null) ?? {}),
              ...counts,
              draft_count: candidates.length,
              eed_id: task.eedId,
            },
            finishedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(extractionTasks.id, task.id));
      });
      const [row] = await db.select().from(extractionTasks).where(eq(extractionTasks.id, task.id));
      return row ?? task;
    } catch (error) {
      const code = isAppError(error) ? error.code : ErrorCode.INTERNAL;
      const message = error instanceof Error ? error.message : String(error);
      const [row] = await db
        .update(extractionTasks)
        .set({
          status: ExtractionTaskStatus.FAILED,
          error: { code, message },
          finishedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(extractionTasks.id, task.id))
        .returning();
      return row ?? task;
    }
  }

  /** 抽取内容来源：分集正文 → 项目原文 → 源资产名（资产抽取只给名字，避免编造画面） */
  private async resolveContent(ctx: {
    project: typeof scriptProjects.$inferSelect | null;
    episode: typeof episodes.$inferSelect | null;
    sourceAsset: typeof assets.$inferSelect | null;
  }): Promise<string | undefined> {
    const text = (ctx.episode?.scriptText ?? "").trim() || (ctx.project?.sourceText ?? "").trim();
    if (text) return text;
    if (ctx.sourceAsset) return ctx.sourceAsset.name;
    throw new AppError(
      ErrorCode.INVALID_PARAM,
      "no extractable content: provide project_id/episode_id with text, or source_asset_id",
      { field: "project_id" },
    );
  }

  private kindsOfTaskType(taskType: number): number[] {
    switch (taskType) {
      case 1:
        return [ExtractionKind.CHARACTER, ExtractionKind.SCENE, ExtractionKind.PROP];
      case 2:
        return [ExtractionKind.CHARACTER];
      case 3:
        return [ExtractionKind.SCENE];
      case 4:
        return [ExtractionKind.PROP];
      default:
        return [ExtractionKind.CHARACTER, ExtractionKind.SCENE, ExtractionKind.PROP];
    }
  }

  private assertTaskType(taskType: number) {
    if (![1, 2, 3, 4, 5].includes(taskType)) {
      throw new AppError(ErrorCode.INVALID_PARAM, "task_type must be 1..5", { field: "task_type" });
    }
  }

  private resolveKind(item: DraftImportItem, index: number): number {
    if (item.kind !== undefined) {
      if (!KIND_NAMES[item.kind]) {
        throw new AppError(ErrorCode.INVALID_PARAM, `items[${index}].kind must be 1/2/3`, {
          field: `items[${index}].kind`,
        });
      }
      return item.kind;
    }
    const type = item.type?.trim();
    if (!type) {
      throw new AppError(ErrorCode.INVALID_PARAM, `items[${index}].type is required`, {
        field: `items[${index}].type`,
      });
    }
    const kind = KIND_NAME_TO_KIND[type];
    if (!kind) {
      throw new AppError(
        ErrorCode.INVALID_PARAM,
        `items[${index}].type must be character|scene|prop (got ${type})`,
        { field: `items[${index}].type` },
      );
    }
    return kind;
  }

  /** 扫码源资产已被软删 → 任务置「失效(4)」（失效与失败的区别：重试只会一直失败） */
  private async invalidateIfSourceGone(row: TaskRow): Promise<TaskRow> {
    if (!row.sourceAssetId || row.status === ExtractionTaskStatus.INVALID) return row;
    const [asset] = await db.select().from(assets).where(eq(assets.id, row.sourceAssetId));
    if (asset && !asset.deletedAt) return row;
    const [updated] = await db
      .update(extractionTasks)
      .set({
        status: ExtractionTaskStatus.INVALID,
        error: { code: ErrorCode.NOT_FOUND, message: "source asset deleted", reason: "source_asset_gone" },
        updatedAt: new Date(),
      })
      .where(eq(extractionTasks.id, row.id))
      .returning();
    return updated ?? row;
  }

  private draftDto(row: DraftRow) {
    return {
      id: String(row.id),
      task_id: String(row.taskId),
      eed_id: row.eedId,
      kind: row.kind,
      kind_name: KIND_NAMES[row.kind] ?? "unknown",
      name: row.name,
      payload: row.payload,
      state: row.state,
      state_name: DRAFT_STATE_NAMES[row.state] ?? "unknown",
      parent_state_id: row.parentStateId,
      // 竞品用非空且非 "0" 的 main_eed_id 指父形态（resource.md:704-727）
      main_eed_id: row.parentStateId ?? "0",
      is_sub: Boolean(row.parentStateId),
      created_at: row.createdAt.toISOString(),
      updated_at: row.updatedAt.toISOString(),
    };
  }

  private async taskDto(row: TaskRow) {
    const drafts = await db
      .select()
      .from(extractionDrafts)
      .where(and(eq(extractionDrafts.taskId, row.id), isNull(extractionDrafts.parentStateId)));
    const subs = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(extractionDrafts)
      .where(and(eq(extractionDrafts.taskId, row.id), sql`${extractionDrafts.parentStateId} is not null`));
    return {
      id: String(row.id),
      et_id: String(row.id),
      space_id: String(row.spaceId),
      project_id: row.projectId ? String(row.projectId) : null,
      episode_id: row.episodeId ? String(row.episodeId) : null,
      source_asset_id: row.sourceAssetId ? String(row.sourceAssetId) : null,
      source_uri: row.sourceUri,
      task_type: row.taskType,
      status: row.status,
      status_name: TASK_STATUS_NAMES[row.status] ?? "unknown",
      // 可重做：只允许失败/失效（resource.md:602-617）
      retryable:
        row.status === ExtractionTaskStatus.FAILED || row.status === ExtractionTaskStatus.INVALID,
      eed_id: row.eedId,
      result: row.result,
      error: row.error,
      draft_count: drafts.length,
      sub_draft_count: subs[0]?.count ?? 0,
      drafts: drafts.map((draft) => this.draftDto(draft)),
      finished_at: row.finishedAt ? row.finishedAt.toISOString() : null,
      created_at: row.createdAt.toISOString(),
      updated_at: row.updatedAt.toISOString(),
    };
  }

  private async findTask(spaceId: string, taskId: string): Promise<TaskRow> {
    const id = this.parseId(taskId, "task_id");
    const [row] = await db
      .select()
      .from(extractionTasks)
      .where(and(eq(extractionTasks.id, id), eq(extractionTasks.spaceId, BigInt(spaceId))));
    if (!row) throw new AppError(ErrorCode.NOT_FOUND, "extraction task not found");
    return row;
  }

  private async findDraftInTask(spaceId: string, taskId: bigint, eedId: string): Promise<DraftRow> {
    const [row] = await db
      .select()
      .from(extractionDrafts)
      .where(
        and(
          eq(extractionDrafts.spaceId, BigInt(spaceId)),
          eq(extractionDrafts.taskId, taskId),
          eq(extractionDrafts.eedId, eedId),
        ),
      );
    if (!row) throw new AppError(ErrorCode.NOT_FOUND, "draft not found", { field: "eed_id" });
    return row;
  }

  private async findProject(spaceId: string, projectId: string) {
    const id = this.parseId(projectId, "project_id");
    const [row] = await db
      .select()
      .from(scriptProjects)
      .where(and(eq(scriptProjects.id, id), eq(scriptProjects.spaceId, BigInt(spaceId))));
    if (!row) throw new AppError(ErrorCode.NOT_FOUND, "project not found");
    return row;
  }

  private async findEpisode(projectId: bigint, episodeId: string) {
    const id = this.parseId(episodeId, "episode_id");
    const [row] = await db
      .select()
      .from(episodes)
      .where(and(eq(episodes.id, id), eq(episodes.projectId, projectId)));
    if (!row) throw new AppError(ErrorCode.NOT_FOUND, "episode not found");
    return row;
  }

  private async findAsset(spaceId: string, assetId: string) {
    const id = this.parseId(assetId, "source_asset_id");
    const [row] = await db
      .select()
      .from(assets)
      .where(and(eq(assets.id, id), eq(assets.spaceId, BigInt(spaceId)), isNull(assets.deletedAt)));
    if (!row) throw new AppError(ErrorCode.NOT_FOUND, "asset not found");
    return row;
  }

  private parseId(value: string, field: string): bigint {
    try {
      return BigInt(value);
    } catch {
      throw new AppError(ErrorCode.INVALID_PARAM, `invalid ${field}`, { field });
    }
  }
}

