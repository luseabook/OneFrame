import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  randomUUID,
  createHash,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { env } from "../../config/env";

// 手机号：HMAC 等值查询 + AES-GCM 密文（ADR-007）
export function hashPhone(phone: string): string {
  return createHmac("sha256", env.PHONE_HMAC_PEPPER).update(phone).digest("hex");
}

function phoneKey(): Buffer {
  return createHash("sha256").update(env.PHONE_ENC_KEY).digest();
}

export function encryptPhone(phone: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", phoneKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(phone, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("base64"), tag.toString("base64"), ciphertext.toString("base64")].join(":");
}

export function decryptPhone(payload: string): string {
  const [ivB64, tagB64, dataB64] = payload.split(":");
  if (!ivB64 || !tagB64 || !dataB64) throw new Error("bad phone cipher");
  const decipher = createDecipheriv("aes-256-gcm", phoneKey(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]).toString("utf8");
}

/** 展示用手机号打码：138****1234 */
export function maskPhone(phone: string): string {
  return phone.length === 11 ? `${phone.slice(0, 3)}****${phone.slice(-4)}` : "****";
}

/**
 * 通用标识符 HMAC（第 130 批：邮箱+密码登录）。
 *
 * 与 `hashPhone` **同一个 pepper、同一个算法**：`identities.phone_hash` 这一列存的是
 * 「该 provider 的标识符哈希」（`provider=phone` 存手机号、`provider=email` 存邮箱），
 * 于是唯一性直接继承 `uq_identities_phone(provider, phone_hash)`，不必再造一套索引。
 * 两套 pepper 并不会更安全，只会多一处轮换遗漏；而唯一索引带 `provider` 前缀，
 * "手机号与邮箱撞哈希"在业务上也不成立。
 */
export function hashIdentifier(identifier: string): string {
  return createHmac("sha256", env.PHONE_HMAC_PEPPER).update(identifier).digest("hex");
}

/** 邮箱归一化：裁空白 + 转小写（`A@B.com` 与 `a@b.com` 必须是同一个账号） */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** 最小邮箱形状校验：只拦"明显不是邮箱"，真实性交给后续发信验证 */
export const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// ── 密码哈希（scrypt；不引第三方依赖）────────────────────────────────────
//
// 存储形状：`scrypt$N$r$p$<saltB64>$<hashB64>`。
// 把 N/r/p 写进哈希串，是为了将来调参数时**老哈希仍可验证**（按行内参数算），
// 不必搞"全员强制改密"这种事故式升级。
const SCRYPT_N = 16_384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 64;
const SALT_BYTES = 16;

export function hashPassword(plain: string): string {
  const salt = randomBytes(SALT_BYTES);
  const hash = scryptSync(plain, salt, SCRYPT_KEYLEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });
  return ["scrypt", SCRYPT_N, SCRYPT_R, SCRYPT_P, salt.toString("base64"), hash.toString("base64")].join("$");
}

/**
 * 校验密码：**常数时间比较**。长度不等时 `timingSafeEqual` 会抛错，所以先比长度
 * ——这不是"提前返回优化"，是必要守卫。任何解析失败一律 false（坏数据=验证不过），
 * 绝不把异常抛给登录入口（否则坏行会让整个端点 500，且报错信息能侧信道区分）。
 */
export function verifyPassword(plain: string, stored: string | null | undefined): boolean {
  if (typeof stored !== "string" || stored === "") return false;
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, nRaw, rRaw, pRaw, saltB64, hashB64] = parts as [string, string, string, string, string, string];
  const N = Number(nRaw);
  const r = Number(rRaw);
  const p = Number(pRaw);
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p) || N <= 0 || r <= 0 || p <= 0) return false;
  const expected = Buffer.from(hashB64 ?? "", "base64");
  if (expected.length !== SCRYPT_KEYLEN) return false;
  const actual = scryptSync(plain, Buffer.from(saltB64 ?? "", "base64"), SCRYPT_KEYLEN, { N, r, p });
  return timingSafeEqual(actual, expected);
}

/**
 * 弱口令黑名单：**只在注册/改密时拦**，登录时只验对错。
 * `admin12345` 在列是刻意的——它是本仓库历史上出现过的默认口令，不许再被用户选走。
 */
const WEAK_PASSWORDS = new Set([
  "12345678",
  "123456789",
  "1234567890",
  "password",
  "password1",
  "passw0rd",
  "qwertyui",
  "admin123",
  "admin12345",
  "11111111",
  "abcdefgh",
]);

/** 密码强度：≥8 字符、非弱口令黑名单、不等于邮箱前缀。返回 null = 通过 */
export function passwordProblem(password: string, email?: string): string | null {
  if (password.length < 8) return "密码至少 8 个字符";
  if (password.length > 72) return "密码最多 72 个字符";
  if (WEAK_PASSWORDS.has(password.toLowerCase())) return "密码过于常见，请换一个";
  if (email) {
    const local = normalizeEmail(email).split("@")[0] ?? "";
    if (local !== "" && password.toLowerCase() === local) return "密码不能与邮箱前缀相同";
  }
  return null;
}

/**
 * 通用密文（BYOK 第三方 Key 等「只存密文+哈希」的凭据）。
 *
 * 为什么不复用 `encryptPhone`：手机号的派生 key 与语义绑死（`phoneKey()`），
 * 拿它加密别的明文会让"这份密文是手机号"这条不变量失效；这里用同一主密钥 +
 * 不同上下文串再派生一次（域分离），格式与 AES-256-GCM 相同。
 */
function secretKey(): Buffer {
  return createHash("sha256").update(`${env.PHONE_ENC_KEY}:secret`).digest();
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", secretKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("base64"), tag.toString("base64"), ciphertext.toString("base64")].join(":");
}

export function decryptSecret(payload: string): string {
  const [ivB64, tagB64, dataB64] = payload.split(":");
  if (!ivB64 || !tagB64 || !dataB64) throw new Error("bad secret cipher");
  const decipher = createDecipheriv("aes-256-gcm", secretKey(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]).toString("utf8");
}

/** 等值查重用的哈希（同一明文 → 同一哈希；与密文列分开，永不参与解密） */
export function hashSecret(plain: string): string {
  return createHmac("sha256", env.PHONE_HMAC_PEPPER).update(`secret:${plain}`).digest("hex");
}

/**
 * 对外展示用的打码：`sk-abcd…wxyz`。太短的 key（<12）整串打码，
 * 避免"打码后等于原值"这种自我泄露。
 */
export function maskSecret(plain: string): string {
  if (plain.length < 12) return "*".repeat(plain.length);
  return `${plain.slice(0, 4)}…${plain.slice(-4)}`;
}

export function newJti(): string {
  return randomUUID();
}
