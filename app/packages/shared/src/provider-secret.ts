import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const TAG_BYTES = 16;

/** 把任意高熵配置材料收敛成 AES-256 密钥；Key 本身不落库、不进日志。 */
export function deriveProviderSecretKey(material: string): Buffer {
  return createHash("sha256").update(material, "utf8").digest();
}

/** 密文格式：`base64(iv).base64(tag).base64(ciphertext)`，AAD 绑定供应商与版本。 */
export function encryptProviderSecret(plain: string, aad: string, key: Buffer): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return `${iv.toString("base64")}.${cipher.getAuthTag().toString("base64")}.${encrypted.toString("base64")}`;
}

export function decryptProviderSecret(ciphertext: string, aad: string, key: Buffer): string {
  const parts = ciphertext.split(".");
  if (parts.length !== 3) throw new Error("invalid encrypted provider credential");
  const iv = Buffer.from(parts[0]!, "base64");
  const tag = Buffer.from(parts[1]!, "base64");
  const encrypted = Buffer.from(parts[2]!, "base64");
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
    throw new Error("invalid encrypted provider credential");
  }
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAAD(Buffer.from(aad, "utf8"));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}

export function providerSecretHint(secret: string): string {
  const trimmed = secret.trim();
  return trimmed.length > 4 ? `****${trimmed.slice(-4)}` : "****";
}

export function providerSecretFingerprint(secret: string): string {
  return createHash("sha256").update(secret.trim(), "utf8").digest("hex").slice(0, 8);
}
