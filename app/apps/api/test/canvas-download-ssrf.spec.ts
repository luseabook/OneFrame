import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppError, ErrorCode } from "@app/shared";
import {
  DEFAULT_MAX_BYTES,
  DOWNLOAD_TIMEOUT_MS,
  MAX_REDIRECTS,
  assertFetchableUri,
  checkDownloadUri,
  fetchGuarded,
  hostMatchesAllowlist,
  isBlockedAddress,
  normalizeHostname,
  parseAllowlist,
  resolveDownloadLimits,
  resolveUriPolicy,
  safeUriForLog,
  storageHostsFromEnv,
  type AddressResolver,
  type DownloadLimits,
} from "../src/modules/canvas/canvas-download.guard";

/**
 * PR-04（P0 SSRF）验伪单测 —— **纯函数，不连 PG/Redis，不发真实网络请求**。
 *
 * 为什么必须纯函数：这条 P0 的验收要在"没有数据库的开发机"上也能跑，
 * 而它的攻击面恰恰是"服务端替用户去访问一个 URI"。判定逻辑与 IO 分离，
 * 才能把 7 条必测判据（回环/云元数据/私网/file:/未配置白名单/通配放行/IPv6 回环）
 * 变成秒级的确定性断言，而不是"跑一遍 e2e 看有没有炸"。
 *
 * 覆盖边界（写在测试里，防止被读成"SSRF 已完全验证"）：
 * - **未发真实请求**：`fetchGuarded` 的超时、流式大小上限、3xx 逐跳复检没有走真网络；
 * - **DNS 层用注入解析器验证判定分支**，不代表真实 DNS 行为（生产 DNS 由系统提供）；
 * - 真实内网探测（`http://169.254.169.254/...` 实打实发一次）不在本文件。
 */

/** allowlist 未配置的默认形态：只允许存储自身 host */
const STORAGE_ONLY = { allowlist: [] as string[], storageHosts: ["storage.example.net"] };

const decide = (uri: string, policy: typeof STORAGE_ONLY = STORAGE_ONLY) => checkDownloadUri(uri, policy);

describe("PR-04 必测判据（报告 §行动 6 ④）", () => {
  it("http://127.0.0.1/x → 拒绝（回环）", () => {
    const verdict = decide("http://127.0.0.1/x");
    expect(verdict.ok).toBe(false);
    expect(verdict).toMatchObject({ ok: false, reason: "blocked_ip", host: "127.0.0.1" });
  });

  it("http://169.254.169.254/latest/meta-data/ → 拒绝（云元数据，凭据读取面）", () => {
    const verdict = decide("http://169.254.169.254/latest/meta-data/iam/security-credentials/");
    expect(verdict.ok).toBe(false);
    expect(verdict).toMatchObject({ ok: false, reason: "blocked_ip", host: "169.254.169.254" });
  });

  it("http://10.0.0.5/ → 拒绝（10/8 内网）", () => {
    const verdict = decide("http://10.0.0.5/");
    expect(verdict.ok).toBe(false);
    expect(verdict).toMatchObject({ ok: false, reason: "blocked_ip" });
  });

  it("file:///etc/passwd → 拒绝（协议白名单，不是靠 host 判）", () => {
    const verdict = decide("file:///etc/passwd");
    expect(verdict.ok).toBe(false);
    expect(verdict).toMatchObject({ ok: false, reason: "scheme_not_allowed" });
  });

  it("http://evil.example.com/ → 白名单未配置时拒绝（绝不默认放行任意 host）", () => {
    const verdict = decide("http://evil.example.com/a.png");
    expect(verdict.ok).toBe(false);
    expect(verdict).toMatchObject({ ok: false, reason: "host_not_allowlisted", host: "evil.example.com" });
  });

  it("命中 *.example.com 通配 → 放行", () => {
    const verdict = decide("https://cdn.example.com/u/1/a.png", {
      allowlist: parseAllowlist("*.example.com"),
      storageHosts: [],
    });
    expect(verdict.ok).toBe(true);
    if (verdict.ok) {
      expect(verdict.host).toBe("cdn.example.com");
      // 放行时把解析好的 URL 交出去，后续 fetch 不再二次解析字符串
      expect(verdict.url.href).toBe("https://cdn.example.com/u/1/a.png");
    }
  });

  it("https://[::1]/ → 拒绝（IPv6 回环，方括号要能剥掉）", () => {
    const verdict = decide("https://[::1]/");
    expect(verdict.ok).toBe(false);
    expect(verdict).toMatchObject({ ok: false, reason: "blocked_ip", host: "::1" });
  });
});

