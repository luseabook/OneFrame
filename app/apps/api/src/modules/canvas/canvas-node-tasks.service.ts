import { Inject, Injectable } from "@nestjs/common";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { canvasNodes, canvases, tasks } from "@app/db";
import { AppError, ErrorCode, TaskStatus } from "@app/shared";
import { generationRequestSchema } from "@app/shared";
import { db } from "../../db/database";
import { CreditsService } from "../credits/credits.service";
import { GenerationsService } from "../generations/generations.service";
import { ModelsService } from "../models/models.service";
import type { AuthContext } from "../../common/auth.types";
import type { GenerationRequest } from "@app/shared";

/**
 * 画布节点派生任务（F1 契约 §14.4 C6 / draft §3.4）
 *
 * 角色：把"画布节点上的参数"翻译成既有 `tasks` 体系的请求，**不新建任何任务表**
 * （ADR-003）。本服务只做三件事：
 *   1. 校验节点属于该画布、且类型支持该 mode
 *   2. 把节点的 `params` 映射成 `GenerationRequest`（含 canvas mode → tasks.mode 收敛）
 *   3. 调 GenerationsService 建任务，成功后回写 `canvas_nodes.task_id` + status=2
 *
 * 为什么不复用 `/generations` 端点直接传参：
 * 画布节点的 mode 集合比 tasks.mode 更宽（crop/panorama/story_grid_* 等是后处理子模式），
 * 且节点参数键名与 generations 请求体不同（`settings.ratio` vs `options.ratio`）。
 * 这层映射必须有一个明确位置，否则前端得自己拼请求体、后端就没法做枚举校验。
 */

/**
 * canvas node mode → tasks.mode 收敛表（契约 draft §3.4 明确规定"不得新增 mode"）。
 *
 * 键是节点上的 mode 值，值是既有 `tasks.mode`。后处理类子模式落 `sub_mode`，
 * 不污染 mode 维度——因为 `model_prices` 按 `(model_id, mode, resolution, duration_s)`
 * 定价，每新增一个 mode 都要补价，而补价需要真实的商业决策。
 */
const CANVAS_MODE_MAP: Record<string, { mode: string; subMode?: string }> = {
  // 图像：这些在 tasks.mode 里已有同义值
  text2image: { mode: "text2image" },
  image2image: { mode: "image2image" },
  multi_reference: { mode: "multi_reference" },
  upscale: { mode: "upscale" },
  outpaint: { mode: "outpaint" },
  inpaint: { mode: "inpaint" },
  erase: { mode: "erase" },
  // 图像后处理子模式：mode 落 text2image（同样的计价维度），真实能力靠 sub_mode 表达
  crop: { mode: "image2image", subMode: "crop" },
  panorama: { mode: "text2image", subMode: "panorama" },
  multi_angle_360: { mode: "text2image", subMode: "multi_angle_360" },
  panorama_360: { mode: "text2image", subMode: "panorama_360" },
  lighting: { mode: "text2image", subMode: "lighting" },
  multi_camera_grid_9: { mode: "text2image", subMode: "multi_camera_grid_9" },
  story_grid_4: { mode: "text2image", subMode: "story_grid_4" },
  story_grid_9: { mode: "text2image", subMode: "story_grid_9" },
  story_grid_25: { mode: "text2image", subMode: "story_grid_25" },

  // 视频：直接映射
  text2video: { mode: "text2video" },
  image2video: { mode: "image2video" },
  first_frame: { mode: "first_frame" },
  first_last_frame: { mode: "first_last_frame" },
  universal_reference: { mode: "universal_reference" },
  video_extend: { mode: "video_extend" },
  video_edit: { mode: "video_edit" },
  // 推断映射（契约 §6.3 G-11 标注为推断）
  video_clip: { mode: "video_edit", subMode: "video_clip" },
  video_reference: { mode: "universal_reference", subMode: "video_reference" },
  // 视频后处理
  de_subtitle_auto: { mode: "video_edit", subMode: "de_subtitle_auto" },
  de_subtitle_region: { mode: "video_edit", subMode: "de_subtitle_region" },
  frame_capture: { mode: "video_edit", subMode: "frame_capture" },
  // video_upscale 明确不在 MVP（api-spec §5「走独立能力 Ph2」）→ 不映射，直接拒
};

