import { Module } from "@nestjs/common";
import { HomeController } from "./home.controller";
import { HomeService } from "./home.service";
import { TeamModule } from "../team/team.module";

/**
 * 首页域（模块 #1 收尾）。
 *
 * 依赖 TeamModule 只为了复用 `requireMember`（AB 命中会写 `ab_hits`，非成员必须 403）。
 * 不 import ScriptModule/CanvasModule：首页只读自己的 `home_configs` 与
 * `task_events`/`task_shares` 增量，不跨域 join。
 */
@Module({
  imports: [TeamModule],
  controllers: [HomeController],
  providers: [HomeService],
  exports: [HomeService],
})
export class HomeModule {}