describe("协议与 URI 形态", () => {
  it.each([
    ["gopher://127.0.0.1:6379/_INFO", "scheme_not_allowed"],
    ["data:text/html,<script>alert(1)</script>", "scheme_not_allowed"],
    ["ftp://example.com/a.zip", "scheme_not_allowed"],
    ["dict://127.0.0.1:11211/", "scheme_not_allowed"],
  ])("%s → %s", (uri, reason) => {
    expect(decide(uri)).toMatchObject({ ok: false, reason });
  });

  it("空串/非 URL → malformed_uri（不抛异常）", () => {
    expect(decide("")).toMatchObject({ ok: false, reason: "malformed_uri" });
    expect(decide("not a uri")).toMatchObject({ ok: false, reason: "malformed_uri" });
  });

  it("http://evil.com@127.0.0.1/ → 拒绝（userinfo 混淆不能变成 host 绕过）", () => {
    const verdict = decide("http://evil.com@127.0.0.1/");
    expect(verdict.ok).toBe(false);
    // URL 解析后 host 就是 127.0.0.1，但更早命中 userinfo 规则：
    // 服务端拉取产物不需要任何 URL 内凭据，见到 userinfo 直接拒（两道闸都拦得住）
    expect(verdict).toMatchObject({ ok: false, reason: "credentials_in_url", host: "127.0.0.1" });
  });

  it("http://cdn.example.com@169.254.169.254/ → 拒绝（通配白名单也救不了 userinfo 形态）", () => {
    expect(decide("http://cdn.example.com@169.254.169.254/", {
      allowlist: parseAllowlist("*.example.com"),
      storageHosts: [],
    })).toMatchObject({ ok: false, reason: "credentials_in_url", host: "169.254.169.254" });
  });
});

describe("内网/保留地址黑名单（IP 判定）", () => {
  it.each([
    "127.0.0.1",
    "127.255.255.254",
    "10.1.2.3",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.0.1",
    "169.254.169.254",
    "169.254.0.1",
    "0.0.0.0",
    "100.64.0.1",
    "198.18.0.1",
    "224.0.0.1",
    "255.255.255.255",
  ])("IPv4 %s → blocked", (address) => {
    expect(isBlockedAddress(address)).toBe(true);
  });

  it.each(["8.8.8.8", "1.1.1.1", "93.184.216.34", "172.32.0.1", "100.63.0.1", "11.0.0.1"])(
    "IPv4 %s → allowed（公网地址不误杀）",
    (address) => {
      expect(isBlockedAddress(address)).toBe(false);
    },
  );

  it.each([
    "::1",
    "::",
    "::ffff:127.0.0.1",
    "::ffff:10.0.0.5",
    "::ffff:169.254.169.254",
    "fd00::1",
    "fc00::1",
    "fcff::1",
    "fe80::1",
    "fe80::1%eth0",
    "ff02::1",
    "::127.0.0.1",
    "64:ff9b::7f00:1",
  ])("IPv6 %s → blocked", (address) => {
    expect(isBlockedAddress(address)).toBe(true);
  });

  it.each(["2606:4700:4700::1111", "2400:cb00::1", "2a00:1450::1"])("IPv6 %s → allowed", (address) => {
    expect(isBlockedAddress(address)).toBe(false);
  });

  it("IPv4-mapped IPv6 的两种写法都要认出内网（防 `[::ffff:7f00:1]` 绕过）", () => {
    expect(isBlockedAddress("::ffff:7f00:1")).toBe(true);
    expect(decide("http://[::ffff:7f00:1]/")).toMatchObject({ ok: false, reason: "blocked_ip" });
    expect(decide("http://[::ffff:a9fe:a9fe]/")).toMatchObject({ ok: false, reason: "blocked_ip" });
  });

  it("十进制/八进制 IPv4 由 URL 规范化后再判（2130706433 → 127.0.0.1）", () => {
    expect(decide("http://2130706433/")).toMatchObject({ ok: false, reason: "blocked_ip", host: "127.0.0.1" });
    expect(decide("http://0177.0.0.1/")).toMatchObject({ ok: false, reason: "blocked_ip", host: "127.0.0.1" });
  });

  it("非 IP 文本按不可信处理（fail-closed）", () => {
    expect(isBlockedAddress("example.com")).toBe(true);
    expect(isBlockedAddress("")).toBe(true);
  });
});

