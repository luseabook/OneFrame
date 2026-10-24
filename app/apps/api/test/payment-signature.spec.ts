import { describe, expect, it } from "vitest";
import { generateKeyPairSync, createSign, createCipheriv, randomBytes } from "node:crypto";
import {
  decryptWechatResource,
  safeEqual,
  verifyAlipaySignature,
  verifyWechatSignature,
} from "../src/modules/billing/payment-signature";

/**
 * 支付回调验签契约测试。
 * 用真实 RSA 密钥对与 AES-GCM 加密构造回调，验证：
 * - 正确签名通过 / 篡改签名拒绝 / 时间戳过期拒绝 / 未配置密钥拒绝
 * - 微信资源解密正确 / 密钥错误拒绝
 * - 支付宝签名拼接规则正确
 */
describe("payment signature", () => {
  // 生成 RSA 密钥对（微信平台证书 / 支付宝公钥场景通用）
  const { publicKey, privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });

  const signRsa = (message: string): string => {
    const s = createSign("RSA-SHA256");
    s.update(message);
    s.end();
    return s.sign(privateKey, "base64");
  };

  describe("wechat APIv3", () => {
    it("accepts a correctly signed notify", () => {
      const timestamp = String(Math.floor(Date.now() / 1000));
      const nonce = "abc123";
      const body = '{"id":"evt_1"}';
      const signature = signRsa(`${timestamp}\n${nonce}\n${body}\n`);
      expect(
        verifyWechatSignature({ timestamp, nonce, signature, body, platformPublicKeyPem: publicKey }),
      ).toBe(true);
    });

    it("rejects a tampered body", () => {
      const timestamp = String(Math.floor(Date.now() / 1000));
      const nonce = "abc123";
      const body = '{"id":"evt_1"}';
      const signature = signRsa(`${timestamp}\n${nonce}\n${body}\n`);
      expect(
        verifyWechatSignature({
          timestamp,
          nonce,
          signature,
          body: '{"id":"evt_2"}', // 篡改
          platformPublicKeyPem: publicKey,
        }),
      ).toBe(false);
    });

    it("rejects a stale timestamp (replay protection)", () => {
      const timestamp = String(Math.floor(Date.now() / 1000) - 600); // 10 分钟前
      const nonce = "abc123";
      const body = "{}";
      const signature = signRsa(`${timestamp}\n${nonce}\n${body}\n`);
      expect(
        verifyWechatSignature({ timestamp, nonce, signature, body, platformPublicKeyPem: publicKey }),
      ).toBe(false);
    });

    it("rejects when platform public key is not configured (default deny)", () => {
      const timestamp = String(Math.floor(Date.now() / 1000));
      expect(verifyWechatSignature({ timestamp, nonce: "n", signature: "s", body: "{}" })).toBe(false);
    });

    it("decrypts AEAD_AES_256_GCM resource", () => {
      const apiV3Key = randomBytes(16).toString("hex"); // 32 字符
      const nonce = "0123456789ab"; // 12 字符
      const aad = "transaction";
      const plaintext = JSON.stringify({ out_trade_no: "order-1", transaction_id: "wx-1", amount: { total: 5000 } });

      const cipher = createCipheriv("aes-256-gcm", Buffer.from(apiV3Key, "utf8"), Buffer.from(nonce, "utf8"));
      cipher.setAAD(Buffer.from(aad, "utf8"));
      const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
      const ciphertext = Buffer.concat([enc, cipher.getAuthTag()]).toString("base64");

      const decoded = decryptWechatResource({
        ciphertext,
        nonce,
        associatedData: aad,
        apiV3Key,
      });
      expect(decoded).not.toBeNull();
      expect(decoded?.out_trade_no).toBe("order-1");
      expect((decoded?.amount as { total: number }).total).toBe(5000);
    });

    it("fails decryption with wrong apiV3 key", () => {
      const apiV3Key = randomBytes(16).toString("hex");
      const wrongKey = randomBytes(16).toString("hex");
      const nonce = "0123456789ab";
      const cipher = createCipheriv("aes-256-gcm", Buffer.from(apiV3Key, "utf8"), Buffer.from(nonce, "utf8"));
      const enc = Buffer.concat([cipher.update("{}", "utf8"), cipher.final()]);
      const ciphertext = Buffer.concat([enc, cipher.getAuthTag()]).toString("base64");

      expect(decryptWechatResource({ ciphertext, nonce, apiV3Key: wrongKey })).toBeNull();
    });
  });

  describe("alipay RSA2", () => {
    const baseParams = {
      out_trade_no: "order-1",
      trade_no: "ali-1",
      trade_status: "TRADE_SUCCESS",
      total_amount: "50.00",
    };

    const buildSignedParams = () => {
      const keys = Object.keys(baseParams).sort();
      const content = keys.map((k) => `${k}=${(baseParams as Record<string, string>)[k]}`).join("&");
      const sign = signRsa(content);
      return { ...baseParams, sign, sign_type: "RSA2" };
    };

    it("accepts a correctly signed notify", () => {
      expect(verifyAlipaySignature({ params: buildSignedParams(), publicKeyPem: publicKey })).toBe(true);
    });

    it("rejects tampered amount", () => {
      const signed = buildSignedParams();
      const tampered = { ...signed, total_amount: "0.01" };
      expect(verifyAlipaySignature({ params: tampered, publicKeyPem: publicKey })).toBe(false);
    });

    it("rejects when public key is not configured (default deny)", () => {
      expect(verifyAlipaySignature({ params: buildSignedParams() })).toBe(false);
    });

    it("ignores sign/sign_type keys when building the content string", () => {
      // 若错误地把 sign 也拼进内容，签名校验会失败
      const signed = buildSignedParams();
      expect(verifyAlipaySignature({ params: signed, publicKeyPem: publicKey })).toBe(true);
    });
  });

  describe("helpers", () => {
    it("safeEqual compares equal strings", () => {
      expect(safeEqual("abc", "abc")).toBe(true);
      expect(safeEqual("abc", "abd")).toBe(false);
      expect(safeEqual("abc", "abcd")).toBe(false);
    });
  });
});
