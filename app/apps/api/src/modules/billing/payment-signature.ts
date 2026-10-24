import { createDecipheriv, createHash, createVerify, timingSafeEqual } from "node:crypto";

/**
 * 支付回调验签与解密（微信支付 APIv3 / 支付宝）。
 *
 * 设计原则：**默认拒绝**——未配置密钥时一律验签失败，绝不放行。
 * 这样在 PAYMENT_LIVE=false 的联调环境里，只有 mock 渠道走的独立路径可用，
 * 真实渠道即使被误调用也不会入账。
 */

export interface WechatNotifyPayload {
  id?: string;
  event_type?: string;
  resource?: {
    algorithm?: string;
    ciphertext?: string;
    associated_data?: string;
    nonce?: string;
  };
}

/**
 * 微信支付 APIv3 回调验签。
 * 签名串：timestamp\nnonce\nbody\n（body 为原始字符串，必须用未解析的原文）
 */
export function verifyWechatSignature(params: {
  timestamp: string;
  nonce: string;
  signature: string;
  body: string;
  platformPublicKeyPem?: string;
}): boolean {
  const { timestamp, nonce, signature, body, platformPublicKeyPem } = params;
  if (!platformPublicKeyPem || !signature) return false;
  // 时间戳容差 5 分钟，防重放
  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return false;
  if (Math.abs(Date.now() / 1000 - ts) > 300) return false;

  const message = `${timestamp}\n${nonce}\n${body}\n`;
  try {
    const verifier = createVerify("RSA-SHA256");
    verifier.update(message);
    verifier.end();
    return verifier.verify(platformPublicKeyPem, Buffer.from(signature, "base64"));
  } catch {
    return false;
  }
}

/**
 * 微信支付 APIv3 回调资源解密（AEAD_AES_256_GCM）。
 * 返回解密后的 JSON（含 out_trade_no / transaction_id / amount.total 等）。
 */
export function decryptWechatResource(params: {
  ciphertext: string;
  nonce: string;
  associatedData?: string;
  apiV3Key: string;
}): Record<string, unknown> | null {
  const { ciphertext, nonce, associatedData = "", apiV3Key } = params;
  if (!apiV3Key || apiV3Key.length !== 32) return null;
  try {
    const buf = Buffer.from(ciphertext, "base64");
    const authTag = buf.subarray(buf.length - 16);
    const data = buf.subarray(0, buf.length - 16);
    const decipher = createDecipheriv("aes-256-gcm", Buffer.from(apiV3Key, "utf8"), Buffer.from(nonce, "utf8"));
    decipher.setAuthTag(authTag);
    if (associatedData) decipher.setAAD(Buffer.from(associatedData, "utf8"));
    const plain = Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
    return JSON.parse(plain) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * 支付宝回调验签（RSA2）。
 * 签名内容：将所有非 sign / sign_type 参数按 key 升序拼成 k=v&k=v。
 */
export function verifyAlipaySignature(input: {
  params: Record<string, string>;
  publicKeyPem?: string;
  signType?: string;
}): boolean {
  const { params, publicKeyPem, signType = "RSA2" } = input;
  if (!publicKeyPem) return false;
  const signature = params.sign;
  if (!signature) return false;

  const keys = Object.keys(params)
    .filter((k) => k !== "sign" && k !== "sign_type" && params[k] !== undefined && params[k] !== "")
    .sort();
  const content = keys.map((k) => `${k}=${params[k]}`).join("&");

  try {
    const algo = signType === "RSA2" ? "RSA-SHA256" : "RSA-SHA1";
    const verifier = createVerify(algo);
    verifier.update(content, "utf8");
    verifier.end();
    return verifier.verify(publicKeyPem, Buffer.from(signature, "base64"));
  } catch {
    return false;
  }
}

/** 常时序比较（用于自定义签名算法，防时序攻击） */
export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/** HMAC-SHA256 十六进制签名（部分聚合支付渠道用此方案） */
export function hmacSha256Hex(secret: string, payload: string): string {
  return createHash("sha256").update(`${secret}${payload}`).digest("hex");
}
