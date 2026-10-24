import { Controller, Get, HttpCode, Res } from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { Public } from "../common/public.decorator";
import { pingDb } from "../db/database";
import { pingRedis } from "../redis/redis";

/**
 * 健康检查三端点（deployment.md §3）。
 *
 * - `/healthz/live`  liveness：进程活着就 200。**不查依赖**——依赖挂了重启进程无用，
 *                    查依赖会导致依赖抖动时容器被反复重启（级联故障）。
 * - `/healthz/ready` readiness：依赖可用才 200，否则 **503**。负载均衡据此摘除实例。
 * - `/healthz`       兼容旧探针：聚合详情，依赖不可用时同样是 503。
 */
@Public()
@Controller("healthz")
export class HealthController {
  /** liveness：只反映进程自身，绝不因依赖故障而失败 */
  @Get("live")
  @HttpCode(200)
  live(): { status: "ok"; uptime_s: number; pid: number } {
    return { status: "ok", uptime_s: Math.round(process.uptime()), pid: process.pid };
  }

  /** readiness：依赖可用 → 200；任一依赖不可用或正在停机 → 503 */
  @Get("ready")
  async ready(@Res({ passthrough: true }) res: FastifyReply) {
    // 停机中立即返回 503，让 LB 先摘流，再等在途请求结束
    if ((globalThis as { __of_shutting_down?: boolean }).__of_shutting_down) {
      res.code(503);
      return { status: "shutting_down", checks: { db: "unknown", redis: "unknown" } };
    }
    const [db, redis] = await Promise.all([pingDb(), pingRedis()]);
    const ok = db && redis;
    res.code(ok ? 200 : 503);
    return {
      status: ok ? "ok" : "unavailable",
      checks: { db: db ? "up" : "down", redis: redis ? "up" : "down" },
    };
  }

  /** 聚合详情（人工排查用）；依赖不可用时 503，避免被误当就绪 */
  @Get()
  async check(@Res({ passthrough: true }) res: FastifyReply) {
    const [db, redis] = await Promise.all([pingDb(), pingRedis()]);
    const ok = db && redis;
    res.code(ok ? 200 : 503);
    return {
      status: ok ? "ok" : "degraded",
      checks: { db: db ? "up" : "down", redis: redis ? "up" : "down" },
      uptime_s: Math.round(process.uptime()),
      version: process.env.APP_VERSION ?? "dev",
    };
  }
}
