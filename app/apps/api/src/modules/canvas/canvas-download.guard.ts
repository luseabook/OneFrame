import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { AppError, ErrorCode } from "@app/shared";

/**
 * 画布批量下载：用户可控产物 URI 的拉取守卫（PR-04 / P0 SSRF 收口）
 *
 * 为什么单独一个文件而不是塞进 `canvas-download.service.ts`：
 * 1. 判定逻辑必须是**纯函数**才能在无 PG/Redis 的机器上直接单测（PR-04 的验伪用例）；
 * 2. service 会连带引入 Nest / drizzle / pg Pool，纯单测不该为此付代价；
 * 3. 本文件只依赖 `node:*` 与 `@app/shared`，不新建任何跨包依赖。
 *
 * 收口顺序（见 `checkDownloadUri` / `assertFetchableUri`）：
 *   协议白名单 → host 白名单（未配置则回退"存储自身 host"）→ 内网/保留地址黑名单
 *   → DNS 解析结果逐地址再查黑名单（防 rebinding）→ 超时 → 流式大小上限 → 重定向逐跳复检。
 *
 * 设计取舍（重要，改动前先读）：
 * - **IP 字面量的黑名单前移到 host 白名单之前**：白名单写错（例如运维把
 *   `127.0.0.1` 贴进去）也绝不放行内网地址。这不是放宽，是收紧。
 * - **白名单一旦配置就只认它**（不与"存储自身 host"取并集）：否则"配置了白名单"
 *   仍然隐含放行存储 host，白名单的语义会被稀释。生产若产物托管在自己的 CDN，
 *   请把该 host 一并写进 `CANVAS_DOWNLOAD_HOST_ALLOWLIST`。
 * - **通配 `*.example.com` 不匹配裸域 `example.com`**：与主流 WAF/证书通配语义一致。
 */

/** 允许服务端拉取的协议：仅此两种（`file:`/`gopher:`/`data:`/`ftp:` 等一律拒绝） */
export const ALLOWED_SCHEMES: readonly string[] = ["http:", "https:"];

/** 单次 HTTP 跳的总超时（含首字节与读体）：Node 18+ 的 `AbortSignal.timeout` */
export const DOWNLOAD_TIMEOUT_MS = 10_000;

/** 默认单个产物大小上限：200MiB（env `CANVAS_DOWNLOAD_MAX_BYTES` 可覆盖） */
export const DEFAULT_MAX_BYTES = 200 * 1024 * 1024;

/** 最多跟随的 3xx 跳数：每一跳都重新走完整校验 */
export const MAX_REDIRECTS = 3;

/** 拒绝原因枚举（结构化，便于日志聚合与后续加指标，不靠文案匹配） */
export type UriRejectReason =
  | "malformed_uri"
  | "scheme_not_allowed"
  | "missing_host"
  | "credentials_in_url"
  | "blocked_ip"
  | "host_not_allowlisted"
  | "no_allowlist_configured"
  | "dns_unresolvable"
  | "blocked_resolved_ip"
  | "redirect_without_location"
  | "too_many_redirects"
  | "http_error"
  | "size_exceeded"
  | "network_error"
  | "timeout";

export interface CanvasDownloadPolicy {
  /** 已规范化的白名单条目（`example.com` / `*.example.com`） */
  allowlist: string[];
  /** 白名单为空时的回退：存储自身的 host（由 `STORAGE_*` / `PUBLIC_BASE_URL` 推导） */
  storageHosts: string[];
  /**
   * 可信 origin 精确集合（含端口），**由存储配置推导**，用于豁免内网地址黑名单。
   * 见 `trustedOriginsFromEnv`：只有这一类"运营配置的可信源"能落在内网，
   * 用户可控的 `result_uri` 不能。缺省（undefined）= 无豁免，行为与收口前一致。
   */
  trustedOrigins?: string[];
}

export interface DownloadLimits {
  maxBytes: number;
  timeoutMs: number;
  maxRedirects: number;
}

export const DEFAULT_LIMITS: DownloadLimits = {
  maxBytes: DEFAULT_MAX_BYTES,
  timeoutMs: DOWNLOAD_TIMEOUT_MS,
  maxRedirects: MAX_REDIRECTS,
};

