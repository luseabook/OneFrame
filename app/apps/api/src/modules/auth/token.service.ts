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
  typ: "access" | "refresh" | "master";
}

export interface IssuedAccess {
  accessToken: string;
  expiresIn: number;
  jti: string;
}

export interface IssuedMaster {
  masterToken: string;
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

  /**
   * 签发 master token（双 token 的第二枚，长有效期）。
   *
   * 用途**只有**一个：换 access（`POST /auth/renew`）。它**不能**用于任何业务端点——
   * `AuthGuard` 走 `verifyAccess`，而 `verify` 会比对 `typ`，master 直接 401
   * （`auth-oauth.spec.ts` 有专门用例钉住这条，防以后有人图省事把 guard 改成 lenient）。
   *
   * 每人只保留**一枚**有效 master（`master:user:<id>` 单值）：换设备登录会让旧 master
   * 失效，这是有意的——master 有效期长，无法被动失效就等于永久凭据。
   */
  async issueMaster(userId: string, spaceId: string): Promise<IssuedMaster> {
    const jti = newJti();
    const ttl = env.MASTER_TTL_S;
    await this.redis.set(`master:user:${userId}`, jti, ttl);
    return {
      masterToken: this.sign({ sub: userId, sid: spaceId, jti, typ: "master" }, ttl),
      expiresIn: ttl,
      jti,
    };
  }

  verifyMaster(token: string): TokenPayload {
    return this.verify(token, "master");
  }

  /** master 是否仍是"当前那一枚"（被新登录轮换/登出后失效） */
  async assertMasterActive(userId: string, jti: string): Promise<void> {
    const current = await this.redis.get(`master:user:${userId}`);
    if (current !== jti) throw new AppError(ErrorCode.UNAUTHORIZED, "master token revoked");
  }

  async revokeMaster(userId: string): Promise<void> {
    await this.redis.del(`master:user:${userId}`);
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
    // 原子「比对并删除」：并发的两次 /auth/refresh 只能有一次成功（见 RedisService.delIfCurrent）。
    // 分开的 GET + DEL 会让两个调用都读到同一 jti 并各自签发新会话 —— 重放检测形同虚设。
    return this.redis.delIfCurrent(`refresh:user:${userId}`, jti, `refresh:jti:${jti}`);
  }

  /**
   * 只校验、不消费（P1-8）。
   *
   * `/auth/renew` 是「拿 refresh Cookie 换一枚新 access」的降级通道，**不轮换** refresh，
   * 所以不能用 `consumeRefresh`（那会让并发的续期请求互相把对方作废）。
   * 但也不能不校验 —— 否则登出/改密/被踢下线之后，一枚被窃的 refresh cookie
   * 还能在 14 天有效期内无限续 access，这条通道等于「不可撤销的永久凭据」。
   *
   * 判据取与 `consumeRefresh` 完全相同的两个键：`refresh:user:<uid>` 必须是当前 jti，
   * 且 `refresh:jti:<jti>` 仍在（登出会删这两把，改密/踢下线走 `revokeRefresh`）。
   */
  async assertRefreshActive(userId: string, jti: string): Promise<void> {
    const current = await this.redis.get(`refresh:user:${userId}`);
    if (current !== jti) throw new AppError(ErrorCode.UNAUTHORIZED, "refresh token revoked");
    const alive = await this.redis.get(`refresh:jti:${jti}`);
    if (!alive) throw new AppError(ErrorCode.UNAUTHORIZED, "refresh token revoked");
  }

  async revokeRefresh(userId: string): Promise<void> {
    const jti = await this.redis.get(`refresh:user:${userId}`);
    await this.redis.del(`refresh:user:${userId}`);
    if (jti) await this.redis.del(`refresh:jti:${jti}`);
  }
}
