import { Inject, Injectable } from "@nestjs/common";
import { randomInt } from "node:crypto";
import { AppError, ErrorCode } from "@app/shared";
import { env } from "../../config/env";
import { RedisService } from "../../redis/redis.service";

const CODE_TTL_S = 300;
const MAX_TRIES = 5;

@Injectable()
export class SmsService {
  constructor(@Inject(RedisService) private readonly redis: RedisService) {}

  async send(phone: string): Promise<{ debug_code?: string }> {
    const perMinute = await this.redis.incrWithTtl(`sms:60:${phone}`, 60);
    if (perMinute > 1) throw new AppError(ErrorCode.RATE_LIMITED, "发送过于频繁，请稍后重试");
    const perDay = await this.redis.incrWithTtl(`sms:day:${phone}`, 86_400);
    if (perDay > 5) throw new AppError(ErrorCode.RATE_LIMITED, "今日发送次数已达上限");

    const code = String(randomInt(100_000, 1_000_000));
    await this.redis.set(`sms:code:${phone}`, JSON.stringify({ code, tries: 0 }), CODE_TTL_S);
    return env.NODE_ENV === "production" ? {} : { debug_code: code };
  }

  async verify(phone: string, code: string): Promise<void> {
    const raw = await this.redis.get(`sms:code:${phone}`);
    if (!raw) throw new AppError(ErrorCode.INVALID_PARAM, "验证码不存在或已过期", { field: "code" });
    const data = JSON.parse(raw) as { code: string; tries: number };
    if (data.tries >= MAX_TRIES) {
      await this.redis.del(`sms:code:${phone}`);
      throw new AppError(ErrorCode.INVALID_PARAM, "验证码已作废，请重新获取", { field: "code" });
    }
    if (data.code !== code) {
      data.tries += 1;
      await this.redis.set(`sms:code:${phone}`, JSON.stringify(data), CODE_TTL_S);
      throw new AppError(ErrorCode.INVALID_PARAM, "验证码错误", { field: "code" });
    }
    await this.redis.del(`sms:code:${phone}`);
  }
}