/** 只读 env 视图：保持本文件纯函数化（不 import `config/env`，便于测试注入） */
export interface CanvasDownloadEnvLike {
  CANVAS_DOWNLOAD_HOST_ALLOWLIST?: string | undefined;
  STORAGE_PUBLIC_BASE?: string | undefined;
  STORAGE_S3_ENDPOINT?: string | undefined;
  STORAGE_S3_PUBLIC_ENDPOINT?: string | undefined;
  PUBLIC_BASE_URL?: string | undefined;
}

export interface UriCheckOk {
  ok: true;
  url: URL;
  host: string;
}

export interface UriCheckRejected {
  ok: false;
  reason: UriRejectReason;
  /** 已规范化（小写、去方括号、去尾点）的 host；无法解析时为 null */
  host: string | null;
}

export type UriCheck = UriCheckOk | UriCheckRejected;

// ── 地址判定（纯函数）────────────────────────────────────────────────────

function stripBrackets(host: string): string {
  return host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
}

/** 规范化 host：小写、去 IPv6 方括号、去尾点（`example.com.` 与 `example.com` 同义） */
export function normalizeHostname(host: string): string {
  let text = stripBrackets(host.trim().toLowerCase());
  while (text.endsWith(".")) text = text.slice(0, -1);
  return text;
}

function parseIpv4(text: string): number[] | null {
  const parts = text.split(".");
  if (parts.length !== 4) return null;
  const out: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const value = Number(part);
    if (!Number.isInteger(value) || value > 255) return null;
    out.push(value);
  }
  return out;
}

/** 展开 IPv6 为 8 个 hextet；支持 `::` 压缩、内嵌 IPv4（`::ffff:127.0.0.1`）与 zone id */
function parseIpv6(raw: string): number[] | null {
  let text = raw.trim().toLowerCase();
  const zone = text.indexOf("%");
  if (zone >= 0) text = text.slice(0, zone);

  // 内嵌 IPv4 先折算成两组 hextet，否则 `::` 展开会错位
  const embedded = /^(.*:)(\d{1,3}(?:\.\d{1,3}){3})$/.exec(text);
  if (embedded) {
    const v4 = parseIpv4(embedded[2] ?? "");
    if (!v4) return null;
    const hi = ((v4[0] ?? 0) << 8) | (v4[1] ?? 0);
    const lo = ((v4[2] ?? 0) << 8) | (v4[3] ?? 0);
    text = `${embedded[1]}${hi.toString(16)}:${lo.toString(16)}`;
  }

  const halves = text.split("::");
  if (halves.length > 2) return null;
  const toGroup = (part: string): number | null =>
    /^[0-9a-f]{1,4}$/.test(part) ? Number.parseInt(part, 16) : null;

  const head = (halves[0] ?? "") === "" ? [] : (halves[0] ?? "").split(":");
  const tail = halves.length === 2 ? ((halves[1] ?? "") === "" ? [] : (halves[1] ?? "").split(":")) : [];

  const groups: number[] = [];
  for (const part of head) {
    const group = toGroup(part);
    if (group === null) return null;
    groups.push(group);
  }
  if (halves.length === 2) {
    const fill = 8 - groups.length - tail.length;
    if (fill < 0) return null;
    for (let index = 0; index < fill; index += 1) groups.push(0);
  }
  for (const part of tail) {
    const group = toGroup(part);
    if (group === null) return null;
    groups.push(group);
  }
  return groups.length === 8 ? groups : null;
}

/** 内网/保留 IPv4 网段。任何一条命中即拒绝（顺序无关，宁可误拒不可漏放） */
function isBlockedIpv4(octets: number[]): boolean {
  const first = octets[0] ?? 0;
  const second = octets[1] ?? 0;
  if (first === 0) return true; // 0.0.0.0/8（含 0.0.0.0）
  if (first === 10) return true; // 10/8 私有
  if (first === 127) return true; // 127/8 环回
  if (first === 169 && second === 254) return true; // 169.254/16（含云元数据 169.254.169.254）
  if (first === 172 && second >= 16 && second <= 31) return true; // 172.16/12 私有
  if (first === 192 && second === 168) return true; // 192.168/16 私有
  if (first === 100 && second >= 64 && second <= 127) return true; // 100.64/10 CGNAT
  if (first === 198 && (second === 18 || second === 19)) return true; // 198.18/15 基准测试
  if (first >= 224) return true; // 224/4 组播 + 240/4 保留 + 255.255.255.255
  return false;
}

