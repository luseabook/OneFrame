import { Module } from "@nestjs/common";
import { BillingModule } from "../billing/billing.module";
import { AdminAuthService } from "./admin-auth.service";
import { AdminAuthController, AdminController } from "./admin.controller";
import { AdminGuard } from "./admin.guard";
import { AdminService } from "./admin.service";

@Module({
  // 退款是运营动作：管理端直接复用 BillingService.refundOrder（订单/积分/渠道一致性逻辑只有一处）
  imports: [BillingModule],
  controllers: [AdminAuthController, AdminController],
  providers: [AdminAuthService, AdminGuard, AdminService],
  exports: [AdminAuthService],
})
export class AdminModule {}
