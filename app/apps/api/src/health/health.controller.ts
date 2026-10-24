import { Controller, Get } from "@nestjs/common";
import { Public } from "../common/public.decorator";
import { pingDb } from "../db/database";
import { pingRedis } from "../redis/redis";

// P0 健康检查：进程存活 + 依赖连通性真值（不作硬失败，M0 便于本地无容器演示）
// TODO(P1): readiness 与 liveness 分离，db/redis down 时 readiness 503（deployment.md）
@Public()
@Controller("healthz")
export class HealthController {
  @Get()
  async check(): Promise<{
    status: "ok" | "degraded";
    checks: { db: "up" | "down"; redis: "up" | "down" };
    uptime_s: number;
  }> {
    const [db, redis] = await Promise.all([pingDb(), pingRedis()]);
    return {
      status: db && redis ? "ok" : "degraded",
      checks: { db: db ? "up" : "down", redis: redis ? "up" : "down" },
      uptime_s: Math.round(process.uptime()),
    };
  }
}
