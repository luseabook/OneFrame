import { createCipheriv, createDecipheriv, createHmac, randomBytes, randomUUID, createHash } from "node:crypto";
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
