import { Inject, Injectable } from "@nestjs/common";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import {
  assets,
  episodes,
  freezeCredits,
  modelPrices,
  models,
  projectAssets,
  scriptProjects,
  settleCredits,
  storyboards,
  taskEvents,
  tasks,
  unfreezeCredits,
} from "@app/db";
import type { Tx } from "@app/db";
import { AppError, ErrorCode, newId } from "@app/shared";
import { db } from "../../db/database";
import type { AuthContext } from "../../common/auth.types";
import { CreditsService } from "../credits/credits.service";
import { ModerationService } from "../moderation/moderation.service";
import { AdLlmService } from "./ad-llm.service";
import {
  AD_BRIEF_CANDIDATES,
  AD_LLM_MODE,
  AD_PROJECT_MODE,
  AD_SHOT_COUNT,
  AD_SP_TYPE,
  AD_STAGES,
  AD_STATUS_LABEL,
  assertMetaSize,
  emptyAdMeta,
  readAdMeta,
  type AdLlmAction,
  type AdModeMeta,
} from "./ad.constants";

type ProjectRow = typeof scriptProjects.$inferSelect;
type EpisodeRow = typeof episodes.$inferSelect;
type AssetRow = typeof projectAssets.$inferSelect;
type ShotRow = typeof storyboards.$inferSelect;

/** `tasks.status`：1 待处理 / 2 运行中 / 3 完成 / 4 失败（schema.ts:307 注释） */
const TASK_STATUS = { PENDING: 1, RUNNING: 2, DONE: 3, FAILED: 4 } as const;

/**
 * 广告剧（drama_ad）服务 —— 对照竞品 `/df/script_project/drama_ad/*` 12 端点
 * （`rea-reelmate/routes.txt:680-691`）+ 页面 `/ad-drama/{create,workspace}`（`:11-12`）。
 *
 * ## 三条硬约束
 *
 * 1. **不新增表**：项目就是 `script_projects(project_mode=2)`，集/分镜/资产复用
 *    `episodes`/`storyboards`/`project_assets`（schema.ts:440-455 已写明这个取舍：
 *    竞品同样是 `/script_project/{drama_ad,video_redraw}/project/*` 复用同一骨架）。
 *    未取证的模式专属字段全部进 `mode_meta`（jsonb，服务端**不解析语义**、只限 64KB）。
 *
 * 2. **生成动作不白送**：每个 LLM 动作先 `credits.price()` 拿**目录里的真实价**
 *    （文本模型按次 2 积分，`seed.ts:1486-1498`），再「建 task + 冻结」→ 生成 →
 *    「业务写入 + 结算」**同一事务**落库；失败解冻 + 任务置失败。绝不出现
 *    "内容写进去了但没扣费"或"扣了费但内容没落库"。
 *
 * 3. **跨 space 一律 404**（不是 403）：与 `script.service.findProject` 同口径——
 *    项目 id 是不透明指针，403 等于确认"这个 id 存在"。
 */
@Injectable()
export class AdDramaService {
  // esbuild/vitest 不产装饰器元数据 → 必须显式 @Inject
  constructor(
    @Inject(AdLlmService) private readonly llm: AdLlmService,
    @Inject(CreditsService) private readonly credits: CreditsService,
    @Inject(ModerationService) private readonly moderation: ModerationService,
  ) {}

  // ══════════════════════════════════════════════════════════
  // 1. 建/存项目（竞品 `drama_ad/project/save`，rt:686）
  // ══════════════════════════════════════════════════════════

  /**
   * 新建或更新商品广告项目。竞品 `ad save` 的语义是"`sp_id` 为空时新增、传值时更新"
   * （`commands/ad.md:67`），我方用 `project_id` 表达同一件事。
   *
   * 必填字段与竞品逐条一致（`commands/ad.md:57-66`）：
   * `material_name` / `material_highlight` / `material_image` / `style` / `ratio` / `sp_type`；
   * 可选 `theme` / `group_ids`。
   */
  async save(
    auth: AuthContext,
    input: {
      project_id?: string;
      material_name: string;
      material_highlight: string;
      material_image: string;
      style: string;
      ratio: string;
      sp_type?: number;
      theme?: string;
      group_ids?: string;
      title?: string;
    },
  ) {
    const spaceId = BigInt(auth.spaceId);
    this.moderation.assertText(input.material_name, "material_name");
    this.moderation.assertText(input.material_highlight, "material_highlight");
    await this.assertMaterialImage(spaceId, input.material_image);

    const material: AdModeMeta["material"] = {
      name: input.material_name.trim(),
      highlight: input.material_highlight.trim(),
      image: input.material_image.trim(),
      style: input.style.trim(),
      ratio: input.ratio,
      /** 竞品 `sp_type` 当前恒为 2（`commands/ad.md:64-66`）：原样留痕，不改我方 project_mode */
      sp_type: input.sp_type ?? AD_SP_TYPE,
      ...(input.theme ? { theme: input.theme } : {}),
      ...(input.group_ids ? { group_ids: input.group_ids } : {}),
    };

    if (input.project_id) {
      const project = await this.findAdProject(spaceId, input.project_id);
      const meta = readAdMeta(project.modeMeta);
      meta.material = material;
      assertMetaSize(meta);
      const [updated] = await db
        .update(scriptProjects)
        .set({ title: input.title ?? project.title, ratio: material.ratio, modeMeta: meta, updatedAt: new Date() })
        .where(eq(scriptProjects.id, project.id))
        .returning();
      return { project: this.toProjectDto(updated!), created: false };
    }

    const meta = emptyAdMeta(material);
    assertMetaSize(meta);
    const [created] = await db
      .insert(scriptProjects)
      .values({
        id: newId(),
        spaceId,
        title: input.title?.trim() || material.name || "未命名广告剧",
        ratio: material.ratio,
        /** 2 = idea（一句话想法）：广告剧的"来源"是商品 + 卖点，不是小说/剧本 */
        sourceType: 2,
        projectMode: AD_PROJECT_MODE,
        modeMeta: meta,
        status: 1,
      })
      .returning();
    return { project: this.toProjectDto(created!), created: true };
  }