describe("host 白名单语义", () => {
  it("未配置 allowlist → 只放行存储自身 host", () => {
    expect(decide("https://storage.example.net/u/1/a.mp4")).toMatchObject({ ok: true });
  });

  it("连存储 host 都没有 → 全拒（no_allowlist_configured，不是默认放行）", () => {
    expect(decide("https://cdn.example.com/a.png", { allowlist: [], storageHosts: [] })).toMatchObject({
      ok: false,
      reason: "no_allowlist_configured",
    });
  });

  it("通配不匹配裸域（`*.example.com` ≠ `example.com`）", () => {
    const policy = { allowlist: parseAllowlist("*.example.com"), storageHosts: [] };
    expect(decide("https://example.com/a.png", policy)).toMatchObject({
      ok: false,
      reason: "host_not_allowlisted",
    });
    expect(decide("https://a.b.example.com/a.png", policy)).toMatchObject({ ok: true });
  });

  it("配置了 allowlist 就只认 allowlist（不与存储 host 取并集）", () => {
    const policy = { allowlist: parseAllowlist("*.example.com"), storageHosts: ["storage.example.net"] };
    expect(decide("https://storage.example.net/u/1/a.mp4", policy)).toMatchObject({
      ok: false,
      reason: "host_not_allowlisted",
    });
  });

  it("白名单里误写了内网地址也不放行（IP 黑名单优先）", () => {
    expect(decide("http://127.0.0.1/x", { allowlist: ["127.0.0.1"], storageHosts: [] })).toMatchObject({
      ok: false,
      reason: "blocked_ip",
    });
  });

  it("白名单条目容忍大写/端口/路径/完整 URL/尾点（运维不该因为格式全站挂掉）", () => {
    expect(parseAllowlist(" CDN.Example.com , https://files.example.org:8443/base ,*.x.example.com. ")).toEqual([
      "cdn.example.com",
      "files.example.org",
      "*.x.example.com",
    ]);
    expect(hostMatchesAllowlist("cdn.example.com", ["cdn.example.com"])).toBe(true);
    expect(hostMatchesAllowlist("cdn.example.com.", ["cdn.example.com"])).toBe(true);
    expect(hostMatchesAllowlist("CDN.EXAMPLE.COM", ["cdn.example.com"])).toBe(true);
    expect(hostMatchesAllowlist("evilcdn.example.com", ["cdn.example.com"])).toBe(false);
    expect(normalizeHostname("[::1]")).toBe("::1");
  });

  it("同前缀不同域不能被通配吞掉（`notexample.com` ≠ `*.example.com`）", () => {
    expect(hostMatchesAllowlist("notexample.com", ["*.example.com"])).toBe(false);
    expect(hostMatchesAllowlist("example.com.evil.net", ["*.example.com"])).toBe(false);
  });
});

