/**
 * 备案号（ICP）的归一化与形状校验 —— **纯函数，无 Nitro 依赖**。
 *
 * 为什么单独成模块而不是写在 `server/plugins/icp-guard.ts` 里：
 * 插件带 `defineNitroPlugin` / `useRuntimeConfig`，只能在 Nitro 运行时加载，
 * 于是"校验逻辑本身"没法被任何测试用例直接调用，只能靠人手工起服务去撞。
 * 抽出来之后判据是纯字符串函数，可以被 spec 逐条锁住（包括带空格的真号这类排版变体）。
 *
 * 判据的教训来自 INC-01：那次写进线上的是 `TEST-京ICP备…`，
 * 任何"含 ICP备 + 数字"的宽松判据都能放它过去，所以这里**整串锚定**。
 */

/**
 * 31 个省级行政区简称。备案号一律以省简称开头（`京ICP备…` / `粤ICP证…`）。
 * 少一个简称的后果是真实号被判非法 → 站点起不来，所以这张表按穷举维护。
 */
const PROVINCE_PREFIXES = [
  "京", "津", "沪", "渝",
  "冀", "豫", "云", "辽", "黑", "湘", "皖", "鲁",
  "新", "苏", "浙", "赣", "鄂", "桂",
  "甘", "晋", "蒙", "陕", "吉", "闽", "贵",
  "粤", "青", "藏", "川", "宁", "琼",
] as const;

/**
 * 去掉**所有**空白，不只是首尾。
 *
 * 备案系统页面上的写法是 `京 ICP 备 2024000000 号-1`，运维最自然的动作是复制粘贴；
 * `trim()` 只处理首尾，中间空格会留下，整串锚定就把它判成"不像备案号"。
 * 号刚下来、准备对外的时刻踩这一脚，站点直接起不来，排查方向还会被误导到"号没生效"。
 */
export function normalizeIcp(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, "");
}

/**
 * 合法形态：省简称 + `ICP备`/`ICP证` + ≥4 位数字 + `号` + 可选 `-N`。
 *
 * 已知限制（刻意不预先放宽，按实际形态再放开）：
 * - `-1A` 这类字母后缀会被判非法；
 * - 数字少于 4 位会被判非法；
 * - `京公网安备…`（公安备案）不属于此判据，它归 `NUXT_PUBLIC_ICP_POLICE`。
 *
 * 误判方向是安全的：非法 → 启动失败并回显原值，而不是带着假号上线。
 */
export function isValidIcp(value: unknown): boolean {
  const normalized = normalizeIcp(value);
  if (normalized === "") return false;
  const province = PROVINCE_PREFIXES.join("|");
  return new RegExp(`^(?:${province})ICP[备证]\\d{4,}号(?:-\\d+)?$`).test(normalized);
}

/** 导出给测试用：确认省份表没有漏项（31 个） */
export const ICP_PROVINCE_PREFIXES: readonly string[] = PROVINCE_PREFIXES;
