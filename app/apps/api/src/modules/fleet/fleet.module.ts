import { Module } from "@nestjs/common";
import { FleetController } from "./fleet.controller";
import { FleetReconcileService } from "./fleet-reconcile.service";
import { FleetService } from "./fleet.service";

/**
 * 机队 / 自带算力（BYOC）。
 *
 * 只依赖 `@app/db` 与 `@app/shared`，不依赖 generations/tasks —— 调度方向是
 * 「worker 调网关」，本模块只负责让节点在位（见 docs/02-architecture/autodl-integration.md §2）。
 */
@Module({
  controllers: [FleetController],
  providers: [FleetService, FleetReconcileService],
  exports: [FleetService, FleetReconcileService],
})
export class FleetModule {}