describe("env → 策略/限额的推导（allowlist 默认空 = 仅存储 host）", () => {
  it("默认形态：allowlist 空 + 存储基址推导出自身 host", () => {
    const policy = resolveUriPolicy({
      CANVAS_DOWNLOAD_HOST_ALLOWLIST: "",
      STORAGE_PUBLIC_BASE: "http://127.0.0.1:3000/v1",
    });
    expect(policy.allowlist).toEqual([]);
    expect(policy.storageHosts).toEqual(["127.0.0.1"]);
  });

  it("S3/MinIO 的 endpoint 与 public endpoint 都进回退集合（对外地址优先）", () => {
    // 顺序即优先级：驱动签名 URL 的是 public endpoint，所以它排在 SDK endpoint 之前
    expect(
      storageHostsFromEnv({
        STORAGE_S3_ENDPOINT: "http://minio:9000",
        STORAGE_S3_PUBLIC_ENDPOINT: "https://cdn.example.net/",
      }),
    ).toEqual(["cdn.example.net", "minio"]);
  });

  it("显式配置 allowlist 后覆盖回退集合", () => {
    const policy = resolveUriPolicy({
      CANVAS_DOWNLOAD_HOST_ALLOWLIST: "*.example.com",
      STORAGE_PUBLIC_BASE: "http://127.0.0.1:3000/v1",
    });
    expect(policy.allowlist).toEqual(["*.example.com"]);
    expect(policy.storageHosts).toEqual(["127.0.0.1"]);
    expect(checkDownloadUri("https://cdn.example.com/a.png", policy).ok).toBe(true);
  });

  it("大小上限默认 200MiB；显式配置时取配置值；非法值回落默认", () => {
    expect(DEFAULT_MAX_BYTES).toBe(200 * 1024 * 1024);
    expect(resolveDownloadLimits({}).maxBytes).toBe(200 * 1024 * 1024);
    expect(resolveDownloadLimits({ CANVAS_DOWNLOAD_MAX_BYTES: 1024 }).maxBytes).toBe(1024);
    expect(resolveDownloadLimits({ CANVAS_DOWNLOAD_MAX_BYTES: 0 }).maxBytes).toBe(200 * 1024 * 1024);
    expect(resolveDownloadLimits({ CANVAS_DOWNLOAD_MAX_BYTES: Number.NaN }).maxBytes).toBe(200 * 1024 * 1024);
    // 超时与跳数是固定值（不再开新的配置面）
    expect(resolveDownloadLimits({}).timeoutMs).toBe(DOWNLOAD_TIMEOUT_MS);
    expect(resolveDownloadLimits({}).timeoutMs).toBe(10_000);
    expect(resolveDownloadLimits({}).maxRedirects).toBe(MAX_REDIRECTS);
  });
});

describe("日志口径：不打印 URI 的 query", () => {
  it("签名参数必须被丢掉，path 可留", () => {
    const safe = safeUriForLog("https://cdn.example.com/u/1/a.mp4?X-Amz-Signature=deadbeef&token=secret");
    expect(safe).toBe("https://cdn.example.com/u/1/a.mp4");
    expect(safe).not.toContain("deadbeef");
    expect(safe).not.toContain("?");
  });

  it("存储 key / 不可解析文本按截断返回，不抛异常", () => {
    expect(safeUriForLog("u/1/canvas/a.png")).toBe("u/1/canvas/a.png");
    expect(safeUriForLog("mock://results/x.mp4")).toBe("mock://results/x.mp4");
    expect(safeUriForLog("x".repeat(200)).length).toBeLessThanOrEqual(121);
  });
});

