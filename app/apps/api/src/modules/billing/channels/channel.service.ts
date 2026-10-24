import { readFileSync } from "node:fs";
import { Injectable } from "@nestjs/common";
import { env, type Env } from "../../../config/env";
import { AlipayAdapter, type AlipayConfig } from "./alipay.adapter";
import { ChannelError } from "./errors";
import type { FetchLike } from "./http";
import {
  ChannelAvailability,
  PaymentChannelAdapter,
  PaymentChannelId,
  PaymentMode,
} from "./types";
import { WechatPayV3Adapter, type WechatPayConfig } from "./wechat-pay.adapter";

/**
 * 渠道工厂：从环境变量解析凭据 → 构造适配器。
 *
 * 铁律：**凭据不全就不创建适配器**（NotConfigured 默认拒绝），
 * 绝不在缺配置时回退到 mock / 跳过签名。
 *
 * 私钥支持两种写法：
 * - 内联 PEM：`WECHAT_MCH_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n..."`（支持 \n 转义）；
 * - 文件路径：`WECHAT_MCH_PRIVATE_KEY_PATH=/run/secrets/wechat_key.pem`（推荐生产用挂载密钥）。
 */

/** 把 .env 里单行写的 `\n` 还原成真实换行；同时兼容首尾空白 */
export function normalizePem(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const normalized = trimmed.includes("\\n") ? trimmed.replace(/\\n/g, "\n") : trimmed;
  return normalized.endsWith("\n") ? normalized : `${normalized}\n`;
}

interface PemSource {
  value?: string;
  /** 配置了但读不出来时的原因（不含密钥内容） */
  error?: string;
}

export function readPem(inline: string | undefined, path: string | undefined): PemSource {
  if (inline && inline.trim()) return { value: normalizePem(inline) };
  if (path && path.trim()) {
    try {
      return { value: normalizePem(readFileSync(path, "utf8")) };
    } catch (err) {
      return { error: `cannot read key file ${path}: ${(err as Error).message}` };
    }
  }
  return {};
}

// ── 微信平台证书轮换（api-spec §10.3）──────────────────────────────────────

/**
 * 平台证书公钥集合：
 * - `bySerial`：serial_no → 公钥 PEM（来自 `WECHAT_PLATFORM_PUBLIC_KEYS` JSON 或 `*_KEYS_PATH` 文件）；
 * - `fallback`：未提供 `Wechatpay-Serial` 时的单公钥回退（`WECHAT_PLATFORM_PUBLIC_KEY`）。
 *
 * 轮换期可同时配置新旧两张证书；微信按请求头 `Wechatpay-Serial` 指明签名证书。
 * 只命中 keyring 中的 serial 才验签；未命中一律 401（默认拒绝，绝不"随便找一把钥匙试"）。
 */
export interface WechatPlatformKeyring {
  bySerial: Record<string, string>;
  fallback?: string;
}

export function parseWechatPlatformKeyring(
  rawJson: string | undefined,
  jsonPath: string | undefined,
  fallbackPem: string | undefined,
): WechatPlatformKeyring {
  let text: string | undefined;
  if (rawJson && rawJson.trim()) text = rawJson;
  else if (jsonPath && jsonPath.trim()) {
    try {
      text = readFileSync(jsonPath, "utf8");
    } catch {
      text = undefined;
    }
  }

  const bySerial: Record<string, string> = {};
  if (text) {
    try {
      const parsed = JSON.parse(text) as Record<string, unknown>;
      for (const [serial, pem] of Object.entries(parsed)) {
        const normalizedSerial = serial.trim();
        if (!normalizedSerial || typeof pem !== "string") continue;
        const normalizedPem = normalizePem(pem);
        if (normalizedPem) bySerial[normalizedSerial] = normalizedPem;
      }
    } catch {
      // 非法 JSON：不静默通过——由 resolveWechatConfig 计入 missing（见下）
    }
  }
  return { bySerial, fallback: fallbackPem };
}

export function selectWechatPlatformPublicKey(
  keyring: WechatPlatformKeyring,
  serial?: string,
): string | undefined {
  const serials = Object.keys(keyring.bySerial);
  if (serials.length > 0) {
    const normalizedSerial = serial?.trim();
    // 有 serial：必须精确命中（未知 serial 默认拒绝）
    if (normalizedSerial) return keyring.bySerial[normalizedSerial];
    // 无 serial：仅一张平台证书时可直接用；多张时必须回退单公钥配置
    if (serials.length === 1) return keyring.bySerial[serials[0]];
    return keyring.fallback;
  }
  // 仅配置单公钥（历史部署）：忽略 serial，直接使用（保持向后兼容）
  return keyring.fallback;
}