function isBlockedIpv6(groups: number[]): boolean {
  const first = groups[0] ?? 0;
  const zeroTail = groups.slice(0, 7).every((group) => group === 0);
  if (groups.every((group) => group === 0)) return true; // :: 未指定
  if (zeroTail && groups[7] === 1) return true; // ::1 环回
  if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7 唯一本地
  if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10 链路本地
  if ((first & 0xffc0) === 0xfec0) return true; // fec0::/10 站点本地（已废弃，仍在用）
  if ((first & 0xff00) === 0xff00) return true; // ff00::/8 组播

  // 内嵌 IPv4：`::ffff:a.b.c.d`（IPv4-mapped）、`::a.b.c.d`（compatible）、`64:ff9b::/96`（NAT64）
  const mapped = groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff;
  const compatible =
    groups.slice(0, 6).every((group) => group === 0) && ((groups[6] ?? 0) !== 0 || (groups[7] ?? 0) > 1);
  const nat64 =
    groups[0] === 0x64 && groups[1] === 0xff9b && groups.slice(2, 6).every((group) => group === 0);
  if (mapped || compatible || nat64) {
    const hi = groups[6] ?? 0;
    const lo = groups[7] ?? 0;
    return isBlockedIpv4([hi >> 8, hi & 0xff, lo >> 8, lo & 0xff]);
  }
  return false;
}

/**
 * 该地址是否属于内网/保留网段。
 * 非 IP 文本一律按"不可信"返回 true（调用方只应在已确认是 IP 时使用本函数）。
 */
export function isBlockedAddress(address: string): boolean {
  const text = stripBrackets(address.trim());
  const family = isIP(text);
  if (family === 4) {
    const octets = parseIpv4(text);
    return octets === null ? true : isBlockedIpv4(octets);
  }
  if (family === 6) {
    const groups = parseIpv6(text);
    return groups === null ? true : isBlockedIpv6(groups);
  }
  return true;
}

// ── 白名单（纯函数）──────────────────────────────────────────────────────

/** 规范化单个白名单条目：容忍运维误贴完整 URL / 带端口 / 带路径 / 大写 / 尾点 */
export function normalizeAllowlistEntry(raw: string): string {
  let text = raw.trim().toLowerCase();
  if (!text) return "";
  const wildcard = text.startsWith("*.");
  if (wildcard) text = text.slice(2);
  if (text.includes("://")) {
    try {
      text = new URL(text).hostname;
    } catch {
      return "";
    }
  } else {
    text = text.split("/")[0] ?? text;
    const colon = text.lastIndexOf(":");
    if (colon > 0 && /^\d+$/.test(text.slice(colon + 1))) text = text.slice(0, colon);
  }
  text = normalizeHostname(text);
  if (!text) return "";
  return wildcard ? `*.${text}` : text;
}

/** 解析 `CANVAS_DOWNLOAD_HOST_ALLOWLIST`（逗号分隔，支持 `*.example.com`） */
export function parseAllowlist(raw: string | undefined | null): string[] {
  if (typeof raw !== "string" || raw.trim() === "") return [];
  const out: string[] = [];
  for (const chunk of raw.split(",")) {
    const entry = normalizeAllowlistEntry(chunk);
    if (entry && !out.includes(entry)) out.push(entry);
  }
  return out;
}

/** host 是否命中白名单条目（`*.example.com` 覆盖子域、不覆盖裸域） */
export function hostMatchesAllowlist(host: string, entries: readonly string[]): boolean {
  const target = normalizeHostname(host);
  if (!target) return false;
  for (const entry of entries) {
    if (!entry) continue;
    if (entry.startsWith("*.")) {
      const suffix = entry.slice(1); // ".example.com"
      if (target.length > suffix.length && target.endsWith(suffix)) return true;
    } else if (target === entry) {
      return true;
    }
  }
  return false;
}