  // ══════════════════════════════════════════════════════════
  // 2. 项目详情（竞品 `drama_ad/project/info`，rt:684）
  // ══════════════════════════════════════════════════════════

  /**
   * 查项目详情：模式态 + **五段进度** + 集/分镜/资产。
   *
   * 竞品 `info` 的表格列是 `SP_ID`/`EP_ID`/`STAGE`/`STATUS`（`commands/ad.md:41`），
   * 但 STAGE/STATUS 的**取值域未取证**。我方两个都给：
   * - `stage`/`status`：保留竞品字段名，值按我方定义（1..5 / 1 进行中 2 完成）；
   * - `stages[]`：逐段 done 与 count（五段步进页面真正要的数据）。
   */
  async info(auth: AuthContext, projectId: string) {
    const project = await this.findAdProject(BigInt(auth.spaceId), projectId);
    const meta = readAdMeta(project.modeMeta);
    const episode = await this.findEpisode(project.id);
    const shots = episode
      ? await db
          .select()
          .from(storyboards)
          .where(eq(storyboards.episodeId, episode.id))
          .orderBy(asc(storyboards.shotNo))
      : [];
    const assetRows = await db
      .select()
      .from(projectAssets)
      .where(eq(projectAssets.projectId, project.id))
      // 按 id（雪花，单调递增）排序 = 插入顺序。**不能按 created_at**：
      // 同一事务里批量插入的行 `now()` 完全相同，排序不稳定，前端看到的资产顺序会抖。
      .orderBy(asc(projectAssets.id));

    const stages = this.computeStages(meta, shots.length, assetRows.length);
    return {
      project: this.toProjectDto(project),
      material: meta.material,
      episode: episode ? { id: String(episode.id), ep_no: episode.epNo, title: episode.title } : null,
      selling_points: meta.selling_points,
      briefs: meta.briefs.map((b) => ({ ...b, selected: b.id === meta.selected_brief })),
      selected_brief: meta.selected_brief,
      script: meta.script,
      storyboard: meta.storyboard ? { ...meta.storyboard, shots: shots.length } : { shots: shots.length },
      shots: shots.map((s) => this.toShotDto(s)),
      assets: assetRows.map((a) => this.toAssetDto(a)),
      image_tips: meta.image_tips,
      asset_meta: meta.asset,
      /** 竞品字段名，值域我方定义（待取证） */
      stage: meta.stage,
      status: meta.status,
      status_name: AD_STATUS_LABEL[meta.status] ?? String(meta.status),
      stages,
      current_stage: stages.find((s) => !s.done)?.stage ?? AD_STAGES.length,
      charges: meta.charges.slice(-20),
    };
  }

  // ══════════════════════════════════════════════════════════
  // 3. 卖点（竞品 `drama_ad/selling-point/generate`，rt:690）
  // ══════════════════════════════════════════════════════════

  /**
   * 生成卖点 → `mode_meta.selling_points`。
   *
   * 竞品该端点**不需要 sp_id**（`commands/ad.md:85`），即可以先出卖点再建项目。
   * 我方把卖点挂在项目上（task 要求"状态挂 project"），所以 create 页的用法是
   * "先建项目（草稿）→ 再生成卖点"。→ 已知偏离（时序差异，能力不减），见回报。
   */
  async generateSellingPoints(
    auth: AuthContext,
    projectId: string,
    input: { model?: string; count?: number },
  ) {
    const project = await this.findAdProject(BigInt(auth.spaceId), projectId);
    const meta = readAdMeta(project.modeMeta);

    const charge = await this.chargeAndPersist({
      action: "selling_point",
      auth,
      projectId: project.id,
      prompt: `selling points for ${meta.material.name}`,
      model: input.model,
      produce: () =>
        this.llm.sellingPoints({
          name: meta.material.name,
          highlight: meta.material.highlight,
          style: meta.material.style,
        }),
      persist: async (tx, result) => {
        const next = readAdMeta(project.modeMeta);
        const limit = Math.max(1, Math.min(input.count ?? result.selling_points.length, 8));
        next.selling_points = result.selling_points.slice(0, limit);
        next.stage = Math.max(next.stage, 1);
        await this.writeMeta(tx, project.id, next);
      },
    });

    const updated = await this.findAdProject(BigInt(auth.spaceId), projectId);
    return { selling_points: readAdMeta(updated.modeMeta).selling_points, charge };
  }

