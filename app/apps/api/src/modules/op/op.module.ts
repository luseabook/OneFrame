import { Module } from "@nestjs/common";
import { TeamModule } from "../team/team.module";
import { OpController, RedeemCodeController } from "./op.controller";
import { OpRedeemService } from "./op.redeem.service";
import { OpService } from "./op.service";
import { OpSurveyService } from "./op.survey.service";

/**
 * 运营增长（op）域 —— 对照参照产品 `/web/v1/op/*` 31 端点（`rt:829-859`）
 * + 兑换码核销独立路径 `/redeem-code/redeem`（`rt:860`）。
 *
 * 依赖说明：
 * - `TeamModule`：复用 `requireMember`（非成员 403）与 `hasPrivilege`（运营特权），
 *   不另写一套成员校验（两套守卫必然漂移）。
 * - `RedisService` 是 `@Global()`（`redis/redis.module.ts`），无需 import。
 * - 数据全部落正式表（迁移 0025/0027：`op_daily_rewards` / `op_questionnaires` /
 *   `op_questionnaire_responses` / `invite_codes.owner_user_id` / `campaign_signup_drafts` /
 *   `asset_reports`），已无"借用 home_configs"的形态。
 *
 * 运营位（`promo_slots`）的**写入口不在这里**：已由 admin 域提供
 * `/ops/admin/promo-slots`（`AdminGuard` + `created_by → admin_users`，迁移 0028）。
 * 本模块只保留 C 端读（`crc/banner_list`、`crc/pop_up`）与空间管理员只读列表
 * （`GET /op/promo-slots`，客服/排障场景）。重复实现一套写接口会造成路由冲突
 * 与两套鉴权口径——这是明确避开的。
 */
@Module({
  imports: [TeamModule],
  controllers: [OpController, RedeemCodeController],
  providers: [OpService, OpRedeemService, OpSurveyService],
  exports: [OpService],
})
export class OpModule {}
