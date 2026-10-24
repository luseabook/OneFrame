import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ChannelService,
  normalizePem,
  parseWechatPlatformKeyring,
  readPem,
  resolveAlipayConfig,
  resolveChannelSet,
  resolveWechatConfig,
  selectWechatPlatformPublicKey,
} from "../src/modules/billing/channels/channel.service";
import type { Env } from "../src/config/env";
import type { KeyPair } from "./channels-test-utils";
import { generateRsaKeyPair } from "./channels-test-utils";

/**
 * 渠道工厂测试：凭据不全时必须 NotConfigured（默认拒绝），绝不静默 mock；
 * 同时覆盖 PEM 内联/文件路径两种私钥来源与前端渠道清单。
 */
describe("channel factory", () => {
  const merchant = generateRsaKeyPair();
  const platform = generateRsaKeyPair();
  const alipay = generateRsaKeyPair();

  const fullPaymentEnv = (overrides: Record<string, unknown> = {}): Env =>
    ({
      NODE_ENV: "test",
      PAYMENT_LIVE: true,
      WECHAT_APP_ID: "wxtest",
      WECHAT_MCH_ID: "1900000001",
      WECHAT_MCH_SERIAL_NO: "SERIAL",
      WECHAT_MCH_PRIVATE_KEY: merchant.privateKeyPem,
      WECHAT_API_V3_KEY: "0123456789abcdef0123456789abcdef",
      WECHAT_PLATFORM_PUBLIC_KEY: platform.publicKeyPem,
      WECHAT_NOTIFY_URL: "https://api.example.com/v1/billing/notify/wechat",
      ALIPAY_APP_ID: "2016102300012345",
      ALIPAY_APP_PRIVATE_KEY: alipay.privateKeyPem,
      ALIPAY_PUBLIC_KEY: alipay.publicKeyPem,
      ALIPAY_NOTIFY_URL: "https://api.example.com/v1/billing/notify/alipay",
      ...overrides,
    }) as unknown as Env;

  it("reports every missing credential instead of silently falling back to mock", () => {
    const resolved = resolveWechatConfig({} as Env);
    expect(resolved.config).toBeUndefined();
    expect(resolved.missing).toEqual(
      expect.arrayContaining([
        "WECHAT_APP_ID",
        "WECHAT_MCH_ID",
        "WECHAT_MCH_SERIAL_NO",
        "WECHAT_MCH_PRIVATE_KEY",
        "WECHAT_API_V3_KEY",
        "WECHAT_PLATFORM_PUBLIC_KEY or WECHAT_PLATFORM_PUBLIC_KEYS",
        "WECHAT_NOTIFY_URL",
      ]),
    );

    const alipayResolved = resolveAlipayConfig({} as Env);
    expect(alipayResolved.config).toBeUndefined();
    expect(alipayResolved.missing).toEqual(
      expect.arrayContaining(["ALIPAY_APP_ID", "ALIPAY_APP_PRIVATE_KEY", "ALIPAY_PUBLIC_KEY", "ALIPAY_NOTIFY_URL"]),
    );
  });

  it("builds adapters when credentials are complete and throws NotConfigured for the others", () => {
    const set = resolveChannelSet(fullPaymentEnv());
    expect(set.wechat).toBeDefined();
    expect(set.alipay).toBeDefined();

    const service = new ChannelService(set, true);
    expect(service.isConfigured("wechat")).toBe(true);
    expect(service.isConfigured("alipay")).toBe(true);

    const empty = new ChannelService(resolveChannelSet({} as Env), true);
    expect(empty.isConfigured("wechat")).toBe(false);
    expect(() => empty.get("wechat")).toThrowError(
      expect.objectContaining({ code: "CHANNEL_NOT_CONFIGURED" }),
    );
  });

  it("lists mock-only channels when PAYMENT_LIVE=false and marks real channels disabled", () => {
    const service = new ChannelService(resolveChannelSet({} as Env), false);
    const list = service.available();
    const byChannel = Object.fromEntries(list.map((c) => [c.channel, c]));
    expect(byChannel.mock.configured).toBe(true);
    expect(byChannel.wechat.configured).toBe(false);
    expect(byChannel.wechat.reason).toBe("PAYMENT_LIVE=false");
    expect(byChannel.alipay.configured).toBe(false);
  });

  it("lists configured real channels with modes when live and hides mock", () => {
    const service = new ChannelService(resolveChannelSet(fullPaymentEnv()), true);
    const list = service.available();
    expect(list.find((c) => c.channel === "mock")).toBeUndefined();
    expect(list.find((c) => c.channel === "wechat")?.modes).toEqual(["native", "h5", "jsapi"]);
    expect(list.find((c) => c.channel === "alipay")?.modes).toEqual(["page", "precreate"]);
  });

  it("normalizes escaped PEM newlines from single-line env values", () => {
    expect(normalizePem("-----BEGIN KEY-----\\nabc\\n-----END KEY-----")).toBe(
      "-----BEGIN KEY-----\nabc\n-----END KEY-----\n",
    );
    expect(normalizePem(undefined)).toBeUndefined();
  });

  it("reads private keys from files (production secret mount) and reports unreadable paths", () => {
    const dir = mkdtempSync(join(tmpdir(), "onframe-pem-"));
    try {
      const keyPath = join(dir, "merchant.pem");
      writeFileSync(keyPath, merchant.privateKeyPem, "utf8");
      const fromFile = readPem(undefined, keyPath);
      expect(fromFile.value).toContain("BEGIN PRIVATE KEY");

      const unreadable = readPem(undefined, join(dir, "missing.pem"));
      expect(unreadable.value).toBeUndefined();
      expect(unreadable.error).toContain("cannot read key file");

      const resolved = resolveWechatConfig(
        fullPaymentEnv({
          WECHAT_MCH_PRIVATE_KEY: undefined,
          WECHAT_MCH_PRIVATE_KEY_PATH: keyPath,
        }),
      );
      expect(resolved.config?.privateKeyPem).toContain("BEGIN PRIVATE KEY");
      expect(resolved.missing).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

/**
 * 微信平台证书轮换（api-spec §10.3）纯函数：
 * serial → PEM 映射、精确选取、未知 serial 拒绝、无 serial 回退单公钥、仅单证书时直接使用。
 */
describe("wechat platform keyring rotation", () => {
  const oldKey = generateRsaKeyPair();
  const newKey = generateRsaKeyPair();
  const fallbackKey = generateRsaKeyPair();
  const serialOld = "OLD_SERIAL_0001";
  const serialNew = "NEW_SERIAL_0002";

  const keyring = () =>
    parseWechatPlatformKeyring(
      JSON.stringify({ [serialOld]: oldKey.publicKeyPem, [serialNew]: newKey.publicKeyPem }),
      undefined,
      fallbackKey.publicKeyPem,
    );

  it("parses the serial → PEM map and keeps the fallback key", () => {
    const parsed = keyring();
    expect(Object.keys(parsed.bySerial).sort()).toEqual([serialNew, serialOld].sort());
    expect(parsed.bySerial[serialNew]).toContain("BEGIN PUBLIC KEY");
    expect(parsed.fallback).toContain("BEGIN PUBLIC KEY");
  });

  it("selects exactly by serial and rejects unknown serials", () => {
    const parsed = keyring();
    expect(selectWechatPlatformPublicKey(parsed, serialOld)).toBe(parsed.bySerial[serialOld]);
    expect(selectWechatPlatformPublicKey(parsed, serialNew)).toBe(parsed.bySerial[serialNew]);
    expect(selectWechatPlatformPublicKey(parsed, "UNKNOWN_SERIAL")).toBeUndefined();
  });

  it("falls back to the single public key when no serial header is present", () => {
    expect(selectWechatPlatformPublicKey(keyring())).toBe(fallbackKey.publicKeyPem);
  });

  it("uses the only certificate when the map has one entry and no serial", () => {
    const single = parseWechatPlatformKeyring(
      JSON.stringify({ [serialNew]: newKey.publicKeyPem }),
      undefined,
      undefined,
    );
    expect(selectWechatPlatformPublicKey(single)).toBe(newKey.publicKeyPem);
  });

  it("keeps legacy single-key deployments working (no map)", () => {
    const legacy = parseWechatPlatformKeyring(undefined, undefined, fallbackKey.publicKeyPem);
    expect(selectWechatPlatformPublicKey(legacy, serialOld)).toBe(fallbackKey.publicKeyPem);
  });

  it("returns nothing when neither map nor fallback is configured", () => {
    const empty = parseWechatPlatformKeyring(undefined, undefined, undefined);
    expect(selectWechatPlatformPublicKey(empty, serialNew)).toBeUndefined();
    expect(selectWechatPlatformPublicKey(empty)).toBeUndefined();
  });

  it("accepts WECHAT_PLATFORM_PUBLIC_KEYS as a complete platform key source", () => {
    const source = {
      NODE_ENV: "test",
      PAYMENT_LIVE: true,
      WECHAT_APP_ID: "wxtest",
      WECHAT_MCH_ID: "1900000001",
      WECHAT_MCH_SERIAL_NO: "SERIAL",
      WECHAT_MCH_PRIVATE_KEY: oldKey.privateKeyPem,
      WECHAT_API_V3_KEY: "0123456789abcdef0123456789abcdef",
      WECHAT_PLATFORM_PUBLIC_KEYS: JSON.stringify({ [serialNew]: newKey.publicKeyPem }),
      WECHAT_NOTIFY_URL: "https://api.example.com/v1/billing/notify/wechat",
    } as unknown as Env;
    const resolved = resolveWechatConfig(source);
    expect(resolved.missing).toEqual([]);
    expect(Object.keys(resolved.keyring.bySerial)).toEqual([serialNew]);
  });
});
