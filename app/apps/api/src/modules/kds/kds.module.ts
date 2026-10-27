import { Module } from "@nestjs/common";
import { KdsController } from "./kds.controller";
import { KdsService } from "./kds.service";
import { TeamModule } from "../team/team.module";

/**
 * 数据看板（kds）域 —— 对照参照产品 `/web/v1/kds/da/*` 13 端点。
 *
 * 依赖 TeamModule 只是因为要复用 `requireMember`（非成员 403）。
 * 不 import ScriptModule / CanvasModule：看板只读 `credit_flows` / `tasks` 的
 * 既有列，不跨域 join（ADR-009：域边界按资源所有权划）。
 */
@Module({
  imports: [TeamModule],
  controllers: [KdsController],
  providers: [KdsService],
  exports: [KdsService],
})
export class KdsModule {}
