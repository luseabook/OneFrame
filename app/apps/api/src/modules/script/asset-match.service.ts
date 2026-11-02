import { Inject, Injectable } from "@nestjs/common";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  episodeResources,
  episodes,
  projectAssets,
  scriptProjects,
  storyboardAssets,
  storyboards,
  tasks,
} from "@app/db";
import { AppError, ErrorCode, ProjectAssetStatus, TaskStatus, newId } from "@app/shared";
import { db } from "../../db/database";
import { StorageService } from "../../storage/storage.service";
import { LlmService } from "./llm.service";

/**
 * 资产 × 分镜匹配（`asset-match`）—— GUI 环节 4 的核心。
 *
 * 竞品证据：
 * - `episode.md:261-300` `match-resources` 是**资产匹配 + 自动拆分镜的组合任务**，受理成功只代表
 *   任务已创建；确认成功要逐集轮询 `match-result` 到 `data.status=2`；
 * - `_storyboard-asset-match.md:5` `match-result` 的 `characters[]/scenes[]/props[]` 三项计数：
 *   `status=2` 已匹配 / `status=1` 未定稿 / `status=3` 缺失；
 * - `episode.md:368-388` `save-resource-matches`：**完整快照语义**——必须同时给三类数组，
 *   空类别显式 `[]`；漏传类别由服务端清空（我方选择直接 400101 拒绝，不做静默清空）；
 * - `subject.md:228-250` `match-reset` 是破坏性动作，先 dry-run 提示；
 * - `_storyboard-asset-match.md:7-46` 智能补充 7 项条件 + 三选项（补/重匹配/保持现状，默认第三），
 *   无可复用资产时按 `resource add → resource generate → …` 补齐；
 * - `storyboard.md:308-310` 参考资产按顺序转 `images`，提示词中的名称转 `[[@imgN]]`。
 *
 * ## 本轮（迁移 0031）把"投影"换成真正的集级快照
 *
 * 上轮我方没有集级清单表，只能用「分镜绑定 ∪ 提示词提及」投影，留下两个真实缺口：
 * 1. 无法保存"属于本集但没有任何镜头提及、也未绑定"的资产；
 * 2. 未定稿/占位项也被绑到分镜（因为绑定是唯一载体），导致"匹配一次就出不了片"。
 *
 * 现在 `episode_resources` 是一等公民：一次写入即本集权威清单，读取直接命中，
 * 占位/缺失项只存在于快照里（不再绑镜头），生成侧只看到已定稿资产。
 * 唯一键 `(episode_id, kind, name)` 保证同一集同类同名只一行（schema.ts:3138-3152）。
 *
 * 快照与分镜绑定的分工：
 * - **快照** = 本集要哪些资源、各自匹配到谁（统计口径的唯一来源）；
 * - **分镜绑定** = 生成时该镜实际注入哪些参考图（仍写 `storyboard_assets`，
 *   因为批量投递按镜读参考图）。快照写好后再按"名字命中该镜"绑一次，两者不会互相污染。
 */

/** 竞品三分类（我方 project_assets.kind 的四值里 other 不参与匹配） */
export const MatchCategory: Record<number, "characters" | "scenes" | "props"> = {
  1: "characters",
  2: "scenes",
  3: "props",
};

const CATEGORY_KINDS: Record<"characters" | "scenes" | "props", number> = {
  characters: 1,
  scenes: 2,
  props: 3,
};

const KIND_BY_ASSET: Record<string, number> = {
  character: 1,
  scene: 2,
  prop: 3,
};

const KIND_NAMES: Record<number, string> = { 1: "character", 2: "scene", 3: "prop" };
const ASSET_KIND_BY_KIND: Record<number, string> = { 1: "character", 2: "scene", 3: "prop" };

/** 匹配项状态（episode.md:368-388 / _storyboard-asset-match.md:5） */
export const MatchEntryStatus = {
  DRAFT: 1, // 未定稿：有资产有提示词，但没过稿/没图
  MATCHED: 2, // 已匹配：定稿且有参考图
  MISSING: 3, // 缺失：快照里有条目但没有可用资产/提示词
} as const;

const ENTRY_STATUS_NAMES: Record<number, string> = {
  1: "unfinalized",
  2: "matched",
  3: "missing",
};

/** 集级匹配总状态；0 = 从未匹配（三闸门里的「匹配闸门」用它判未就绪） */
export const MatchStatus = {
  NONE: 0,
  PARTIAL: 1,
  MATCHED: 2,
  MISSING: 3,
} as const;

/** 提示词完备状态（project_assets.prompt_status，迁移 0031） */
export const PromptStatus = {
  IDLE: 0,
  GENERATING: 1,
  READY: 2,
  BLOCKED: 3,
} as const;

