import { Injectable } from "@nestjs/common";
import type { z } from "zod";
import {
  AppError,
  ErrorCode,
  assetExtractResultSchema,
  charactersSchema,
  outlineSchema,
  scriptDraftSchema,
  storyboardsSchema,
  type AssetExtractResult,
  type CharactersResult,
  type OutlineResult,
  type ScriptDraftResult,
  type StoryboardsResult,
} from "@app/shared";
import { DeepSeekChatAdapter } from "@app/model-adapters";
import { env } from "../../config/env";
import { resolveModerationWords } from "../moderation/moderation.service";

// P3 AI 提取资产：mock 确定性候选池（同一输入 → 同一批资产名，便于幂等复跑）
const MOCK_SCENE_POOL = [
  "雨夜街头",
  "旧仓库",
  "出租屋天台",
  "医院走廊",
  "深夜咖啡馆",
  "地下车库",
  "废弃教堂",
  "河堤长椅",
  "老式办公室",
  "酒店大堂",
] as const;
const MOCK_PROP_POOL = [
  "旧怀表",
  "匿名信",
  "录音笔",
  "红色雨伞",
  "金属打火机",
  "泛黄照片",
  "老式钥匙",
  "日记本",
  "病历袋",
  "银色项链",
] as const;
const MOCK_CHARACTER_POOL = ["林晚", "顾沉", "苏禾", "周野", "陈默", "叶青"] as const;

/** 文本 → 稳定 32 位种子（mock 模式按内容确定性取候选池） */
function textSeed(text: string): number {
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  }
  return hash;
}

/** 从固定候选池按种子偏移取 count 个（不超过池长度，保证同批不重名） */
function pickFromPool(pool: readonly string[], count: number, seed: number): string[] {
  if (pool.length === 0) return [];
  const size = Math.min(count, pool.length);
  const offset = seed % pool.length;
  return Array.from({ length: size }, (_, i) => pool[(offset + i) % pool.length]!);
}

// LLM 步骤：mock 确定性输出（本地/CI），real 走 DeepSeek（JSON 强约束 + Zod 校验 + 输出审核）
@Injectable()
export class LlmService {
  private readonly deepseek =
    env.LLM_MODE === "real" && env.DEEPSEEK_API_KEY
      ? new DeepSeekChatAdapter({
          apiKey: env.DEEPSEEK_API_KEY,
          baseUrl: env.DEEPSEEK_BASE_URL,
          model: env.DEEPSEEK_MODEL,
        })
      : null;

  async outline(sourceText: string): Promise<OutlineResult> {
    if (!this.deepseek) {
      const excerpt = sourceText.slice(0, 80).replace(/\s+/g, " ");
      return outlineSchema.parse({
        episodes: [1, 2, 3].map((ep) => ({
          ep_no: ep,
          title: `第${ep}集 ${ep === 1 ? "开端" : ep === 2 ? "转折" : "决战"}`,
          synopsis:
            ep === 1
              ? `主角在日常中卷入冲突（素材：${excerpt || "一句话想法"}）。`
              : ep === 2
                ? "矛盾升级，盟友出现，主角做出关键选择。"
                : "正面对决，伏笔回收，为下一季留下钩子。",
        })),
      });
    }
    const result = await this.complete<OutlineResult>(
      "你是短剧编剧。把用户提供的素材拆成分集大纲。只输出 JSON：{\"episodes\":[{\"ep_no\":1,\"title\":\"\",\"synopsis\":\"\"}]}，3~6 集，每集梗概 50~150 字。",
      sourceText.slice(0, 12_000),
      outlineSchema,
    );
    return result;
  }