function hostFromBaseUrl(raw: string): string | null {
  const text = raw.trim();
  if (!text) return null;
  try {
    const host = normalizeHostname(new URL(text).hostname);
    return host || null;
  } catch {
    // 不是完整 URL（例如运维写了 `minio:9000`）：退化成裸 host[:port]
    const host = normalizeAllowlistEntry(text);
    return host.startsWith("*.") ? host.slice(2) : host || null;
  }
}

/** 从存储/站点基址推导"存储自身 host"（allowlist 未配置时的唯一放行面） */
export function storageHostsFromEnv(envLike: CanvasDownloadEnvLike): string[] {
  const out: string[] = [];
  const candidates = [
    envLike.STORAGE_PUBLIC_BASE,
    envLike.STORAGE_S3_PUBLIC_ENDPOINT,
    envLike.STORAGE_S3_ENDPOINT,
    envLike.PUBLIC_BASE_URL,
  ];
  for (const candidate of candidates) {
    if (typeof candidate !== "string") continue;
    const host = hostFromBaseUrl(candidate);
    if (host && !out.includes(host)) out.push(host);
  }
  return out;
}

/** env → 判定策略（allowlist 空 = 只允许存储自身 host；两者都空 = 全拒） */
export function resolveUriPolicy(envLike: CanvasDownloadEnvLike): CanvasDownloadPolicy {
  return {
    allowlist: parseAllowlist(envLike.CANVAS_DOWNLOAD_HOST_ALLOWLIST),
    storageHosts: storageHostsFromEnv(envLike),
    trustedOrigins: trustedOriginsFromEnv(envLike),
  };
}

/**
 * 从基址推导**精确 origin**（scheme + host + port）：
 * `http://127.0.0.1:9000/bucket` → `http://127.0.0.1:9000`。
 * 不是 host 后缀、不是通配：`:9000` 与 `:9001` 是两个不同 origin（两个不同服务）。
 */
function originFromBaseUrl(raw: string): string[] {
  const text = raw.trim();
  if (!text) return [];
  try {
    return [new URL(text).origin];
  } catch {
    // 裸 host[:port]（运维常把 MinIO endpoint 写成 `minio:9000`）：补全两种 scheme 各一个精确 origin
    const entry = normalizeAllowlistEntry(text);
    if (!entry || entry.startsWith("*.")) return [];
    const out: string[] = [];
    for (const scheme of ["http:", "https:"]) {
      try {
        const origin = new URL(`${scheme}//${entry}`).origin;
        if (!out.includes(origin)) out.push(origin);
      } catch {
        // 非法 host：丢弃，不影响其它候选
      }
    }
    return out;
  }
}

/**
 * 可信 origin 集合：**唯一来源是存储/站点配置**
 * （`STORAGE_PUBLIC_BASE` / `STORAGE_S3_PUBLIC_ENDPOINT` / `STORAGE_S3_ENDPOINT` / `PUBLIC_BASE_URL`）。
 *
 * 为什么需要这一步（这是功能性回归，不是安全放松）：
 * 开发/内网部署里存储自身就落在 `127.0.0.1:9000`（MinIO）或 VPC 内网端点
 * （`minio:9000`、`storage.internal:9000`）。若对**任何**内网地址一刀切，
 * 这批签名链接会被全部跳过 → 用户拿到空 zip，且只有运行期才暴露。
 *
 * 为什么这样仍然安全：
 * - 这是**运营配置的可信源**，不是用户可控输入。用户可控的只有节点/任务结果里的
 *   `result_uri`，它可以指向任意 host —— 所以判定仍然按 origin 精确比对；
 * - **豁免粒度是精确 origin（含端口）**：`http://127.0.0.1:9000` 的豁免不会覆盖
 *   `http://127.0.0.1:9001`，也不会覆盖 `http://127.0.0.1.evil.com`；
 * - **豁免不传染**：运营在 allowlist 写 `*.example.com` 不代表这些域可以解析到
 *   `169.254.169.254` —— 非可信 origin 一律恢复黑名单（含 DNS 解析结果）；
 * - 协议白名单、userinfo 拒收、重定向逐跳复检、超时、大小上限**照旧全部生效**。
 *
 * 运维注意：`STORAGE_DRIVER=local` 时 `STORAGE_PUBLIC_BASE` 就是 API 自身
 * （`http://127.0.0.1:3000/v1`），等于把"本应用 origin"列为可信。这在同机形态下是
 * 必需的（产物就是本应用在发），但生产请让它指向对外域名/CDN，并确保该 origin 上
 * 没有仅供内网调用的管理端点。
 */