type ProjectRow = typeof scriptProjects.$inferSelect;
type EpisodeRow = typeof episodes.$inferSelect;
type ProjectAssetRow = typeof projectAssets.$inferSelect;
type StoryboardRow = typeof storyboards.$inferSelect;
type EpisodeResourceRow = typeof episodeResources.$inferSelect;

export interface MatchEntry {
  /** 快照条目 id（episode_resources.id）；用于回写/排错 */
  resource_row_id: string;
  resource_id: string | null;
  name: string;
  kind: number;
  kind_name: string;
  /** 1 未定稿 / 2 已匹配 / 3 缺失 */
  status: number;
  status_name: string;
  prompt: string | null;
  has_prompt: boolean;
  prompt_status: number;
  prompt_generating: boolean;
  prompt_blocked: boolean;
  file_id: string | null;
  ref_image_uri: string | null;
  ref_image_url: string | null;
  finalized_at: string | null;
  bound_shot_count: number;
  /** 7 项条件全满足才可智能补充 */
  supplementable: boolean;
}

export interface SaveResourceMatchesInput {
  resources: {
    characters: Array<{ resource_id: string; name?: string }>;
    scenes: Array<{ resource_id: string; name?: string }>;
    props: Array<{ resource_id: string; name?: string }>;
  };
}

@Injectable()
export class AssetMatchService {
  constructor(
    @Inject(LlmService) private readonly llm: LlmService,
    @Inject(StorageService) private readonly storage: StorageService,
  ) {}

  // ── 1. 执行匹配 ───────────────────────────────────────────────────────

  /**
   * 执行资产匹配：从本集内容抽出角色/场景/道具名称，命中项目资产则复用，未命中只落
   * **快照占位条目**（`project_asset_id = null` + `prompt = null`）——不再先建占位资产。
   *
   * 为什么不建占位资产：竞品"缺失项"在补充时才 `resource add`（`_storyboard-asset-match.md:37`），
   * 提前建资产会在资产库里留一堆空壳，且上轮正因为"占位项被绑到分镜"导致匹配后无法出片。
   * 补充流程（`supplementMissing`）会按 name+kind 建资产并回填快照条目的 `project_asset_id`。
   */
  async matchResources(
    spaceId: string,
    projectId: string,
    episodeId: string,
    input: { dry_run?: boolean } = {},
  ) {
    const { project, episode } = await this.loadScope(spaceId, projectId, episodeId);
    const dryRun = input.dry_run === true;

    const extracted = await this.llm.extractAssets({
      title: episode.title ?? project.title,
      synopsis: episode.synopsis ?? undefined,
      scriptText: episode.scriptText ?? undefined,
      sourceText: project.sourceText ?? undefined,
    });
    const candidates = [
      ...extracted.characters.map((item) => ({ kind: 1, ...item })),
      ...extracted.scenes.map((item) => ({ kind: 2, ...item })),
      ...extracted.props.map((item) => ({ kind: 3, ...item })),
    ].filter((item) => item.name.trim().length > 0 && KIND_NAMES[item.kind]);

    const existingAssets = await db
      .select()
      .from(projectAssets)
      .where(eq(projectAssets.projectId, project.id));
    const byKindName = new Map(
      existingAssets.map((row) => [`${this.kindOf(row)}:${row.name.trim()}`, row]),
    );

    const plan = candidates.map((candidate) => {
      const asset = byKindName.get(`${candidate.kind}:${candidate.name.trim()}`) ?? null;
      return {
        kind: candidate.kind,
        name: candidate.name.trim(),
        projectAssetId: asset?.id ?? null,
        // 快照里的 prompt 以资产为准；无资产时留空 —— 空 prompt 是"可智能补充"的前置条件之一
        prompt: asset?.prompt ?? null,
      };
    });

    if (!dryRun) {
      // 逐类重写本集该类的快照（fresh match 语义：这次匹配算出来的就是这一类的新清单）
      const kinds = [...new Set(plan.map((row) => row.kind))];
      await db.transaction(async (tx) => {
        for (const kind of kinds) {
          const rows = plan.filter((row) => row.kind === kind);
          await tx
            .delete(episodeResources)
            .where(and(eq(episodeResources.episodeId, episode.id), eq(episodeResources.kind, kind)));
          if (rows.length > 0) {
            await tx.insert(episodeResources).values(
              rows.map((row, index) => ({
                id: newId(),
                episodeId: episode.id,
                spaceId: BigInt(spaceId),
                kind: row.kind,
                projectAssetId: row.projectAssetId,
                name: row.name,
                prompt: row.prompt,
                sort: index,
              })),
            );
          }
        }
      });
      // 只把"已定稿且有参考图"的资产绑到分镜（缺失/未定稿项只活在快照里）
      await this.bindFinalizedToShots(episode);
    }

    const summary = await this.computeMatch(project, episode);
    return {
      dry_run: dryRun,
      status: summary.status,
      status_name: this.statusName(summary.status),
      // 兼容上轮字段名（前端已在用）：本轮不再创建占位资产，恒为空数组
      created_placeholders: [] as string[],
      reused_assets: plan
        .filter((row) => row.projectAssetId !== null)
        .map((row) => String(row.projectAssetId)),
      matched: plan.filter((row) => row.projectAssetId !== null).length,
      missing: plan.filter((row) => row.projectAssetId === null).length,
      candidates: plan.map((row) => ({ kind: KIND_NAMES[row.kind], name: row.name })),
      counts: summary.counts,
    };
  }

