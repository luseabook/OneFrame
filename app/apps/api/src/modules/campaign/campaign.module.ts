import { Module } from "@nestjs/common";
import { TeamModule } from "../team/team.module";
import { CampaignController } from "./campaign.controller";
import { CampaignService } from "./campaign.service";

/**
 * 激励活动（campaign）域 —— 对照参照产品 `/web/v1/campaign/*` 6 端点（`rt:267-272`）。
 *
 * 依赖：
 * - `TeamModule`：`requireMember` / `hasPrivilege`（不另写守卫）。
 * 报名草稿落在 `campaign_signup_drafts`（迁移 0027，唯一键 `(campaign_id, user_id)`），
 * 所以本模块**不再**依赖 op 的 KV 服务。
 * 导出 `CampaignService`：creator 域 `crc/activity/*` 复用同一套活动口径
 * （"可报名/已入围"的判定只能有一份实现，两处各写必然会漂移）。
 */
@Module({
  imports: [TeamModule],
  controllers: [CampaignController],
  providers: [CampaignService],
  exports: [CampaignService],
})
export class CampaignModule {}
