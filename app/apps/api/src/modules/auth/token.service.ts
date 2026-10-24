import { Inject, Injectable } from "@nestjs/common";
import jwt from "jsonwebtoken";
import { AppError, ErrorCode } from "@app/shared";
import { env } from "../../config/env";
import { RedisService } from "../../redis/redis.service";
import { newJti } from "./crypto";

interface TokenPayload {
  sub: string;
  sid: string;
  jti: string;
  typ: "access" | "refresh";
}

export interface IssuedAccess {
  accessToken: string;
  expiresIn: number;
  jti: string;
}

@Injectable()
export class TokenService {
  constructor(@Inject(RedisService) private readonly redis: RedisService) {}

  private sign(payload: TokenPayload, ttl: number): string {
    return jwt.sign(payload, env.JWT_SECRET, { expiresIn: ttl });
  }

  issueAccess(userId: string, spaceId: string): IssuedAccess {
    const jti = newJti();
    return {
      accessToken: this.sign({ sub: userId, sid: spaceId, jti, typ: "access" }, env.ACCESS_TTL_S),
      expiresIn: env.ACCESS_TTL_S,
      jti,
    };
  }

  async issueRefresh(userId: string, spaceId: string): Promise<string> {
    const jti = newJti();
    await this.redis.set(`refresh:jti:${jti}`, `${userId}:${spaceId}`, env.REFRESH_TTL_S);
    await this.redis.set(`refresh:user:${userId}`, jti, env.REFRESH_TTL_S);
    return this.sign({ sub: userId, sid: spaceId, jti, typ: "refresh" }, env.REFRESH_TTL_S);
  }

  verifyAccess(token: string): TokenPayload {
    return this.verify(token, "access");
  }

  verifyRefresh(token: string): TokenPayload {
    return this.verify(token, "refresh");
  }

  private verify(token: string, typ: TokenPayload["typ"]): TokenPayload {
    try {
      const payload = jwt.verify(token, env.JWT_SECRET) as TokenPayload;
      if (payload.typ !== typ) throw new AppError(ErrorCode.UNAUTHORIZED, "wrong token type");
      return payload;
    } catch (error) {
      if (error instanceof jwt.TokenExpiredError) {
        throw new AppError(ErrorCode.TOKEN_EXPIRED, "token expired");
      }
      if (error instanceof AppError) throw error;
      throw new AppError(ErrorCode.UNAUTHORIZED, "invalid token");
    }
  }

  async assertAccessActive(jti: string): Promise<void> {
    const blocked = await this.redis.get(`bl:${jti}`);
    if (blocked) throw new AppError(ErrorCode.UNAUTHORIZED, "token revoked");
  }

  async blacklistAccess(jti: string): Promise<void> {
    await this.redis.set(`bl:${jti}`, "1", env.ACCESS_TTL_S);
  }

  async consumeRefresh(userId: string, jti: string): Promise<boolean> {
    const expected = await this.redis.get(`refresh:user:${userId}`);
    if (expected !== jti) return false;
    await this.redis.del(`refresh:jti:${jti}`, `refresh:user:${userId}`);
    return true;
  }

  async revokeRefresh(userId: string): Promise<void> {
    const jti = await this.redis.get(`refresh:user:${userId}`);
    await this.redis.del(`refresh:user:${userId}`);
    if (jti) await this.redis.del(`refresh:jti:${jti}`);
  }
}
