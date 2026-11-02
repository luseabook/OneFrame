/**
 * 存储 key 的空间归属校验。
 *
 * 约定：业务对象一律落在 `u/<spaceId>/...` 下；`u/<spaceId>` 本身就是归属证明。
 * 这里只做结构校验，不访问存储，也不接受 URL——外部 http(s) 资源不是 storage key。
 */
const SPACE_KEY_PATTERN = /^u\/([1-9]\d{0,19})\/(.+)$/;
const MAX_KEY_LENGTH = 1024;

function invalidKey(reason: string): Error {
  return Object.assign(new Error(`invalid storage key: ${reason}`), {
    name: "InvalidStorageKeyError",
  });
}

function decodeOnce(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    throw invalidKey("malformed percent-encoding");
  }
}

/**
 * 校验并返回规范化后的 key。
 *
 * 拒绝规则故意从严：历史 key 都是 `u/<digits>/...` 的 ASCII 路径，没有需要放行的
 * 编码段或空段。任何可以被不同存储后端解释成另一种路径的写法都不接受，
 * 例如 `u/1/../2/x`、`u/1//x`、`u\1\x`、`u/1/%2e%2e/2/x`。
 */
export function assertStorageKey(key: string): string {
  if (typeof key !== "string" || key.length === 0) {
    throw invalidKey("empty key");
  }
  if (key.length > MAX_KEY_LENGTH) {
    throw invalidKey("key too long");
  }
  // 外部 URL / 协议形态不是 storage key（含 `mock://`、`file:`）
  if (/^[a-z][a-z0-9+.-]*:/i.test(key)) {
    throw invalidKey("url or scheme is not a storage key");
  }
  if (key.includes("\\") || key.includes("\0")) {
    throw invalidKey("backslash or NUL is not allowed");
  }
  if (key.startsWith("/") || key.endsWith("/") || key.includes("//")) {
    throw invalidKey("leading, trailing or empty path segment");
  }

  const segments = key.split("/");
  for (const segment of segments) {
    if (segment === "." || segment === ".." || segment.length === 0) {
      throw invalidKey("path traversal or empty segment");
    }
  }

  // 编码后的分隔符/穿越也不能绕过上面的分段检查
  const decoded = decodeOnce(key);
  if (decoded !== key) {
    if (
      decoded.includes("\\") ||
      decoded.includes("\0") ||
      decoded.startsWith("/") ||
      decoded.includes("//")
    ) {
      throw invalidKey("encoded path separator or traversal");
    }
    for (const segment of decoded.split("/")) {
      if (segment === "." || segment === ".." || segment.length === 0) {
        throw invalidKey("encoded path traversal or empty segment");
      }
    }
  }

  if (!SPACE_KEY_PATTERN.test(key)) {
    throw invalidKey("key must be u/<spaceId>/<object>");
  }
  return key;
}

/** 返回 key 所属 spaceId；不是合法空间 key 时抛错 */
export function spaceIdOfStorageKey(key: string): string {
  const match = SPACE_KEY_PATTERN.exec(assertStorageKey(key));
  if (!match) throw invalidKey("key must be u/<spaceId>/<object>");
  return match[1]!;
}

/** 校验 key 必须属于指定空间；返回原 key 便于链式调用 */
export function assertKeyInSpace(spaceId: string, key: string): string {
  if (!/^[1-9]\d{0,19}$/.test(spaceId)) {
    throw invalidKey("invalid space id");
  }
  const actual = spaceIdOfStorageKey(key);
  if (actual !== spaceId) {
    throw invalidKey("key belongs to another space");
  }
  return key;
}
