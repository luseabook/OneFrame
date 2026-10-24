import type { ModelAdapter } from "./types";
import { makeStubAdapter } from "./types";

// adapter_code → 实例。P1 接火山（视频+图像），P2 接可灵/Vidu/百炼
// （docs/07-plan/wbs.md；能力矩阵蓝本见 E:\wanxing\rea-reelmate\model-catalog-summary.json）
export const registry: Record<string, ModelAdapter> = {
  "volcengine:stub": makeStubAdapter("volcengine"),
  "aliyun:stub": makeStubAdapter("aliyun"),
  "deepseek:stub": makeStubAdapter("deepseek"),
};

export function getAdapter(code: string): ModelAdapter {
  const adapter = registry[code];
  if (!adapter) {
    throw new Error(`unknown adapter_code: ${code}`);
  }
  return adapter;
}
