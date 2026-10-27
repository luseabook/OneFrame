import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { env } from "../../config/env";
import { RedisService } from "../../redis/redis.service";

/**
 * 行为验证码票据（模块 #25 收尾）。
 *
 * ## 诚实边界（这一条最重要）
 * 我方**没有**配置第三方行为验证码（腾讯云/极验/阿里云）的 Key，也没有对应的
 * 服务端 SDK 调用与回调校验。所以：
 * - `available` 恒为 `false`，并显式返回 `reason:"third_party_not_configured"`；
 * - 实际可用的是**本地算术题模式**（`mode:"local_arithmetic"`）——一个"人类更顺手、
 *   脚本要先算一步"的**弱**门槛，不声称等同于行为验证；
 * - 绝不会出现「已接入腾讯云」这类文案（`provider` 恒为 `null`，
 *   即使有人配了 `CAPTCHA_PROVIDER` 环境变量，也只报 `integration:"not_implemented"`）。
 *
 * ## 票据三要素（任务要求）
 * - **HMAC 签名**：payload 用 `JWT_SECRET` 派生的域隔离密钥签名，客户端改不动 `exp/jti/a/b`；
 * - **5 分钟过期**：payload 里带 `exp`，且 Redis 侧同 TTL（双保险，时钟回拨也不会让票据永生）；
 * - **一次性**：`jti` 在 Redis 里占位，`verify` 用 `DEL` 的返回值判定是否首次使用——
 *   同票重放第二次直接 `used_or_expired`（不依赖内存态，多实例部署同样成立）。
 */

const TICKET_TTL_S = 300;
const REDIS_PREFIX = "moderation:captcha:";

export interface CaptchaChallenge {
  a: number;
  b: number;
  op: "+";
}

export interface CaptchaTicketView {
  /** 第三方是否可用：恒 false（未接入，见文件头） */
  available: false;
  provider: null;
  mode: "local_arithmetic";
  reason: "third_party_not_configured";
  /** 若运维配了 CAPTCHA_PROVIDER，这里如实透出"配了但没实现" */
  configured_provider: string | null;
  integration: "not_implemented" | "none";
  challenge: CaptchaChallenge;
  ticket: string;
  expires_in: number;
}

export interface CaptchaVerifyResult {
  passed: boolean;
  reason?: "invalid_ticket" | "expired" | "used_or_expired" | "wrong_answer" | "verifier_unavailable";
  /** 剩余可用次数提示（一次性票据失败即作废，前端应重新取票） */
  retry_allowed: boolean;
}

interface TicketPayload {
  v: 1;
  jti: string;
  a: number;
  b: number;
  op: "+";
  exp: number;
  scope: "captcha";
}

const b64url = (buf: Buffer | string): string =>
  Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const fromB64url = (text: string): Buffer =>
  Buffer.from(text.replace(/-/g, "+").replace(/_/g, "/"), "base64");

@Injectable()
export class CaptchaService {
  constructor(@Inject(RedisService) private readonly redis: RedisService) {}

  /** 域隔离：captcha 的签名密钥不能与 access token 的密钥"同串复用" */
  private signKey(): string {
    // 显式 hex：Buffer 直接当 string 用会触发 TS2322，也会在 HMAC key 处产生隐式转换
    return createHmac("sha256", env.JWT_SECRET).update("captcha-ticket:v1").digest("hex");
  }

  private sign(payloadB64: string): string {
    return b64url(createHmac("sha256", this.signKey()).update(payloadB64).digest());
  }

  async issue(): Promise<CaptchaTicketView> {
    const a = 1 + Math.floor(Math.random() * 9);
    const b = 1 + Math.floor(Math.random() * 9);
    const jti = randomBytes(12).toString("base64url");
    const payload: TicketPayload = {
      v: 1,
      jti,
      a,
      b,
      op: "+",
      exp: Date.now() + TICKET_TTL_S * 1000,
      scope: "captcha",
    };
    const payloadB64 = b64url(JSON.stringify(payload));
    const ticket = `${payloadB64}.${this.sign(payloadB64)}`;
    // 占位：写入失败（Redis 不可用）时仍发票，但 verify 会以 verifier_unavailable 失败
    // —— 宁可让验证码暂不可用，也不要"跳过校验"。
    const client = this.redis.client;
    try {
      await client.set(`${REDIS_PREFIX}${jti}`, "1", "EX", TICKET_TTL_S, "NX");
    } catch {
      // 忽略：verify 侧会 fail closed
    }
    const configured = (process.env.CAPTCHA_PROVIDER ?? "").trim();
    return {
      available: false,
      provider: null,
      mode: "local_arithmetic",
      reason: "third_party_not_configured",
      configured_provider: configured === "" ? null : configured,
      integration: configured === "" ? "none" : "not_implemented",
      challenge: { a, b, op: "+" },
      ticket,
      expires_in: TICKET_TTL_S,
    };
  }

  async verify(ticket: string, answer: unknown): Promise<CaptchaVerifyResult> {
    const [payloadB64, signature] = ticket.split(".");
    if (!payloadB64 || !signature) return { passed: false, reason: "invalid_ticket", retry_allowed: true };

    let payload: TicketPayload;
    try {
      const expected = this.sign(payloadB64);
      const given = Buffer.from(signature);
      const want = Buffer.from(expected);
      // 长度不等时 timingSafeEqual 会抛，先挡一层
      if (given.length !== want.length || !timingSafeEqual(given, want)) {
        return { passed: false, reason: "invalid_ticket", retry_allowed: true };
      }
      payload = JSON.parse(fromB64url(payloadB64).toString("utf8")) as TicketPayload;
    } catch {
      return { passed: false, reason: "invalid_ticket", retry_allowed: true };
    }
    if (payload.scope !== "captcha" || payload.v !== 1) {
      return { passed: false, reason: "invalid_ticket", retry_allowed: true };
    }
    if (typeof payload.exp !== "number" || payload.exp <= Date.now()) {
      return { passed: false, reason: "expired", retry_allowed: true };
    }

    // 一次性：DEL 返回 1 表示本次是首次消费；0 表示已用过/已过期（Redis TTL 兜底）
    let consumed: number;
    try {
      consumed = await this.redis.client.del(`${REDIS_PREFIX}${payload.jti}`);
    } catch {
      // 失败关闭：验证器不可用时拒绝，而不是放行
      return { passed: false, reason: "verifier_unavailable", retry_allowed: true };
    }
    if (consumed !== 1) {
      return { passed: false, reason: "used_or_expired", retry_allowed: true };
    }

    const expectedAnswer = payload.a + payload.b;
    const provided = Number(answer);
    if (!Number.isFinite(provided) || provided !== expectedAnswer) {
      // 答错也消耗票据：否则同一张票可以被脚本无限次试（10×10 只有 100 种可能）
      return { passed: false, reason: "wrong_answer", retry_allowed: true };
    }
    return { passed: true, retry_allowed: false };
  }
}
