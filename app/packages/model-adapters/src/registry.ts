import { ArkImageAdapter, type ArkImageConfig } from "./ark-image";
import { ArkVideoAdapter, type ArkVideoConfig } from "./ark-video";
import { DeepSeekChatAdapter, type DeepSeekConfig } from "./deepseek";
import { HttpVideoAdapter, type HttpVideoConfig } from "./http-video";
import { MockAdapter, type MockAdapterOptions } from "./mock";
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
}

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
    code.startsWith("tomoviee:")
  ) {
    throw new Error(`vendor adapter not implemented yet: ${code} (use ADAPTER_MODE=mock for local)`);
  }
  throw new Error(`unknown adapter_code: ${code}`);
}

export { ArkImageAdapter, ArkVideoAdapter, DeepSeekChatAdapter, HttpVideoAdapter, MockAdapter };