  // ── 2. 匹配结果（从快照读）────────────────────────────────────────────

  async matchResult(spaceId: string, projectId: string, episodeId: string) {
    const { project, episode } = await this.loadScope(spaceId, projectId, episodeId);
    const summary = await this.computeMatch(project, episode);
    return {
      ep_id: String(episode.id),
      status: summary.status,
      status_name: this.statusName(summary.status),
      // 三态统计与快照一致（判据 §2）
      counts: summary.counts,
      totals: summary.totals,
      characters: summary.byCategory.characters,
      scenes: summary.byCategory.scenes,
      props: summary.byCategory.props,
      snapshot: {
        // 快照落库时间（本集最后一次匹配/保存）：没有行时为 null
        populated: summary.rows.length > 0,
        row_count: summary.rows.length,
      },
      supplement: {
        // 竞品三选项；默认第三项（保持现状）——不选就走主流程，不阻塞分镜确认
        options: [
          {
            value: "smart-supplement",
            label: "智能补充缺失资产",
            default: false,
            destructive: false,
            target_count: summary.supplementTargets.length,
            targets: summary.supplementTargets.map((entry) => ({
              resource_id: entry.resource_id,
              kind: entry.kind_name,
              name: entry.name,
            })),
            qty: 1,
          },
          {
            value: "rematch",
            label: "重新匹配",
            default: false,
            destructive: true,
            note: "match-reset 会清空本集快照与全部分镜资产绑定；一次选择只重跑一次",
          },
          {
            value: "keep",
            label: "保持现状，进入分镜确认",
            default: true,
            destructive: false,
          },
        ],
        target_count: summary.supplementTargets.length,
        reusable_count: 0,
        needs_image_count: summary.supplementTargets.length,
      },
    };
  }

  // ── 3. 匹配重置 ───────────────────────────────────────────────────────

  /** 破坏性：清空本集快照 + 全部分镜资产绑定（`subject.md:228-250`）；先 dry-run 可预演 */
  async resetMatches(
    spaceId: string,
    projectId: string,
    episodeId: string,
    input: { dry_run?: boolean } = {},
  ) {
    const { episode } = await this.loadScope(spaceId, projectId, episodeId);
    const shots = await this.shotsOf(episode.id);
    const shotIds = shots.map((shot) => shot.id);
    const linked = shotIds.length
      ? await db.select().from(storyboardAssets).where(inArray(storyboardAssets.storyboardId, shotIds))
      : [];
    const snapshotRows = await this.readSnapshot(episode.id);
    if (input.dry_run === true) {
      return {
        dry_run: true,
        would_remove: linked.length,
        would_remove_resources: snapshotRows.length,
        shot_count: shots.length,
      };
    }
    await db.transaction(async (tx) => {
      await tx.delete(episodeResources).where(eq(episodeResources.episodeId, episode.id));
      if (shotIds.length > 0) {
        await tx.delete(storyboardAssets).where(inArray(storyboardAssets.storyboardId, shotIds));
      }
    });
    return {
      dry_run: false,
      removed: linked.length,
      removed_resources: snapshotRows.length,
      shot_count: shots.length,
    };
  }

  // ── 4. 保存匹配（完整快照）────────────────────────────────────────────

