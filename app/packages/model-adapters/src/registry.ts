import { ArkImageAdapter, type ArkImageConfig } from "./ark-image";
import { ArkVideoAdapter, type ArkVideoConfig } from "./ark-video";
import { DeepSeekChatAdapter, type DeepSeekConfig } from "./deepseek";
import { HttpVideoAdapter, type HttpVideoConfig } from "./http-video";
import { LipSyncAdapter, type LipSyncConfig } from "./lip-sync";
import { MockAdapter, type MockAdapterOptions } from "./mock";
import { MusicAdapter, type MusicConfig } from "./music";
import {
  AudioSeparationAdapter,
  AutoBgmAdapter,
  FpsDurationUnifyAdapter,
  ImageInpaintAdapter,
  TextRepaintAdapter,
  TimbreModifyAdapter,
  VideoEffectsAdapter,
} from "./postprocess-tools";
import { SlicingAdapter, type SlicingConfig } from "./slicing";
import { SubtitleEraseAdapter, type SubtitleEraseConfig } from "./subtitle-erase";
import { TtsAdapter, VoiceCloneAdapter, type TtsConfig } from "./tts";
import { UpscaleAdapter, type UpscaleConfig } from "./upscale";
import type { PostprocessHttpConfig } from "./postprocess";
import type { ModelAdapter } from "./types";

export type AdapterMode = "mock" | "real";

export interface AdapterRuntimeOptions {
  mode: AdapterMode;
  mock?: MockAdapterOptions;
  deepseek?: DeepSeekConfig;
  /** 通用 HTTP 视频供应商（火山/百炼网关或自建代理） */
  httpVideo?: HttpVideoConfig;
  /** 火山方舟（Ark）视频任务协议 */
  ark?: ArkVideoConfig;
  /** 火山方舟（Ark）图像生成协议（Seedream）；未配置时回落到 ark 的 Key */
  arkImage?: ArkImageConfig;
  /**
   * 显式把既有 adapter_code 映射到 Ark 图像（运营显式选择）。
   * 例：["tomoviee:image"] → Ark Seedream。未配置时这些 code 保持原有报错行为，
   * 绝不静默切 mock（B 型「能真实收钱跑业务」要求真实产物）。
   */
  arkImageCodes?: string[];
  /**
   * 后处理/单点能力（第 3 批工具箱）：TTS / 音乐音效 / 对口型 / 超分 / 去字幕 / 切片。
   *
   * 这六个能力的供应商协议同形（提交→轮询→取产物），因此共享一个 `postprocess`
   * 配置块；`mock` 字段控制「用该适配器自己的确定性 mock」还是发真实 HTTP。
   * 真实模式下缺 `apiKey` 会在构造时硬失败（见 postprocess.ts 的注释）。
   */
  postprocess?: PostprocessConfig;
}

/** 后处理能力的运行配置（六类共用；各家的差异化字段走 config 覆盖） */
export interface PostprocessConfig {
  /** 真实模式必填；缺少时每个后处理适配器都会显式报错，绝不静默回落 mock */
  apiKey?: string;
  baseUrl?: string;
  /** 该能力在供应商侧是否用同一网关不同路径（默认按各自适配器内置路径） */
  tts?: TtsConfig;
  /** 声音克隆（第 93 批）：与 TTS 共用 HTTP 骨架，路径与请求体不同 */
  voiceClone?: TtsConfig;
  music?: MusicConfig;
  lipSync?: LipSyncConfig;
  upscale?: UpscaleConfig;
  subtitleErase?: SubtitleEraseConfig;
  slicing?: SlicingConfig;
  /** 第 3 批补齐的七个单点能力（同一个 HTTP 骨架，仅路径/请求体不同） */
  videoEffects?: PostprocessHttpConfig;
  fpsUnify?: PostprocessHttpConfig;
  audioSeparation?: PostprocessHttpConfig;
  timbreModify?: PostprocessHttpConfig;
  autoBgm?: PostprocessHttpConfig;
  inpaint?: PostprocessHttpConfig;
  textRepaint?: PostprocessHttpConfig;
}