  // ══════════════════════════════════════════════════════════
  // 4. brief（剧情方案）生成与选定（rt:682、:683）
  // ══════════════════════════════════════════════════════════

  /**
   * 生成多个剧情方案候选（竞品 `brief/generate`；CLI 的 `ad plot` 就是它，
   * `commands/ad.md:27` "生成剧情方案任务"）。
   *
   * 前置：必须先有卖点。这既是产品逻辑，也让"五段"有真实依赖顺序
   * （竞品网页端五段步进未取证是否有硬校验 → 我方选择硬校验并登记）。
   */
  async generateBriefs(auth: AuthContext, projectId: string, input: { count?: number; model?: string }) {
    const project = await this.findAdProject(BigInt(auth.spaceId), projectId);
    const meta = readAdMeta(project.modeMeta);
    if (meta.selling_points.length === 0) {
      throw new AppError(ErrorCode.INVALID_PARAM, "generate selling points before briefs", {
        field: "selling_points",
        stage: 1,
      });
    }
    const count = Math.max(1, Math.min(input.count ?? AD_BRIEF_CANDIDATES, 5));

    const charge = await this.chargeAndPersist({
      action: "brief",
      auth,
      projectId: project.id,
      prompt: `ad briefs for ${meta.material.name}`,
      model: input.model,
      produce: () =>
        this.llm.briefs({
          name: meta.material.name,
          highlight: meta.material.highlight,
          sellingPoints: meta.selling_points,
          count,
        }),
      persist: async (tx, result) => {
        const next = readAdMeta(project.modeMeta);
        // 每次重新分配 id：候选是"这一轮的方案"，旧 selected_brief 不能跨轮沿用
        next.briefs = result.briefs.map((brief) => ({ ...brief, id: String(newId()) }));
        next.selected_brief = null;
        next.stage = Math.max(next.stage, 2);
        await this.writeMeta(tx, project.id, next);
      },
    });

    const updated = await this.findAdProject(BigInt(auth.spaceId), projectId);
    return { briefs: readAdMeta(updated.modeMeta).briefs, charge };
  }

  /** 选定方案（竞品 `brief/select`，rt:683）：选定后才能生成脚本（CLI 要求 `brief_id`） */
  async selectBrief(auth: AuthContext, projectId: string, input: { brief_id: string }) {
    const project = await this.findAdProject(BigInt(auth.spaceId), projectId);
    const meta = readAdMeta(project.modeMeta);
    const brief = meta.briefs.find((b) => b.id === input.brief_id);
    if (!brief) {
      throw new AppError(ErrorCode.NOT_FOUND, "brief not found in this project", { field: "brief_id" });
    }
    return db.transaction(async (tx) => {
      const next = readAdMeta(project.modeMeta);
      next.selected_brief = brief.id;
      next.stage = Math.max(next.stage, 2);
      await this.writeMeta(tx, project.id, next);
      return { selected_brief: brief.id, brief };
    });
  }

  // ══════════════════════════════════════════════════════════
  // 5. 脚本：生成 / 编辑 / 重置（rt:688、:687、:689）
  // ══════════════════════════════════════════════════════════

  /**
   * 按选中方案生成广告脚本（竞品 `script/generate`；CLI 必填 `brief_id`，
   * `commands/ad.md:117`）。正文落 `episodes(ep_no=1).script_text`（复用既有集表），
   * `mode_meta.script` 只存正文快照与时间戳留痕。
   */
  async generateScript(auth: AuthContext, projectId: string, input: { brief_id?: string; model?: string }) {
    const project = await this.findAdProject(BigInt(auth.spaceId), projectId);
    const meta = readAdMeta(project.modeMeta);
    const briefId = input.brief_id ?? meta.selected_brief;
    if (!briefId) {
      throw new AppError(ErrorCode.INVALID_PARAM, "select a brief before generating script", {
        field: "brief_id",
        stage: 2,
      });
    }
    const brief = meta.briefs.find((b) => b.id === briefId);
    if (!brief) {
      throw new AppError(ErrorCode.NOT_FOUND, "brief not found in this project", { field: "brief_id" });
    }

    const charge = await this.chargeAndPersist({
      action: "script",
      auth,
      projectId: project.id,
      prompt: `ad script for ${meta.material.name} / ${brief.title}`,
      model: input.model,
      produce: () =>
        this.llm.script({
          name: meta.material.name,
          highlight: meta.material.highlight,
          brief: { title: brief.title, logline: brief.logline, beats: brief.beats },
          ratio: meta.material.ratio,
        }),
      persist: async (tx, result) => {
        await this.upsertEpisode(tx, project.id, result.script_text, brief.title);
        const next = readAdMeta(project.modeMeta);
        next.selected_brief = brief.id;
        next.script = { text: result.script_text };
        next.stage = Math.max(next.stage, 3);
        await this.writeMeta(tx, project.id, next);
      },
    });

    const updated = await this.findAdProject(BigInt(auth.spaceId), projectId);
    return { script: readAdMeta(updated.modeMeta).script, charge };
  }