/** 每种节点类型允许的 mode 集合（防止"文本节点传 text2video"这类错配） */
const NODE_ALLOWED_MODES: Record<string, (mode: string) => boolean> = {
  image: (m) => m in CANVAS_MODE_MAP && !m.includes("video") && !m.includes("subtitle") && m !== "frame_capture",
  video: (m) => m in CANVAS_MODE_MAP && (m.includes("video") || m.includes("frame") || m.includes("subtitle") || m === "universal_reference" || m === "first_frame" || m === "first_last_frame"),
  threeDWorld: (m) => m in CANVAS_MODE_MAP && !m.includes("video") && !m.includes("subtitle"),
  audio: (m) => m === "tts" || m === "voice_clone",
  text: (m) => m === "text2text",
};

export interface NodeGenerateInput {
  mode: string;
  model: string;
  input: { prompt?: string; reference_uris?: string[]; first_frame_uri?: string | null; last_frame_uri?: string | null };
  options?: Record<string, unknown>;
  quote_id?: string;
}

export interface NodeGenerateResult {
  task_id: string;
  status: number;
  credits_estimate: number;
  node: { id: string; status: number; task_id: string | null };
}

export interface BatchItemResult {
  node_id: string;
  task_id?: string;
  submitted: boolean;
  code?: number;
  msg?: string;
  credits_estimate?: number;
}

@Injectable()
export class CanvasNodeTasksService {
  constructor(
    @Inject(GenerationsService) private readonly generations: GenerationsService,
    @Inject(CreditsService) private readonly credits: CreditsService,
    @Inject(ModelsService) private readonly models: ModelsService,
  ) {}

