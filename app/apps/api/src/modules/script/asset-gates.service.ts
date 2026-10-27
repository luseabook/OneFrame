import { Inject, Injectable } from "@nestjs/common";
import { AppError, ErrorCode, ProjectAssetStatus } from "@app/shared";
import { SubjectsService, SubjectReviewStatus } from "../subjects/subjects.service";
import { AssetMatchService, MatchStatus } from "./asset-match.service";

/**
 * 一致性三闸门（`completion-plan §2 任务 1.4`）。
 *
 * 竞品证据：
 * - `target-spec.md:124`（PRD F2）：「同角色各镜 references 均含其已定稿定妆图、
 *   **未定稿返回 400105**」；`target-spec.md:174` 400105 = 资产未定稿/参考图缺失；
 * - `resource.md:207`（`resource list` 分页语义）：清单不全时不报错、表现为"某几个资产
 *   没被处理"——所以闸门必须**逐个资产判**并指名，不能只看数量；
 * - `storyboard.md:308-310`：参考资产按表格顺序转成草稿 `images`，提示词里的名称转 `[[@imgN]]`；
 * - `subject.md:204-226`：主体审核三态，**驳回 retryable=false、禁止自动重试**。
 *
 * 三闸门顺序固定：**定稿 → 匹配 → 生成注入**（后面的闸门依赖前面已通过）。
 * 为什么落成 service 而不是散在 controller：生成入口（批量投递）与只读预检
 * （`match-result` 的 gates 字段）必须用同一套判定，否则"界面显示能投、投递返回 400105"。
 */

export interface FinalizeGateBlocked {
  resource_id: string;
  name: string;
  kind: string;
  status: number;
  reason: "not_finalized" | "missing_file";
}

export interface FinalizeGateVerdict {
  ok: boolean;
  blocked: FinalizeGateBlocked[];
}

export interface SubjectGateBlocked {
  resource_id: string;
  name: string;
  subject_id: string;
  subject_name: string;
  review_status: string;
  retryable: boolean;
}

export interface MatchGateVerdict {
  ok: boolean;
  /** 0 从未匹配 / 1 部分未定稿 / 2 全部已匹配 / 3 有缺失 */
  status: number;
  reason?: "match_not_ready";
}

export interface GenerationInjection {
  /** 按绑定顺序排好的参考图（= 竞品草稿 `images`） */
  images: string[];
  /** images[i] 对应的资产与「名称 → [[@imgN]]」标记 */
  image_subjects: Array<{ index: number; marker: string; resource_id: string; name: string }>;
  /** 把提示词里出现的资产名替换成 [[@imgN]] 后的文本（不改原提示词，由调用方决定用哪个） */
  prompt_with_images: string;
}

type AssetLike = {
  id: bigint;
  name: string;
  kind: string;
  status: number;
  refImageUri: string | null;
  portraitAssetId: bigint | null;
};

const KIND_NAMES: Record<string, string> = {
  character: "character",
  scene: "scene",
  prop: "prop",
  other: "other",
};

@Injectable()
export class AssetGatesService {
  constructor(
    @Inject(SubjectsService) private readonly subjects: SubjectsService,
    @Inject(AssetMatchService) private readonly match: AssetMatchService,
  ) {}

  /**
   * 闸门 1 · 定稿：`status=2` **且**有参考图文件（我方「file_id」等价物是
   * `portrait_asset_id`/`ref_image_uri`——`assets` 行就是竞品的 file 记录）。
   */
  finalizeGate(assets: AssetLike[]): FinalizeGateVerdict {
    const blocked: FinalizeGateBlocked[] = [];
    for (const asset of assets) {
      if (asset.status !== ProjectAssetStatus.FINALIZED) {
        blocked.push({
          resource_id: String(asset.id),
          name: asset.name,
          kind: KIND_NAMES[asset.kind] ?? asset.kind,
          status: asset.status,
          reason: "not_finalized",
        });
        continue;
      }
      if (!asset.refImageUri) {
        blocked.push({
          resource_id: String(asset.id),
          name: asset.name,
          kind: KIND_NAMES[asset.kind] ?? asset.kind,
          status: asset.status,
          reason: "missing_file",
        });
      }
    }
    return { ok: blocked.length === 0, blocked };
  }

  /**
   * 闸门 2 · 匹配：本集匹配总状态必须是 1/2/3（匹配已执行）。
   * `0` 表示从未匹配——此时投递无法保证「同角色各镜同一参考」，
   * 按 400105 拦下并要求先跑 `match-resources`。
   */
  async matchGate(projectId: bigint, episodeId: bigint): Promise<MatchGateVerdict> {
    const status = await this.match.statusOf(projectId, episodeId);
    if (status === MatchStatus.NONE) {
      return { ok: false, status, reason: "match_not_ready" };
    }
    return { ok: true, status };
  }