  /** 人工编辑脚本（竞品 `script/edit`，rt:687）：只改正文，不动方案选择 */
  async editScript(auth: AuthContext, projectId: string, input: { script_text: string }) {
    const project = await this.findAdProject(BigInt(auth.spaceId), projectId);
    this.moderation.assertText(input.script_text, "script_text");
    const text = input.script_text.trim();
    if (text.length === 0) {
      throw new AppError(ErrorCode.INVALID_PARAM, "script_text must not be empty", { field: "script_text" });
    }
    return db.transaction(async (tx) => {
      await this.upsertEpisode(tx, project.id, text, "广告片");
      const next = readAdMeta(project.modeMeta);
      next.script = { text, edited_at: new Date().toISOString() };
      next.stage = Math.max(next.stage, 3);
      await this.writeMeta(tx, project.id, next);
      return { script: next.script };
    });
  }

  /**
   * 重置脚本（竞品 `script/reset`，rt:689；CLI："重置脚本并回到剧情方案选择"，
   * `commands/ad.md:31`）。
   *
   * **同时清掉分镜**：竞品只写"重置脚本"，未说明分镜是否随之失效。分镜是从旧脚本
   * 派生的，留着会与"重新选方案 → 重新生成脚本"直接矛盾（新脚本配旧分镜）。
   * → 我方选择清除，登记为已知偏离。
   */
  async resetScript(auth: AuthContext, projectId: string) {
    const project = await this.findAdProject(BigInt(auth.spaceId), projectId);
    return db.transaction(async (tx) => {
      const episode = await this.findEpisodeTx(tx, project.id);
      let deletedShots = 0;
      if (episode) {
        const removed = await tx
          .delete(storyboards)
          .where(eq(storyboards.episodeId, episode.id))
          .returning({ id: storyboards.id });
        deletedShots = removed.length;
        await tx.update(episodes).set({ scriptText: null, updatedAt: new Date() }).where(eq(episodes.id, episode.id));
      }
      const next = readAdMeta(project.modeMeta);
      next.script = { text: "", reset_at: new Date().toISOString() };
      next.selected_brief = null;
      next.storyboard = null;
      next.stage = 2;
      await this.writeMeta(tx, project.id, next);
      return { reset: true, stage: next.stage, deleted_shots: deletedShots };
    });
  }

  // ══════════════════════════════════════════════════════════
  // 6. 分镜（竞品 `storyboard/generate`，rt:691；CLI `plan` + `template_type`）
  // ══════════════════════════════════════════════════════════

  /**
   * 生成分镜规划 → 落既有 `episodes` + `storyboards`。
   *
   * 竞品 `template_type`：1 急速 / 2 至尊（`commands/ad.md:149`）——**取证到的参数名**，直接沿用。
   * 档位对应镜头数竞品未给 → 我方 6/10，登记待取证。
   */
  async generateStoryboard(
    auth: AuthContext,
    projectId: string,
    input: { template_type?: number; shot_count?: number; model?: string },
  ) {
    const project = await this.findAdProject(BigInt(auth.spaceId), projectId);
    const meta = readAdMeta(project.modeMeta);
    if (!meta.script || !meta.script.text) {
      throw new AppError(ErrorCode.INVALID_PARAM, "generate script before storyboard", { stage: 3 });
    }
    const templateType = input.template_type === 2 ? 2 : 1;
    const shotCount = Math.max(
      1,
      Math.min(input.shot_count ?? (templateType === 2 ? AD_SHOT_COUNT.premium : AD_SHOT_COUNT.fast), 30),
    );

    const charge = await this.chargeAndPersist({
      action: "storyboard",
      auth,
      projectId: project.id,
      prompt: `storyboard for ${meta.material.name}`,
      model: input.model,
      produce: () =>
        this.llm.storyboards({
          name: meta.material.name,
          highlight: meta.material.highlight,
          scriptText: meta.script?.text ?? "",
          shotCount,
          ratio: meta.material.ratio,
          templateType,
        }),
      persist: async (tx, result) => {
        const episodeId = await this.upsertEpisode(tx, project.id, meta.script?.text ?? "", "广告片");
        // 重生成 = 整体替换（同剧本流水线口径：不叠加旧镜头，否则镜号会重复）
        await tx.delete(storyboards).where(eq(storyboards.episodeId, episodeId));
        await tx.insert(storyboards).values(
          result.storyboards.map((shot) => ({
            id: newId(),
            episodeId,
            shotNo: shot.shot_no,
            shotDesc: shot.shot_desc,
            videoPrompt: shot.video_prompt,
            durationS: shot.duration_s,
            ratio: meta.material.ratio,
            resolution: "720p",
            status: 1,
          })),
        );
        const next = readAdMeta(project.modeMeta);
        next.storyboard = {
          template_type: templateType,
          shot_count: result.storyboards.length,
          generated_at: new Date().toISOString(),
        };
        next.stage = Math.max(next.stage, 4);
        await this.writeMeta(tx, project.id, next);
      },
    });

    const updated = await this.findAdProject(BigInt(auth.spaceId), projectId);
    const episode = await this.findEpisode(updated.id);
    const shots = episode
      ? await db.select().from(storyboards).where(eq(storyboards.episodeId, episode.id)).orderBy(asc(storyboards.shotNo))
      : [];
    return {
      storyboard: readAdMeta(updated.modeMeta).storyboard,
      shots: shots.map((s) => this.toShotDto(s)),
      charge,
    };
  }