  /** 把节点 params 映射成 GenerationRequest（不落库，纯翻译） */
  async translate(
    nodeType: string,
    params: Record<string, unknown>,
    override: NodeGenerateInput,
    modelCfg: { modeCfg?: Record<string, unknown> },
  ): Promise<GenerationRequest> {
    const canvasMode = String(override.mode);
    const mapped = CANVAS_MODE_MAP[canvasMode];
    if (!mapped) {
      throw new AppError(ErrorCode.INVALID_PARAM, `unsupported canvas mode: ${canvasMode}`, { field: "mode" });
    }
    const allowed = NODE_ALLOWED_MODES[nodeType];
    if (!allowed || !allowed(canvasMode)) {
      throw new AppError(ErrorCode.INVALID_PARAM, `node type ${nodeType} does not accept mode ${canvasMode}`, {
        field: "mode",
        node_type: nodeType,
      });
    }

    const settings = (params.settings ?? {}) as Record<string, unknown>;
    const options: Record<string, unknown> = { ...(override.options ?? {}) };
    const pick = (fromKey: string, toKey: string): void => {
      if (options[toKey] === undefined && settings[fromKey] !== undefined) options[toKey] = settings[fromKey];
    };
    pick("ratio", "ratio");
    pick("resolution", "resolution");
    pick("duration", "duration");
    pick("fps", "fps");
    pick("enableSound", "enable_audio");
    pick("mouthDrive", "mouth_drive");
    pick("count", "count");

    /**
     * **默认值必须来自模型目录，不能硬编码**。
     *
     * 实测：图像模型的分辨率值是 `1K/2K/4K`，视频模型是 `720p/1080p`。
     * 如果这里写死 `720p` 当默认，图像节点第一次投递必然报
     * "resolution 720p not supported"。
     * 这正是 docs/03-frontend/conventions.md §3 的硬规则：
     * 时长/画幅/分辨率一律由 `/models` 目录驱动，禁止写死。
     */
    const cfg = modelCfg.modeCfg ?? {};
    if (options.resolution === undefined && typeof cfg.default_resolution === "string") {
      options.resolution = cfg.default_resolution;
    }
    if (options.duration === undefined && typeof cfg.default_duration === "number") {
      options.duration = cfg.default_duration;
    }
    if (options.count === undefined && typeof cfg.default_count === "number") {
      options.count = cfg.default_count;
    }
    // ratio 目录里没有 default_ratio 字段，取该 mode 支持列表的第一个
    if (options.ratio === undefined) {
      const ratios = cfg.ratios;
      if (Array.isArray(ratios) && typeof ratios[0] === "string") options.ratio = ratios[0];
    }
    // 后处理子模式：不污染 mode 维度，但要让 worker 知道具体做什么
    if (mapped.subMode) options.sub_mode = mapped.subMode;

    const prompt =
      override.input.prompt ??
      (typeof params.prompt === "string" ? params.prompt : "") ??
      "";
    const refs = override.input.reference_uris ?? this.collectReferenceUris(params);

    /**
     * **必须过一遍 generationRequestSchema**：它补齐 options 里剩下的默认值
     * （duration/count/enable_audio...）并做枚举校验。
     * 直接把裸对象传给 GenerationsService 会跳过默认值：
     * `credits.price()` 读到 `options.resolution === undefined` →
     * 报 "resolution undefined not supported"（实测踩过）。
     */
    const parsed = generationRequestSchema.safeParse({
      mode: mapped.mode,
      model: override.model,
      scene: null,
      input: {
        prompt,
        reference_uris: refs,
        first_frame_uri: override.input.first_frame_uri ?? null,
        last_frame_uri: override.input.last_frame_uri ?? null,
      },
      options,
      quote_id: override.quote_id ?? null,
    });
    if (!parsed.success) {
      throw new AppError(ErrorCode.INVALID_PARAM, `invalid generation params: ${parsed.error.issues[0]?.message ?? ""}`, {
        issues: parsed.error.issues,
      });
    }
    // sub_mode 不是 generations schema 的字段，schema 会剥掉它 → 校验后补回
    if (mapped.subMode) {
      (parsed.data.options as Record<string, unknown>).sub_mode = mapped.subMode;
    }
    return parsed.data;
  }

  /** 从节点 params 里收集参考图（referenceAssets/upstreamRefs 的 uri 字段） */
  private collectReferenceUris(params: Record<string, unknown>): string[] {
    const out: string[] = [];
    for (const key of ["referenceAssets", "upstreamRefs"]) {
      const arr = params[key];
      if (!Array.isArray(arr)) continue;
      for (const item of arr) {
        if (typeof item === "string") out.push(item);
        else if (item && typeof item === "object") {
          const uri = (item as Record<string, unknown>).uri ?? (item as Record<string, unknown>).url;
          if (typeof uri === "string" && uri) out.push(uri);
        }
      }
    }
    return out.slice(0, 8);
  }

  private async mustGetCanvasAndNode(spaceId: string, canvasId: string, nodeId: string) {
    const [canvas] = await db
      .select()
      .from(canvases)
      .where(and(eq(canvases.id, BigInt(canvasId)), eq(canvases.spaceId, BigInt(spaceId)), isNull(canvases.deletedAt)));
    if (!canvas) throw new AppError(ErrorCode.NOT_FOUND, "canvas not found");
    const [node] = await db
      .select()
      .from(canvasNodes)
      .where(and(eq(canvasNodes.id, BigInt(nodeId)), eq(canvasNodes.canvasId, canvas.id), isNull(canvasNodes.deletedAt)));
    if (!node) throw new AppError(ErrorCode.NOT_FOUND, "node not found");
    return { canvas, node };
  }