  async characters(sourceText: string, count: number): Promise<CharactersResult> {
    if (!this.deepseek) {
      const names = ["林晚", "顾沉", "苏禾", "周野", "陈默", "叶青", "陆离", "白露", "沈川", "夏至"];
      return charactersSchema.parse({
        characters: Array.from({ length: Math.max(1, Math.min(count, 10)) }, (_, i) => ({
          name: names[i % names.length],
          description: i === 0 ? "主角，坚韧克制，背负秘密" : `关键配角 ${i + 1}，推动主线冲突`,
          prompt: `${names[i % names.length]}，中国大陆短剧角色，电影感肖像，清晰五官，${i === 0 ? "冷色光影" : "暖色光影"}`,
        })),
      });
    }
    return this.complete<CharactersResult>(
      `你是短剧角色设计师。从素材中抽取不超过 ${count} 个角色。只输出 JSON：{"characters":[{"name":"","description":"","prompt":"用于文生图的中文提示词"}]}。`,
      sourceText.slice(0, 12_000),
      charactersSchema,
    );
  }

  async scriptDraft(input: { title: string; synopsis: string; sourceText: string; instructions?: string }): Promise<ScriptDraftResult> {
    if (!this.deepseek) {
      return scriptDraftSchema.parse({
        script_text: [
          `【${input.title}】`,
          `场景一 · 日 · 内`,
          `（${input.synopsis}）`,
          `林晚：这件事没有你想的那么简单。`,
          `顾沉：那你就告诉我，真相到底是什么。`,
          `（两人对视，镜头缓慢推近，音乐起。）`,
          input.instructions ? `\n（调整要求：${input.instructions}）` : "",
        ].join("\n"),
      });
    }
    return this.complete<ScriptDraftResult>(
      "你是短剧编剧。根据大纲写一集可拍摄剧本（场景/动作/对白）。只输出 JSON：{\"script_text\":\"\"}。",
      JSON.stringify(input),
      scriptDraftSchema,
    );
  }

  async storyboards(input: { title: string; synopsis: string; scriptText: string; shotCount: number; characterNames?: string[] }): Promise<StoryboardsResult> {
    if (!this.deepseek) {
      const shots = Array.from({ length: input.shotCount }, (_, i) => ({
        shot_no: i + 1,
        shot_desc:
          i === 0
            ? "全景：夜色中的城市天际线，镜头缓慢下摇到街角"
            : i === input.shotCount - 1
              ? "特写：主角眼神坚定，画面定格，字幕升起"
              : `中景：人物动作推进第 ${i + 1} 个节拍，镜头跟随`,
        video_prompt: `电影感短剧镜头，${input.title}，${i === 0 ? "城市夜景" : "人物对峙"}，9:16 竖屏，光线克制，浅景深`,
        duration_s: 5,
        ratio: "9:16",
        resolution: "720p",
        character_names: input.characterNames?.length ? [input.characterNames[0]!] : [],
      }));
      return storyboardsSchema.parse({ storyboards: shots });
    }
    return this.complete<StoryboardsResult>(
      `你是分镜师。把剧本拆成恰好 ${input.shotCount} 个镜头；角色名单：${(input.characterNames ?? []).join("、") || "无"}。只输出 JSON：{"storyboards":[{"shot_no":1,"shot_desc":"","video_prompt":"","duration_s":5,"ratio":"9:16","resolution":"720p","character_names":[]}]}。`,
      JSON.stringify(input).slice(0, 20_000),
      storyboardsSchema,
    );
  }

