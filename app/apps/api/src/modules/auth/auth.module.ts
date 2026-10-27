import { Module } from "@nestjs/common";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { OauthService } from "./oauth.service";
import { SmsService } from "./sms.service";
import { TokenService } from "./token.service";

@Module({
  controllers: [AuthController],
  providers: [TokenService, SmsService, AuthService, OauthService],
  exports: [TokenService, AuthService, OauthService],
})
export class AuthModule {}
