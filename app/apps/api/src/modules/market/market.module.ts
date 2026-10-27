import { Module } from "@nestjs/common";
import { AdminModule } from "../admin/admin.module";
import { MarketAdminController } from "./market-admin.controller";
import { MarketController } from "./market.controller";
import { MarketService } from "./market.service";
import { MarketTaxonomyService } from "./market-taxonomy.service";

/**
 * 剧本集市（market）域 —— 对照竞品 `df/novel_market` 29 端点（`routes.txt:601-629`）
 * + 集市 Admin 12 端点（`routes.txt:100-111`）。
 *
 * 依赖说明：
 * - `AdminModule`：只为拿 `AdminGuard` 需要的 `AdminAuthService`（该模块 `exports` 了它）。
 *   集市的运营后台与 C 端必须物理隔离（竞品把 admin 放在独立服务域 `rmadminsrv`），
 *   所以 admin 控制器走 `@Public() + @UseGuards(AdminGuard)`，不复用用户登录态。
 * - **不 import TeamModule**：集市的跨 space 行为是业务需求（A 团队买 B 团队的作品），
 *   不能简单"非成员 403"。归属判权靠两条：查询第一条件 `auth.spaceId`／`auth.userId`，
 *   以及跨 space 读内容时的 `assertEntitled`（必须有已生效购买/预售协议）。
 * - **不 import NovelModule**：`NovelService` 按 `novels.space_id` 判权，买方永远读不到；
 *   集市需要"按购买凭据跨 space 只读本子结构"，判权模型不同，故自带查询。
 * - `MarketTaxonomyService` 必须注册为 provider：`MarketService` 通过构造函数注入它
 *   （分类/标签在迁移 0030 起是真表）。**漏注册会直接让 `NestFactory.create(AppModule)`
 *   DI 失败——不只是一个 spec 红，而是全仓 e2e 归零**，所以这里同时 `exports` 出去，
 *   便于后续其它模块（如创作者中心）复用同一套分类/标签口径。
 */
@Module({
  imports: [AdminModule],
  controllers: [MarketController, MarketAdminController],
  providers: [MarketService, MarketTaxonomyService],
  exports: [MarketService, MarketTaxonomyService],
})
export class MarketModule {}
