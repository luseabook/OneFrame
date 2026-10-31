import { Module } from "@nestjs/common";
import { BillingModule } from "../billing/billing.module";
import { AdminAccountsService } from "./admin-accounts.service";
import { AdminAiLabelService } from "./admin-ai-label.service";
import { AdminAuditService } from "./admin-audit.service";
import { AdminAuthService } from "./admin-auth.service";
import { AdminCommunityService } from "./admin-community.service";
import { AdminConfigService } from "./admin-config.service";
import { AdminAuthController, AdminController } from "./admin.controller";
import { AdminAiLabelController, AdminCommunityController } from "./admin-community.controller";
import { AdminGuard } from "./admin.guard";
import { AdminOpsController, OpsConfigController } from "./admin-ops.controller";
import { AdminService } from "./admin.service";

@Module({
  // 退款是运营动作：管理端直接复用 BillingService.refundOrder（订单/积分/渠道一致性逻辑只有一处）
  imports: [BillingModule],
  controllers: [
    AdminAuthController,
    AdminController,
    // P1 基建（契约 §3）：管理员账号 / 操作审计 / 配置中心 / 订单对账导出。
    // 与 AdminController 同前缀但分文件，避免两个并行施工方互相覆盖。
    AdminOpsController,
    // 公开配置读（/ops/config/:key），与 ops 管理面隔开，未登录前端也能读
    OpsConfigController,
    // P2（契约 §2.1–§2.4）：用户/等待名单/邀请码 + AI 标识审计。
    // 动的是真实用户数据，与运维面（配置/审计）分文件，风险模型不混。
    AdminCommunityController,
    AdminAiLabelController,
  ],
  providers: [
    AdminAuthService,
    AdminGuard,
    AdminService,
    AdminAccountsService,
    AdminAuditService,
    AdminConfigService,
    AdminCommunityService,
    AdminAiLabelService,
  ],
  // AdminAuthService：MarketModule/AgentModule 的 AdminGuard 依赖它（跨模块解析）；
  // AdminAuditService：全局 AdminAuditInterceptor 在 AppModule 注册，必须能从本模块取出
  exports: [AdminAuthService, AdminAuditService],
})
export class AdminModule {}
