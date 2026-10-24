import { Module } from "@nestjs/common";
import { BillingController } from "./billing.controller";
import { BillingService } from "./billing.service";
import { ChannelService } from "./channels/channel.service";

@Module({
  controllers: [BillingController],
  providers: [
    BillingService,
    // 渠道实例在启动时由环境变量解析一次：凭据不全则该渠道 NotConfigured（默认拒绝）
    { provide: ChannelService, useFactory: () => ChannelService.fromEnv() },
  ],
  exports: [BillingService, ChannelService],
})
export class BillingModule {}
