/**
 * worker 侧布尔 / 枚举环境变量的取值表（第 124 批）。
 *
 * 只放 spec，不放读取逻辑：读取走 `@app/shared` 的 `readEnvFlag` / `readEnvEnum`
 * （`packages/shared/src/env-flag.ts`）。同一个键被多个模块读时必须共用这里的表，
 * 否则两处接受范围会重新漂移 —— `ADAPTER_MODE` 就是实例：`main.ts` 与 `env-guard.ts`
 * 曾各自比较一次（`=== "real"` 与 `.trim() !== "real"`），`ADAPTER_MODE=Real` 在生产
 * 下同时给出「按 mock 跑」与「拒绝启动」两个相反结论。
 */
import type { EnvEnumSpec, EnvFlagSpec } from "@app/shared";

/** 适配器模式：生产守卫与适配器构造共用这一张表 */
export const ADAPTER_MODE_SPEC: EnvEnumSpec<"real" | "mock"> = {
  values: ["real", "mock"],
  default: "mock",
};

/** Ark 图像返回格式：非 b64_json 一律按 URL 处理 */
export const ARK_IMAGE_RESPONSE_FORMAT_SPEC: EnvEnumSpec<"url" | "b64_json"> = {
  values: ["url", "b64_json"],
  default: "url",
};

/** Ark 图像水印：默认开启（合规向默认值不变） */
export const ARK_IMAGE_WATERMARK_SPEC: EnvFlagSpec = { default: true };

/** AI 标识：默认开启（合规硬闸门，默认值不变） */
export const AI_LABEL_ENABLED_SPEC: EnvFlagSpec = { default: true };