/**
 * 后处理能力的 adapter_code。
 *
 * 命名规则：`<能力>[:<子能力>]`，与真实供应商无关——同一能力换供应商只改配置不改 code。
 * 这样模型目录里的 adapterCode 稳定，运营换供应商不需要迁移数据。
 * `music:text2sfx` 与 `music:text2music` 是两个 code 但一个适配器（同一接口的 kind 差异）。
 */
export const POSTPROCESS_CODES = {
  tts: "tts",
  /** 声音克隆（第 93 批）：输入参考音频 + 文本，产出用克隆音色朗读的音轨。 */
  voiceClone: "voice-clone",
  music: "music:text2music",
  sfx: "music:text2sfx",
  lipSync: "lip-sync",
  upscale: "upscale",
  subtitleErase: "subtitle-erase",
  slicing: "slicing",
  videoEffects: "video-effects",
  fpsUnify: "fps-unify",
  audioSeparation: "audio-separation",
  timbreModify: "timbre-modify",
  autoBgm: "auto-bgm",
  inpaint: "image-inpaint",
  textRepaint: "text-repaint",
} as const;

const sharedMock = new MockAdapter();

/** Ark 图像协议原生 code（Ark 已配置时即生效） */
const ARK_IMAGE_CODES = ["volcengine:image", "volcengine:seedream"];

function arkImageConfigFrom(options: AdapterRuntimeOptions): ArkImageConfig | undefined {
  if (options.arkImage?.apiKey) return options.arkImage;
  if (options.ark?.apiKey) {
    // 同一 ARK_API_KEY 同时服务视频/图像；模型映射可独立覆盖
    return {
      apiKey: options.ark.apiKey,
      baseUrl: options.ark.baseUrl,
      modelMap: options.ark.modelMap,
    };
  }
  return undefined;
}

/**
 * 后处理能力的配置合成：以 `postprocess` 的公共字段为底，允许每个能力单独覆盖
 * （各家超时/路径不同，但 Key 与 baseUrl 通常共享）。
 */
function postprocessConfig<T extends { apiKey?: string; baseUrl?: string }>(
  options: AdapterRuntimeOptions,
  specific: T | undefined,
): T {
  const shared = options.postprocess ?? {};
  return {
    apiKey: specific?.apiKey ?? shared.apiKey,
    baseUrl: specific?.baseUrl ?? shared.baseUrl,
    ...(specific ?? {}),
  } as T;
}