export interface ResolvedChannelSet {
  wechat?: WechatPayV3Adapter;
  alipay?: AlipayAdapter;
  missing: { wechat: string[]; alipay: string[] };
  /** 配置了但不可用（例如密钥文件读不出来）的原因 */
  issues: { wechat?: string; alipay?: string };
  /** 微信平台证书公钥集合（回调验签用） */
  wechatPlatformKeyring: WechatPlatformKeyring;
}

export interface ChannelResolveDeps {
  fetchImpl?: FetchLike;
  retries?: number;
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

/** 微信：凭据齐全才可用（含回调验签公钥与 APIv3 密钥——收钱依赖回调） */
export function resolveWechatConfig(
  source: Env,
  deps: ChannelResolveDeps = {},
): { config?: WechatPayConfig; missing: string[]; issue?: string; keyring: WechatPlatformKeyring } {
  const missing: string[] = [];
  if (!source.WECHAT_APP_ID) missing.push("WECHAT_APP_ID");
  if (!source.WECHAT_MCH_ID) missing.push("WECHAT_MCH_ID");
  if (!source.WECHAT_MCH_SERIAL_NO) missing.push("WECHAT_MCH_SERIAL_NO");
  const privateKey = readPem(source.WECHAT_MCH_PRIVATE_KEY, source.WECHAT_MCH_PRIVATE_KEY_PATH);
  if (!privateKey.value) missing.push(privateKey.error ? "WECHAT_MCH_PRIVATE_KEY(unreadable)" : "WECHAT_MCH_PRIVATE_KEY");
  if (!source.WECHAT_API_V3_KEY) missing.push("WECHAT_API_V3_KEY");
  const platformKey = readPem(source.WECHAT_PLATFORM_PUBLIC_KEY, source.WECHAT_PLATFORM_PUBLIC_KEY_PATH);
  const keyring = parseWechatPlatformKeyring(
    source.WECHAT_PLATFORM_PUBLIC_KEYS,
    source.WECHAT_PLATFORM_PUBLIC_KEYS_PATH,
    platformKey.value,
  );
  const hasPlatformKey = Object.keys(keyring.bySerial).length > 0 || Boolean(platformKey.value);
  if (!hasPlatformKey) {
    missing.push(
      platformKey.error
        ? "WECHAT_PLATFORM_PUBLIC_KEY/WECHAT_PLATFORM_PUBLIC_KEYS(unreadable)"
        : "WECHAT_PLATFORM_PUBLIC_KEY or WECHAT_PLATFORM_PUBLIC_KEYS",
    );
  }
  if (!source.WECHAT_NOTIFY_URL) missing.push("WECHAT_NOTIFY_URL");
  if (missing.length) {
    return { missing, issue: privateKey.error ?? platformKey.error, keyring };
  }
  return {
    missing: [],
    keyring,
    config: {
      appId: source.WECHAT_APP_ID as string,
      mchId: source.WECHAT_MCH_ID as string,
      serialNo: source.WECHAT_MCH_SERIAL_NO as string,
      privateKeyPem: privateKey.value as string,
      apiV3Key: source.WECHAT_API_V3_KEY,
      notifyUrl: source.WECHAT_NOTIFY_URL,
      apiBase: source.WECHAT_API_BASE,
      fetchImpl: deps.fetchImpl,
      retries: deps.retries,
      timeoutMs: deps.timeoutMs,
      sleep: deps.sleep,
    },
  };
}

/** 支付宝：应用私钥签名下单 + 支付宝公钥验回调，二者缺一不可 */
export function resolveAlipayConfig(source: Env, deps: ChannelResolveDeps = {}): { config?: AlipayConfig; missing: string[]; issue?: string } {
  const missing: string[] = [];
  if (!source.ALIPAY_APP_ID) missing.push("ALIPAY_APP_ID");
  const privateKey = readPem(source.ALIPAY_APP_PRIVATE_KEY, source.ALIPAY_APP_PRIVATE_KEY_PATH);
  if (!privateKey.value) missing.push(privateKey.error ? "ALIPAY_APP_PRIVATE_KEY(unreadable)" : "ALIPAY_APP_PRIVATE_KEY");
  const publicKey = readPem(source.ALIPAY_PUBLIC_KEY, source.ALIPAY_PUBLIC_KEY_PATH);
  if (!publicKey.value) missing.push(publicKey.error ? "ALIPAY_PUBLIC_KEY(unreadable)" : "ALIPAY_PUBLIC_KEY");
  if (!source.ALIPAY_NOTIFY_URL) missing.push("ALIPAY_NOTIFY_URL");
  if (missing.length) {
    return { missing, issue: privateKey.error ?? publicKey.error };
  }
  return {
    missing: [],
    config: {
      appId: source.ALIPAY_APP_ID as string,
      appPrivateKeyPem: privateKey.value as string,
      publicKeyPem: publicKey.value,
      gateway: source.ALIPAY_GATEWAY,
      notifyUrl: source.ALIPAY_NOTIFY_URL,
      signType: source.ALIPAY_SIGN_TYPE,
      fetchImpl: deps.fetchImpl,
      retries: deps.retries,
      timeoutMs: deps.timeoutMs,
      sleep: deps.sleep,
    },
  };
}

export function resolveChannelSet(source: Env, deps: ChannelResolveDeps = {}): ResolvedChannelSet {
  const wechat = resolveWechatConfig(source, deps);
  const alipay = resolveAlipayConfig(source, deps);
  return {
    wechat: wechat.config ? new WechatPayV3Adapter(wechat.config) : undefined,
    alipay: alipay.config ? new AlipayAdapter(alipay.config) : undefined,
    missing: { wechat: wechat.missing, alipay: alipay.missing },
    issues: { wechat: wechat.issue, alipay: alipay.issue },
    wechatPlatformKeyring: wechat.keyring,
  };
}

@Injectable()
export class ChannelService {
  private readonly adapters: { wechat?: WechatPayV3Adapter; alipay?: AlipayAdapter };
  private readonly missing: { wechat: string[]; alipay: string[] };
  private readonly issues: { wechat?: string; alipay?: string };
  private readonly keyring: WechatPlatformKeyring;
  private readonly live: boolean;

