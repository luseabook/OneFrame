import { Inject, Injectable } from "@nestjs/common";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
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
 * - `episode.md:261-300` `episode match-resources` 是**资产匹配 + 自动拆分镜的组合任务**，
 *   受理成功只代表任务已创建；确认成功要逐集轮询 `match-result` 到 `data.status=2`；
 * - `_storyboard-asset-match.md:5` `match-result` 的 `characters[]/scenes[]/props[]` 三项计数：
 *   `status=2` 已匹配 / `status=1` 未定稿 / `status=3` 缺失；
 * - `episode.md:368-388` `save-resource-matches`：`PUT episode/:ep_id/resources`，
 *   **完整快照语义**——必须同时给 `characters/scenes/props` 三个数组，空类别显式传 `[]`；
 *   只发增量会让服务端把漏传类别清空；
 * - `subject.md:228-250` `match-reset`（`POST df/episode/:ep_id/resources/match-reset`）是
 *   破坏性动作，先 dry-run 提示、一次选择只重跑一次；
 * - `_storyboard-asset-match.md:7-17` 智能补充 7 项条件 + 三选项（补 / 重匹配 / 保持现状，默认第三）；
 * - `storyboard.md:308-310` 参考资产按表格顺序转成 `images`，提示词中的名称转 `[[@imgN]]`。
 *
 * 我方数据模型与竞品的**关键差异**（必须在回报里登记）：竞品的匹配清单是「集级
 * resources 数组」；我方落库只有分镜级 `storyboard_assets`。因此：
 * 1. 集级清单用「分镜绑定 ∪ 本集文本/提示词里出现的项目资产」投影出来（可复现、无需额外表）；
 * 2. `save-resource-matches` 按快照整类替换绑定，类别内每个资产绑到「提示词里点到名的镜」，
 *    若全都没点名则绑到本集全部分镜（与竞品「集级资产用于该集所有镜」等义）。
 */

/** 竞品三分类（我方 project_assets.kind 的四值里 other 不参与匹配） */
export const MatchCategory: Record<number, "characters" | "scenes" | "props"> = {
  1: "characters",
  2: "scenes",
  3: "props",
};

const KIND_BY_ASSET: Record<string, number> = {
  character: 1,
  scene: 2,
  prop: 3,
};

const KIND_NAMES: Record<number, string> = { 1: "character", 2: "scene", 3: "prop" };

