/**
 * 数值环境变量的**唯一**读取入口（第 123 批）。
 *
 * ## 为什么要收口
 * 仓库里原有 15 处 `Number(process.env.<键> ?? 默认值)`（worker 12、api 2、shared 1），
 * 每个都有两个静默口子（实测见 `_acceptance/d123/nan-probe.log`）：
 *
 * - `Number("") === 0`、`Number("   ") === 0` —— 「留空」被当成 0，而不是「没配置」。
 *   `POLL_INTERVAL_MS=` 于是变成 0ms 轮询（60ms 内 5 次，正常 1000ms 只 1 次）。
 * - `Number("30s")` / `Number("5m")` / `Number("abc")` 是 **NaN**，而 `NaN <= 0` 为 false。
 *   worker 的 `schedule()` 用 `intervalMs <= 0` 判「停用」，NaN 直接穿过去，
 *   `setInterval(fn, NaN)` 被 Node 夹到 1ms（实测告警 "Timeout duration was set to 1"）。
 *   于是 `ORDERS_RECONCILE_INTERVAL_MS=5m` 这种写法不是「5 分钟」，而是「几乎不停」——
 *   对账 / 看门狗 / 清理任务会以数据库为靶子热循环。停机定时器同理：`SHUTDOWN_TIMEOUT_MS=30s`
 *   下强制退出定时器 0ms 就开火，把还没 drain 完的进程直接 `exit(1)`（`shutdown-child.cjs`
 *   实测：坏值 EXIT=1、空白 EXIT=1、合法值 EXIT=0）。
 * - `Number("0x10") === 16`、`Number("Infinity") === Infinity` —— 语法合法、语义意外。
 *
 * 同一语义在 api 里已经有一条校验过的路（`config/env.ts` 的 `z.coerce.number()`），
 * 但 worker / 共享包没有 schema，只能各自 `Number()`。这个函数就是那条路的单点实现：
 * `MASTER_TTL_S` 这类已有 schema 的键继续走 `env.ts`（见本批 token.service 的改动），
 * 其余一律走这里。
 *
 * ## 行为约定
 * - **未设置或纯空白 → 默认值**。空白是「没配置」，不是 0。
 * - **只接受十进制写法**：`1000` / `-1` / `1.5` / `1e3` / ` 5 `（首尾空白裁掉）。
 *   `0x10`、`Infinity`、`NaN`、`1_000`、`5m` 一律拒绝。
 * - **越界 / 非整数 / 非有限 → 抛 `RangeError`**，信息含变量名、原始值、合法范围。
 *   与 `apps/worker/src/env-guard.ts` 同一条策略：启动即失败，不进「悄悄回落默认值」
 *   的分支（那正是这批要消掉的形状）。数值变量不含密钥，信息可直接打日志。
 * - **默认值本人也要合规格**：`{ default: 1.5, integer: true }` 这种参数是写错代码，
 *   与是否设置环境变量无关，同样抛。
 *
 * ## 诚实边界
 * - 只覆盖「进程启动时读一次」的数值配置；运行期热改 env 的语义不变（本仓库没有）。
 * - `setInterval(fn, NaN)` 在 Node 内部被夹到 1ms，但 Windows 默认定时器粒度约 15.6ms，
 *   本机实测 60ms 窗内 4 次（`setTimeout(fn, NaN)` 实测 15.8ms）；Linux 上会更快。
 *   数量级结论不变：本该 5 分钟一次的任务变成每秒几十次。
 * - 本函数不校验「数值的业务含义」（例如轮询间隔是否小于总超时），那属于调用方规格。
 */
export interface EnvNumberSpec {
  /** 未设置或纯空白时返回的值（本身必须满足 integer / min / max） */
  default: number;
  /** 允许的最小值（含） */
  min?: number;
  /** 允许的最大值（含） */
  max?: number;
  /** 是否要求整数 */
  integer?: boolean;
}

/** 十进制（含科学计数法）；刻意不接受 `0x` / `Infinity` / 下划线分隔 */
const DECIMAL = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

function describeRule(spec: EnvNumberSpec): string {
  const parts: string[] = [];
  if (spec.integer) parts.push("integer");
  if (spec.min !== undefined && spec.max !== undefined) parts.push(`within [${spec.min}, ${spec.max}]`);
  else if (spec.min !== undefined) parts.push(`>= ${spec.min}`);
  else if (spec.max !== undefined) parts.push(`<= ${spec.max}`);
  return parts.length > 0 ? parts.join(", ") : "any finite number";
}

function checkValue(name: string, raw: string, value: number, spec: EnvNumberSpec): number {
  if (!Number.isFinite(value)) {
    throw new RangeError(`invalid ${name}: ${JSON.stringify(raw)} (must be ${describeRule(spec)})`);
  }
  if (spec.integer && !Number.isInteger(value)) {
    throw new RangeError(`invalid ${name}: ${JSON.stringify(raw)} (must be an integer)`);
  }
  if (spec.min !== undefined && value < spec.min) {
    throw new RangeError(`invalid ${name}: ${JSON.stringify(raw)} (must be >= ${spec.min})`);
  }
  if (spec.max !== undefined && value > spec.max) {
    throw new RangeError(`invalid ${name}: ${JSON.stringify(raw)} (must be <= ${spec.max})`);
  }
  return value;
}

/**
 * 读取一个数值环境变量。
 *
 * @param name 变量名（错误信息里原样出现，便于运维定位）
 * @param spec 默认值 + 取值范围 + 是否整数
 * @param env  注入点，默认 `process.env`（测试不该改全局 env）
 */
export function readEnvNumber(
  name: string,
  spec: EnvNumberSpec,
  env: Readonly<Record<string, string | undefined>> = process.env,
): number {
  // 默认值是代码，不是配置：写错立刻抛，别等到某次发布才暴露
  const defaultRule = describeRule(spec);
  if (!Number.isFinite(spec.default)) {
    throw new RangeError(`invalid default for ${name}: ${String(spec.default)} (must be ${defaultRule})`);
  }
  if (spec.integer && !Number.isInteger(spec.default)) {
    throw new RangeError(`invalid default for ${name}: ${String(spec.default)} (must be an integer)`);
  }
  if (spec.min !== undefined && spec.default < spec.min) {
    throw new RangeError(`invalid default for ${name}: ${String(spec.default)} (must be >= ${spec.min})`);
  }
  if (spec.max !== undefined && spec.default > spec.max) {
    throw new RangeError(`invalid default for ${name}: ${String(spec.default)} (must be <= ${spec.max})`);
  }

  const raw = env[name];
  if (raw === undefined || raw.trim() === "") return spec.default;

  const text = raw.trim();
  if (!DECIMAL.test(text)) {
    throw new RangeError(`invalid ${name}: ${JSON.stringify(raw)} (must be ${defaultRule}; blank = unset)`);
  }
  return checkValue(name, raw, Number(text), spec);
}