  // ══════════════════════════════════════════════════════════
  // 7. 资产抽取 / 提示词（rt:680、:681）
  // ══════════════════════════════════════════════════════════

  /**
   * 抽商品/场景资产 → `project_assets`（竞品 `asset/extract`，rt:680；CLI `asset`
   * 带 `need_voice`，`commands/ad.md:133`）。
   *
   * 商品本体一定是第一条资产（`kind=prop`、`refImageUri=material_image`）：广告片主角是商品，
   * 让 LLM"抽"商品名反而可能抽错（模型只知道名字）。
   * `need_voice`（1 生成配音 / 2 不生成）原样记进 `mode_meta.asset` 留痕；配音任务属出片链路，
   * 不在本端点触发（本端点只负责"资产清单"）。
   */
  async extractAssets(auth: AuthContext, projectId: string, input: { need_voice?: number; model?: string }) {
    const project = await this.findAdProject(BigInt(auth.spaceId), projectId);
    const meta = readAdMeta(project.modeMeta);
    const needVoice = input.need_voice === 2 ? 2 : 1;

    const charge = await this.chargeAndPersist({
      action: "asset_extract",
      auth,
      projectId: project.id,
      prompt: `assets for ${meta.material.name}`,
      model: input.model,
      produce: () =>
        this.llm.assets({
          name: meta.material.name,
          highlight: meta.material.highlight,
          materialImage: meta.material.image,
          includeCharacters: true,
        }),
      persist: async (tx, result) => {
        // 重抽 = 整体替换（商品可能已换，旧资产留着会让提示词与当前商品对不上）
        await tx.delete(projectAssets).where(eq(projectAssets.projectId, project.id));
        await tx.insert(projectAssets).values(
          result.assets.map((asset) => ({
            id: newId(),
            projectId: project.id,
            kind: asset.kind,
            name: asset.name,
            description: asset.description,
            prompt: asset.prompt,
            refImageUri: asset.ref_image_uri,
            status: 1,
          })),
        );
        const next = readAdMeta(project.modeMeta);
        next.stage = Math.max(next.stage, 5);
        next.asset = { need_voice: needVoice };
        await this.writeMeta(tx, project.id, next);
      },
    });

    const updated = await this.findAdProject(BigInt(auth.spaceId), projectId);
    const rows = await db
      .select()
      .from(projectAssets)
      .where(eq(projectAssets.projectId, updated.id))
      // 同 info：按 id 升序 = 插入顺序（商品本体永远是第一条）
      .orderBy(asc(projectAssets.id));
    return { assets: rows.map((a) => this.toAssetDto(a)), need_voice: needVoice, charge };
  }

  /** 生成资产提示词建议（竞品 `asset/image-tips`，rt:681）：写回 `project_assets.prompt` */
  async generateImageTips(auth: AuthContext, projectId: string, input: { model?: string }) {
    const project = await this.findAdProject(BigInt(auth.spaceId), projectId);
    const meta = readAdMeta(project.modeMeta);
    const assetRows = await db.select().from(projectAssets).where(eq(projectAssets.projectId, project.id));
    if (assetRows.length === 0) {
      throw new AppError(ErrorCode.INVALID_PARAM, "extract assets before image tips", { stage: 5 });
    }

    const charge = await this.chargeAndPersist({
      action: "image_tips",
      auth,
      projectId: project.id,
      prompt: `image tips for ${meta.material.name}`,
      model: input.model,
      produce: () =>
        this.llm.imageTips({
          name: meta.material.name,
          highlight: meta.material.highlight,
          assets: assetRows.map((a) => ({ name: a.name, kind: a.kind })),
        }),
      persist: async (tx, result) => {
        const byName = new Map(assetRows.map((a) => [a.name, a]));
        for (const tip of result.tips) {
          const asset = byName.get(tip.name);
          if (!asset) continue;
          await tx
            .update(projectAssets)
            .set({ prompt: tip.prompt, promptStatus: 2, updatedAt: new Date() })
            .where(eq(projectAssets.id, asset.id));
        }
        const next = readAdMeta(project.modeMeta);
        next.image_tips = result.tips.map((tip) => {
          const asset = byName.get(tip.name);
          return { name: tip.name, prompt: tip.prompt, ...(asset ? { asset_id: String(asset.id) } : {}) };
        });
        next.stage = Math.max(next.stage, 5);
        await this.writeMeta(tx, project.id, next);
      },
    });

    const updated = await this.findAdProject(BigInt(auth.spaceId), projectId);
    return { image_tips: readAdMeta(updated.modeMeta).image_tips, charge };
  }

  // ══════════════════════════════════════════════════════════
  // 8. 积分预估（竞品 `project/point`，rt:685）
  // ══════════════════════════════════════════════════════════