  /**
   * P3 AI 提取资产：从剧本/分集内容抽取场景/道具（可选角色）清单。
   * mock：按输入文本种子从固定候选池确定性派生（同一输入 → 同一批名称，幂等复跑友好）；
   * real：DeepSeek 只输出 JSON，过 zod + 既有输出审核（745802）。
   */
  async extractAssets(input: {
    title: string;
    synopsis?: string;
    scriptText?: string;
    sourceText?: string;
    maxScenes?: number;
    maxProps?: number;
  }): Promise<AssetExtractResult> {
    const title = input.title.trim() || "短剧";
    if (!this.deepseek) {
      const seed = textSeed(
        [input.title, input.synopsis ?? "", input.scriptText ?? "", input.sourceText ?? ""].join("\n"),
      );
      const sceneCount = Math.max(1, Math.min(input.maxScenes ?? 3, 10));
      const propCount = Math.max(1, Math.min(input.maxProps ?? 3, 10));
      const scenes = pickFromPool(MOCK_SCENE_POOL, sceneCount, seed).map((name) => ({
        name,
        description: `《${title}》中的关键场景：${name}。`,
        prompt: `电影感短剧场景，${name}，《${title}》，9:16 竖屏，光影克制，浅景深，写实质感`,
      }));
      const props = pickFromPool(MOCK_PROP_POOL, propCount, seed >>> 3).map((name) => ({
        name,
        description: `推动《${title}》剧情的关键道具：${name}。`,
        prompt: `电影感短剧道具特写，${name}，《${title}》，9:16 竖屏，浅景深，细节清晰`,
      }));
      const characters = pickFromPool(MOCK_CHARACTER_POOL, 3, seed >>> 5).map((name) => ({
        name,
        description: `《${title}》中的主要角色：${name}。`,
        prompt: `电影感短剧角色肖像，${name}，《${title}》，9:16 竖屏，清晰五官，冷色光影`,
      }));
      return assetExtractResultSchema.parse({ scenes, props, characters });
    }
    const payload = JSON.stringify({
      title: input.title,
      synopsis: input.synopsis ?? "",
      scriptText: (input.scriptText ?? "").slice(0, 12_000),
      sourceText: (input.sourceText ?? "").slice(0, 12_000),
      maxScenes: input.maxScenes ?? 6,
      maxProps: input.maxProps ?? 6,
    }).slice(0, 20_000);
    return this.complete<AssetExtractResult>(
      '你是短剧制片与美术指导。从剧本内容中提取可复用的「场景」与「道具」，并可选提取主要「角色」。' +
        '只输出 JSON：{"scenes":[{"name":"","description":"","prompt":""}],"props":[{"name":"","description":"","prompt":""}],"characters":[{"name":"","description":"","prompt":""}]}。' +
        'name 简洁不超过 50 字（如「雨夜街头」「旧怀表」）；description 一句话；prompt 为中文文生图提示词（含构图/光线/质感），不要输出 JSON 之外的任何文字。',
      payload,
      assetExtractResultSchema,
    );
  }

  private async complete<T>(system: string, user: string, schema: z.ZodTypeAny): Promise<T> {
    if (!this.deepseek) throw new AppError(ErrorCode.INTERNAL, "LLM not configured");
    const { text } = await this.deepseek.chat(
      [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      { temperature: 0.3 },
    );
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new AppError(ErrorCode.VENDOR_ERROR, "LLM output is not JSON");
    let parsed: unknown;
    try {
      parsed = JSON.parse(match[0]);
    } catch {
      throw new AppError(ErrorCode.VENDOR_ERROR, "LLM output JSON parse failed");
    }
    const result = schema.safeParse(parsed);
    if (!result.success) {
      throw new AppError(ErrorCode.VENDOR_ERROR, "LLM output schema invalid", {
        issues: result.error.issues.slice(0, 3),
      });
    }
    // PRD F7：LLM 输出同样过审（大纲/剧本/分镜提示词），未过返回 745802 且不落半写状态
    this.assertOutput(result.data);
    return result.data as T;
  }

  // 输出审核：命中敏感词 → 745802（环节由调用方定位）
  private assertOutput(value: unknown): void {
    if (!env.MODERATION_ENABLED) return;
    const words = resolveModerationWords();
    const text = JSON.stringify(value ?? "").toLowerCase();
    const hit = words.find((word) => text.includes(word.toLowerCase()));
    if (hit) {
      throw new AppError(ErrorCode.OUTPUT_REJECTED, "生成内容未通过审核，请改写后重试", {
        keyword: hit,
      });
    }
  }
}
