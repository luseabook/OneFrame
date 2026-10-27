import { Module } from "@nestjs/common";
import { RedisModule } from "../../redis/redis.module";
import { StorageModule } from "../../storage/storage.module";
import { AuthModule } from "../auth/auth.module";
import { HomeController } from "./home.controller";
import { HomeService } from "./home.service";
import { TeamModule } from "../team/team.module";

/**
 * 首页域（模块 #1 收尾）。
 *
 * - `TeamModule`：复用 `requireMember`（AB 命中会写 `ab_hits`，非成员必须 403）；
 * - `RedisModule`：运营位打点 5 分钟去重（`SET NX EX`），不打库；
 * - `StorageModule`：banner 图存的是 storage key，读时签名成可访问 URL；
 * - `AuthModule`：公开打点要"可选身份"（带了有效 token 就按用户去重），只借用
 *   `TokenService.verifyAccess`，不引入登录态依赖（公开路由不进 AuthGuard）。
 * 不 import ScriptModule/CanvasModule：首页只读自己的配置与 task 增量，不跨域 join。
 */
@Module({
  imports: [TeamModule, RedisModule, StorageModule, AuthModule],
  controllers: [HomeController],
  providers: [HomeService],
  exports: [HomeService],
})
export class HomeModule {}