  /** 单节点投递 */
  async generate(
    auth: AuthContext,
    spaceId: string,
    canvasId: string,
    nodeId: string,
    override: NodeGenerateInput,
  ): Promise<NodeGenerateResult> {
    const { node } = await this.mustGetCanvasAndNode(spaceId, canvasId, nodeId);

    // 先查模型目录，拿到该 mode 的真实默认值（分辨率/时长/条数因模型而异，不能硬编码）
    const model = await this.models.findByName(override.model);
    const modes = (model.modes ?? {}) as Record<string, Record<string, unknown>>;
    const canvasModeMapped = CANVAS_MODE_MAP[override.mode];
    const modeCfg = canvasModeMapped ? modes[canvasModeMapped.mode] : undefined;
    if (!modeCfg) {
      throw new AppError(
        ErrorCode.INVALID_PARAM,
        `model ${override.model} does not support ${canvasModeMapped?.mode ?? override.mode}`,
        { field: "model" },
      );
    }

    const request = await this.translate(
      node.nodeType,
      node.params as Record<string, unknown>,
      override,
      { modeCfg },
    );

    // 幂等键：节点 + 请求指纹。同一节点重复点"生成"若参数没变，命中 5 分钟内的缓存结果，
    // 不会重复扣费（GenerationsService 内部按 idemKey 做 setNx）。
    const idemKey = `canvas-node:${nodeId}:${JSON.stringify(request)}`;
    const created = await this.generations.create(auth, request, idemKey);

    // 回写节点：task_id + status=2（生成中）。status 语义见 schema：
    // 1 就绪 2 生成中 3 失败（此前 commit 会用 1..3 覆盖，这里只写 2，成功/失败由 worker 回写）
    const updated = await db
      .update(canvasNodes)
      .set({ taskId: BigInt(created.task_id), status: 2, updatedAt: new Date() })
      .where(eq(canvasNodes.id, node.id))
      .returning({ id: canvasNodes.id, status: canvasNodes.status, taskId: canvasNodes.taskId });

    const row = updated[0]!;
    return {
      task_id: created.task_id,
      status: created.status,
      credits_estimate: created.credits_estimate,
      node: {
        id: String(row.id),
        status: row.status,
        task_id: row.taskId ? String(row.taskId) : null,
      },
    };
  }

  /**
   * 批量投递（≤50）：**逐条独立**，一条失败不连累其它条。
   *
   * 为什么不用事务包起来：生成任务是"逐节点独立的商业动作"，
   * 包事务会导致"第 37 个节点余额不足 → 前 36 个已冻结的积分全部回滚"，
   * 而用户的本意是"能投的都投了"。对齐 api-spec 批量投递的逐项返回语义。
   */
  async batchGenerate(
    auth: AuthContext,
    spaceId: string,
    canvasId: string,
    items: Array<{ node_id: string } & NodeGenerateInput>,
  ): Promise<{ submitted: number; results: BatchItemResult[]; total_credits: number }> {
    if (items.length === 0) {
      throw new AppError(ErrorCode.INVALID_PARAM, "items must not be empty", { field: "items" });
    }
    if (items.length > 50) {
      throw new AppError(ErrorCode.INVALID_PARAM, "items must be <= 50", { field: "items" });
    }

    const results: BatchItemResult[] = [];
    let submitted = 0;
    let totalCredits = 0;

    for (const item of items) {
      const { node_id, ...rest } = item;
      try {
        const r = await this.generate(auth, spaceId, canvasId, node_id, rest);
        results.push({ node_id, task_id: r.task_id, submitted: true, credits_estimate: r.credits_estimate });
        submitted++;
        totalCredits += r.credits_estimate;
      } catch (e) {
        const err = e as { code?: number; message?: string };
        results.push({
          node_id,
          submitted: false,
          code: err.code ?? ErrorCode.INTERNAL,
          msg: err.message ?? "submit failed",
        });
      }
    }
    return { submitted, results, total_credits: totalCredits };
  }