  /**
   * `PUT episode/:ep_id/resources` 的等价实现，**完整快照语义**（本轮落到 `episode_resources`）：
   * - 三类数组必须**同时给**（控制器 zod 已强制），空类别显式 `[]` 表示"该类清空"；
   * - 漏传类别由控制器直接 400101，**不会**被清空；
   * - 只接受本项目资产；跨项目/不存在一律 400101（不泄露其它项目资产是否存在）；
   * - 类别内先整类删除再按入参顺序重建 → 重复提交同一快照是幂等的。
   */
  async saveResourceMatches(
    spaceId: string,
    projectId: string,
    episodeId: string,
    input: SaveResourceMatchesInput,
  ) {
    const { project, episode } = await this.loadScope(spaceId, projectId, episodeId);
    const categories: Array<{ key: keyof SaveResourceMatchesInput["resources"]; kind: number }> = [
      { key: "characters", kind: CATEGORY_KINDS.characters },
      { key: "scenes", kind: CATEGORY_KINDS.scenes },
      { key: "props", kind: CATEGORY_KINDS.props },
    ];

    // 归一 + 校验（全部先校验，任何一项不合法 → 零写入）
    const resolved = new Map<number, ProjectAssetRow[]>();
    for (const category of categories) {
      const entries = input.resources[category.key] ?? [];
      const rows: ProjectAssetRow[] = [];
      const seen = new Set<string>();
      for (const [index, entry] of entries.entries()) {
        let id: bigint;
        try {
          id = BigInt(entry.resource_id);
        } catch {
          throw new AppError(
            ErrorCode.INVALID_PARAM,
            `resources.${category.key}[${index}] invalid resource_id`,
            { field: `resources.${category.key}` },
          );
        }
        const key = String(id);
        if (seen.has(key)) continue;
        seen.add(key);
        const [row] = await db
          .select()
          .from(projectAssets)
          .where(and(eq(projectAssets.id, id), eq(projectAssets.projectId, project.id)));
        if (!row) {
          throw new AppError(
            ErrorCode.INVALID_PARAM,
            `resources.${category.key}[${index}] does not exist in this project`,
            { field: `resources.${category.key}`, resource_id: key },
          );
        }
        if (this.kindOf(row) !== category.kind) {
          throw new AppError(
            ErrorCode.INVALID_PARAM,
            `resources.${category.key}[${index}] is not a ${KIND_NAMES[category.kind]}`,
            { field: `resources.${category.key}`, resource_id: key },
          );
        }
        rows.push(row);
      }
      resolved.set(category.kind, rows);
    }

    // 写快照 + 绑定已定稿项（单事务：快照与绑定不能一半新一半旧）
    await db.transaction(async (tx) => {
      for (const category of categories) {
        const rows = resolved.get(category.kind) ?? [];
        await tx
          .delete(episodeResources)
          .where(and(eq(episodeResources.episodeId, episode.id), eq(episodeResources.kind, category.kind)));
        if (rows.length > 0) {
          await tx.insert(episodeResources).values(
            rows.map((row, index) => ({
              id: newId(),
              episodeId: episode.id,
              spaceId: BigInt(spaceId),
              kind: category.kind,
              projectAssetId: row.id,
              name: row.name.trim(),
              prompt: row.prompt ?? null,
              sort: index,
            })),
          );
        }
      }
    });
    // 绑定同步到分镜（只绑已定稿；快照里未定稿的条目不绑，避免"匹配后出不了片"）
    await this.bindFinalizedToShots(episode);

    const summary = await this.computeMatch(project, episode);
    return {
      ep_id: String(episode.id),
      status: summary.status,
      status_name: this.statusName(summary.status),
      counts: summary.counts,
      snapshot: {
        characters: (input.resources.characters ?? []).map((entry) => entry.resource_id),
        scenes: (input.resources.scenes ?? []).map((entry) => entry.resource_id),
        props: (input.resources.props ?? []).map((entry) => entry.resource_id),
      },
    };
  }

  // ── 5. 缺失资产智能补充 ───────────────────────────────────────────────

