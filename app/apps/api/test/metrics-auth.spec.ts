import { describe, expect, it } from "vitest";
import { metricsAuthorized } from "../src/health/metrics-auth";

/**
 * `/v1/metrics` 抓取鉴权（deployment.md §4）。
 *
 * 背景（P1-12）：该端点原先是 `@Public` + nginx 全量反代，等于把任务积压、
 * 15 分钟失败率与「已支付未入账」这类资金异常匿名公开。现在必须带
 * `Authorization: Bearer <METRICS_TOKEN>`，且**未配置令牌 = 一律拒绝**
 * （不给"没配就放行"的默认敞开），生产启动守卫则会先拦下缺配置的部署。
 *
 * 这里只测纯函数 `metricsAuthorized`（显式传 expected），不连库、不读 env。
 */
describe("metricsAuthorized", () => {
  const token = "Metrics-Token-0123456789AbCdEf";

  it("接受完全匹配的 Bearer 令牌", () => {
    expect(metricsAuthorized(`Bearer ${token}`, token)).toBe(true);
  });

  it("未配置令牌时一律拒绝（不能因为缺配置而敞开）", () => {
    expect(metricsAuthorized(`Bearer ${token}`, undefined)).toBe(false);
    expect(metricsAuthorized(`Bearer ${token}`, "")).toBe(false);
    expect(metricsAuthorized(undefined, undefined)).toBe(false);
  });

  it("拒绝缺失 / 空 / 非 Bearer 形式的请求头", () => {
    expect(metricsAuthorized(undefined, token)).toBe(false);
    expect(metricsAuthorized("", token)).toBe(false);
    expect(metricsAuthorized(token, token)).toBe(false);
    expect(metricsAuthorized(`Basic ${token}`, token)).toBe(false);
    expect(metricsAuthorized(`bearer ${token}`, token)).toBe(false);
  });

  it("拒绝错误令牌，且不因长度不同而抛异常", () => {
    expect(metricsAuthorized("Bearer wrong-token-0123456789AbCdEf", token)).toBe(false);
    expect(metricsAuthorized("Bearer ", token)).toBe(false);
    expect(metricsAuthorized(`Bearer ${token}x`, token)).toBe(false);
    expect(metricsAuthorized(`Bearer ${token.slice(0, -1)}`, token)).toBe(false);
  });

  it("不把令牌前后缀当作匹配（防前缀绕过）", () => {
    expect(metricsAuthorized(`Bearer ${token.slice(0, 8)}`, token)).toBe(false);
    expect(metricsAuthorized(`Bearer ${token}extra`, token)).toBe(false);
  });
});