export function trustedOriginsFromEnv(envLike: CanvasDownloadEnvLike): string[] {
  const out: string[] = [];
  const candidates = [
    envLike.STORAGE_PUBLIC_BASE,
    envLike.STORAGE_S3_PUBLIC_ENDPOINT,
    envLike.STORAGE_S3_ENDPOINT,
    envLike.PUBLIC_BASE_URL,
  ];
  for (const candidate of candidates) {
    if (typeof candidate !== "string") continue;
    for (const origin of originFromBaseUrl(candidate)) {
      if (!out.includes(origin)) out.push(origin);
    }
  }
  return out;
}

/** 该 URL 的 origin 是否精确命中可信集合（undefined/空集合 = 永不命中） */
export function isTrustedOrigin(url: URL, trustedOrigins: readonly string[] | undefined): boolean {
  if (!trustedOrigins || trustedOrigins.length === 0) return false;
  return trustedOrigins.includes(url.origin);
}

/** env → 拉取限额（大小上限可配，超时/跳数固定，避免再开一个新配置面） */
export function resolveDownloadLimits(envLike: { CANVAS_DOWNLOAD_MAX_BYTES?: number | undefined }): DownloadLimits {
  const configured = envLike.CANVAS_DOWNLOAD_MAX_BYTES;
  const maxBytes =
    typeof configured === "number" && Number.isFinite(configured) && configured > 0
      ? Math.floor(configured)
      : DEFAULT_MAX_BYTES;
  return { maxBytes, timeoutMs: DOWNLOAD_TIMEOUT_MS, maxRedirects: MAX_REDIRECTS };
}

// ── 判定（纯函数，单测入口）──────────────────────────────────────────────

/**
 * 判定一条产物 URI 是否可被服务端拉取。**不做任何 IO**（DNS 在校验层）。
 *
 * 判定顺序：可解析 → 协议白名单 → host 存在 → 无 userinfo → IP 字面量黑名单
 * → host 白名单（未配置时回退存储 host）。
 *
 * 唯一豁免：**存储配置里登记的精确 origin**（`trustedOrigins`）可跳过 IP 黑名单，
 * 因为内网存储端点（MinIO/VPC S3）本来就是运营自己配的地址。豁免不覆盖白名单、
 * 不覆盖协议、不覆盖 DNS 层之外的任何判据。
 */
export function checkDownloadUri(uri: string, policy: CanvasDownloadPolicy): UriCheck {
  if (typeof uri !== "string" || uri.trim() === "") {
    return { ok: false, reason: "malformed_uri", host: null };
  }
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return { ok: false, reason: "malformed_uri", host: null };
  }

  const host = normalizeHostname(url.hostname);
  if (!ALLOWED_SCHEMES.includes(url.protocol)) {
    // file:/gopher:/data:/ftp:/... 一律在这里被挡，不进入后面的任何分支
    return { ok: false, reason: "scheme_not_allowed", host: host || null };
  }
  if (!host) return { ok: false, reason: "missing_host", host: null };
  // `http://evil.com@127.0.0.1/` 这类 userinfo 混淆：服务端拉取不需要凭据。
  // 可信 origin 也不例外——存储签名链接从不带 userinfo。
  if (url.username || url.password) return { ok: false, reason: "credentials_in_url", host };

  // IP 字面量先过黑名单：即便白名单里误写了 127.0.0.1 也不放行。
  // 只有存储配置登记的**精确 origin** 例外（内网 MinIO/VPC S3），见 trustedOriginsFromEnv。
  const trusted = isTrustedOrigin(url, policy.trustedOrigins);
  if (!trusted && isIP(host) !== 0 && isBlockedAddress(host)) {
    return { ok: false, reason: "blocked_ip", host };
  }

  const effective = policy.allowlist.length > 0 ? policy.allowlist : policy.storageHosts;
  if (effective.length === 0) return { ok: false, reason: "no_allowlist_configured", host };
  if (!hostMatchesAllowlist(host, effective)) return { ok: false, reason: "host_not_allowlisted", host };

  return { ok: true, url, host };
}