  /**
   * 智能补充（`_storyboard-asset-match.md:7-46`）。
   *
   * **7 项条件**（本轮用 `prompt_status` 真正实现第 6、7 条）：
   * 1. 类型 ∈ 角色/场景/道具；
   * 2. 有 resource_id —— 我方快照模型下无资产的缺失条目等价"可按 name+kind 落资源"
   *    （竞品是匹配时就建了占位 resource；我方在补充时才 `resource add`，见执行顺序 ③）；
   * 3. `status=3`（缺失）；
   * 4. `name` 非空；
   * 5. prompt 为空；
   * 6. `prompt_generating` 不为真 = `prompt_status !== 1`（生成中）；
   * 7. `prompt_blocked` 不为真 = `prompt_status !== 3`（内容安全拦截）。
   *
   * **执行顺序**：①提示词补全 → ②轮询（同步调用无需轮询）→ ③查重 → ④`resource add`
   * （无资产时建资产）/ 需要生图的目标交给既有 `generate-image`（**不在这里扣费**：
   * 证据要求生图前单独展示账单）→ ⑤成功项绑回分镜。
   * 失败项保持未匹配、不重复提交已成功项、**不自动 match-reset**。
   */
  async supplementMissing(
    spaceId: string,
    projectId: string,
    episodeId: string,
    input: { asset_ids?: string[]; dry_run?: boolean } = {},
  ) {
    const { project, episode } = await this.loadScope(spaceId, projectId, episodeId);
    const summary = await this.computeMatch(project, episode);
    const wanted = input.asset_ids ? new Set(input.asset_ids.map((id) => id.trim()).filter(Boolean)) : null;
    const targets = summary.supplementTargets.filter(
      (entry) => !wanted || (entry.resource_id !== null && wanted.has(entry.resource_id)),
    );
    if (targets.length === 0) {
      return {
        dry_run: input.dry_run === true,
        targets: [],
        completed: [],
        reused: [],
        pending_image: [],
        failed: [],
        notes: ["no supplementable target (7 conditions not met)"],
      };
    }
    const plan = targets.map((entry) => ({
      resource_id: entry.resource_id,
      resource_row_id: entry.resource_row_id,
      kind: entry.kind_name,
      name: entry.name,
    }));
    if (input.dry_run === true) {
      return {
        dry_run: true,
        targets: plan,
        completed: [],
        reused: [],
        pending_image: plan,
        failed: [],
        notes: ["dry-run: prompt completion and resource creation were not executed"],
      };
    }

    // ① 提示词补全：复用同一套抽取入口（mock 下同输入同输出，便于幂等复跑）
    const promptByKindName = new Map<string, string>();
    let blockedByModeration = false;
    try {
      const extracted = await this.llm.extractAssets({
        title: episode.title ?? project.title,
        synopsis: episode.synopsis ?? undefined,
        scriptText: episode.scriptText ?? undefined,
        sourceText: project.sourceText ?? undefined,
      });
      for (const item of [
        ...extracted.characters.map((entry) => ({ kind: 1, ...entry })),
        ...extracted.scenes.map((entry) => ({ kind: 2, ...entry })),
        ...extracted.props.map((entry) => ({ kind: 3, ...entry })),
      ]) {
        const prompt = (item.prompt ?? "").trim();
        if (prompt) promptByKindName.set(`${item.kind}:${item.name.trim()}`, prompt);
      }
    } catch (error) {
      // 745802 = LLM 输出未过审：这些目标被"拦截"，必须落 prompt_status=3，
      // 否则下一次智能补充还会重复尝试同一批被拦内容（证据里的 prompt_blocked 语义）
      if (error instanceof AppError && error.code === ErrorCode.OUTPUT_REJECTED) blockedByModeration = true;
      else throw error;
    }

    const completed: Array<{ resource_id: string | null; name: string; action: string }> = [];
    const reused: Array<{ resource_id: string; name: string; reused_from: string }> = [];
    const pendingImage: Array<{ resource_id: string; name: string; kind: string; prompt: string }> = [];
    const failed: Array<{ resource_id: string | null; name: string; reason: string }> = [];
    const shots = await this.shotsOf(episode.id);

    for (const target of targets) {
      const snapshotKey = { kind: target.kind, name: target.name };
      if (blockedByModeration) {
        await this.markPromptStatus(spaceId, project.id, snapshotKey, PromptStatus.BLOCKED, null);
        failed.push({ resource_id: target.resource_id, name: target.name, reason: "output_rejected" });
        continue;
      }
      const prompt = promptByKindName.get(`${target.kind}:${target.name}`) ?? null;
      if (!prompt) {
        failed.push({ resource_id: target.resource_id, name: target.name, reason: "prompt_unavailable" });
        continue;
      }
      // ③ 查重：同类同名且已定稿的正式资产可直接复用，不重复建资产/生图
      const [reusable] = await db
        .select()
        .from(projectAssets)
        .where(
          and(
            eq(projectAssets.projectId, project.id),
            eq(projectAssets.kind, ASSET_KIND_BY_KIND[target.kind]!),
            eq(projectAssets.name, target.name),
            eq(projectAssets.status, ProjectAssetStatus.FINALIZED),
            sql`${projectAssets.refImageUri} is not null`,
          ),
        )
        .limit(1);
      if (reusable) {
        await this.linkSnapshotRow(episode.id, spaceId, snapshotKey, reusable.id, reusable.prompt ?? prompt);
        await this.bindAssetToShots(shots, reusable);
        reused.push({ resource_id: String(reusable.id), name: target.name, reused_from: String(reusable.id) });
        completed.push({ resource_id: String(reusable.id), name: target.name, action: "reused_finalized_asset" });
        continue;
      }

      // ④ resource add：快照条目已有资产 → 只回填提示词；没有资产 → 建一个草稿资产
      let assetId: bigint;
      if (target.resource_id) {
        assetId = BigInt(target.resource_id);
        await db
          .update(projectAssets)
          .set({ prompt, promptStatus: PromptStatus.READY, updatedAt: new Date() })
          .where(eq(projectAssets.id, assetId));
      } else {
        const [created] = await db
          .insert(projectAssets)
          .values({
            id: newId(),
            projectId: project.id,
            kind: ASSET_KIND_BY_KIND[target.kind]!,
            name: target.name,
            prompt,
            promptStatus: PromptStatus.READY,
            status: ProjectAssetStatus.DRAFT,
          })
          .returning();
        if (!created) {
          failed.push({ resource_id: null, name: target.name, reason: "resource_create_failed" });
          continue;
        }
        assetId = created.id;
      }
      await this.linkSnapshotRow(episode.id, spaceId, snapshotKey, assetId, prompt);
      pendingImage.push({
        resource_id: String(assetId),
        name: target.name,
        kind: target.kind_name,
        prompt,
      });
    }

    // ⑤ 让已就绪项重新参与匹配（只绑已定稿资产；待生图项保持未定稿）
    await this.bindFinalizedToShots(episode);
    const after = await this.computeMatch(project, episode);
    return {
      dry_run: false,
      targets: plan,
      completed,
      reused,
      pending_image: pendingImage,
      failed,
      status: after.status,
      status_name: this.statusName(after.status),
      counts: after.counts,
      next_actions: pendingImage.map((item) => ({
        action: "generate-image",
        method: "POST",
        path: `/projects/{project_id}/assets/${item.resource_id}/generate-image`,
        resource_id: item.resource_id,
        kind: item.kind,
        qty: 1,
        note: "生图前须展示报价并取得确认；本接口不代扣积分",
      })),
    };
  }