  /**
   * 积分预估：**用目录里的真实价**逐条报价，不写死金额。
   *
   * 竞品 `project/point`（rt:685）与 `df/novel/{nt_id}/point` 同类
   * （`d-commerce-account.md:107` "项目级计价"）；其入参/出参未取证 → 我方定义：
   * - `steps[]`：**还没做**的文本生成步骤，各自 `credits.price()` 得到的真实单价；
   * - `total_credits`：这些步骤之和（"把这条广告剧做完还要多少文本生成费"）；
   * - `media_estimate`：分镜出图/出片的**最低价档位**估算（`include_media=true` 才给），
   *   带 `basis` 说明；实际按逐镜 `/credits/quote` 结算，本端点不预扣。
   */
  async estimate(
    auth: AuthContext,
    projectId: string,
    input: { include_media?: boolean; shot_count?: number; model?: string },
  ) {
    const project = await this.findAdProject(BigInt(auth.spaceId), projectId);
    const meta = readAdMeta(project.modeMeta);
    const episode = await this.findEpisode(project.id);
    const [shotAgg] = episode
      ? await db
          .select({ n: sql<number>`count(*)::int` })
          .from(storyboards)
          .where(eq(storyboards.episodeId, episode.id))
      : [{ n: 0 }];
    const [assetAgg] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(projectAssets)
      .where(eq(projectAssets.projectId, project.id));
    const shotCount = shotAgg?.n ?? 0;
    const assetCount = assetAgg?.n ?? 0;

    /** 还没做的步骤（按五段依赖顺序） */
    const pending: AdLlmAction[] = [];
    if (meta.selling_points.length === 0) pending.push("selling_point");
    if (meta.briefs.length === 0) pending.push("brief");
    if (!meta.script || !meta.script.text) pending.push("script");
    if (shotCount === 0) pending.push("storyboard");
    if (assetCount === 0) pending.push("asset_extract");
    if (assetCount > 0 && meta.image_tips.length === 0) pending.push("image_tips");

    const steps: Array<{ action: string; label: string; mode: string; model: string; credits: number }> = [];
    for (const action of pending) {
      const priced = await this.priceStep(auth.spaceId, action, input.model);
      if (!priced) continue;
      steps.push({
        action,
        label: AD_LLM_MODE[action],
        mode: priced.mode,
        model: priced.model,
        credits: priced.credits,
      });
    }
    const totalCredits = steps.reduce((sum, s) => sum + s.credits, 0);

    let mediaEstimate: null | {
      shots: number;
      image_credits: number;
      video_credits: number;
      total_credits: number;
      basis: string;
    } = null;
    if (input.include_media) {
      const shots = Math.max(1, Math.min(input.shot_count ?? (shotCount > 0 ? shotCount : AD_SHOT_COUNT.fast), 30));
      const cheapest = await this.cheapestMediaPrices();
      if (cheapest) {
        mediaEstimate = {
          shots,
          image_credits: cheapest.image * shots,
          video_credits: cheapest.video * shots,
          total_credits: (cheapest.image + cheapest.video) * shots,
          basis:
            `按目录中最低价图像档（${cheapest.image} 积分/张）与最低价视频档（${cheapest.video} 积分/镜）估算；` +
            "实际按逐镜 /credits/quote 结算",
        };
      }
    }

    return {
      project_id: String(project.id),
      steps,
      total_credits: totalCredits,
      media_estimate: mediaEstimate,
      note: "文本步骤用目录真实单价（文本模型按次计价）；media_estimate 仅预算参考，不预扣",
    };
  }

  // ══════════════════════════════════════════════════════════
  // 内部：计价 → 冻结 → 生成 → 写入+结算
  // ══════════════════════════════════════════════════════════

