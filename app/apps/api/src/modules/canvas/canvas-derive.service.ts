import { Inject, Injectable } from "@nestjs/common";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { canvasNodes } from "@app/db";
import { AppError, ErrorCode, generationRequestSchema, newId } from "@app/shared";
import { db } from "../../db/database";
import { GenerationsService } from "../generations/generations.service";
import { ModelsService } from "../models/models.service";
import { StorageService } from "../../storage/storage.service";

/** 画布当前支持的「文本类派生」能力（与 `TextMode` 一致） */
export type DeriveKind = "script_optimization" | "storyboard_parse" | "asset_extraction";

/** 文本任务的 mode 集合：三种派生 + 资产匹配 + 视频拆解（后两者不走 derive()，各有入口） */
type TextTaskMode = DeriveKind | "storyboard_asset_match" | "video_parse";

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
    @Inject(StorageService) private readonly storage: StorageService,
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

    return this.createTextTask(
      auth,
      node,
      kind,
      this.buildPrompt(kind, source, input.prompt, input.active_tab),
      model.name,
    );
  }

  /**
   * 分镜 × 资产匹配（参照站 `storyboard-asset-match` / `rematch`）。
   *
   * 契约形态：`{storyboard_node_id, scene_node_ids?, character_node_ids?}` → `{task_id}`。
   * 语义：把「拆分资产」抽出来的角色/场景/道具，按镜头对到分镜上。
   * 仍然是**一条 tasks**（同脊柱、同按次计价、可取消、可重跑），不另造表。
   *
   * 400105（引用资产未定稿）用在这里：资产节点还没有 `prompt` 就等于"没定稿"，
   * 拿空名字去匹配只会得到一堆错配，比直接报错更糟。
   */
  async matchAssets(
    auth: { spaceId: string; userId: string },
    canvasId: string,
    nodeId: string,
    input: {
      storyboard_node_id?: string;
      scene_node_ids?: string[];
      character_node_ids?: string[];
      model?: string;
    },
  ): Promise<DeriveResult> {
    const node = await this.requireNode(auth.spaceId, canvasId, nodeId);
    if (!ALLOWED_NODE_TYPES.has(node.nodeType)) {
      throw new AppError(ErrorCode.INVALID_PARAM, `node type ${node.nodeType} cannot run matching`, {
        field: "node_id",
      });
    }

    // 分镜文本：显式指定节点优先，否则用当前节点自己的派生结果/原文
    const storyboardNode = input.storyboard_node_id
      ? await this.requireNode(auth.spaceId, canvasId, input.storyboard_node_id)
      : node;
    const storyboardParams = (storyboardNode.params ?? {}) as Record<string, unknown>;
    const storyboardText = String(
      (typeof storyboardParams.result_text === "string" && storyboardParams.result_text) ||
        (typeof storyboardParams.sourceText === "string" && storyboardParams.sourceText) ||
        "",
    ).trim();
    if (!storyboardText) {
      throw new AppError(ErrorCode.INVALID_PARAM, "storyboard node has no shots yet, run storyboard-parse first", {
        field: "storyboard_node_id",
      });
    }
    if (storyboardText.length > SOURCE_MAX) {
      throw new AppError(ErrorCode.SOURCE_TOO_LONG, "storyboard text exceeds 50000 chars", {
        field: "storyboard_node_id",
      });
    }

    const assets = await this.loadAssetNodes(auth.spaceId, canvasId, [
      ...(input.character_node_ids ?? []),
      ...(input.scene_node_ids ?? []),
    ]);
    if (assets.length === 0) {
      throw new AppError(ErrorCode.INVALID_PARAM, "no asset nodes to match", {
        field: "character_node_ids",
      });
    }
    const unfinished = assets.filter((item) => !item.prompt);
    if (unfinished.length > 0) {
      throw new AppError(ErrorCode.ASSET_NOT_READY, "referenced asset is not finalized (missing prompt)", {
        node_ids: unfinished.map((item) => item.node_id),
      });
    }

    const model = input.model
      ? await this.models.findByName(input.model)
      : await this.pickTextModel("storyboard_asset_match");
    const prompt = [
      "把下面的分镜清单与候选资产做匹配：每个镜头选出最合适的 1 个角色、1 个场景，以及 0~3 个道具。",
      '只输出 JSON 数组：[{"shot_no":1,"character":"","scene":"","props":[]}]。',
      "只能从给定候选里选，选不到就留空字符串，不要编造新名字。",
      "",
      "【分镜清单】",
      storyboardText,
      "",
      "【候选资产】",
      ...assets.map((item) => `- ${item.kind}：${item.name}`),
    ].join("\n");

    return this.createTextTask(auth, node, "storyboard_asset_match", prompt, model.name);
  }

  /**
   * 视频拆解（拉片）。
   *
   * 契约形态：`{object_key?, prompt?, model?}` → `{task_id, node}`。
   * 输入默认取**视频节点自己已有的产物**（`params.result_uri` / `result_uris[0]`），
   * 也允许显式传 `object_key`（例如素材库里上传的原始视频）。
   *
   * 仍是**一条 tasks**：同脊柱、按次计价、可取消、可重跑；产出是一段 JSON
   * （角色/场景/道具，与「拆分资产」同形），前端复用"一键建资产节点"。
   *
   * 为什么必须先有媒体：没有视频就去拆解，等于让模型凭空编一集片子——
   * 结果是"看起来成功了但全是错的"，比直接报错糟得多（同 400105 的思路）。
   */
  async parseVideo(
    auth: { spaceId: string; userId: string },
    canvasId: string,
    nodeId: string,
    input: { object_key?: string; prompt?: string; model?: string },
  ): Promise<DeriveResult> {
    const node = await this.requireNode(auth.spaceId, canvasId, nodeId);
    if (node.nodeType !== "video") {
      throw new AppError(ErrorCode.INVALID_PARAM, `node type ${node.nodeType} is not a video node`, {
        field: "node_id",
      });
    }

    const params = (node.params ?? {}) as Record<string, unknown>;
    const objectKey = this.pickVideoKey(input.object_key, params);
    if (!objectKey) {
      throw new AppError(ErrorCode.INVALID_PARAM, "video node has no media to parse, generate or upload one first", {
        field: "object_key",
      });
    }
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(objectKey)) {
      this.storage.assertOwnedKey(auth.spaceId, objectKey, "object_key");
    }

    const model = input.model
      ? await this.models.findByName(input.model)
      : await this.pickTextModel("video_parse");
    const modes = (model.modes ?? {}) as Record<string, unknown>;
    if (!Object.prototype.hasOwnProperty.call(modes, "video_parse")) {
      throw new AppError(ErrorCode.INVALID_PARAM, `model ${model.name} has no mode video_parse`, {
        field: "model",
      });
    }

    return this.createTextTask(
      auth,
      node,
      "video_parse",
      this.buildVideoParsePrompt(objectKey, input.prompt),
      model.name,
    );
  }

  /** 视频源：显式 object_key 优先，否则取节点自身产物（result_uri / result_uris / 上传 key） */
  private pickVideoKey(explicit: string | undefined, params: Record<string, unknown>): string {
    const candidates: unknown[] = [
      explicit,
      params.result_uri,
      Array.isArray(params.result_uris) ? params.result_uris[0] : undefined,
      params.object_key,
      params.video_uri,
      params.fileId,
    ];
    for (const item of candidates) {
      if (typeof item === "string" && item.trim()) return item.trim();
    }
    return "";
  }

  /** 候选资产：本画布下的资产节点（可按 ids 收窄），带定稿所需的 prompt */
  private async loadAssetNodes(
    spaceId: string,
    canvasId: string,
    onlyIds: string[],
  ): Promise<Array<{ node_id: string; kind: string; name: string; prompt: string }>> {
    const ids = onlyIds
      .filter((raw) => raw)
      .map((raw) => {
        try {
          return BigInt(raw);
        } catch {
          throw new AppError(ErrorCode.INVALID_PARAM, "invalid asset node id", { value: raw });
        }
      });
    const rows = await db
      .select()
      .from(canvasNodes)
      .where(
        and(
          eq(canvasNodes.canvasId, BigInt(canvasId)),
          eq(canvasNodes.spaceId, BigInt(spaceId)),
          eq(canvasNodes.nodeType, "asset"),
          isNull(canvasNodes.deletedAt),
          ids.length > 0 ? inArray(canvasNodes.id, ids) : undefined,
        ),
      );
    return rows.map((row) => {
      const params = (row.params ?? {}) as Record<string, unknown>;
      return {
        node_id: String(row.id),
        kind: typeof params.assetKind === "string" ? params.assetKind : "asset",
        name: row.name,
        prompt: typeof params.prompt === "string" ? params.prompt : "",
      };
    });
  }

  /** 建文本任务并挂到节点上（三个派生能力 + 资产匹配共用，避免四份复制粘贴） */
  private async createTextTask(
    auth: { spaceId: string; userId: string },
    node: { id: bigint },
    kind: TextTaskMode,
    prompt: string,
    modelName: string,
  ): Promise<DeriveResult> {
    const parsed = generationRequestSchema.safeParse({
      mode: kind,
      model: modelName,
      scene: null,
      input: { prompt },
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
  private async pickTextModel(kind: TextTaskMode) {
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

  /**
   * 视频拆解的提示词。
   *
   * 产出形状与「拆分资产」一致（角色/场景/道具），**不额外编造镜头表**：
   * 参照站里镜头表是另行派生（storyboard-parse）的产物，未取证的部分不臆造（ADR-013）。
   */
  private buildVideoParsePrompt(videoKey: string, extra?: string): string {
    const tail = extra?.trim() ? `\n\n额外要求：${extra.trim()}` : "";
    return (
      "分析下面这段视频（拉片），抽取可复用的「角色 / 场景 / 道具」，只输出 JSON：" +
      '{"characters":[{"name":"","description":"","prompt":"中文文生图提示词"}],' +
      '"scenes":[{"name":"","description":"","prompt":""}],' +
      '"props":[{"name":"","description":"","prompt":""}]}。' +
      "name 简洁（如「林晚」「雨夜街头」「旧怀表」），每类不超过 8 个，" +
      "不要输出 JSON 之外的任何文字。" +
      "\n\n【视频】" +
      videoKey +
      tail
    );
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
