import { Inject, Injectable, Logger } from "@nestjs/common";
import { z } from "zod";
import { env } from "../../config/env";
import { LlmService } from "../script/llm.service";

/** 画布支持的 11 种节点（与 `canvas_nodes.node_type` 硬约束一致） */
const NODE_TYPES = [
  "text",
  "table",
  "image",
  "video",
  "audio",
  "clip",
  "script",
  "asset",
  "director",
  "threeDWorld",
  "group",
] as const;

const replySchema = z.object({
  reply: z.string().min(1).max(4000),
  content_type: z.union([z.literal(1), z.literal(2), z.literal(3)]).default(1),
  nodes: z
    .array(
      z.object({
        node_type: z.string().max(32),
        name: z.string().max(60),
        params: z.record(z.unknown()).optional(),
      }),
    )
    .max(12)
    .optional(),
  /** 助手认为该真跑一次生成时给出能力与提示词；由调用方用模型目录补全参数 */
  generate: z
    .object({ capability: z.enum(["image", "video"]), prompt: z.string().min(1).max(2000) })
    .nullable()
    .optional(),
});

export type AgentReplyResult = z.infer<typeof replySchema>;

export interface AgentHistoryItem {
  role: 1 | 2 | 3;
  content: string;
}

/**
 * 助手回复引擎。
 *
 * 两条路径共用同一个开关 `LLM_MODE`（与剧本域一致）：
 * - `real`：DeepSeek 出 JSON，过 zod 校验 + 输出审核；
 * - `mock`：**规则式路由**（关键词 → 意图），不是"假装 AI 在思考"。
 *   mock 输出确定性、可断言，CI/E2E 才能验证链路；真实文案质量属 LLM 的职责。
 *
 * 明确不做：让这个服务自己建任务或算积分。它只产出"意图"，
 * 参数补全（模型目录默认值）与投递（tasks/冻结）由 chat 服务负责，
 * 免得"对话逻辑"和"计费逻辑"长在一起。
 */
@Injectable()
export class AgentReplyService {
  private readonly logger = new Logger("agent.reply");

  constructor(@Inject(LlmService) private readonly llm: LlmService) {}

  private get real(): boolean {
    return env.LLM_MODE === "real" && !!env.DEEPSEEK_API_KEY;
  }

  async reply(input: {
    history: AgentHistoryItem[];
    canvas?: { nodeCount: number; nodeTypes: string[]; selectionCount: number } | null;
  }): Promise<AgentReplyResult> {
    const lastUser = [...input.history].reverse().find((item) => item.role === 1)?.content ?? "";
    if (!this.real) return this.ruleBased(lastUser, input.canvas ?? null);

    const system =
      "你是短剧创作画布里的助手。根据用户要求，决定是「只回答」还是「在画布上创建节点」或「发起一次生成」。\n" +
      '只输出 JSON：{"reply":"给用户看的中文回复","content_type":1|2|3,' +
      '"nodes":[{"node_type":"text|table|image|video|audio|clip|script|asset|director|threeDWorld|group","name":"","params":{}}],' +
      '"generate":{"capability":"image|video","prompt":"中文提示词"}}\n' +
      "规则：只是想聊/问问题时只填 reply 且 content_type=1；要往画布上放东西时填 nodes 且 content_type=2；" +
      "要真正跑一次图片或视频生成时填 generate 且 content_type=3（此时不要再填 nodes）。" +
      `当前画布有 ${input.canvas?.nodeCount ?? 0} 个节点，类型：${(input.canvas?.nodeTypes ?? []).join("、") || "空"}。` +
      "不要输出 JSON 之外的任何文字。";
    const user = input.history
      .slice(-12)
      .map((item) => `${item.role === 1 ? "用户" : item.role === 2 ? "助手" : "系统"}：${item.content}`)
      .join("\n");

    try {
      const result = await this.llm.completeJson<AgentReplyResult>(system, user, replySchema);
      return this.sanitize(result);
    } catch (error) {
      // LLM 失败不吞掉：转成一条"可理解"的助手回复 + 由调用方补 error 事件。
      // 直接 500 会让用户已经发出去的话消失在界面上，比"报错但消息还在"更糟。
      this.logger.warn(
        { err: error instanceof Error ? error.message : String(error) },
        "agent reply via llm failed",
      );
      throw error;
    }
  }

  /** 过滤掉模型幻觉出的非法节点类型；过滤后为空则退化成纯文本回复 */
  private sanitize(result: AgentReplyResult): AgentReplyResult {
    const nodes = (result.nodes ?? []).filter((node) =>
      (NODE_TYPES as readonly string[]).includes(node.node_type),
    );
    return {
      reply: result.reply,
      content_type: nodes.length > 0 ? 2 : result.content_type,
      nodes: nodes.length > 0 ? nodes : undefined,
      generate: result.generate ?? null,
    };
  }

  /**
   * 规则式路由（mock）。刻意保持简单可读：它是"确定性替身"，
   * 而不是试图模仿 LLM 的自然语言质量。
   */
  private ruleBased(
    text: string,
    canvas: { nodeCount: number; nodeTypes: string[]; selectionCount: number } | null,
  ): AgentReplyResult {
    const prompt = text.trim();
    if (!prompt) {
      return { reply: "说说你想做什么，我可以帮你往画布上放节点，或者直接生成图片/视频。", content_type: 1, generate: null };
    }

    // 生成视频优先于生成图片判断：否则"生成一段视频"会被"生成…图"的规则抢先
    if (/(视频|镜头|短片|片段)/.test(prompt) && /(生成|做|来|拍|出)/.test(prompt)) {
      return {
        reply: `好，把「${prompt}」作为提示词发起一次视频生成，完成后结果会回到这个会话里。`,
        content_type: 3,
        generate: { capability: "video", prompt: clampPrompt(prompt) },
      };
    }
    // "生成一张图""出图""画张海报"都要命中：口语里"图"很少单独成词但一定会带量词
    if (/(图片|出图|海报|封面|插图|一张图|一幅图|画一|画个|画张)/.test(prompt) && /(生成|画|做|来|出)/.test(prompt)) {
      return {
        reply: `好，按「${prompt}」生成一张图，结果会回填到会话里。`,
        content_type: 3,
        generate: { capability: "image", prompt: clampPrompt(prompt) },
      };
    }

    const wanted = NODE_TYPES.find((type) => prompt.includes(nodeLabel(type)));
    if (wanted && /(节点|加|创建|新建|放)/.test(prompt)) {
      const selected = canvas?.selectionCount ?? 0;
      return {
        reply:
          `准备在画布上创建一个${nodeLabel(wanted)}节点` +
          (selected > 0 ? `，并关联你选中的 ${selected} 个节点。` : "。"),
        content_type: 2,
        nodes: [{ node_type: wanted, name: nodeLabel(wanted) }],
        generate: null,
      };
    }

    return {
      reply:
        `收到：「${prompt.slice(0, 120)}」。我可以帮你把内容拆成画布节点，` +
        `也可以直接生成图片或视频——说「生成一张图」或「生成一段视频」即可。`,
      content_type: 1,
      generate: null,
    };
  }
}

function nodeLabel(type: string): string {
  const map: Record<string, string> = {
    text: "文本",
    table: "表格",
    image: "图片",
    video: "视频",
    audio: "音频",
    clip: "剪辑",
    script: "剧本",
    asset: "资产",
    director: "导演",
    threeDWorld: "三维场景",
    group: "分组",
  };
  return map[type] ?? type;
}

function clampPrompt(text: string): string {
  return text.length > 1000 ? text.slice(0, 1000) : text;
}
