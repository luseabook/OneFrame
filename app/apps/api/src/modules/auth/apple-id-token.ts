import { createPublicKey, verify as cryptoVerify, type JsonWebKey, type KeyObject } from "node:crypto";

/**
 * Apple `id_token` 校验（JWKS 验签 + claims 校验）。
 *
 * ## 为什么必须做（本批之前是"不验签"）
 *
 * 改造前 `oauth.service.ts` 的 apple 分支只做了 `id_token.split(".")[1]` + base64 解码，
 * 注释写的理由是"该 token 是我们通过 TLS 直连 Apple token 端点换回来的，来源可信"。
 * 这个理由对**直连换取**的路径成立，但它把安全边界放在了"网络路径"上：
 *
 * 1. 一旦 token 端点被代理/中间人（企业网关、抓包排障、被污染的 DNS+TLS 终止）篡改，
 *    解码出的 `sub` 就可能不是真实 Apple 用户 —— 我们没有第二道校验。
 * 2. `id_token` 是**身份断言**，其价值恰在签名：不验签时 `sub` 与一段随手 base64 的
 *    JSON 等价，安全强度为零。竞品接入 Apple 登录同样必须验签（Apple 官方要求）。
 * 3. 顺带补齐时效（`exp`/`iat`）与受众（`aud`）校验：没有它们，过期 token 与
 *    "发给别的 client_id 的 token"都能被我方接受。
 *
 * ## 为什么不用第三方 JWT 库
 *
 * 只需要 RS256/ES256 两种算法的**验签** + 少量 claims 判断，`node:crypto` 直接够用；
 * 引一个 JWT 库会带来一整条依赖，且其默认行为（宽松的 alg 处理）反而是常见漏洞来源。
 * 这里显式白名单 alg，`none`/`HS256`（用公钥当 HMAC 密钥的经典攻击）一律拒绝。
 *
 * ## 网络与缓存
 *
 * JWKS 走 `https://appleid.apple.com/auth/keys`，缓存 5 分钟（Apple 轮换密钥时最多滞后
 * 一个 TTL；`kid` 未命中时会**强制刷新一次**，避免轮换瞬间登录全部失败）。
 * 验签函数本身把 JWKS provider 作为参数注入，测试用本地生成的密钥对 + stub JWKS，
 * 完全不联网。
 */

export const APPLE_ISSUER = "https://appleid.apple.com";
const APPLE_JWKS_URL = "https://appleid.apple.com/auth/keys";
const JWKS_TTL_MS = 5 * 60_000;
const JWKS_TIMEOUT_MS = 3_000;
/** 时钟偏移容忍（秒）：双方 NTP 漂移在几十秒内属正常，过严会误杀合法登录 */
const CLOCK_SKEW_S = 60;

export type AppleJwk = Record<string, unknown> & { kid?: string; alg?: string; kty?: string };
export interface AppleJwks {
  keys: AppleJwk[];
}
export type AppleJwksProvider = () => Promise<AppleJwks>;

let jwksCache: { at: number; jwks: AppleJwks } | null = null;

/** 拉 Apple JWKS（带 5 分钟缓存）。`force` 用于 kid 未命中时的重新拉取。 */
export async function fetchAppleJwks(force = false): Promise<AppleJwks> {
  if (!force && jwksCache && Date.now() - jwksCache.at < JWKS_TTL_MS) return jwksCache.jwks;
  const res = await fetch(APPLE_JWKS_URL, { signal: AbortSignal.timeout(JWKS_TIMEOUT_MS) });
  if (!res.ok) throw new AppleIdTokenError("jwks_unavailable", `apple jwks http ${res.status}`);
  const body = (await res.json().catch(() => null)) as AppleJwks | null;
  if (!body || !Array.isArray(body.keys)) {
    throw new AppleIdTokenError("jwks_unavailable", "apple jwks malformed");
  }
  jwksCache = { at: Date.now(), jwks: body };
  return body;
}

/** 仅供测试：清空 JWKS 缓存，避免用例间互相影响 */
export function resetAppleJwksCache(): void {
  jwksCache = null;
}

export type AppleIdTokenFailure =
  | "malformed"
  | "bad_alg"
  | "missing_kid"
  | "jwks_unavailable"
  | "unknown_kid"
  | "bad_signature"
  | "bad_issuer"
  | "bad_audience"
  | "expired"
  | "issued_in_future"
  | "bad_nonce";

export class AppleIdTokenError extends Error {
  constructor(
    public readonly reason: AppleIdTokenFailure,
    detail?: string,
  ) {
    super(detail ? `apple id_token invalid: ${reason} (${detail})` : `apple id_token invalid: ${reason}`);
    this.name = "AppleIdTokenError";
  }
}

export interface VerifiedAppleClaims {
  sub: string;
  email?: string;
  email_verified?: boolean;
  iss: string;
  exp: number;
  iat?: number;
}

export interface VerifyAppleIdTokenOptions {
  /** 期望的受众：我方 Apple client_id（Services ID） */
  clientId: string;
  /** 注入 JWKS 来源（测试用）；默认走 Apple 官方端点 */
  jwks?: AppleJwksProvider;
  /** 注入当前时间（毫秒），测试用于构造过期/未来 token */
  now?: () => number;
  /** 若授权请求带了 nonce，必须回传一致（可选校验） */
  expectedNonce?: string;
}

interface DecodedToken {
  header: Record<string, unknown>;
  claims: Record<string, unknown>;
  signingInput: string;
  signature: Buffer;
}

