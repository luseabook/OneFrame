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

export function newJti(): string {
  return randomUUID();
}