// adapter_code → 实例。真实供应商（火山/百炼/可灵/Vidu）在 P1.4 逐个实现；
// 未知 code 显式报错，不静默 mock。
export function resolveAdapter(code: string, options: AdapterRuntimeOptions): ModelAdapter {
  if (options.mode === "mock") return sharedMock;

  if (code === "deepseek:chat") {
    if (!options.deepseek?.apiKey) {
      throw new Error("deepseek adapter requires DEEPSEEK_API_KEY");
    }
    return new DeepSeekChatAdapter(options.deepseek);
  }

  // 后处理/单点能力：缺 Key 硬失败（不静默 mock），配置项按能力独立覆盖
  if (code === POSTPROCESS_CODES.tts) {
    return new TtsAdapter(postprocessConfig(options, options.postprocess?.tts));
  }
  if (code === POSTPROCESS_CODES.voiceClone) {
    return new VoiceCloneAdapter(postprocessConfig(options, options.postprocess?.voiceClone));
  }
  if (code === POSTPROCESS_CODES.music || code === POSTPROCESS_CODES.sfx) {
    return new MusicAdapter(
      postprocessConfig(options, options.postprocess?.music),
      code === POSTPROCESS_CODES.sfx ? "text2sfx" : "text2music",
    );
  }
  if (code === POSTPROCESS_CODES.lipSync) {
    return new LipSyncAdapter(postprocessConfig(options, options.postprocess?.lipSync));
  }
  if (code === POSTPROCESS_CODES.upscale) {
    return new UpscaleAdapter(postprocessConfig(options, options.postprocess?.upscale));
  }
  if (code === POSTPROCESS_CODES.subtitleErase) {
    return new SubtitleEraseAdapter(postprocessConfig(options, options.postprocess?.subtitleErase));
  }
  if (code === POSTPROCESS_CODES.slicing) {
    return new SlicingAdapter(postprocessConfig(options, options.postprocess?.slicing));
  }
  if (code === POSTPROCESS_CODES.videoEffects) {
    return new VideoEffectsAdapter(postprocessConfig(options, options.postprocess?.videoEffects));
  }
  if (code === POSTPROCESS_CODES.fpsUnify) {
    return new FpsDurationUnifyAdapter(postprocessConfig(options, options.postprocess?.fpsUnify));
  }
  if (code === POSTPROCESS_CODES.audioSeparation) {
    return new AudioSeparationAdapter(postprocessConfig(options, options.postprocess?.audioSeparation));
  }
  if (code === POSTPROCESS_CODES.timbreModify) {
    return new TimbreModifyAdapter(postprocessConfig(options, options.postprocess?.timbreModify));
  }
  if (code === POSTPROCESS_CODES.autoBgm) {
    return new AutoBgmAdapter(postprocessConfig(options, options.postprocess?.autoBgm));
  }
  if (code === POSTPROCESS_CODES.inpaint) {
    return new ImageInpaintAdapter(postprocessConfig(options, options.postprocess?.inpaint));
  }
  if (code === POSTPROCESS_CODES.textRepaint) {
    return new TextRepaintAdapter(postprocessConfig(options, options.postprocess?.textRepaint));
  }

  // 图像：运营显式把某个既有 code 指向 Ark 图像时，缺 Key 必须硬失败（配置错误要暴露）
  if ((options.arkImageCodes ?? []).includes(code)) {
    const config = arkImageConfigFrom(options);
    if (!config) {
      throw new Error(
        `ark image adapter requires ARK_API_KEY (ARK_IMAGE_REPLACE_CODES lists ${code}, use ADAPTER_MODE=mock for local)`,
      );
    }
    return new ArkImageAdapter(config);
  }

  // 火山方舟专用协议（volcengine:*）：图像走 Seedream 同步接口，视频走异步任务接口
  if (ARK_IMAGE_CODES.includes(code)) {
    const config = arkImageConfigFrom(options);
    if (config) return new ArkImageAdapter(config);
    // Ark 未配置：继续走既有回退（通用网关 → 显式未实现报错），不静默 mock
  }
  if (code.startsWith("volcengine:") && options.ark?.apiKey) {
    return new ArkVideoAdapter(options.ark);
  }
  // 配置了 HTTP 视频网关时，所有视频/图像供应商 code 走通用适配器
  if (options.httpVideo?.baseUrl) {
    return new HttpVideoAdapter(options.httpVideo);
  }
  if (
    code.startsWith("volcengine:") ||
    code.startsWith("aliyun:") ||
    code.startsWith("kling:") ||
    code.startsWith("vidu:") ||
    code.startsWith("tomoviee:") ||
    code.startsWith("minimax:") ||
    code.startsWith("happy-horse:") ||
    code.startsWith("midjourney:") ||
    code.startsWith("google:") ||
    code.startsWith("openai:")
  ) {
    throw new Error(`vendor adapter not implemented yet: ${code} (use ADAPTER_MODE=mock for local)`);
  }
  throw new Error(`unknown adapter_code: ${code}`);
}

export {
  ArkImageAdapter,
  ArkVideoAdapter,
  AudioSeparationAdapter,
  AutoBgmAdapter,
  DeepSeekChatAdapter,
  FpsDurationUnifyAdapter,
  HttpVideoAdapter,
  ImageInpaintAdapter,
  LipSyncAdapter,
  MockAdapter,
  MusicAdapter,
  SlicingAdapter,
  SubtitleEraseAdapter,
  TextRepaintAdapter,
  TimbreModifyAdapter,
  TtsAdapter,
  UpscaleAdapter,
  VideoEffectsAdapter,
  VoiceCloneAdapter,
};
