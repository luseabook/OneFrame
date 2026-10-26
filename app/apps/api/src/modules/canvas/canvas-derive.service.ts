import { Inject, Injectable } from "@nestjs/common";
import { and, eq, isNull } from "drizzle-orm";
import { canvasNodes } from "@app/db";
import { AppError, ErrorCode, generationRequestSchema, newId } from "@app/shared";
import { db } from "../../db/database";
import { GenerationsService } from "../generations/generations.service";
import { ModelsService } from "../models/models.service";

/** 画布当前支持的「文本类派生」能力（与 `TextMode` 一致） */
export type DeriveKind = "script_optimization" | "storyboard_parse" | "asset_extraction";

/** 与契约 §3.4 一致：原文上限 5 万字（400104） */
const SOURCE_MAX = 50_000;

/** 允许发起文本派生的节点类型：剧本与文本（其余类型没有"原文"这个概念） */
const ALLOWED_NODE_TYPES = new Set(["script", "text", "director"]);

export interface DeriveResult {
  task_id: string;
  status: number;
  credits_estimate: number;
  node: { id: string; status: number; task_id: string };
}

@Injectable()
export class CanvasDeriveService {
  constructor(
    @Inject(GenerationsService) private readonly generations: GenerationsService,
    @Inject(ModelsService) private readonly models: ModelsService,
  ) {}

  /**
   * 文本类派生：剧本优化 / 拆解分镜。
   *
   * 三条不可回退的约束：
   * 1. **一律落 `tasks`**（ADR-003），不另造任务表；冻结/结算/幂等全在 generations 里；
   * 2. **金额与档位来自目录与价目表**：本函数只发 `mode` 与计价单位 `per_call`，
   *    单价由 `model_prices` 决定，运营可在后台改——代码里不出现任何积分数值；
   * 3. **节点只挂 task_id + 状态**：文本结果由 worker 回写 `params.result_text`，
   *    与图片/视频节点的回写路径保持一致（否则又是两套写回逻辑）。
   */
  async derive(
    auth: { spaceId: string; userId: string },
    canvasId: string,
    nodeId: string,
    kind: DeriveKind,
    input: {
      source_text?: string;
      prompt?: string;
      model?: string;
      /** 与参照站一致：拆分资产时用户停在哪个 tab，就优先出哪一类 */
      active_tab?: "character" | "scene" | "prop";
    },
  ): Promise<DeriveResult> {
    const node = await this.requireNode(auth.spaceId, canvasId, nodeId);
    if (!ALLOWED_NODE_TYPES.has(node.nodeType)) {
      throw new AppError(ErrorCode.INVALID_PARAM, `node type ${node.nodeType} has no text source`, {
        field: "node_id",
      });
    }

    const params = (node.params ?? {}) as Record<string, unknown>;
    /**
     * 原文来源按节点实际字段取：剧本节点的原文在 `params.sourceText`
     * （检查器里就填这个字段），`prompt` 是"对产出的额外要求"，不能当原文用——
     * 否则用户写一句"镜头少一点"，我们就把这句话当剧本送去优化了。
     */
    const rawSource =
      input.source_text ??
      (typeof params.sourceText === "string" ? params.sourceText : undefined) ??
      (typeof params.script_text === "string" ? params.script_text : undefined) ??
      (typeof params.content === "string" ? params.content : undefined) ??
      "";
    const source = rawSource.trim();
    if (!source) {
      throw new AppError(ErrorCode.INVALID_PARAM, "node has no text content to derive from", {
        field: "source_text",
      });
    }
    if (source.length > SOURCE_MAX) {
      throw new AppError(ErrorCode.SOURCE_TOO_LONG, "source text exceeds 50000 chars", {
        field: "source_text",
      });
    }

    const model = input.model
      ? await this.models.findByName(input.model)
      : await this.pickTextModel(kind);
    const modes = (model.modes ?? {}) as Record<string, unknown>;
    if (!Object.prototype.hasOwnProperty.call(modes, kind)) {
      throw new AppError(ErrorCode.INVALID_PARAM, `model ${model.name} has no mode ${kind}`, {
        field: "model",
      });
    }

    const parsed = generationRequestSchema.safeParse({
      mode: kind,
      model: model.name,
      scene: null,
      input: { prompt: this.buildPrompt(kind, source, input.prompt, input.active_tab) },
      // 文本模式按次计价：resolution 是"计价单位"占位（目录里声明为 per_call），
      // 不带 duration 档位——具体金额由 model_prices 决定
      options: { resolution: "per_call", count: 1 },
    });
    if (!parsed.success) {
      throw new AppError(ErrorCode.INVALID_PARAM, parsed.error.issues[0]?.message ?? "invalid params", {
        field: parsed.error.issues[0]?.path.join("."),
      });
    }

    const created = await this.generations.create(
      { userId: auth.userId, spaceId: auth.spaceId, jti: String(newId()) },
      parsed.data,
      `canvas-derive:${node.id}:${kind}:${newId()}`,
    );

    const [updated] = await db
      .update(canvasNodes)
      .set({ taskId: BigInt(created.task_id), status: 2, updatedAt: new Date() })
      .where(eq(canvasNodes.id, node.id))
      .returning({ id: canvasNodes.id, status: canvasNodes.status, taskId: canvasNodes.taskId });
    const row = updated!;
    return {
      task_id: created.task_id,
      status: created.status,
      credits_estimate: created.credits_estimate,
      node: { id: String(row.id), status: row.status, task_id: String(row.taskId) },
    };
  }