/** 匹配项状态（episode.md:368-388 / _storyboard-asset-match.md:5） */
export const MatchEntryStatus = {
  DRAFT: 1, // 未定稿：有资产有提示词，但没过稿/没图
  MATCHED: 2, // 已匹配：定稿且有参考图
  MISSING: 3, // 缺失：只有占位资产，没有提示词
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

type ProjectRow = typeof scriptProjects.$inferSelect;
type EpisodeRow = typeof episodes.$inferSelect;
type ProjectAssetRow = typeof projectAssets.$inferSelect;
type StoryboardRow = typeof storyboards.$inferSelect;

export interface MatchEntry {
  resource_id: string;
  name: string;
  kind: number;
  kind_name: string;
  /** 1 未定稿 / 2 已匹配 / 3 缺失 */
  status: number;
  status_name: string;
  prompt: string | null;
  has_prompt: boolean;
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
   * 执行资产匹配：从本集内容抽出需要的角色/场景/道具名称，命中项目资产则复用，
   * 未命中则建**占位资产**（未定稿、无提示词 —— 这正是「缺失」的形态，也是智能补充的输入）。
   *
   * 匹配清单里的资产（**含未定稿占位项**）全部绑到镜：绑定是我方唯一可落的「集级匹配清单」
   * 载体（竞品是集级 resources 数组 + 独立表，我方没有）。未定稿项绑上后生成侧会被
   * 400105 拦住 —— 这正是「未定稿/缺失不得用于生成」的语义：先补资产再出片。
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

    const existing = await db
      .select()
      .from(projectAssets)
      .where(eq(projectAssets.projectId, project.id));
    const byKindName = new Map(existing.map((row) => [`${this.kindOf(row)}:${row.name.trim()}`, row]));

    const created: string[] = [];
    const reused: string[] = [];
    const matchRows: ProjectAssetRow[] = [];
    if (!dryRun) {
      for (const candidate of candidates) {
        const key = `${candidate.kind}:${candidate.name.trim()}`;
        const known = byKindName.get(key);
        if (known) {
          reused.push(String(known.id));
          matchRows.push(known);
          continue;
        }
        const [row] = await db
          .insert(projectAssets)
          .values({
            id: newId(),
            projectId: project.id,
            kind: KIND_NAMES[candidate.kind]!,
            name: candidate.name.trim(),
            description: candidate.description ?? null,
            // 占位资产**不写提示词**：prompt 为空是「可智能补充」的前置条件之一
            prompt: null,
            status: ProjectAssetStatus.DRAFT,
          })
          .returning();
        if (!row) throw new AppError(ErrorCode.INTERNAL, "failed to create placeholder asset");
        byKindName.set(key, row);
        matchRows.push(row);
        created.push(String(row.id));
      }
      await this.bindAssetsToShots(episode, matchRows);
    }

    const summary = await this.computeMatch(project, episode);
    return {
      dry_run: dryRun,
      // 组合任务里的「资产匹配」半段：自动拆分镜由 storyboards/generate 另行触发
      status: summary.status,
      status_name: this.statusName(summary.status),
      created_placeholders: created,
      reused_assets: reused,
      candidates: candidates.map((item) => ({ kind: KIND_NAMES[item.kind], name: item.name })),
      counts: summary.counts,
    };
  }

  // ── 2. 匹配结果 ───────────────────────────────────────────────────────

  async matchResult(spaceId: string, projectId: string, episodeId: string) {
    const { project, episode } = await this.loadScope(spaceId, projectId, episodeId);
    const summary = await this.computeMatch(project, episode);
    return {
      ep_id: String(episode.id),
      status: summary.status,
      status_name: this.statusName(summary.status),
      // 三态统计与实际一致（completion-plan §2 判据）
      counts: summary.counts,
      totals: summary.totals,
      characters: summary.byCategory.characters,
      scenes: summary.byCategory.scenes,
      props: summary.byCategory.props,
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
            note: "match-reset 会清空本集全部分镜资产绑定；一次选择只重跑一次",
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

  /** 破坏性：清空本集全部分镜的资产绑定（`subject.md:228-250`）；先 dry-run 可预演 */
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
      ? await db
          .select()
          .from(storyboardAssets)
          .where(inArray(storyboardAssets.storyboardId, shotIds))
      : [];
    if (input.dry_run === true) {
      return { dry_run: true, would_remove: linked.length, shot_count: shots.length };
    }
    if (shotIds.length > 0) {
      await db.delete(storyboardAssets).where(inArray(storyboardAssets.storyboardId, shotIds));
    }
    return { dry_run: false, removed: linked.length, shot_count: shots.length };
  }

  // ── 4. 保存匹配（完整快照）────────────────────────────────────────────

  /**
   * `PUT episode/:ep_id/resources` 的等价实现，**完整快照语义**：
   * - `characters` / `scenes` / `props` 三个数组必须**同时给**（控制器 zod 已强制），
   *   空类别显式传 `[]` 表示"该类清空"；漏传类别由控制器直接 400101，**不会**被清空；
   * - 只接受本项目资产；跨项目/不存在一律 400101（不泄露其它项目资产是否存在）；
   * - 类别内先整类解绑，再按新数组重建绑定 → 重复提交同一快照是幂等的。
   */
  async saveResourceMatches(
    spaceId: string,
    projectId: string,
    episodeId: string,
    input: SaveResourceMatchesInput,
  ) {
    const { project, episode } = await this.loadScope(spaceId, projectId, episodeId);
    const shots = await this.shotsOf(episode.id);
    const shotIds = shots.map((shot) => shot.id);

    const categories: Array<{ key: keyof SaveResourceMatchesInput["resources"]; kind: number }> = [
      { key: "characters", kind: 1 },
      { key: "scenes", kind: 2 },
      { key: "props", kind: 3 },
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
          throw new AppError(ErrorCode.INVALID_PARAM, `resources.${category.key}[${index}] invalid resource_id`, {
            field: `resources.${category.key}`,
          });
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

    // 写：按类别整类替换（快照）
    await db.transaction(async (tx) => {
      if (shotIds.length === 0) return;
      const kindSet = [1, 2, 3];
      const assetsOfKinds = await tx
        .select({ id: projectAssets.id, kind: projectAssets.kind })
        .from(projectAssets)
        .where(eq(projectAssets.projectId, project.id));
      const idsByKind = new Map<number, bigint[]>();
      for (const row of assetsOfKinds) {
        const kind = KIND_BY_ASSET[row.kind];
        if (!kind || !kindSet.includes(kind)) continue;
        const list = idsByKind.get(kind) ?? [];
        list.push(row.id);
        idsByKind.set(kind, list);
      }
      for (const kind of kindSet) {
        const ids = idsByKind.get(kind) ?? [];
        if (ids.length === 0) continue;
        await tx
          .delete(storyboardAssets)
          .where(
            and(
              inArray(storyboardAssets.storyboardId, shotIds),
              inArray(storyboardAssets.projectAssetId, ids),
            ),
          );
      }
      const values: Array<{ storyboardId: bigint; projectAssetId: bigint }> = [];
      for (const rows of resolved.values()) {
        for (const row of rows) {
          const targets = this.targetShotIdsFor(shots, row);
          for (const shotId of targets) {
            values.push({ storyboardId: shotId, projectAssetId: row.id });
          }
        }
      }
      if (values.length > 0) {
        await tx.insert(storyboardAssets).values(values).onConflictDoNothing();
      }
    });

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
   * 7 项条件全满足才进候选：类型是角色/场景/道具 + 有 resource_id + status=3 +
   * name 非空 + prompt 为空 + prompt_generating 不为真 + prompt_blocked 不为真。
   *
   * 执行顺序（同证据 §19-46）：①提示词补全 → ②轮询（同步调用无需轮询）→
   * ③查重复用 → ④需要生图的目标交给既有 `POST /projects/{id}/assets/{aid}/generate-image`
   * （**不在这里扣费**：证据要求生图前单独展示账单并经用户确认）→ ⑤成功项绑回分镜。
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
    const wanted = input.asset_ids
      ? new Set(input.asset_ids.map((id) => id.trim()).filter(Boolean))
      : null;
    const targets = summary.supplementTargets.filter(
      (entry) => !wanted || wanted.has(entry.resource_id),
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
        notes: ["dry-run: prompt completion and image generation were not executed"],
      };
    }

    // ① 提示词补全：复用同一套抽取入口（mock 下同输入同输出，便于幂等复跑）
    const extracted = await this.llm.extractAssets({
      title: episode.title ?? project.title,
      synopsis: episode.synopsis ?? undefined,
      scriptText: episode.scriptText ?? undefined,
      sourceText: project.sourceText ?? undefined,
    });
    const promptByKindName = new Map<string, string>();
    for (const item of [
      ...extracted.characters.map((entry) => ({ kind: 1, ...entry })),
      ...extracted.scenes.map((entry) => ({ kind: 2, ...entry })),
      ...extracted.props.map((entry) => ({ kind: 3, ...entry })),
    ]) {
      const prompt = (item.prompt ?? "").trim();
      if (prompt) promptByKindName.set(`${item.kind}:${item.name.trim()}`, prompt);
    }

    const completed: Array<{ resource_id: string; name: string; action: string }> = [];
    const reused: Array<{ resource_id: string; name: string; reused_from: string }> = [];
    const pendingImage: Array<{ resource_id: string; name: string; kind: string; prompt: string }> = [];
    const failed: Array<{ resource_id: string; name: string; reason: string }> = [];
    const shots = await this.shotsOf(episode.id);

    for (const target of targets) {
      const [row] = await db
        .select()
        .from(projectAssets)
        .where(eq(projectAssets.id, BigInt(target.resource_id)));
      if (!row) {
        failed.push({ resource_id: target.resource_id, name: target.name, reason: "resource_gone" });
        continue;
      }
      const prompt = promptByKindName.get(`${target.kind}:${row.name.trim()}`) ?? null;
      if (!prompt) {
        // 空 prompt 禁止发起生图（_storyboard-asset-match.md:46）
        failed.push({ resource_id: target.resource_id, name: target.name, reason: "prompt_unavailable" });
        continue;
      }
      // ③ 查重：同类同名且已定稿的正式资产可直接复用，不重复生图
      const [reusable] = await db
        .select()
        .from(projectAssets)
        .where(
          and(
            eq(projectAssets.projectId, project.id),
            eq(projectAssets.kind, row.kind),
            eq(projectAssets.name, row.name),
            eq(projectAssets.status, ProjectAssetStatus.FINALIZED),
            sql`${projectAssets.refImageUri} is not null`,
            sql`${projectAssets.id} <> ${row.id}`,
          ),
        )
        .limit(1);
      if (reusable) {
        await this.bindAssetToShots(shots, reusable);
        reused.push({ resource_id: target.resource_id, name: target.name, reused_from: String(reusable.id) });
        completed.push({ resource_id: target.resource_id, name: target.name, action: "reused_finalized_asset" });
        continue;
      }
      // ① 写入补全后的提示词（到此为止不扣费、不生图）
      await db
        .update(projectAssets)
        .set({ prompt, updatedAt: new Date() })
        .where(eq(projectAssets.id, row.id));
      pendingImage.push({
        resource_id: String(row.id),
        name: row.name,
        kind: target.kind_name,
        prompt,
      });
    }

    // ⑤ 让已就绪项重新参与匹配（只绑已定稿资产；待生图项保持未定稿，等生图+定稿后再绑）
    const readyAfter = await db
      .select()
      .from(projectAssets)
      .where(
        and(
          eq(projectAssets.projectId, project.id),
          eq(projectAssets.status, ProjectAssetStatus.FINALIZED),
        ),
      );
    await this.bindAssetsToShots(episode, readyAfter);
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

  // ── 内部：匹配计算 ────────────────────────────────────────────────────

  /** 集级匹配总状态（供三闸门的「匹配闸门」直接读，不建 DTO） */
  async statusOf(projectId: bigint, episodeId: bigint): Promise<number> {
    const [project] = await db.select().from(scriptProjects).where(eq(scriptProjects.id, projectId));
    const [episode] = await db.select().from(episodes).where(eq(episodes.id, episodeId));
    if (!project || !episode) return MatchStatus.NONE;
    const summary = await this.computeMatch(project, episode);
    return summary.status;
  }

  /**
   * 计算本集匹配清单：
   * 候选 = 绑定到本集分镜的项目资产 ∪ 名称在本集正文/标题/梗概/分镜文案里出现的项目资产。
   *
   * 为什么用"名称出现"而不是只认绑定：竞品的集级 resources 数组里既有已绑定项，也有
   * 还没绑定的占位项（缺失/未定稿）；只看绑定会让"缺失"永远统计不到（判据 §2）。
   */
  private async computeMatch(project: ProjectRow, episode: EpisodeRow) {
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
    const assets = await db
      .select()
      .from(projectAssets)
      .where(eq(projectAssets.projectId, project.id))
      .orderBy(projectAssets.createdAt, projectAssets.id);
    const generatingIds = await this.inFlightImageAssets(assets.map((row) => row.sourceTaskId));

    const episodeText = [episode.title ?? "", episode.synopsis ?? "", episode.scriptText ?? ""]
      .join("\n")
      .toLowerCase();
    const shotText = shots
      .map((shot) => `${shot.shotDesc ?? ""}\n${shot.videoPrompt ?? ""}`)
      .join("\n")
      .toLowerCase();

    const byCategory: Record<"characters" | "scenes" | "props", MatchEntry[]> = {
      characters: [],
      scenes: [],
      props: [],
    };
    const supplementTargets: MatchEntry[] = [];

    for (const row of assets) {
      const kind = this.kindOf(row);
      if (!kind) continue;
      const name = row.name.trim();
      if (!name) continue;
      const bound = boundCount.get(String(row.id)) ?? 0;
      const mentioned = episodeText.includes(name.toLowerCase()) || shotText.includes(name.toLowerCase());
      if (bound === 0 && !mentioned) continue;

      const prompt = (row.prompt ?? "").trim();
      const finalized = row.status === ProjectAssetStatus.FINALIZED && Boolean(row.refImageUri);
      const status = finalized
        ? MatchEntryStatus.MATCHED
        : prompt.length === 0
          ? MatchEntryStatus.MISSING
          : MatchEntryStatus.DRAFT;
      const promptGenerating = generatingIds.has(String(row.id));
      const entry: MatchEntry = {
        resource_id: String(row.id),
        name,
        kind,
        kind_name: KIND_NAMES[kind]!,
        status,
        status_name: ENTRY_STATUS_NAMES[status]!,
        prompt: prompt.length > 0 ? prompt : null,
        has_prompt: prompt.length > 0,
        prompt_generating: promptGenerating,
        prompt_blocked: false,
        file_id: row.portraitAssetId ? String(row.portraitAssetId) : null,
        ref_image_uri: row.refImageUri,
        ref_image_url: row.refImageUri ? await this.storage.signDownload(row.refImageUri, 3600) : null,
        finalized_at: row.finalizedAt ? row.finalizedAt.toISOString() : null,
        bound_shot_count: bound,
        // 7 条件：类型 ∈ 角色/场景/道具 · 有 resource_id · status=3 · name 非空 ·
        //          prompt 为空 · prompt_generating 不为真 · prompt_blocked 不为真
        supplementable:
          status === MatchEntryStatus.MISSING &&
          name.length > 0 &&
          !promptGenerating &&
          validatedKind(kind),
      };
      byCategory[MatchCategory[kind]!].push(entry);
      if (entry.supplementable) supplementTargets.push(entry);
    }

    const counts: Record<string, { total: number; matched: number; unfinalized: number; missing: number; supplementable: number }> = {};
    for (const [category, entries] of Object.entries(byCategory)) {
      counts[category] = {
        total: entries.length,
        matched: entries.filter((entry) => entry.status === MatchEntryStatus.MATCHED).length,
        unfinalized: entries.filter((entry) => entry.status === MatchEntryStatus.DRAFT).length,
        missing: entries.filter((entry) => entry.status === MatchEntryStatus.MISSING).length,
        supplementable: entries.filter((entry) => entry.supplementable).length,
      };
    }
    const totals = {
      total: counts.characters!.total + counts.scenes!.total + counts.props!.total,
      matched: counts.characters!.matched + counts.scenes!.matched + counts.props!.matched,
      unfinalized:
        counts.characters!.unfinalized + counts.scenes!.unfinalized + counts.props!.unfinalized,
      missing: counts.characters!.missing + counts.scenes!.missing + counts.props!.missing,
      supplementable:
        counts.characters!.supplementable +
        counts.scenes!.supplementable +
        counts.props!.supplementable,
    };
    const allEntries = [...byCategory.characters, ...byCategory.scenes, ...byCategory.props];
    // 总状态：缺失 (3) > 未定稿 (1) > 已匹配 (2)；无候选 = 0（从未匹配）
    const status =
      allEntries.length === 0
        ? MatchStatus.NONE
        : totals.missing > 0
          ? MatchStatus.MISSING
          : totals.unfinalized > 0
            ? MatchStatus.PARTIAL
            : MatchStatus.MATCHED;
    return { status, counts, totals, byCategory, supplementTargets };
  }

  /** 把一批资产按名称提及关系绑到分镜（已存在的绑定不重复写，可反复调用） */
  private async bindAssetsToShots(episode: EpisodeRow, assets: ProjectAssetRow[]) {
    const shots = await this.shotsOf(episode.id);
    if (shots.length === 0 || assets.length === 0) return 0;
    const shotIds = shots.map((shot) => shot.id);
    const existing = await db
      .select()
      .from(storyboardAssets)
      .where(inArray(storyboardAssets.storyboardId, shotIds));
    const existingKeys = new Set(
      existing.map((link) => `${link.storyboardId}:${link.projectAssetId}`),
    );
    const values: Array<{ storyboardId: bigint; projectAssetId: bigint }> = [];
    for (const asset of assets) {
      if (!validatedKind(this.kindOf(asset))) continue;
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

  private async bindAssetToShots(shots: StoryboardRow[], asset: ProjectAssetRow) {
    const targets = this.targetShotIdsFor(shots, asset);
    if (targets.length === 0) return 0;
    await db
      .insert(storyboardAssets)
      .values(targets.map((shotId) => ({ storyboardId: shotId, projectAssetId: asset.id })))
      .onConflictDoNothing();
    return targets.length;
  }

  /**
   * 某资产应绑哪些镜：命名被分镜文案点到的镜；一镜都没点名时退化为全集
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

  private async inFlightImageAssets(taskIds: Array<bigint | null>): Promise<Set<string>> {
    const ids = taskIds.filter((id): id is bigint => Boolean(id));
    if (ids.length === 0) return new Set();
    const rows = await db
      .select({ id: tasks.id, status: tasks.status })
      .from(tasks)
      .where(inArray(tasks.id, ids));
    const inFlight = new Set(
      rows
        .filter((row) => row.status === TaskStatus.PENDING || row.status === TaskStatus.RUNNING)
        .map((row) => String(row.id)),
    );
    const result = new Set<string>();
    const assets = await db
      .select({ id: projectAssets.id, sourceTaskId: projectAssets.sourceTaskId })
      .from(projectAssets)
      .where(inArray(projectAssets.sourceTaskId, [...inFlight].map((id) => BigInt(id))));
    for (const asset of assets) result.add(String(asset.id));
    return result;
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