  /**
   * 闸门 1.5 · 主体审核（放在定稿后、生成前）：绑定资产若显式关联了未过审主体，
   * 按 400105 拦下；`rejected` 的 `retryable=false`（禁止自动重试，`subject.md:212`）。
   */
  async subjectGate(spaceId: string, assets: AssetLike[]): Promise<{ ok: boolean; blocked: SubjectGateBlocked[] }> {
    const linked = await this.subjects.subjectsOfAssetFiles(
      spaceId,
      assets.map((asset) => ({
        assetId: asset.portraitAssetId ?? null,
        uri: asset.refImageUri ?? null,
      })),
    );
    const blocked: SubjectGateBlocked[] = [];
    for (const item of linked) {
      const subject = item.subject;
      if (subject.reviewStatus === SubjectReviewStatus.APPROVED) continue;
      const owner =
        assets.find(
          (asset) =>
            (item.asset_id && asset.portraitAssetId && String(asset.portraitAssetId) === item.asset_id) ||
            (item.uri && asset.refImageUri === item.uri),
        ) ?? null;
      blocked.push({
        resource_id: owner ? String(owner.id) : "",
        name: owner?.name ?? "",
        subject_id: String(subject.id),
        subject_name: subject.name,
        review_status:
          subject.reviewStatus === SubjectReviewStatus.REVIEWING
            ? "reviewing"
            : subject.reviewStatus === SubjectReviewStatus.REJECTED
              ? "rejected"
              : "unknown",
        // 只有"审核中"可以等待后重试；驳回 retryable=false（subject.md:212）
        retryable: subject.reviewStatus === SubjectReviewStatus.REVIEWING,
      });
    }
    return { ok: blocked.length === 0, blocked };
  }

  /**
   * 闸门 3 · 生成注入：把已定稿资产按绑定顺序展开成 `images[]`，并给出
   * 「名称 → [[@imgN]]」映射（`storyboard.md:308-310`）。
   *
   * 只做数据构造，不改 `prompt`：生成侧仍用原提示词 + `reference_uris`，
   * 避免把用户可见提示词改写掉（偏离登记见回报）。
   */
  injectImages(prompt: string, assets: AssetLike[]): GenerationInjection {
    const ready = assets.filter(
      (asset) => asset.status === ProjectAssetStatus.FINALIZED && Boolean(asset.refImageUri),
    );
    const images = ready.map((asset) => asset.refImageUri!);
    const imageSubjects = ready.map((asset, index) => ({
      index,
      marker: `[[@img${index + 1}]]`,
      resource_id: String(asset.id),
      name: asset.name,
    }));
    let promptWithImages = prompt;
    // 名称长的先替换，避免"林晚"把"林晚秋"吃掉一半
    for (const subject of [...imageSubjects].sort((a, b) => b.name.length - a.name.length)) {
      if (!subject.name.trim()) continue;
      promptWithImages = promptWithImages.split(subject.name).join(subject.marker);
    }
    return { images, image_subjects: imageSubjects, prompt_with_images: promptWithImages };
  }

  /**
   * 三闸门聚合判定（只读预检；`match-result` 与生成前 dry-run 共用）。
   * 顺序固定：定稿 → 匹配 → 生成注入；任一门失败即整体 not ok。
   */
  async verdicts(spaceId: string, projectId: bigint, episodeId: bigint, assets: AssetLike[]) {
    const finalize = this.finalizeGate(assets);
    const match = await this.matchGate(projectId, episodeId);
    const subject = await this.subjectGate(spaceId, assets);
    const generate = this.injectImages("", assets);
    const ok = finalize.ok && match.ok && subject.ok;
    return {
      ok,
      gates: [
        { gate: "finalize", ok: finalize.ok, blocked: finalize.blocked },
        { gate: "match", ok: match.ok, status: match.status, reason: match.reason ?? null },
        { gate: "subject", ok: subject.ok, blocked: subject.blocked },
        { gate: "generate", ok: generate.images.length > 0, images: generate.images },
      ],
    };
  }

  /** 生成入口用：任一门不过时抛 400105（整单语义，带闸门名与 retryable） */
  async assertGenerationReady(
    spaceId: string,
    projectId: bigint,
    episodeId: bigint,
    assets: AssetLike[],
  ) {
    const verdict = await this.verdicts(spaceId, projectId, episodeId, assets);
    if (verdict.ok) return verdict;
    const failed = verdict.gates.find((gate) => !gate.ok);
    throw new AppError(
      ErrorCode.ASSET_NOT_READY,
      `generation blocked by ${failed?.gate ?? "asset"} gate`,
      { gate: failed?.gate ?? "asset", verdict },
    );
  }
}

/** 供生成侧断言用：未过审主体（保留导出，避免调用方自己拼判定） */
export async function assertSubjectsApproved(service: SubjectsService, spaceId: string, subjectIds: string[]) {
  return service.assertApproved(spaceId, subjectIds);
}
