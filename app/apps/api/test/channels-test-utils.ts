import { createCipheriv, createSign, createVerify, generateKeyPairSync, randomBytes } from "node:crypto";
import { parse as parseQuery } from "node:querystring";
import type { FetchLike } from "../src/modules/billing/channels/http";

/** 测试用 RSA 密钥对（本地生成，绝不使用真实商户证书） */
export interface KeyPair {
  publicKeyPem: string;
  privateKeyPem: string;
}

export function generateRsaKeyPair(): KeyPair {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  return { publicKeyPem: publicKey, privateKeyPem: privateKey };
}

export function rsaSign(privateKeyPem: string, message: string): string {
  const signer = createSign("RSA-SHA256");
  signer.update(message, "utf8");
  signer.end();
  return signer.sign(privateKeyPem, "base64");
}

export function rsaVerify(publicKeyPem: string, message: string, signatureBase64: string): boolean {
  const verifier = createVerify("RSA-SHA256");
  verifier.update(message, "utf8");
  verifier.end();
  return verifier.verify(publicKeyPem, Buffer.from(signatureBase64, "base64"));
}

export interface CapturedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

export type FakeResponder = (
  call: CapturedRequest,
  index: number,
) => { status?: number; body?: string } | Promise<{ status?: number; body?: string }> | Error;

export interface FakeFetch {
  fetchImpl: FetchLike;
  calls: CapturedRequest[];
}

/** 可控假 fetch：记录每次请求并返回预置响应（或抛错模拟网络故障） */
export function createFakeFetch(responder: FakeResponder): FakeFetch {
  const calls: CapturedRequest[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    const call: CapturedRequest = {
      url,
      method: init?.method ?? "GET",
      headers: init?.headers ?? {},
      body: init?.body,
    };
    calls.push(call);
    const result = await responder(call, calls.length - 1);
    if (result instanceof Error) throw result;
    const status = result.status ?? 200;
    const bodyText = result.body ?? "";
    return { status, text: async () => bodyText, headers: { get: () => null } };
  };
  return { fetchImpl, calls };
}

/** 快速失败的重试睡眠（测试不真等） */
export const noSleep = async (): Promise<void> => {
  /* no-op */
};

/** 从 querystring 解析出 Record（node:querystring） */
export function parseForm(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(parseQuery(body))) {
    if (v === undefined) continue;
    out[k] = Array.isArray(v) ? (v[0] ?? "") : v;
  }
  return out;
}

/** 从 Authorization 头解析 `key="value"` 字段 */
export function parseAuthorizationFields(header: string): Record<string, string> {
  const fields: Record<string, string> = {};
  const pattern = /([A-Za-z_]+)="([^"]*)"/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(header)) !== null) fields[match[1]] = match[2];
  return fields;
}

// ── 微信 APIv3 回调构造（验签/解密 e2e 共用）──────────────────────────────

export interface WechatEncryptedResource {
  ciphertext: string;
  nonce: string;
  associated_data: string;
}

/** AEAD_AES_256_GCM 加密交易通知 resource（apiV3Key 必须 32 字符） */
export function encryptWechatResource(plaintext: Record<string, unknown>, apiV3Key: string): WechatEncryptedResource {
  const nonce = "0123456789ab";
  const associatedData = "transaction";
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(apiV3Key, "utf8"), Buffer.from(nonce, "utf8"));
  cipher.setAAD(Buffer.from(associatedData, "utf8"));
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(plaintext), "utf8"), cipher.final()]);
  return {
    ciphertext: Buffer.concat([encrypted, cipher.getAuthTag()]).toString("base64"),
    nonce,
    associated_data: associatedData,
  };
}

/**
 * 构造完整微信回调原始体。
 * 默认 `pretty=true`：带缩进/空白的 JSON——只有"按原始请求体字节验签"的实现才能通过。
 */
export function buildWechatNotifyBody(
  plaintext: Record<string, unknown>,
  apiV3Key: string,
  pretty = true,
): string {
  const resource = encryptWechatResource(plaintext, apiV3Key);
  const payload = {
    id: `EV-${randomBytes(6).toString("hex")}`,
    create_time: new Date().toISOString(),
    event_type: "TRANSACTION.SUCCESS",
    resource_type: "encrypt-resource",
    summary: "支付成功",
    resource: { original_type: "transaction", algorithm: "AEAD_AES_256_GCM", ...resource },
  };
  return JSON.stringify(payload, null, pretty ? 2 : 0);
}

/** 微信回调请求头（timestamp/nonce/signature，可选 Wechatpay-Serial） */
export function wechatNotifyHeaders(
  rawBody: string,
  platformPrivateKeyPem: string,
  options: { serial?: string; tamperSignature?: boolean } = {},
): Record<string, string> {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonceStr = randomBytes(8).toString("hex");
  const signature = options.tamperSignature
    ? rsaSign(platformPrivateKeyPem, "tampered")
    : rsaSign(platformPrivateKeyPem, `${timestamp}\n${nonceStr}\n${rawBody}\n`);
  return {
    "content-type": "application/json",
    "wechatpay-timestamp": timestamp,
    "wechatpay-nonce": nonceStr,
    "wechatpay-signature": signature,
    ...(options.serial ? { "wechatpay-serial": options.serial } : {}),
  };
}