  // ── 内部：匹配计算（快照 → 三态）───────────────────────────────────────

  /**
   * 集级匹配状态（供三闸门直接读）。
   *
   * 口径：**快照是权威**。仅当本集从未写过快照时回落到"分镜绑定"（历史项目兼容），
   * 否则历史项目会因"没跑过匹配"而整体无法投递。回落不算统计口径——`match-result` 永远只读快照。
   */
  async statusOf(projectId: bigint, episodeId: bigint): Promise<number> {
    const [project] = await db.select().from(scriptProjects).where(eq(scriptProjects.id, projectId));
    const [episode] = await db.select().from(episodes).where(eq(episodes.id, episodeId));
    if (!project || !episode) return MatchStatus.NONE;
    const summary = await this.computeMatch(project, episode);
    if (summary.rows.length > 0) return summary.status;
    // 历史项目兼容：没有快照时用绑定判"有没有可用匹配信息"
    const shots = await this.shotsOf(episode.id);
    if (shots.length === 0) return MatchStatus.NONE;
    const links = await db
      .select()
      .from(storyboardAssets)
      .where(inArray(storyboardAssets.storyboardId, shots.map((shot) => shot.id)));
    if (links.length === 0) return MatchStatus.NONE;
    const assetIds = [...new Set(links.map((link) => String(link.projectAssetId)))].map((id) => BigInt(id));
    const assets = await db
      .select()
      .from(projectAssets)
      .where(inArray(projectAssets.id, assetIds));
    const anyDraft = assets.some((row) => row.status !== ProjectAssetStatus.FINALIZED || !row.refImageUri);
    return anyDraft ? MatchStatus.PARTIAL : MatchStatus.MATCHED;
  }

  private async readSnapshot(episodeId: bigint): Promise<EpisodeResourceRow[]> {
    return db
      .select()
      .from(episodeResources)
      .where(eq(episodeResources.episodeId, episodeId))
      .orderBy(episodeResources.kind, episodeResources.sort, episodeResources.id);
  }

