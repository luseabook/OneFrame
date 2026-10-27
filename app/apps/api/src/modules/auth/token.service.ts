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

/**
 * master token 有效期（天级）。
 *
 * 为什么不在 `config/env.ts` 里声明：那个文件是 Lead 独占（本批写权限只有 modules/auth、
 * modules/team）。这里在**调用时**读 `process.env.MASTER_TTL_S`（默认 30 天），
 * 好处是同一个进程内可切换（测试能造"过期/被轮换"的 master），代价是生产应改由
 * env.ts 启动即校验——已写进 `_acceptance/_team/report-account-team.md`「需要 Lead 做」。
 */
const MASTER_TTL_DEFAULT_S = 30 * 86_400;
function masterTtlSeconds(): number {
  const raw = Number(process.env.MASTER_TTL_S ?? "");
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : MASTER_TTL_DEFAULT_S;
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
    const ttl = masterTtlSeconds();
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
