import { Module } from "@nestjs/common";
import { CampaignModule } from "../campaign/campaign.module";
import { OpModule } from "../op/op.module";
import { TeamModule } from "../team/team.module";
import { CreatorController } from "./creator.controller";
import { CreatorService } from "./creator.service";

/**
 * 创作者中心（crc）域 —— 对照参照产品 `/web/v1/crc/*` 30 端点（`rt:275-304`）
 * + 我方补充 2 条（作品创建/编辑，竞品走资源上传链，我方无等价链）。
 *
 * 依赖：
 * - `TeamModule`：`requireMember` / `hasPrivilege`（审核动作要运营特权）；
 * - `OpModule`：`OpService` 读运营位（banner/pop_up）；
 * - `CampaignModule`：`crc/activity/*` 四条委托 campaign 域，
 *   **不**直接 join `campaigns` 表。理由：活动"可报名/已入围"的判定必须只有一份实现，
 *   两处各写一遍必然在边界（活动结束时间、取消后重报）上漂移。
 * 举报落 `asset_reports`（迁移 0027），已不依赖任何 KV 借用形态。
 */
@Module({
  imports: [TeamModule, OpModule, CampaignModule],
  controllers: [CreatorController],
  providers: [CreatorService],
  exports: [CreatorService],
})
export class CreatorModule {}
