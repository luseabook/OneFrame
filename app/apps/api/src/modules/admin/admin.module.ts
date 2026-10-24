import { Module } from "@nestjs/common";
import { AdminAuthService } from "./admin-auth.service";
import { AdminAuthController, AdminController } from "./admin.controller";
import { AdminGuard } from "./admin.guard";
import { AdminService } from "./admin.service";

@Module({
  controllers: [AdminAuthController, AdminController],
  providers: [AdminAuthService, AdminGuard, AdminService],
  exports: [AdminAuthService],
})
export class AdminModule {}