  /**
   * 节点任务状态（含结果）。
   *
   * 为什么不直接复用 `GET /tasks/:id`：画布需要"节点视角"的返回
   * （节点 status + 结果 URI 列表），而 /tasks 返回的是通用任务结构。
   * 这里做一层薄封装，避免前端为了画布节点去理解整个 tasks 语义。
   */
  async nodeTaskStatus(spaceId: string, canvasId: string, nodeId: string, taskId: string) {
    const { node } = await this.mustGetCanvasAndNode(spaceId, canvasId, nodeId);
    if (!node.taskId || String(node.taskId) !== taskId) {
      throw new AppError(ErrorCode.NOT_FOUND, "task does not belong to this node");
    }
    const [task] = await db
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, BigInt(taskId)), eq(tasks.spaceId, BigInt(spaceId))));
    if (!task) throw new AppError(ErrorCode.NOT_FOUND, "task not found");

    return {
      task: {
        task_id: String(task.id),
        status: task.status,
        progress: task.progress,
        results: (task.results as unknown[]) ?? [],
        error: task.error ?? null,
      },
      node: {
        id: String(node.id),
        status: node.status,
        task_id: node.taskId ? String(node.taskId) : null,
      },
    };
  }

  /**
   * 把某一批节点的任务状态同步回来（供前端轮询后一次性刷新画布）。
   *
   * 存在的意义：worker 在任务终态时已回写 canvas_nodes（见 executor.ts），
   * 但前端可能错过 SSE/轮询窗口；这个端点给"打开画布时校正一次"的能力，
   * 避免画布上永远显示"生成中"而实际早就完成了。
   */
  async syncNodeTaskStates(spaceId: string, canvasId: string, nodeIds: string[]) {
    const [canvas] = await db
      .select()
      .from(canvases)
      .where(and(eq(canvases.id, BigInt(canvasId)), eq(canvases.spaceId, BigInt(spaceId)), isNull(canvases.deletedAt)));
    if (!canvas) throw new AppError(ErrorCode.NOT_FOUND, "canvas not found");

    const rows = await db
      .select()
      .from(canvasNodes)
      .where(
        and(
          eq(canvasNodes.canvasId, canvas.id),
          isNull(canvasNodes.deletedAt),
          nodeIds.length > 0 ? inArray(canvasNodes.id, nodeIds.map((id) => BigInt(id))) : undefined,
        ),
      );

    const taskIds = rows.map((r) => r.taskId).filter((t): t is bigint => t !== null);
    const taskRows = taskIds.length
      ? await db.select().from(tasks).where(inArray(tasks.id, taskIds))
      : [];
    const taskMap = new Map(taskRows.map((t) => [String(t.id), t]));

    const updated: Array<{ id: string; status: number; task_id: string | null; task_status: number | null }> = [];
    for (const node of rows) {
      if (!node.taskId) continue;
      const task = taskMap.get(String(node.taskId));
      if (!task) continue;
      // 任务终态 → 节点状态跟着落定：成功=3（就绪/完成），失败=1（回到就绪，允许重投）
      let nextStatus = node.status;
      if (task.status === TaskStatus.SUCCEEDED) nextStatus = 3;
      else if (task.status === TaskStatus.FAILED || task.status === TaskStatus.REVIEW_REJECTED) nextStatus = 1;
      else if (task.status === TaskStatus.RUNNING || task.status === TaskStatus.PENDING) nextStatus = 2;

      if (nextStatus !== node.status) {
        await db
          .update(canvasNodes)
          .set({ status: nextStatus, updatedAt: new Date() })
          .where(eq(canvasNodes.id, node.id));
      }
      updated.push({
        id: String(node.id),
        status: nextStatus,
        task_id: String(node.taskId),
        task_status: task.status,
      });
    }
    return { nodes: updated };
  }
}
