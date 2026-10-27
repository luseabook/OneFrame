import { Inject, Injectable } from "@nestjs/common";
import { env } from "../../config/env";
import { LlmService } from "../script/llm.service";
import {
  AD_BRIEF_CANDIDATES,
  adAssetResultSchema,
  adBriefsResultSchema,
  adImageTipsResultSchema,
  adScriptResultSchema,
  adStoryboardsResultSchema,
  sellingPointsResultSchema,
  type AdAssetResult,
  type AdBriefsResult,
  type AdImageTipsResult,
  type AdScriptResult,
  type AdStoryboardsResult,
  type SellingPointsResult,
} from "./ad.constants";

/** 文本 → 稳定 32 位种子（mock 按内容确定性派生，同一输入永远同一输出） */
function textSeed(text: string): number {
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function pick<T>(pool: readonly T[], index: number): T {
  return pool[index % pool.length]!;
}

const TONE_POOL = ["温情", "紧迫", "幽默", "高级感", "反差"] as const;
const HOOK_POOL = [
  "痛点开场：先让观众看到自己的困局",
  "结果前置：先给效果再讲过程",
  "身份反差：让最不可能的人来用",
  "悬念提问：一句话制造好奇",
  "场景对照：使用前后的两秒对比",
] as const;
const SHOT_POOL = [
  "开篇特写：商品在自然光下缓慢旋转，细节纹理清晰",
  "痛点场景：使用者皱眉的瞬间，环境色调偏冷",
  "转折中景：商品入画，光线转为暖色",
  "卖点特写：核心功能操作手部特写，节奏明快",
  "对比镜头：左右分屏展示使用前后差异",
  "收尾全景：商品与使用者同框，字幕落定品牌名",
] as const;

/** 资产抽取的确定性候选池（与剧本流水线同设计：同输入 → 同输出，便于幂等复跑） */
const AD_SCENE_POOL = [
  "清晨的开放式厨房",
  "通勤地铁车厢",
  "健身房镜面墙",
  "直播间补光台",
  "周末的客厅沙发区",
  "写字楼工位",
  "户外咖啡座",
  "浴室洗漱台",
] as const;
const AD_PROP_POOL = [
  "桌面木纹特写",
  "水杯与手指",
  "包装盒开箱瞬间",
  "悬挂的运动毛巾",
  "手机屏幕特写",
  "行李箱滚轮",
] as const;
const AD_PERSON_POOL = ["通勤白领", "健身教练", "新手妈妈", "学生党", "探店博主"] as const;

/**
 * 广告剧 LLM 服务（mock 确定性 / real 走 DeepSeek）。
 *
 * **不复用** `LlmService` 的 `outline`/`scriptDraft`/`storyboards`：那些是"短剧"提示词，
 * 直接拿来写广告会把剧情节奏、卖点落点、商品出镜率全部带偏（广告是 15~60s 的单点说服，
 * 不是 3 集叙事）。但**复用同一个 LLM 通道**（`LlmService.completeJson`）——mock/real
 * 单一开关（`LLM_MODE`）必须全站一致，各模块自己 new 客户端会让"缺 Key 怎么办"的
 * 策略漂移（`script.module.ts:41-43` 已明确这个理由）。
 */
@Injectable()
export class AdLlmService {
  // 显式 @Inject：esbuild/vitest 不产装饰器元数据
  constructor(@Inject(LlmService) private readonly llm: LlmService) {}

  /** 真实模型是否可用（与 `llm.service.ts:69` 同一判据，只是本模块需要自己判断走哪条路） */
  private get real(): boolean {
    return env.LLM_MODE === "real" && Boolean(env.DEEPSEEK_API_KEY);
  }

  async sellingPoints(input: {
    name: string;
    highlight: string;
    style?: string;
  }): Promise<SellingPointsResult> {
    if (!this.real) {
      const seed = textSeed(`${input.name}|${input.highlight}|${input.style ?? ""}`);
      const base = input.highlight.trim() || "好用不贵";
      const pool = [
        `${base}`,
        `${input.name}：3 秒看懂的核心卖点`,
        `${pick(HOOK_POOL, seed)}——${base}`,
        `真实场景实测：${base}`,
        `对比同价位：${base}`,
      ];
      return sellingPointsResultSchema.parse({ selling_points: pool });
    }
    return this.llm.completeJson<SellingPointsResult>(
      "你是资深效果广告文案。根据商品名与用户给的一句卖点，产出 3~5 条可直接拍的卖点句。" +
        "只输出 JSON：{\"selling_points\":[\"\"]}。每条 ≤ 20 字、可视觉化、不要形容词堆砌。",
      JSON.stringify(input),
      sellingPointsResultSchema,
    );
  }

  async briefs(input: {
    name: string;
    highlight: string;
    sellingPoints: string[];
    count?: number;
  }): Promise<AdBriefsResult> {
    const count = Math.max(1, Math.min(input.count ?? AD_BRIEF_CANDIDATES, 5));
    if (!this.real) {
      const seed = textSeed(`${input.name}|${input.sellingPoints.join("|")}`);
      const briefs = Array.from({ length: count }, (_, i) => {
        const point = input.sellingPoints[i % Math.max(1, input.sellingPoints.length)] ?? input.highlight;
        return {
          title: `${pick(TONE_POOL, seed + i)}向·方案 ${i + 1}`,
          logline: `用「${point}」这一个点打动目标用户，${pick(HOOK_POOL, seed + i * 3)}。`,
          beats: [
            `0-3s 痛点：用户正处在「${input.name}」要解决的那个场景里`,
            `3-8s 转折：${input.name} 入画，${point}`,
            `8-13s 证据：一个可验证的细节（材质/数据/前后对比）`,
            `13-15s 收口：品牌名 + 一句行动号召`,
          ],
          tone: pick(TONE_POOL, seed + i),
        };
      });
      return adBriefsResultSchema.parse({ briefs });
    }
    return this.llm.completeJson<AdBriefsResult>(
      `你是效果广告导演。基于商品与卖点产出恰好 ${count} 个互不相同的 15s 剧情方案（brief）。` +
        "只输出 JSON：{\"briefs\":[{\"title\":\"\",\"logline\":\"\",\"beats\":[\"\"],\"tone\":\"\"}]}。" +
        "beats 3~5 条、按秒标出节拍；logline ≤ 60 字。",
      JSON.stringify(input),
      adBriefsResultSchema,
    );
  }

  async script(input: {
    name: string;
    highlight: string;
    brief: { title: string; logline: string; beats: string[] };
    ratio: string;
  }): Promise<AdScriptResult> {
    if (!this.real) {
      const beats = input.brief.beats.length > 0 ? input.brief.beats : ["痛点", "转折", "收口"];
      const lines = beats.map((beat, i) => {
        const n = i + 1;
        return [
          `【镜头 ${n}】${i === 0 ? "近景" : i === beats.length - 1 ? "全景" : "中景"} · ${input.ratio}`,
          `画面：${beat}`,
          i === beats.length - 1
            ? `字幕：${input.name} —— ${input.highlight}`
            : `旁白：${beat.replace(/^\d+-\d+s\s*/, "")}`,
        ].join("\n");
      });
      return adScriptResultSchema.parse({
        script_text: [`广告剧脚本 · ${input.brief.title}`, input.brief.logline, "", ...lines].join("\n\n"),
      });
    }
    return this.llm.completeJson<AdScriptResult>(
      "你是广告片编剧。把选定的 brief 写成可直接拍的分镜式脚本（镜头号/景别/画面/旁白或字幕）。" +
        "只输出 JSON：{\"script_text\":\"\"}。总时长 15~30s。",
      JSON.stringify(input),
      adScriptResultSchema,
    );
  }

  async storyboards(input: {
    name: string;
    highlight: string;
    scriptText: string;
    shotCount: number;
    ratio: string;
    /** 竞品 `template_type`：1 急速 / 2 至尊（`commands/ad.md:149`） */
    templateType?: number;
  }): Promise<AdStoryboardsResult> {
    if (!this.real) {
      const seed = textSeed(`${input.name}|${input.scriptText}|${input.shotCount}`);
      const shots = Array.from({ length: input.shotCount }, (_, i) => {
        const base = pick(SHOT_POOL, seed + i);
        return {
          shot_no: i + 1,
          shot_desc: base,
          video_prompt:
            `广告质感 ${input.ratio} 竖屏/横屏构图，${base}；商品「${input.name}」为主体，` +
            `卖点「${input.highlight}」需在画面中可辨识，柔光棚拍质感，浅景深，4K 清晰`,
          duration_s: input.templateType === 2 ? 5 : 3,
        };
      });
      return adStoryboardsResultSchema.parse({ storyboards: shots });
    }
    return this.llm.completeJson<AdStoryboardsResult>(
      `你是广告分镜师。把脚本拆成恰好 ${input.shotCount} 个镜头（时长 3~5s/镜）。` +
        "只输出 JSON：{\"storyboards\":[{\"shot_no\":1,\"shot_desc\":\"\",\"video_prompt\":\"\",\"duration_s\":3}]}。" +
        "video_prompt 要含商品名、卖点、构图与光线，可直接喂文生视频。",
      JSON.stringify(input).slice(0, 20_000),
      adStoryboardsResultSchema,
    );
  }

  async imageTips(input: {
    name: string;
    highlight: string;
    assets: Array<{ name: string; kind: string }>;
  }): Promise<AdImageTipsResult> {
    if (!this.real) {
      const tips = input.assets.slice(0, 20).map((asset, i) => {
        const seed = textSeed(`${input.name}|${asset.name}|${i}`);
        return {
          name: asset.name,
          prompt:
            `广告级商品/场景图，主体「${asset.name}」（${asset.kind}），` +
            `${pick(["棚拍白底", "生活场景", "特写质感", "使用中", "对比图"], seed)}，` +
            `与「${input.name}」品牌调性一致，柔光，4K，干净背景`,
        };
      });
      return adImageTipsResultSchema.parse({
        tips: tips.length > 0 ? tips : [{ name: input.name, prompt: `广告商品主图，${input.name}，棚拍白底` }],
      });
    }
    return this.llm.completeJson<AdImageTipsResult>(
      "你是广告美术指导。为每个资产给出一条中文文生图提示词（含构图/光线/质感/背景）。" +
        "只输出 JSON：{\"tips\":[{\"name\":\"\",\"prompt\":\"\"}]}。",
      JSON.stringify(input).slice(0, 20_000),
      adImageTipsResultSchema,
    );
  }

  /**
   * 抽取广告资产（商品 / 场景 / 道具 / 可选角色）。
   *
   * mock 的确定性来自"按商品名种子从固定池取"：同一商品反复抽 → 同一批资产名，
   * 这样重抽时前端不会看到名字乱跳（与剧本流水线 `extractAssets` 同一设计原则，
   * `script/llm.service.ts:21-24`）。
   */
  async assets(input: {
    name: string;
    highlight: string;
    materialImage: string;
    includeCharacters?: boolean;
  }): Promise<AdAssetResult> {
    if (!this.real) {
      const seed = textSeed(`${input.name}|${input.highlight}`);
      const scenes = [pick(AD_SCENE_POOL, seed), pick(AD_SCENE_POOL, seed + 3)];
      const props = [pick(AD_PROP_POOL, seed + 1), pick(AD_PROP_POOL, seed + 4)];
      const characters = [pick(AD_PERSON_POOL, seed + 2)];
      const assets: AdAssetResult["assets"] = [
        {
          kind: "prop",
          name: input.name,
          description: `广告商品本体：${input.highlight}`,
          prompt: `广告商品主图，${input.name}，棚拍白底，硬朗质感，细节清晰，4K`,
          ref_image_uri: input.materialImage || null,
        },
        ...scenes.map((name) => ({
          kind: "scene" as const,
          name,
          description: `《${input.name}》广告片的使用场景：${name}`,
          prompt: `广告生活场景，${name}，${input.name} 正在被使用，自然光，电影感，4K`,
          ref_image_uri: null,
        })),
        ...props.map((name) => ({
          kind: "prop" as const,
          name,
          description: `配合 ${input.name} 出镜的道具：${name}`,
          prompt: `商品广告道具特写，${name}，浅景深，细节清晰，4K`,
          ref_image_uri: null,
        })),
        ...(input.includeCharacters
          ? characters.map((name) => ({
              kind: "character" as const,
              name,
              description: `广告片模特：${name}`,
              prompt: `广告模特肖像，${name}，生活方式质感，自然光，清晰五官，4K`,
              ref_image_uri: null,
            }))
          : []),
      ];
      return adAssetResultSchema.parse({ assets });
    }
    return this.llm.completeJson<AdAssetResult>(
      "你是广告美术指导。为这支广告片抽取可直接生图的资产：商品本体、使用场景、关键道具（可选模特）。" +
        "只输出 JSON：{\"assets\":[{\"kind\":\"prop|scene|character\",\"name\":\"\",\"description\":\"\",\"prompt\":\"\",\"ref_image_uri\":null}]}。" +
        "prompt 为中文文生图提示词（含构图/光线/质感）。",
      JSON.stringify({ ...input, materialImage: undefined }).slice(0, 20_000),
      adAssetResultSchema,
    );
  }
}