describe("DNS 层：解析结果逐地址复检（防 rebinding）", () => {
  const policy = { allowlist: parseAllowlist("*.example.com"), storageHosts: [] };

  const reasonOf = async (promise: Promise<unknown>): Promise<unknown> => {
    await expect(promise).rejects.toBeInstanceOf(AppError);
    const error = await promise.catch((caught: unknown) => caught as AppError);
    expect(error.code).toBe(ErrorCode.INVALID_PARAM);
    return (error.details as { reason?: unknown } | undefined)?.reason;
  };

  it("解析到 10.0.0.5 → blocked_resolved_ip", async () => {
    const reason = await reasonOf(
      assertFetchableUri("https://cdn.example.com/a.png", policy, {
        resolve: async () => [{ address: "10.0.0.5", family: 4 }],
      }),
    );
    expect(reason).toBe("blocked_resolved_ip");
  });

  it("解析到 169.254.169.254 → blocked_resolved_ip（任何一条命中即拒）", async () => {
    const reason = await reasonOf(
      assertFetchableUri("https://cdn.example.com/latest/meta-data/", policy, {
        resolve: async () => [
          { address: "93.184.216.34", family: 4 },
          { address: "169.254.169.254", family: 4 },
        ],
      }),
    );
    expect(reason).toBe("blocked_resolved_ip");
  });

  it("解析到 ::ffff:127.0.0.1 → blocked_resolved_ip（mapped 形态）", async () => {
    const reason = await reasonOf(
      assertFetchableUri("https://cdn.example.com/a.png", policy, {
        resolve: async () => [{ address: "::ffff:127.0.0.1", family: 6 }],
      }),
    );
    expect(reason).toBe("blocked_resolved_ip");
  });

  it("解析失败 → dns_unresolvable（不是 500）", async () => {
    const reason = await reasonOf(
      assertFetchableUri("https://cdn.example.com/a.png", policy, {
        resolve: async () => {
          throw new Error("ENOTFOUND");
        },
      }),
    );
    expect(reason).toBe("dns_unresolvable");
  });

  it("解析器返回空列表 → dns_unresolvable", async () => {
    const reason = await reasonOf(
      assertFetchableUri("https://cdn.example.com/a.png", policy, { resolve: async () => [] }),
    );
    expect(reason).toBe("dns_unresolvable");
  });

  it("全部解析到公网 → 放行并返回 URL", async () => {
    const url = await assertFetchableUri("https://cdn.example.com/a.png", policy, {
      resolve: async () => [{ address: "93.184.216.34", family: 4 }],
    });
    expect(url.href).toBe("https://cdn.example.com/a.png");
  });

  it("IP 字面量不查 DNS（黑名单已在纯判定里做完）", async () => {
    let called = false;
    const url = await assertFetchableUri(
      "https://93.184.216.34/a.png",
      { allowlist: ["93.184.216.34"], storageHosts: [] },
      {
        resolve: async () => {
          called = true;
          return [{ address: "93.184.216.34", family: 4 }];
        },
      },
    );
    expect(called).toBe(false);
    expect(url.href).toBe("https://93.184.216.34/a.png");
  });

  it("策略拒绝在解析之前就抛（不允许把 host 送去解析：某些解析器本身可被用作外带）", async () => {
    let called = false;
    const reason = await reasonOf(
      assertFetchableUri(
        "http://169.254.169.254/latest/meta-data/",
        policy,
        {
          resolve: async () => {
            called = true;
            return [{ address: "169.254.169.254", family: 4 }];
          },
        },
      ),
    );
    expect(reason).toBe("blocked_ip");
    expect(called).toBe(false);
  });
});