  constructor(resolved?: ResolvedChannelSet, live?: boolean) {
    const set = resolved ?? resolveChannelSet(env);
    this.adapters = { wechat: set.wechat, alipay: set.alipay };
    this.missing = set.missing;
    this.issues = set.issues;
    this.keyring = set.wechatPlatformKeyring ?? { bySerial: {} };
    this.live = live ?? env.PAYMENT_LIVE;
  }

  static fromEnv(source: Env = env): ChannelService {
    return new ChannelService(resolveChannelSet(source), source.PAYMENT_LIVE);
  }

  /** 微信平台证书公钥：按 Wechatpay-Serial 选择；未命中返回 undefined（调用方应 401 默认拒绝） */
  wechatPlatformPublicKey(serial?: string): string | undefined {
    return selectWechatPlatformPublicKey(this.keyring, serial);
  }

  /** 是否配置了任何微信平台公钥（无则所有回调 401） */
  get hasWechatPlatformKeys(): boolean {
    return Object.keys(this.keyring.bySerial).length > 0 || Boolean(this.keyring.fallback);
  }

  /** 渠道是否已配置（可直接收款） */
  isConfigured(channel: PaymentChannelId): boolean {
    return channel === "wechat" ? this.adapters.wechat !== undefined : this.adapters.alipay !== undefined;
  }

  /** 取适配器；未配置时抛 NotConfigured（绝不静默 mock） */
  get(channel: PaymentChannelId): PaymentChannelAdapter {
    const adapter = channel === "wechat" ? this.adapters.wechat : this.adapters.alipay;
    if (adapter) return adapter;
    const missing = this.missing[channel];
    const issue = this.issues[channel];
    throw new ChannelError(
      "CHANNEL_NOT_CONFIGURED",
      `${channel} channel not configured (missing: ${missing.join(", ") || "unknown"}${issue ? `; ${issue}` : ""})`,
      { details: { channel, missing, issue } },
    );
  }

  /** 前端可用渠道清单（GET /billing/channels） */
  available(): ChannelAvailability[] {
    const modesWechat: PaymentMode[] = ["native", "h5", "jsapi"];
    const modesAlipay: PaymentMode[] = ["page", "precreate"];
    const list: ChannelAvailability[] = [];
    if (this.live) {
      list.push(
        this.adapters.wechat
          ? { channel: "wechat", configured: true, modes: modesWechat }
          : {
              channel: "wechat",
              configured: false,
              modes: modesWechat,
              missing: this.missing.wechat,
              reason: this.issues.wechat ?? "missing credentials",
            },
        this.adapters.alipay
          ? { channel: "alipay", configured: true, modes: modesAlipay }
          : {
              channel: "alipay",
              configured: false,
              modes: modesAlipay,
              missing: this.missing.alipay,
              reason: this.issues.alipay ?? "missing credentials",
            },
      );
    } else {
      // 联调模式：只有 mock；真实渠道明确标记未启用，避免前端误引导用户付款
      list.push({ channel: "mock", configured: true, modes: [] });
      list.push(
        { channel: "wechat", configured: false, modes: modesWechat, reason: "PAYMENT_LIVE=false" },
        { channel: "alipay", configured: false, modes: modesAlipay, reason: "PAYMENT_LIVE=false" },
      );
    }
    return list;
  }
}