/** 日志安全形态：去掉 query/hash（签名参数不能进日志），path 截断 */
export function safeUriForLog(uri: string): string {
  const raw = typeof uri === "string" ? uri : "";
  try {
    const url = new URL(raw);
    const path = url.pathname.length > 80 ? `${url.pathname.slice(0, 80)}…` : url.pathname;
    return `${url.protocol}//${url.host}${path}`;
  } catch {
    // 存储 key（相对路径）或不可解析文本：截断后返回，仍不带任何 query 风险
    return raw.length > 120 ? `${raw.slice(0, 120)}…` : raw;
  }
}

/** 统一的拒绝错误：业务码 400101（参数不可用），details 带结构化原因与 host */
function reject(
  reason: UriRejectReason,
  uri: string,
  host: string | null,
  extra: Record<string, unknown> = {},
): AppError {
  return new AppError(ErrorCode.INVALID_PARAM, `canvas result uri rejected: ${reason}`, {
    reason,
    host,
    uri: safeUriForLog(uri),
    ...extra,
  });
}

// ── 校验 + 拉取（有 IO，service 调用）────────────────────────────────────

export type AddressResolver = (host: string) => Promise<Array<{ address: string; family: number }>>;

const defaultResolver: AddressResolver = async (host) =>
  (await lookup(host, { all: true, verbatim: true })).map((item) => ({
    address: item.address,
    family: item.family,
  }));

export interface FetchGuardOptions {
  /** 注入 DNS 解析器（测试/特殊网络环境用）；默认 `node:dns/promises` */
  resolve?: AddressResolver;
}

/**
 * 在 `checkDownloadUri` 之上补"DNS 解析后再校验每个地址"（防 DNS rebinding /
 * 解析到内网），通过后返回最终 URL。
 *
 * 已知边界：本函数是"先校验后请求"，Node 的 `fetch`（undici）随后会**自行再解析一次**，
 * 严格意义上仍有 TOCTOU 窗口。真正钉死需要用 undici dispatcher 固定 IP + 手写 SNI，
 * 代价与风险都比这条 P0 的收益大，故此处只做校验并把边界写进报告。
 */
export async function assertFetchableUri(
  uri: string,
  policy: CanvasDownloadPolicy,
  options: FetchGuardOptions = {},
): Promise<URL> {
  const verdict = checkDownloadUri(uri, policy);
  if (!verdict.ok) throw reject(verdict.reason, uri, verdict.host);

  // 字面量地址已在 check 内判过黑名单：无需再查 DNS
  if (isIP(verdict.host) !== 0) return verdict.url;

  /**
   * 存储自身端点（精确 origin，来自 `STORAGE_*` 配置）：解析结果不再查黑名单。
   *
   * 这是内网部署的必要条件——`minio:9000` / `storage.internal:9000` 解析出来必然是
   * 10.x/172.16.x，若照查黑名单，内网存储的产物会被全部跳过（空 zip）。信任依据是
   * "运营把该地址配成了存储端点"，不是用户输入；用户可控的 `result_uri` 只要不在这个
   * 精确 origin 上，就仍然逐地址查黑名单（含 IPv4-mapped IPv6）。
   */
  if (isTrustedOrigin(verdict.url, policy.trustedOrigins)) return verdict.url;

  const resolver = options.resolve ?? defaultResolver;
  let addresses: Array<{ address: string; family: number }>;
  try {
    addresses = await resolver(verdict.host);
  } catch {
    throw reject("dns_unresolvable", uri, verdict.host);
  }
  if (!Array.isArray(addresses) || addresses.length === 0) {
    throw reject("dns_unresolvable", uri, verdict.host);
  }
  for (const item of addresses) {
    if (isBlockedAddress(item.address)) {
      throw reject("blocked_resolved_ip", uri, verdict.host, { address: item.address });
    }
  }
  return verdict.url;
}