describe("可信 origin 豁免（存储自身是内网地址时，签名链接不能被一律跳过）", () => {
  /**
   * 回归场景：dev/内网部署里存储就是 `127.0.0.1:9000`（MinIO）或 VPC 内网 S3 端点。
   * 一刀切封内网 → 这批链接全被跳过 → 用户拿到空 zip，且只有运行期才发现。
   * 豁免依据是"运营把它配成了存储端点"，粒度是**精确 origin（含端口）**。
   */
  const internalStorage = resolveUriPolicy({
    CANVAS_DOWNLOAD_HOST_ALLOWLIST: "",
    STORAGE_PUBLIC_BASE: "http://127.0.0.1:9000",
  });

  it("① 存储端点自身（精确 origin）→ 放行", () => {
    expect(internalStorage.trustedOrigins).toEqual(["http://127.0.0.1:9000"]);
    expect(checkDownloadUri("http://127.0.0.1:9000/b/x.png", internalStorage)).toMatchObject({ ok: true });
  });

  it("② 同 host 不同端口 → 仍拒（豁免粒度是 origin，不是 host）", () => {
    expect(checkDownloadUri("http://127.0.0.1:9001/b/x.png", internalStorage)).toMatchObject({
      ok: false,
      reason: "blocked_ip",
      host: "127.0.0.1",
    });
    // 也挡住"顺带扫同机别的服务"：9000 的豁免不外溢到 22/5432/6379
    for (const port of ["22", "5432", "6379"]) {
      expect(checkDownloadUri(`http://127.0.0.1:${port}/`, internalStorage).ok).toBe(false);
    }
  });

  it("③ allowlist 通配不等于可信：`*.example.com` 解析到 169.254.169.254 仍拒（豁免不传染）", async () => {
    const policy = { allowlist: parseAllowlist("*.example.com"), storageHosts: [], trustedOrigins: [] };
    // 纯判定层：域名不是 IP 字面量，过
    expect(checkDownloadUri("https://cdn.example.com/x.png", policy)).toMatchObject({ ok: true });
    // DNS 层：解析到云元数据 → 拒。少了这一步，攻击者只需要一个自己的域名
    const error = (await assertFetchableUri("https://cdn.example.com/x.png", policy, {
      resolve: async () => [{ address: "169.254.169.254", family: 4 }],
    }).catch((caught: unknown) => caught)) as AppError;
    expect(error).toBeInstanceOf(AppError);
    expect((error.details as { reason?: string }).reason).toBe("blocked_resolved_ip");
  });

  it("④ trustedOrigins 为空 → 行为与收口前完全一致（内网一律拒）", () => {
    // 未配置任何存储基址：没有豁免
    expect(resolveUriPolicy({}).trustedOrigins).toEqual([]);
    // 不传 trustedOrigins 的旧式策略对象（= 空）仍然拒内网字面量
    expect(
      checkDownloadUri("http://127.0.0.1:9000/b/x.png", { allowlist: [], storageHosts: ["127.0.0.1"] }),
    ).toMatchObject({ ok: false, reason: "blocked_ip" });
    // 显式空数组同理
    expect(
      checkDownloadUri("http://169.254.169.254/latest/meta-data/", {
        allowlist: [],
        storageHosts: ["169.254.169.254"],
        trustedOrigins: [],
      }),
    ).toMatchObject({ ok: false, reason: "blocked_ip" });
  });

  it("豁免只认存储配置的 origin：allowlist 写内网地址不产生豁免", () => {
    const policy = { allowlist: parseAllowlist("127.0.0.1"), storageHosts: [], trustedOrigins: [] };
    expect(checkDownloadUri("http://127.0.0.1:9000/b/x.png", policy)).toMatchObject({
      ok: false,
      reason: "blocked_ip",
    });
  });

  it("内网存储域名（minio:9000 / VPC endpoint）解析到内网 → 放行；同域名别的端口不放行", async () => {
    const vpc = resolveUriPolicy({
      CANVAS_DOWNLOAD_HOST_ALLOWLIST: "",
      STORAGE_S3_ENDPOINT: "http://minio:9000",
    });
    expect(vpc.trustedOrigins).toEqual(["http://minio:9000"]);
    // 可信 origin：解析结果不再查黑名单（内网地址在这是预期形态）
    const url = await assertFetchableUri("http://minio:9000/bucket/a.mp4", vpc, {
      resolve: async () => [{ address: "10.0.3.7", family: 4 }],
    });
    expect(url.href).toBe("http://minio:9000/bucket/a.mp4");
    // 非可信 origin 且解析到内网 → 拒（且是字面量/白名单层就拒，不是靠 DNS）
    const error = (await assertFetchableUri("http://minio:9001/bucket/a.mp4", vpc, {
      resolve: async () => [{ address: "10.0.3.7", family: 4 }],
    }).catch((caught: unknown) => caught)) as AppError;
    expect(error).toBeInstanceOf(AppError);
  });

  it("可信 origin 仍受其余判据约束（协议/userinfo/白名单都要过）", () => {
    // 协议：可信 origin 不豁免协议判定
    expect(checkDownloadUri("file:///etc/passwd", internalStorage)).toMatchObject({
      ok: false,
      reason: "scheme_not_allowed",
    });
    // userinfo：存储链接从不带凭据
    expect(checkDownloadUri("http://u:p@127.0.0.1:9000/b/x.png", internalStorage)).toMatchObject({
      ok: false,
      reason: "credentials_in_url",
    });
    // 白名单：配置了 allowlist 就只认 allowlist（内网存储 host 需显式写入）
    const strict = { ...internalStorage, allowlist: parseAllowlist("*.example.com") };
    expect(checkDownloadUri("http://127.0.0.1:9000/b/x.png", strict)).toMatchObject({
      ok: false,
      reason: "host_not_allowlisted",
    });
  });

  it("豁免不随跳转传染：9001 不在可信集合，字面量层直接拒", async () => {
    const policy = resolveUriPolicy({
      CANVAS_DOWNLOAD_HOST_ALLOWLIST: "localhost,127.0.0.1",
      STORAGE_PUBLIC_BASE: "http://127.0.0.1:9000",
    });
    const error = (await assertFetchableUri("http://127.0.0.1:9001/x", policy, {
      resolve: async () => [{ address: "93.184.216.34", family: 4 }],
    }).catch((caught: unknown) => caught)) as AppError;
    expect((error.details as { reason?: string }).reason).toBe("blocked_ip");
  });
});

