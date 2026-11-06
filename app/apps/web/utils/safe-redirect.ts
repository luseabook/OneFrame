/**
 * 登录后跳转目标的净化。
 *
 * 为什么需要：`/login?redirect=` 是公开可拼的 query，直接把 `route.query.redirect`
 * 交给 `navigateTo()` 构成开放重定向 —— 攻击者发 `?redirect=https://evil.com`，
 * 用户刚输完密码就被带去钓鱼站，且地址栏起始域名是本站，极具迷惑性。
 *
 * 规则：只放行**站内绝对路径**（以单个 `/` 开头）。以下一律回落到 fallback：
 * - 协议相对地址 `//evil.com`（浏览器会当主机名）
 * - 反斜杠变体 `/\evil.com`、`\\evil.com`（部分浏览器把 `\` 归一成 `/`）
 * - 带 scheme 的绝对地址（`https:`、`javascript:`、`data:` …）
 * - 含控制字符的串（`/\t/evil.com` 这类绕过）
 */
export function safeRedirect(raw: unknown, fallback = "/home"): string {
  if (typeof raw !== "string" || raw === "") return fallback;
  if (!raw.startsWith("/")) return fallback;
  if (raw.startsWith("//") || raw.startsWith("/\\")) return fallback;
  // 控制字符（含 tab/newline/CR）可能被 URL 解析器剥掉后重新拼出 `//host`
  if (/[\u0000-\u001f\u007f\\]/.test(raw)) return fallback;
  return raw;
}

/**
 * 外部跳转（支付收银台 / OAuth 授权页）的 URL 校验。
 *
 * 这些地址来自服务端响应，但不能无条件信任：计费 API 被攻破、响应被中间人篡改或
 * 配置错误时，`window.location.href = url` 会把用户带向任意站点（含 `javascript:`）。
 * 只接受可解析的 http(s) 绝对地址，其余返回 null 由调用方处理。
 */
export function safeExternalUrl(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.trim() === "") return null;
  if (/[\u0000-\u001f\u007f]/.test(raw)) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}