/**
 * worker 生产启动守卫（fail fast）。
 *
 * 生产环境最危险的两类配置事故：
 * 1) `ADAPTER_MODE=mock` 上线：用户订单"成功"但根本没有调用供应商，属于假生成；
 * 2) 忘了配任何真实供应商 Key：任务必然全部失败，却要到线上才发现。
 * 因此 NODE_ENV=production 时两者都必须在启动阶段拒绝。
 *
 * 纯函数实现，便于单测；错误信息只包含变量名与原因，不含任何密钥值。
 */
import { parseEnvEnum } from "@app/shared";
import { ADAPTER_MODE_SPEC } from "./env-flags";

export interface WorkerEnvLike {
  NODE_ENV?: string;
  ADAPTER_MODE?: string;
  ARK_API_KEY?: string;
  DEEPSEEK_API_KEY?: string;
  HTTP_VIDEO_BASE_URL?: string;
}

function filled(value: string | undefined): boolean {
  return typeof value === "string" && value.trim() !== "";
}

/**
 * 与适配器构造共用同一张 `ADAPTER_MODE` 表（第 124 批）：`ADAPTER_MODE=Real` 在这里和
 * `main.ts` 必须得到同一个结论。未知取值把解析错误原文作为「当前」带进拒绝启动原因。
 */
function readAdapterMode(raw: string | undefined): { mode: "real" | "mock" | undefined; current: string } {
  const trimmed = (raw ?? "").trim();
  try {
    return { mode: parseEnvEnum("ADAPTER_MODE", raw, ADAPTER_MODE_SPEC.values), current: trimmed === "" ? "未设置" : trimmed };
  } catch (error) {
    return { mode: undefined, current: (error as Error).message };
  }
}

export function collectWorkerProductionProblems(env: WorkerEnvLike = process.env): string[] {
  const nodeEnv = (env.NODE_ENV ?? "development").trim();
  if (nodeEnv !== "production") return [];

  const problems: string[] = [];
  const adapterMode = readAdapterMode(env.ADAPTER_MODE);
  if (adapterMode.mode !== "real") {
    problems.push(`ADAPTER_MODE 必须为 real（当前：${adapterMode.current}）；生产禁止 mock 生成`);
  }

  const vendors: Array<[string, string | undefined]> = [
    ["ARK_API_KEY", env.ARK_API_KEY],
    ["DEEPSEEK_API_KEY", env.DEEPSEEK_API_KEY],
    ["HTTP_VIDEO_BASE_URL", env.HTTP_VIDEO_BASE_URL],
  ];
  const configured = vendors.filter(([, value]) => filled(value)).map(([name]) => name);
  if (configured.length === 0) {
    problems.push("生产必须至少配置一种真实供应商：ARK_API_KEY / DEEPSEEK_API_KEY / HTTP_VIDEO_BASE_URL");
  }
  return problems;
}

/** 启动时调用：有问题直接抛错，进程退出（fail fast） */
export function assertWorkerEnv(env: WorkerEnvLike = process.env): void {
  const problems = collectWorkerProductionProblems(env);
  if (problems.length > 0) {
    throw new Error(`worker 生产环境配置校验失败（${problems.length} 项，拒绝启动）：\n - ${problems.join("\n - ")}`);
  }
}