/**
 * 网络层：真起一台 127.0.0.1 的临时 http 服务器（**不连库**），验证三件纯逻辑测不到的事：
 * 1. 流式计数超限会**中止**读取，而不是先 `arrayBuffer()` 全读再判；
 * 2. 3xx 的 Location 会重新走完整判定 —— 跳内网必须被拦（这是最常见的 SSRF 绕过）；
 * 3. 超时与非 2xx 变成业务错误，不是 500。
 *
 * 注意：这里注入 `resolve` 返回公网地址，等于"承认 DNS 判定已在上一块验证过"，
 * 目的是把流量留在本机。生产不使用注入解析器。
 */
describe("网络层：流式上限 / 重定向复检 / 超时（本机 http 服务器）", () => {
  const POLICY = { allowlist: parseAllowlist("localhost"), storageHosts: [] };
  const resolvePublic: AddressResolver = async () => [{ address: "93.184.216.34", family: 4 }];

  let server: Server;
  let base = "";
  const hits: string[] = [];

  beforeAll(async () => {
    server = createServer((req, res) => {
      const path = (req.url ?? "").split("?")[0] ?? "";
      hits.push(path);
      res.on("error", () => {
        // 客户端主动 abort（大小超限/超时）不算服务器故障
      });
      switch (path) {
        case "/ok":
          res.writeHead(200, { "content-type": "application/octet-stream" });
          res.end("OK-BODY");
          return;
        case "/big-declared":
          res.writeHead(200, { "content-length": String(64 * 1024) });
          res.end(Buffer.alloc(64 * 1024));
          return;
        case "/big-chunked": {
          // 不声明 content-length：只能靠流式计数发现超限
          res.writeHead(200, { "content-type": "application/octet-stream" });
          res.write(Buffer.alloc(8 * 1024, 1));
          res.write(Buffer.alloc(8 * 1024, 2));
          res.end(Buffer.alloc(8 * 1024, 3));
          return;
        }
        case "/redirect-internal":
          res.writeHead(302, { location: "http://169.254.169.254/latest/meta-data/" });
          res.end();
          return;
        case "/redirect-file":
          res.writeHead(302, { location: "file:///etc/passwd" });
          res.end();
          return;
        case "/redirect-ok":
          res.writeHead(302, { location: "/ok" });
          res.end();
          return;
        case "/redirect-no-location":
          res.writeHead(302);
          res.end();
          return;
        case "/loop":
          res.writeHead(302, { location: "/loop" });
          res.end();
          return;
        case "/slow":
          // 永不响应：等客户端的 AbortSignal 到点
          return;
        case "/500":
          res.writeHead(500);
          res.end("boom");
          return;
        default:
          res.writeHead(404);
          res.end();
      }
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const address = server.address() as AddressInfo;
    base = `http://localhost:${address.port}`;
  });

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  const run = (path: string, overrides: Partial<DownloadLimits> = {}) =>
    fetchGuarded(
      `${base}${path}`,
      POLICY,
      { maxBytes: 4 * 1024, timeoutMs: 2_000, maxRedirects: 3, ...overrides },
      { resolve: resolvePublic },
    );

  const rejection = async (promise: Promise<unknown>): Promise<AppError> => {
    await expect(promise).rejects.toBeInstanceOf(AppError);
    return (await promise.catch((caught: unknown) => caught as AppError)) as AppError;
  };

  it("正常 2xx → 拿到完整字节", async () => {
    const data = await run("/ok");
    expect(data.toString("utf8")).toBe("OK-BODY");
  });

  it("声明 content-length 超限 → size_exceeded（连响应体都不下载）", async () => {
    const error = await rejection(run("/big-declared"));
    expect(error.code).toBe(ErrorCode.INVALID_PARAM);
    expect((error.details as { reason?: string }).reason).toBe("size_exceeded");
  });

  it("不声明长度、流式超限 → size_exceeded（中止读取，不整包进内存）", async () => {
    const error = await rejection(run("/big-chunked", { maxBytes: 1024 }));
    expect((error.details as { reason?: string }).reason).toBe("size_exceeded");
    expect((error.details as { max_bytes?: number }).max_bytes).toBe(1024);
  });

  it("跳转到云元数据 → 拒绝，且**没有**对目标发出任何请求", async () => {
    const before = hits.length;
    const error = await rejection(run("/redirect-internal"));
    expect((error.details as { reason?: string }).reason).toBe("blocked_ip");
    expect((error.details as { host?: string }).host).toBe("169.254.169.254");
    // 只打了第一跳（本机），第二跳在判定阶段就被拦下
    expect(hits.length - before).toBe(1);
  });

  it("跳转到 file:// → 拒绝（重新做协议判定）", async () => {
    const error = await rejection(run("/redirect-file"));
    expect((error.details as { reason?: string }).reason).toBe("scheme_not_allowed");
  });

  it("跳转到同源 2xx → 允许并读到内容", async () => {
    const data = await run("/redirect-ok");
    expect(data.toString("utf8")).toBe("OK-BODY");
  });

  it("3xx 但没有 Location → redirect_without_location", async () => {
    const error = await rejection(run("/redirect-no-location"));
    expect((error.details as { reason?: string }).reason).toBe("redirect_without_location");
  });

  it("无限重定向 → too_many_redirects（跳数有硬上限）", async () => {
    const before = hits.filter((path) => path === "/loop").length;
    const error = await rejection(run("/loop"));
    expect((error.details as { reason?: string }).reason).toBe("too_many_redirects");
    // 初始请求 + maxRedirects 跳：到上限就停，不会一直跟
    expect(hits.filter((path) => path === "/loop").length - before).toBe(4);
  });

  it("服务端不响应 → 745901 超时（不是挂死，也不是 500）", async () => {
    const error = await rejection(run("/slow", { timeoutMs: 300 }));
    expect(error.code).toBe(ErrorCode.VENDOR_TIMEOUT);
    expect((error.details as { reason?: string }).reason).toBe("timeout");
  });

  it("非 2xx → http_error 并带状态码", async () => {
    const error = await rejection(run("/500"));
    expect(error.code).toBe(ErrorCode.INVALID_PARAM);
    expect((error.details as { reason?: string }).reason).toBe("http_error");
    expect((error.details as { status?: number }).status).toBe(500);
  });
});
