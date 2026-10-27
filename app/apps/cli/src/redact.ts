/**
 * 凭据脱敏。
 *
 * 契约来源：`manual/error-codes.md:23`「日志和 JSON 中不得出现 access token、cookie
 * 或密码」+ `commands/account.md:38`「任何输出都不包含 access token 或 refresh token」。
 *
 * 做法：所有进入 stdout/stderr 的**原始**对象（`error.raw`、`--verbose` 回显）都先过
 * `redact`；密钥名按后缀匹配，命中即替换为 `"***"`，不保留长度（长度也是信息）。
 */
const SECRET_KEY = /(token|cookie|password|passwd|secret|authorization|credential|passphrase)/i;

export const REDACTED = "***";

export function isSecretKey(key: string): boolean {
  return SECRET_KEY.test(key);
}

/** 递归脱敏；循环引用安全（WeakSet），数组按元素处理 */
export function redact(value: unknown, seen: WeakSet<object> = new WeakSet()): unknown {
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value as object)) return "[circular]";
  seen.add(value as object);
  if (Array.isArray(value)) return value.map((item) => redact(item, seen));
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    out[key] = isSecretKey(key) ? REDACTED : redact(val, seen);
  }
  return out;
}

/** URL 里同名查询参数的值同样要脱敏（预签名 URL 的签名也是凭据） */
export function redactUrl(raw: string): string {
  try {
    const url = new URL(raw);
    for (const key of [...url.searchParams.keys()]) {
      if (isSecretKey(key) || /^(signature|x-amz-signature|sig)$/i.test(key)) {
        url.searchParams.set(key, REDACTED);
      }
    }
    return url.toString();
  } catch {
    return raw;
  }
}
