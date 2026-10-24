import { Module } from "@nestjs/common";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { SmsService } from "./sms.service";
import { TokenService } from "./token.service";

@Module({
  controllers: [AuthController],
  providers: [TokenService, SmsService, AuthService],
  exports: [TokenService, AuthService],
})
export class AuthModule {}