type FetchResponse = Awaited<ReturnType<typeof fetch>>;

function isRedirect(status: number): boolean {
  return status >= 300 && status < 400;
}

async function cancelBody(res: FetchResponse): Promise<void> {
  try {
    await res.body?.cancel();
  } catch {
    // 取消失败不影响拒绝结论
  }
}

async function fetchOnce(url: URL, timeoutMs: number): Promise<FetchResponse> {
  try {
    return await fetch(url, {
      // 手动跟随：3xx 的 Location 必须重新走一遍完整校验（跳内网是常见绕过）
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
      headers: { accept: "*/*" },
    });
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    if (name === "TimeoutError" || name === "AbortError") {
      throw new AppError(ErrorCode.VENDOR_TIMEOUT, "canvas result uri fetch timed out", {
        reason: "timeout" satisfies UriRejectReason,
        host: url.host,
        timeout_ms: timeoutMs,
      });
    }
    throw new AppError(ErrorCode.VENDOR_ERROR, "canvas result uri fetch failed", {
      reason: "network_error" satisfies UriRejectReason,
      host: url.host,
    });
  }
}

/** 流式读取 + 计数：超过上限立刻 cancel，绝不 `arrayBuffer()` 无上限全读 */
async function readBodyWithLimit(res: FetchResponse, limit: number, uri: string, host: string): Promise<Buffer> {
  if (!res.body) return Buffer.alloc(0);
  const reader = res.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value || value.byteLength === 0) continue;
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel().catch(() => {});
        throw reject("size_exceeded", uri, host, { max_bytes: limit });
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    // 已 done / cancel 后 release 是安全的；失败也不影响结论
    try {
      reader.releaseLock();
    } catch {
      // ignore
    }
  }
  return Buffer.concat(chunks);
}

/**
 * 带守卫地拉取一条用户可控 URI，返回完整字节（≤ `limits.maxBytes`）。
 *
 * 拒绝/超限/非 2xx 全部抛业务错误（100% `AppError`，不会变成 500）：
 * - 策略拒绝 → 400101，`details.reason` 是上面那个枚举；
 * - 超时 → 745901；网络失败 → 745900；非 2xx → 400101 + `details.status`。
 */
export async function fetchGuarded(
  uri: string,
  policy: CanvasDownloadPolicy,
  limits: DownloadLimits = DEFAULT_LIMITS,
  options: FetchGuardOptions = {},
): Promise<Buffer> {
  let current = uri;
  // +1：初始请求，其后每一跳都算一次（maxRedirects=3 → 最多 4 次请求）
  for (let hop = 0; hop <= limits.maxRedirects; hop += 1) {
    const url = await assertFetchableUri(current, policy, options);
    const res = await fetchOnce(url, limits.timeoutMs);

    if (isRedirect(res.status)) {
      const location = res.headers.get("location");
      await cancelBody(res);
      if (!location) throw reject("redirect_without_location", current, url.hostname);
      current = new URL(location, url).toString();
      continue; // 下一圈 assertFetchableUri 会重新校验协议/host/IP/DNS
    }

    if (!res.ok) {
      await cancelBody(res);
      throw reject("http_error", current, url.hostname, { status: res.status });
    }

    const declared = Number(res.headers.get("content-length") ?? Number.NaN);
    if (Number.isFinite(declared) && declared > limits.maxBytes) {
      await cancelBody(res);
      throw reject("size_exceeded", current, url.hostname, { max_bytes: limits.maxBytes, content_length: declared });
    }

    return readBodyWithLimit(res, limits.maxBytes, current, url.hostname);
  }
  throw reject("too_many_redirects", uri, null, { max_redirects: limits.maxRedirects });
}
