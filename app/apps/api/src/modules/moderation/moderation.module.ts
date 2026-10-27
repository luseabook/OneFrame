import { Global, Module } from "@nestjs/common";
import { CaptchaService } from "./captcha.service";
import { ModerationController } from "./moderation.controller";
import { ModerationDetectService, ModerationService } from "./moderation.service";
import { ModerationStatusService } from "./status.service";

@Global()
@Module({
  controllers: [ModerationController],
  providers: [ModerationService, ModerationDetectService, ModerationStatusService, CaptchaService],
  exports: [ModerationService, ModerationDetectService],
})
export class ModerationModule {}
