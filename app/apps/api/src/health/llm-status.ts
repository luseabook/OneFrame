import type { Env } from "../config/env";

/**
 * 「本进程的 LLM 现在是真调用还是假文案」——一个可被机器读取的状态。
 *
 * ## 为什么必须存在（Architect 的 B 方案约束 2）
 *
 * 验收逃生舱 `ONEFRAME_ALLOW_MOCK_LLM=1` 让生产能用 mock 文案。它和 ICP 逃生舱的
 * 危险程度不是一个量级：
 * - 备案号漏配 **一眼能看出来**（页脚空着）；
 * - mock 漏配/被开着 **看不出来** —— 大纲/角色/剧本/分镜的接口结构完全正确，
 *   只有内容是确定性假文案。运维、前端、下游集成方都没法靠肉眼区分。
 *
 * 所以"允许 mock"不能只打一行日志，必须有一个**结构化、可断言**的出口：
 * - `/v1/healthz/ready` → `llm.mode` / `llm.mock_allowed` / `llm.mock_active`
 * - `/v1/metrics` → `oneframe_llm_mock_allowed` / `oneframe_llm_mock_active` 两个 gauge
 * - `/v1/meta/capabilities` → 供前端做全局可见声明（前端要的"演示环境"横幅）
 *
 * 诚实边界：这里只描述**配置状态**，不证明内容真伪。真文案与假文案长得很像，
 * 唯一可靠判定仍是 `LLM_MODE` 与是否配了 `DEEPSEEK_API_KEY`（启动守卫已保证二者一致）。
 */
export interface LlmStatus {
  /** 配置的取值（`mock` = 本进程会输出确定性假文案） */
  mode: "mock" | "real";
  /** 生产是否显式开了验收逃生舱（`ONEFRAME_ALLOW_MOCK_LLM=1`） */
  mock_allowed: boolean;
  /** 本进程此刻是否**正在**输出假文案（比 mock_allowed 更直接：real 时恒 false） */
  mock_active: boolean;
}

type LlmEnvLike = Pick<Env, "LLM_MODE" | "LLM_MOCK_ALLOWED">;

export function llmStatus(source: LlmEnvLike): LlmStatus {
  const mode = source.LLM_MODE;
  return {
    mode,
    mock_allowed: source.LLM_MOCK_ALLOWED,
    mock_active: mode === "mock",
  };
}