  /**
   * 一次付费生成动作 = 报价 → 建任务+冻结 → 生成 → **业务写入+结算同事务** → 失败解冻。
   *
   * 为什么 persist 与 settle 必须同事务：内容落库成功但结算失败，会留下"冻结永不释放"；
   * 反过来先结算后写库，写库失败就变成"扣了钱没内容"。两者都只能靠同事务消除。
   */
  private async chargeAndPersist<V>(params: {
    action: AdLlmAction;
    auth: AuthContext;
    projectId: bigint;
    prompt: string;
    model?: string;
    produce: () => Promise<V>;
    persist: (tx: Tx, value: V) => Promise<void>;
  }): Promise<{ task_id: string; credits: number; mode: string; model: string }> {
    const priced = await this.priceStep(params.auth.spaceId, params.action, params.model);
    if (!priced) {
      throw new AppError(ErrorCode.INVALID_PARAM, "no priced text model in catalog for this action", {
        field: "model",
        action: params.action,
      });
    }
    if (!priced.sufficient) {
      throw new AppError(ErrorCode.INSUFFICIENT_BALANCE, "Insufficient Balance", {
        required: priced.credits,
        balance: priced.balance,
      });
    }

    const taskId = newId();
    await db.transaction(async (tx) => {
      await tx.insert(tasks).values({
        id: taskId,
        spaceId: BigInt(params.auth.spaceId),
        userId: BigInt(params.auth.userId),
        capability: "text",
        mode: priced.mode,
        modelId: priced.modelId,
        input: { prompt: params.prompt, project_id: String(params.projectId), action: params.action },
        options: { resolution: "per_call", count: 1 },
        status: TASK_STATUS.RUNNING,
        progress: 10,
        creditsFrozen: priced.credits,
      });
      await freezeCredits(tx, {
        spaceId: BigInt(params.auth.spaceId),
        cost: priced.credits,
        taskId,
        memo: `ad-drama ${params.action}`,
      });
      await tx.insert(taskEvents).values({
        id: newId(),
        taskId,
        type: "task.created",
        payload: { action: params.action, mode: priced.mode, model: priced.model },
      });
    });

    try {
      const produced = await params.produce();
      await db.transaction(async (tx) => {
        await params.persist(tx, produced);
        await settleCredits(tx, {
          spaceId: BigInt(params.auth.spaceId),
          cost: priced.credits,
          taskId,
          memo: `ad-drama ${params.action} settled`,
        });
        await tx
          .update(tasks)
          .set({
            status: TASK_STATUS.DONE,
            progress: 100,
            creditsSettled: priced.credits,
            finishedAt: new Date(),
          })
          .where(eq(tasks.id, taskId));
        await tx.insert(taskEvents).values({
          id: newId(),
          taskId,
          type: "task.done",
          payload: { action: params.action, credits: priced.credits },
        });
      });
      // 扣费留痕（info 里能回答"这一步花了多少"）——单独一次写入，失败不影响内容与结算
      await this.appendCharge(params.projectId, {
        action: params.action,
        credits: priced.credits,
        task_id: String(taskId),
        at: new Date().toISOString(),
      });
      return { task_id: String(taskId), credits: priced.credits, mode: priced.mode, model: priced.model };
    } catch (error) {
      // 补偿：解冻 + 任务失败（不让冻结悬空）
      await db.transaction(async (tx) => {
        await unfreezeCredits(tx, {
          spaceId: BigInt(params.auth.spaceId),
          cost: priced.credits,
          taskId,
          memo: `ad-drama ${params.action} failed refund`,
        });
        await tx
          .update(tasks)
          .set({
            status: TASK_STATUS.FAILED,
            error: { message: error instanceof Error ? error.message : String(error) },
            finishedAt: new Date(),
          })
          .where(eq(tasks.id, taskId));
        await tx.insert(taskEvents).values({
          id: newId(),
          taskId,
          type: "task.failed",
          payload: { action: params.action },
        });
      });
      throw error;
    }
  }

  private async appendCharge(projectId: bigint, charge: AdModeMeta["charges"][number]): Promise<void> {
    const [row] = await db.select().from(scriptProjects).where(eq(scriptProjects.id, projectId));
    if (!row) return;
    const meta = readAdMeta(row.modeMeta);
    meta.charges = [...meta.charges, charge].slice(-20);
    await db.update(scriptProjects).set({ modeMeta: meta, updatedAt: new Date() }).where(eq(scriptProjects.id, projectId));
  }

  /** 用目录真实价算一步（找不到文本模型 / 该 mode 没价 → null，由调用方决定报错） */
  private async priceStep(spaceId: string, action: AdLlmAction, modelName?: string) {
    const model = modelName ? await this.findModelByName(modelName) : await this.defaultTextModel();
    if (!model) return null;
    try {
      const priced = await this.credits.price(
        {
          mode: AD_LLM_MODE[action],
          model: model.name,
          input: { prompt: "ad-drama step", reference_uris: [] },
          options: {
            ratio: "9:16",
            resolution: "per_call",
            duration: 5,
            count: 1,
            enable_audio: true,
            mouth_drive: false,
          },
        },
        spaceId,
      );
      return {
        credits: priced.credits,
        model: model.name,
        modelId: priced.model.id,
        mode: priced.mode,
        balance: priced.balance,
        sufficient: priced.sufficient,
      };
    } catch (error) {
      // 目录里该 mode 没价 → 当作"这一步不可计价"，由调用方报 400101 而不是 500
      if (error instanceof AppError && error.code === ErrorCode.INVALID_PARAM) return null;
      throw error;
    }
  }

  private async defaultTextModel() {
    const [row] = await db
      .select()
      .from(models)
      .where(and(eq(models.capability, "text"), eq(models.visible, true)))
      .orderBy(asc(models.sort), asc(models.id))
      .limit(1);
    return row ?? null;
  }

  private async findModelByName(name: string) {
    const [row] = await db.select().from(models).where(eq(models.name, name));
    return row ?? null;
  }

  /** 最低价图像/视频档（`project/point` 的 media 估算用；任一缺失 → null，不臆造） */
  private async cheapestMediaPrices(): Promise<{ image: number; video: number } | null> {
    const rows = await db
      .select({ capability: models.capability, credits: sql<number>`min(${modelPrices.credits})::int` })
      .from(modelPrices)
      .innerJoin(models, eq(modelPrices.modelId, models.id))
      .where(and(eq(modelPrices.active, true), eq(models.visible, true)))
      .groupBy(models.capability);
    const image = rows.find((r) => r.capability === "image")?.credits;
    const video = rows.find((r) => r.capability === "video")?.credits;
    if (image == null || video == null) return null;
    return { image: Number(image), video: Number(video) };
  }