function decodeSegment(segment: string, reason: AppleIdTokenFailure): Record<string, unknown> {
  try {
    const parsed = JSON.parse(Buffer.from(segment, "base64url").toString("utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new AppleIdTokenError(reason, "not an object");
    }
    return parsed as Record<string, unknown>;
  } catch (err) {
    if (err instanceof AppleIdTokenError) throw err;
    throw new AppleIdTokenError(reason, "base64/json decode failed");
  }
}

function decodeIdToken(idToken: string): DecodedToken {
  const parts = String(idToken ?? "").split(".");
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) {
    throw new AppleIdTokenError("malformed", "expected 3 non-empty segments");
  }
  const header = decodeSegment(parts[0], "malformed");
  const claims = decodeSegment(parts[1], "malformed");
  const signature = Buffer.from(parts[2], "base64url");
  if (signature.length === 0) throw new AppleIdTokenError("malformed", "empty signature");
  return { header, claims, signingInput: `${parts[0]}.${parts[1]}`, signature };
}

/** alg 白名单：只接受 Apple 实际使用的两种非对称算法 */
function verifySignature(decoded: DecodedToken, jwk: AppleJwk): void {
  const alg = String(decoded.header.alg ?? "");
  let key: KeyObject;
  try {
    key = createPublicKey({ key: jwk as unknown as JsonWebKey, format: "jwk" });
  } catch {
    throw new AppleIdTokenError("bad_signature", "jwks key is not a valid public key");
  }
  const data = Buffer.from(decoded.signingInput);
  const ok =
    alg === "ES256"
      ? // JWS 的 ES256 签名是 r||s（各 32 字节，共 64），不是 DER；不指定 ieee-p1363 必然验签失败
        cryptoVerify("sha256", data, { key, dsaEncoding: "ieee-p1363" }, decoded.signature)
      : cryptoVerify("RSA-SHA256", data, key, decoded.signature);
  if (!ok) throw new AppleIdTokenError("bad_signature", `alg=${alg}`);
}

/** 手机号/邮箱等场景下 aud 可能是字符串或数组，两者都接受 */
function audienceMatches(aud: unknown, clientId: string): boolean {
  if (typeof aud === "string") return aud === clientId;
  if (Array.isArray(aud)) return aud.some((v) => v === clientId);
  return false;
}

/**
 * 校验 Apple `id_token`，通过则返回 claims；任何一项不过都抛 `AppleIdTokenError`
 * （携带稳定的 `reason`，便于调用方把它塞进错误 details 而不是回显整段 token）。
 */
export async function verifyAppleIdToken(
  idToken: string,
  opts: VerifyAppleIdTokenOptions,
): Promise<VerifiedAppleClaims> {
  // 未配置 client_id 时不可能有合法受众：直接拒，避免"空 audience 通配"这种漏洞
  if (!opts.clientId) throw new AppleIdTokenError("bad_audience", "client_id not configured");

  const decoded = decodeIdToken(idToken);
  const alg = String(decoded.header.alg ?? "");
  if (alg !== "RS256" && alg !== "ES256") throw new AppleIdTokenError("bad_alg", `alg=${alg || "(empty)"}`);

  const kid = String(decoded.header.kid ?? "");
  if (!kid) throw new AppleIdTokenError("missing_kid");

  const nowMs = opts.now ? opts.now() : Date.now();
  const nowS = Math.floor(nowMs / 1000);

  const { claims } = decoded;
  if (String(claims.iss ?? "") !== APPLE_ISSUER) {
    throw new AppleIdTokenError("bad_issuer", String(claims.iss ?? ""));
  }
  if (!audienceMatches(claims.aud, opts.clientId)) {
    throw new AppleIdTokenError("bad_audience", JSON.stringify(claims.aud ?? null));
  }
  const exp = Number(claims.exp);
  if (!Number.isFinite(exp)) throw new AppleIdTokenError("malformed", "exp missing");
  if (nowS > exp + CLOCK_SKEW_S) throw new AppleIdTokenError("expired", `exp=${exp} now=${nowS}`);
  const iat = claims.iat === undefined ? undefined : Number(claims.iat);
  if (iat !== undefined && Number.isFinite(iat) && iat > nowS + CLOCK_SKEW_S) {
    throw new AppleIdTokenError("issued_in_future", `iat=${iat} now=${nowS}`);
  }
  if (opts.expectedNonce !== undefined && String(claims.nonce ?? "") !== opts.expectedNonce) {
    throw new AppleIdTokenError("bad_nonce");
  }
  const sub = String(claims.sub ?? "");
  if (!sub) throw new AppleIdTokenError("malformed", "sub missing");

  // ── 验签 ──
  const provider = opts.jwks ?? (() => fetchAppleJwks());
  let jwks = await provider();
  let jwk = jwks.keys.find((k) => String(k.kid ?? "") === kid);
  if (!jwk && !opts.jwks) {
    // 密钥轮换：kid 未命中时强制刷新一次缓存（否则轮换后最长 5 分钟无法登录）
    jwks = await fetchAppleJwks(true);
    jwk = jwks.keys.find((k) => String(k.kid ?? "") === kid);
  }
  if (!jwk) throw new AppleIdTokenError("unknown_kid", kid);
  verifySignature(decoded, jwk);

  const out: VerifiedAppleClaims = { sub, iss: APPLE_ISSUER, exp };
  if (typeof claims.email === "string") out.email = claims.email;
  if (typeof claims.email_verified === "boolean") out.email_verified = claims.email_verified;
  if (iat !== undefined && Number.isFinite(iat)) out.iat = iat;
  return out;
}
