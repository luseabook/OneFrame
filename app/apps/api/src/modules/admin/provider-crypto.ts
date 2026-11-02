import {
  decryptProviderSecret,
  deriveProviderSecretKey,
  encryptProviderSecret,
  providerSecretFingerprint,
  providerSecretHint,
  AppError,
  ErrorCode,
} from "@app/shared";
import { env } from "../../config/env";

/**
 * 供应商 Key 的落库加密。
 *
 * 生产必须显式配置 `PROVIDER_ENCRYPTION_KEY`；非生产从 JWT_SECRET 派生，
 * 让本地/CI 不必多配一个变量，但**绝不会**在生产走这条回落。
 *
 * 密文格式：`base64(iv).base64(tag).base64(ciphertext)`。AAD 绑定
 * `provider:{id}:v{version}`，防止把 A 供应商的密文搬到 B 供应商行上仍能解开。
 */
function masterKey(): Buffer {
  const configured = env.PROVIDER_ENCRYPTION_KEY?.trim();
  if (configured) return deriveProviderSecretKey(configured);
  if (env.NODE_ENV === "production") {
    throw new AppError(ErrorCode.INTERNAL, "PROVIDER_ENCRYPTION_KEY is required");
  }
  const fallback = env.JWT_SECRET?.trim() || "oneframe-local-provider-secret";
  return deriveProviderSecretKey(`provider:${fallback}`);
}

export function providerAad(providerId: string, credentialVersion: number): string {
  return `provider:${providerId}:v${credentialVersion}`;
}

export interface EncryptedSecret {
  ciphertext: string;
  keyId: string;
}

export function encryptSecret(plain: string, aad: string): EncryptedSecret {
  return {
    ciphertext: encryptProviderSecret(plain, aad, masterKey()),
    keyId: env.PROVIDER_ENCRYPTION_KEY_ID,
  };
}

export function decryptSecret(ciphertext: string, aad: string): string {
  try {
    return decryptProviderSecret(ciphertext, aad, masterKey());
  } catch {
    // 不把底层 OpenSSL 文案透出：它可能暴露密钥/格式细节
    throw new AppError(ErrorCode.INTERNAL, "provider credential decrypt failed");
  }
}

/** 只回显末 4 位；短 Key 一律不露 */
export function secretHint(secret: string): string {
  return providerSecretHint(secret);
}

/** 用于重复检测，不可逆；取 8 位足够区分，不存完整摘要 */
export function secretFingerprint(secret: string): string {
  return providerSecretFingerprint(secret);
}