  private async requireNode(spaceId: string, canvasId: string, nodeId: string) {
    let nid: bigint;
    let cid: bigint;
    try {
      nid = BigInt(nodeId);
      cid = BigInt(canvasId);
    } catch {
      throw new AppError(ErrorCode.INVALID_PARAM, "invalid node_id", { field: "node_id" });
    }
    const [row] = await db
      .select()
      .from(canvasNodes)
      .where(
        and(
          eq(canvasNodes.id, nid),
          eq(canvasNodes.canvasId, cid),
          eq(canvasNodes.spaceId, BigInt(spaceId)),
          isNull(canvasNodes.deletedAt),
        ),
      );
    if (!row) throw new AppError(ErrorCode.NOT_FOUND, "node not found", { node_id: nodeId });
    return row;
  }

  /** 目录里第一个可见且支持该 mode 的文本模型（运营通过目录控制"用哪个 LLM"） */
  private async pickTextModel(kind: DeriveKind) {
    const candidates = await this.models.list({ capability: "text", visible: true });
    const found = candidates.find((item) =>
      Object.prototype.hasOwnProperty.call(item.modes ?? {}, kind),
    );
    if (!found) {
      throw new AppError(ErrorCode.INVALID_PARAM, `no visible text model supports ${kind}`, {
        field: "model",
      });
    }
    return this.models.findByName(found.name);
  }

  private buildPrompt(
    kind: DeriveKind,
    source: string,
    extra?: string,
    activeTab?: "character" | "scene" | "prop",
  ): string {
    const tail = extra?.trim() ? `\n\n额外要求：${extra.trim()}` : "";
    if (kind === "script_optimization") {
      return (
        "优化下面这段剧本：保持人物、情节与集数不变，改善节奏与画面感，" +
        "只输出优化后的剧本正文。\n\n" +
        source +
        tail
      );
    }
    if (kind === "asset_extraction") {
      // 输出必须是可解析的 JSON：前端要按角色/场景/道具分三个 tab 展示，
      // 自由文本没法稳定拆分（这也是参照站把 active_tab 放在请求里的原因）
      const focus =
        activeTab === "character"
          ? "本次重点抽取「角色」，其余两类可以给空数组。"
          : activeTab === "scene"
            ? "本次重点抽取「场景」，其余两类可以给空数组。"
            : activeTab === "prop"
              ? "本次重点抽取「道具」，其余两类可以给空数组。"
              : "";
      return (
        "从下面的剧本里抽取可复用的「角色 / 场景 / 道具」，只输出 JSON：" +
        '{"characters":[{"name":"","description":"","prompt":"中文文生图提示词"}],' +
        '"scenes":[{"name":"","description":"","prompt":""}],' +
        '"props":[{"name":"","description":"","prompt":""}]}。' +
        "name 简洁（如「林晚」「雨夜街头」「旧怀表」），每类不超过 8 个，不要输出 JSON 之外的任何文字。" +
        (focus ? " " + focus : "") +
        "\n\n" +
        source +
        tail
      );
    }
    return (
      "把下面这段剧本拆成分镜清单，每行格式：镜号 | 景别 | 画面描述 | 时长 | 画幅。" +
      "只输出清单。\n\n" +
      source +
      tail
    );
  }
}
