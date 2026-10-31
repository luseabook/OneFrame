import { timingSafeEqual } from "node:crypto";
import { env } from "../config/env";

/**
 * `/v1/metrics` 的抓取鉴权（deployment.md §4）。
 *
 * 指标含任务积压、失败率与资金异常（已支付未入账），属于内部运营数据，
 * 不能像健康检查一样匿名可读。Prometheus 通过 `Authorization: Bearer <METRICS_TOKEN>`
 * 抓取；未配置令牌时一律拒绝（生产启动守卫会先拦下缺配置的部署）。
 *
 * 比较用常量时间：普通 `===` 会在首个不同字节处提前返回，泄漏令牌前缀。
 */
export function metricsAuthorized(
  header: string | undefined,
  expected: string | undefined = env.METRICS_TOKEN,
): boolean {
  if (!expected) return false;
  if (!header?.startsWith("Bearer ")) return false;
  const provided = Buffer.from(header.slice("Bearer ".length));
  const want = Buffer.from(expected);
  return provided.length === want.length && timingSafeEqual(provided, want);
}