  private async computeMatch(project: ProjectRow, episode: EpisodeRow) {
    const rows = await this.readSnapshot(episode.id);
    const shots = await this.shotsOf(episode.id);
    const shotIds = shots.map((shot) => shot.id);
    const links = shotIds.length
      ? await db.select().from(storyboardAssets).where(inArray(storyboardAssets.storyboardId, shotIds))
      : [];
    const boundCount = new Map<string, number>();
    for (const link of links) {
      const key = String(link.projectAssetId);
      boundCount.set(key, (boundCount.get(key) ?? 0) + 1);
    }
    const assetIds = rows
      .map((row) => row.projectAssetId)
      .filter((id): id is bigint => Boolean(id));
    const assets = assetIds.length
      ? await db
          .select()
          .from(projectAssets)
          .where(
            and(
              inArray(projectAssets.id, assetIds),
              eq(projectAssets.projectId, project.id),
            ),
          )
      : [];
    const assetById = new Map(assets.map((row) => [String(row.id), row]));
    const inFlightTaskIds = await this.inFlightTaskIds(assets.map((row) => row.sourceTaskId));

    const byCategory: Record<"characters" | "scenes" | "props", MatchEntry[]> = {
      characters: [],
      scenes: [],
      props: [],
    };
    const supplementTargets: MatchEntry[] = [];

    for (const row of rows) {
      const asset = row.projectAssetId ? (assetById.get(String(row.projectAssetId)) ?? null) : null;
      const promptText = (row.prompt ?? asset?.prompt ?? "").trim();
      const finalized = Boolean(
        asset && asset.status === ProjectAssetStatus.FINALIZED && asset.refImageUri,
      );
      const status = finalized
        ? MatchEntryStatus.MATCHED
        : promptText.length > 0
          ? MatchEntryStatus.DRAFT
          : MatchEntryStatus.MISSING;
      const promptStatus = asset?.promptStatus ?? PromptStatus.IDLE;
      const promptGenerating =
        promptStatus === PromptStatus.GENERATING ||
        Boolean(asset?.sourceTaskId && inFlightTaskIds.has(String(asset.sourceTaskId)));
      const promptBlocked = promptStatus === PromptStatus.BLOCKED;
      const entry: MatchEntry = {
        resource_row_id: String(row.id),
        resource_id: row.projectAssetId ? String(row.projectAssetId) : null,
        name: row.name,
        kind: row.kind,
        kind_name: KIND_NAMES[row.kind] ?? "unknown",
        status,
        status_name: ENTRY_STATUS_NAMES[status] ?? "unknown",
        prompt: promptText.length > 0 ? promptText : null,
        has_prompt: promptText.length > 0,
        prompt_status: promptStatus,
        prompt_generating: promptGenerating,
        prompt_blocked: promptBlocked,
        file_id: asset?.portraitAssetId ? String(asset.portraitAssetId) : null,
        ref_image_uri: asset?.refImageUri ?? null,
        ref_image_url: asset?.refImageUri
          ? await this.storage
              .signDownload(String(project.spaceId), asset.refImageUri, 3600)
              .catch(() => null)
          : null,
        finalized_at: asset?.finalizedAt ? asset.finalizedAt.toISOString() : null,
        bound_shot_count: row.projectAssetId ? (boundCount.get(String(row.projectAssetId)) ?? 0) : 0,
        // 7 条件：类型 ∈ 角色/场景/道具 · 可解析为待补资源 · status=3 · name 非空 ·
        //          prompt 为空 · prompt_generating 不为真 · prompt_blocked 不为真
        supplementable:
          status === MatchEntryStatus.MISSING &&
          row.name.trim().length > 0 &&
          validatedKind(row.kind) &&
          !promptGenerating &&
          !promptBlocked,
      };
      byCategory[MatchCategory[row.kind]!].push(entry);
      if (entry.supplementable) supplementTargets.push(entry);
    }

    const counts: Record<
      "characters" | "scenes" | "props",
      { total: number; matched: number; unfinalized: number; missing: number; supplementable: number }
    > = {
      characters: { total: 0, matched: 0, unfinalized: 0, missing: 0, supplementable: 0 },
      scenes: { total: 0, matched: 0, unfinalized: 0, missing: 0, supplementable: 0 },
      props: { total: 0, matched: 0, unfinalized: 0, missing: 0, supplementable: 0 },
    };
    for (const category of ["characters", "scenes", "props"] as const) {
      const entries = byCategory[category];
      counts[category] = {
        total: entries.length,
        matched: entries.filter((entry) => entry.status === MatchEntryStatus.MATCHED).length,
        unfinalized: entries.filter((entry) => entry.status === MatchEntryStatus.DRAFT).length,
        missing: entries.filter((entry) => entry.status === MatchEntryStatus.MISSING).length,
        supplementable: entries.filter((entry) => entry.supplementable).length,
      };
    }
    const totals = {
      total: counts.characters.total + counts.scenes.total + counts.props.total,
      matched: counts.characters.matched + counts.scenes.matched + counts.props.matched,
      unfinalized:
        counts.characters.unfinalized + counts.scenes.unfinalized + counts.props.unfinalized,
      missing: counts.characters.missing + counts.scenes.missing + counts.props.missing,
      supplementable:
        counts.characters.supplementable +
        counts.scenes.supplementable +
        counts.props.supplementable,
    };
    // 总状态：快照为空 → 0（从未匹配）；缺失(3) > 未定稿(1) > 已匹配(2)
    const status =
      rows.length === 0
        ? MatchStatus.NONE
        : totals.missing > 0
          ? MatchStatus.MISSING
          : totals.unfinalized > 0
            ? MatchStatus.PARTIAL
            : MatchStatus.MATCHED;
    return { status, counts, totals, byCategory, supplementTargets, rows };
  }

  // ── 内部：快照读写 ────────────────────────────────────────────────────

  /** 把快照某一条目指向某个资产（补充流程在补全提示词/复用/建资产后回填） */
  private async linkSnapshotRow(
    episodeId: bigint,
    spaceId: string,
    key: { kind: number; name: string },
    assetId: bigint,
    prompt: string,
  ): Promise<void> {
    await db
      .update(episodeResources)
      .set({ projectAssetId: assetId, prompt, updatedAt: new Date() })
      .where(
        and(
          eq(episodeResources.episodeId, episodeId),
          eq(episodeResources.kind, key.kind),
          eq(episodeResources.name, key.name),
        ),
      );
    void spaceId;
  }

