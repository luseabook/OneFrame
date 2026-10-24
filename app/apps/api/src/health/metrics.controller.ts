import { Controller, Get, Res } from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { sql } from "drizzle-orm";
import { Public } from "../common/public.decorator";
import { db } from "../db/database";

/**
 * Prometheus 文本格式指标（deployment.md §4）。
 *
 * 只暴露**运维必需且低成本**的指标：
 * - 任务队列深度（按状态）：判断是否堆积
 * - 失败率（近 15 分钟）：判断供应商是否异常
 * - 资金链路异常（待支付超时、已支付未入账）：判断资金链路是否正常
 *
 * 刻意不引入 prom-client：单端点手写文本格式，避免为一个指标接口增加运行时依赖。
 * 注意：必须用 @Res() 直接 send，绕过 EnvelopeInterceptor（否则文本被包成 JSON 信封）。
 */
@Public()
@Controller("metrics")
export class MetricsController {
  @Get()
  async metrics(@Res() res: FastifyReply): Promise<void> {
    const lines: string[] = [];

    // ── 任务队列深度（按状态）──
    try {
      const rows = (
        await db.execute(sql`
          select status::int as status, count(*)::int as n
            from tasks
           group by status
        `)
      ) as { rows?: Array<{ status: number; n: number }> };
      lines.push(
        "# HELP oneframe_tasks_total Tasks by status (1 pending 2 running 3 succeeded 4 failed 5 cancelled 7 review_rejected)",
      );
      lines.push("# TYPE oneframe_tasks_total gauge");
      for (const r of rows.rows ?? []) {
        lines.push(`oneframe_tasks_total{status="${r.status}"} ${r.n}`);
      }
    } catch {
      lines.push("# oneframe_tasks_total unavailable");
    }

    // ── 近 15 分钟失败率 ──
    try {
      const r = (
        await db.execute(sql`
          select
            count(*) filter (where status in (4,7))::int as failed,
            count(*)::int as total
          from tasks
          where created_at > now() - interval '15 minutes'
        `)
      ) as { rows?: Array<{ failed: number; total: number }> };
      const row = r.rows?.[0];
      const failed = row?.failed ?? 0;
      const total = row?.total ?? 0;
      const rate = total > 0 ? failed / total : 0;
      lines.push("# HELP oneframe_failure_ratio_15m Task failure ratio over last 15 minutes");
      lines.push("# TYPE oneframe_failure_ratio_15m gauge");
      lines.push(`oneframe_failure_ratio_15m ${rate.toFixed(4)}`);
      lines.push("# HELP oneframe_tasks_15m Task count over last 15 minutes");
      lines.push("# TYPE oneframe_tasks_15m gauge");
      lines.push(`oneframe_tasks_15m ${total}`);
    } catch {
      lines.push("# oneframe_failure_ratio_15m unavailable");
    }

    // ── 资金链路异常 ──
    try {
      const r = (
        await db.execute(sql`
          select
            (select count(*)::int from orders
              where status = 1 and created_at < now() - interval '30 minutes') as stale_pending,
            (select count(*)::int from orders o
              where o.status = 2
                and not exists (select 1 from credit_flows f where f.ref_order_id = o.id)) as paid_without_credit
        `)
      ) as { rows?: Array<{ stale_pending: number; paid_without_credit: number }> };
      const row = r.rows?.[0];
      lines.push("# HELP oneframe_orders_stale_pending Pending orders older than 30 minutes");
      lines.push("# TYPE oneframe_orders_stale_pending gauge");
      lines.push(`oneframe_orders_stale_pending ${row?.stale_pending ?? 0}`);
      lines.push("# HELP oneframe_orders_paid_without_credit Paid orders missing credit flow (should be 0)");
      lines.push("# TYPE oneframe_orders_paid_without_credit gauge");
      lines.push(`oneframe_orders_paid_without_credit ${row?.paid_without_credit ?? 0}`);
    } catch {
      lines.push("# oneframe_orders_* unavailable");
    }

    // ── 进程自身 ──
    const mem = process.memoryUsage();
    lines.push("# HELP oneframe_process_uptime_seconds Process uptime");
    lines.push("# TYPE oneframe_process_uptime_seconds gauge");
    lines.push(`oneframe_process_uptime_seconds ${Math.round(process.uptime())}`);
    lines.push("# HELP oneframe_process_resident_memory_bytes Resident memory");
    lines.push("# TYPE oneframe_process_resident_memory_bytes gauge");
    lines.push(`oneframe_process_resident_memory_bytes ${mem.rss}`);
    lines.push("# HELP oneframe_process_heap_used_bytes V8 heap used");
    lines.push("# TYPE oneframe_process_heap_used_bytes gauge");
    lines.push(`oneframe_process_heap_used_bytes ${mem.heapUsed}`);

    res
      .header("content-type", "text/plain; version=0.0.4; charset=utf-8")
      .send(`${lines.join("\n")}\n`);
  }
}