  // ══════════════════════════════════════════════════════════
  // 内部：查询与写入
  // ══════════════════════════════════════════════════════════

  /** 跨 space / 非广告剧 / 已归档 一律 404（不泄露存在性），与 `script.service.findProject` 同口径 */
  private async findAdProject(spaceId: bigint, projectId: string): Promise<ProjectRow> {
    let id: bigint;
    try {
      id = BigInt(projectId);
    } catch {
      throw new AppError(ErrorCode.INVALID_PARAM, "invalid project id", { field: "id" });
    }
    const [row] = await db
      .select()
      .from(scriptProjects)
      .where(and(eq(scriptProjects.id, id), eq(scriptProjects.spaceId, spaceId), isNull(scriptProjects.archivedAt)));
    if (!row || row.projectMode !== AD_PROJECT_MODE) {
      throw new AppError(ErrorCode.NOT_FOUND, "ad-drama project not found");
    }
    return row;
  }

  /**
   * 商品图校验：竞品传的是 `file_id`（`commands/ad.md:61`），我方接受
   * **本空间的资产 id** 或一个 uri。传入他人空间的资产 id 必须拒绝——
   * 否则 A 团队能把 B 团队未公开的商品图挂到自己的广告剧上（跨租户泄露素材）。
   */
  private async assertMaterialImage(spaceId: bigint, raw: string): Promise<void> {
    const value = raw.trim();
    if (!/^\d+$/.test(value)) return; // 非纯数字按 uri 处理（不解析、不取内容）
    const [row] = await db.select({ spaceId: assets.spaceId }).from(assets).where(eq(assets.id, BigInt(value)));
    if (!row) {
      throw new AppError(ErrorCode.INVALID_PARAM, "material_image asset not found", { field: "material_image" });
    }
    if (row.spaceId !== spaceId) {
      throw new AppError(ErrorCode.FORBIDDEN, "material_image belongs to another space", {
        field: "material_image",
      });
    }
  }

  private async findEpisode(projectId: bigint): Promise<EpisodeRow | null> {
    const [row] = await db
      .select()
      .from(episodes)
      .where(eq(episodes.projectId, projectId))
      .orderBy(asc(episodes.epNo))
      .limit(1);
    return row ?? null;
  }

  private async findEpisodeTx(tx: Tx, projectId: bigint): Promise<EpisodeRow | null> {
    const [row] = await tx
      .select()
      .from(episodes)
      .where(eq(episodes.projectId, projectId))
      .orderBy(asc(episodes.epNo))
      .limit(1);
    return row ?? null;
  }

  /** 广告剧只有 1 集（ep_no=1）；已存在则更新正文 */
  private async upsertEpisode(tx: Tx, projectId: bigint, scriptText: string, title: string): Promise<bigint> {
    const existing = await this.findEpisodeTx(tx, projectId);
    if (existing) {
      await tx.update(episodes).set({ scriptText, title, updatedAt: new Date() }).where(eq(episodes.id, existing.id));
      return existing.id;
    }
    const id = newId();
    await tx.insert(episodes).values({ id, projectId, epNo: 1, title, scriptText, status: 1 });
    return id;
  }

  private async writeMeta(tx: Tx, projectId: bigint, meta: AdModeMeta): Promise<void> {
    assertMetaSize(meta);
    await tx
      .update(scriptProjects)
      .set({ modeMeta: meta, updatedAt: new Date() })
      .where(eq(scriptProjects.id, projectId));
  }

  /** 五段进度：done 由"这一步的产物是否存在"判定，不靠状态位自述 */
  private computeStages(meta: AdModeMeta, shotCount: number, assetCount: number) {
    return AD_STAGES.map((stage) => {
      const done =
        stage.key === "selling_point"
          ? meta.selling_points.length > 0
          : stage.key === "brief"
            ? Boolean(meta.selected_brief)
            : stage.key === "script"
              ? Boolean(meta.script && meta.script.text)
              : stage.key === "storyboard"
                ? shotCount > 0
                : assetCount > 0;
      const count =
        stage.key === "selling_point"
          ? meta.selling_points.length
          : stage.key === "brief"
            ? meta.briefs.length
            : stage.key === "script"
              ? meta.script?.text
                ? 1
                : 0
              : stage.key === "storyboard"
                ? shotCount
                : assetCount;
      return { stage: stage.stage, key: stage.key, name: stage.name, done, count };
    });
  }

  private toProjectDto(project: ProjectRow) {
    return {
      id: String(project.id),
      space_id: String(project.spaceId),
      title: project.title,
      ratio: project.ratio,
      /** 1 普通剧本 / 2 广告剧 / 3 视频转绘（schema.ts:440-447） */
      project_mode: project.projectMode,
      status: project.status,
      created_at: project.createdAt.toISOString(),
      updated_at: project.updatedAt.toISOString(),
    };
  }

  private toAssetDto(row: AssetRow) {
    return {
      id: String(row.id),
      kind: row.kind,
      name: row.name,
      description: row.description,
      prompt: row.prompt,
      ref_image_uri: row.refImageUri,
      status: row.status,
    };
  }

  private toShotDto(row: ShotRow) {
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
}