  /** `prompt_status` 写入钩子（被内容安全拦截时置 3，成功补全时置 2） */
  private async markPromptStatus(
    spaceId: string,
    projectId: bigint,
    key: { kind: number; name: string },
    promptStatus: number,
    prompt: string | null,
  ): Promise<void> {
    const assetKind = ASSET_KIND_BY_KIND[key.kind]!;
    await db
      .update(projectAssets)
      .set({
        promptStatus,
        ...(prompt === null ? {} : { prompt }),
        updatedAt: new Date(),
      })
      .where(and(eq(projectAssets.projectId, projectId), eq(projectAssets.kind, assetKind), eq(projectAssets.name, key.name)));
    void spaceId;
  }

  // ── 内部：分镜绑定（只绑已定稿）───────────────────────────────────────

  /** 把快照里已定稿且有参考图的资产按名称提及关系绑到分镜（幂等，可反复调用） */
  private async bindFinalizedToShots(episode: EpisodeRow): Promise<number> {
    const shots = await this.shotsOf(episode.id);
    if (shots.length === 0) return 0;
    const rows = await this.readSnapshot(episode.id);
    const assetIds = rows.map((row) => row.projectAssetId).filter((id): id is bigint => Boolean(id));
    if (assetIds.length === 0) return 0;
    const assets = await db.select().from(projectAssets).where(inArray(projectAssets.id, assetIds));
    const ready = assets.filter(
      (row) => this.kindOf(row) && row.status === ProjectAssetStatus.FINALIZED && Boolean(row.refImageUri),
    );
    return this.bindAssetsToShots(episode, ready);
  }

  private async bindAssetsToShots(episode: EpisodeRow, assets: ProjectAssetRow[]): Promise<number> {
    const shots = await this.shotsOf(episode.id);
    if (shots.length === 0 || assets.length === 0) return 0;
    const shotIds = shots.map((shot) => shot.id);
    const existing = await db
      .select()
      .from(storyboardAssets)
      .where(inArray(storyboardAssets.storyboardId, shotIds));
    const existingKeys = new Set(existing.map((link) => `${link.storyboardId}:${link.projectAssetId}`));
    const values: Array<{ storyboardId: bigint; projectAssetId: bigint }> = [];
    for (const asset of assets) {
      for (const shotId of this.targetShotIdsFor(shots, asset)) {
        const key = `${shotId}:${asset.id}`;
        if (existingKeys.has(key)) continue;
        existingKeys.add(key);
        values.push({ storyboardId: shotId, projectAssetId: asset.id });
      }
    }
    if (values.length > 0) {
      await db.insert(storyboardAssets).values(values).onConflictDoNothing();
    }
    return values.length;
  }

  private async bindAssetToShots(shots: StoryboardRow[], asset: ProjectAssetRow): Promise<number> {
    const targets = this.targetShotIdsFor(shots, asset);
    if (targets.length === 0) return 0;
    await db
      .insert(storyboardAssets)
      .values(targets.map((shotId) => ({ storyboardId: shotId, projectAssetId: asset.id })))
      .onConflictDoNothing();
    return targets.length;
  }

  /**
   * 某资产应绑哪些镜：名称被分镜文案点到的镜；一镜都没点名时退化为全集
   * （与竞品「集级资产用于该集所有镜」等义，见文件头差异说明）。
   */
  private targetShotIdsFor(shots: StoryboardRow[], asset: ProjectAssetRow): bigint[] {
    const name = asset.name.trim().toLowerCase();
    if (!name) return [];
    const mentioned = shots.filter((shot) =>
      `${shot.shotDesc ?? ""}\n${shot.videoPrompt ?? ""}`.toLowerCase().includes(name),
    );
    if (mentioned.length > 0) return mentioned.map((shot) => shot.id);
    return shots.map((shot) => shot.id);
  }

  private async inFlightTaskIds(taskIds: Array<bigint | null>): Promise<Set<string>> {
    const ids = taskIds.filter((id): id is bigint => Boolean(id));
    if (ids.length === 0) return new Set();
    const rows = await db
      .select({ id: tasks.id, status: tasks.status })
      .from(tasks)
      .where(inArray(tasks.id, ids));
    return new Set(
      rows
        .filter((row) => row.status === TaskStatus.PENDING || row.status === TaskStatus.RUNNING)
        .map((row) => String(row.id)),
    );
  }

  private kindOf(row: ProjectAssetRow): number {
    return KIND_BY_ASSET[row.kind] ?? 0;
  }

  private statusName(status: number): string {
    return ["none", "partial", "matched", "missing"][status] ?? "unknown";
  }

  private async shotsOf(episodeId: bigint): Promise<StoryboardRow[]> {
    return db
      .select()
      .from(storyboards)
      .where(eq(storyboards.episodeId, episodeId))
      .orderBy(storyboards.shotNo);
  }

  private async loadScope(spaceId: string, projectId: string, episodeId: string) {
    const project = await this.findProject(spaceId, projectId);
    const episode = await this.findEpisode(project.id, episodeId);
    return { project, episode };
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
}

function validatedKind(kind: number): boolean {
  return kind === 1 || kind === 2 || kind === 3;
}
