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
  /** 火山方舟（Ark）专用协议 */
  ark?: ArkVideoConfig;
}

const sharedMock = new MockAdapter();

// adapter_code → 实例。真实供应商（火山/百炼/可灵/Vidu）在 P1.4 逐个实现；
// 当前 real 模式只有 DeepSeek 文本适配器，未知 code 显式报错，不静默 mock。
export function resolveAdapter(code: string, options: AdapterRuntimeOptions): ModelAdapter {
  if (options.mode === "mock") return sharedMock;

  if (code === "deepseek:chat") {
    if (!options.deepseek?.apiKey) {
      throw new Error("deepseek adapter requires DEEPSEEK_API_KEY");
    }
    return new DeepSeekChatAdapter(options.deepseek);
  }
  // 火山方舟专用协议（volcengine:*）；其余供应商可走通用 HTTP 网关
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

export { ArkVideoAdapter, DeepSeekChatAdapter, HttpVideoAdapter, MockAdapter };
