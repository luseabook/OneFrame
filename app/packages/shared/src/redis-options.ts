/**
 * `REDIS_URL` → BullMQ/ioredis 连接参数。
 *
 * 为什么不能只取 host/port/password：URL 里还有四类信息，任何一类被丢掉都会在生产
 * 表现为"连接莫名失败/连到错误库"：
 * - `rediss://` 的 TLS（丢掉就明文连 TLS 端口，握手失败）
 * - 用户名（ACL 用户，6.x 起 `redis://user:pass@host`）
 * - `db`（`/2` 后缀，丢掉会连到 db0 —— 队列数据"消失"或串环境）
 * - 密码含 URL 转义字符（必须 decodeURIComponent）
 *
 * 这里统一解析，API 与 worker 共用，避免两处各漏一项。
 */
export interface RedisConnectionOptions {
  host: string;
  port: number;
  username?: string;
  password?: string;
  db?: number;
  tls?: Record<string, never>;
}

export function redisConnectionOptions(redisUrl: string): RedisConnectionOptions {
  const url = new URL(redisUrl);
  if (url.protocol !== "redis:" && url.protocol !== "rediss:") {
    throw new Error(`unsupported REDIS_URL protocol: ${url.protocol}`);
  }
  const dbPart = url.pathname.replace(/^\//, "");
  const db = dbPart === "" ? undefined : Number(dbPart);
  if (db !== undefined && (!Number.isInteger(db) || db < 0)) {
    throw new Error(`invalid REDIS_URL db index: ${dbPart}`);
  }
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    ...(url.username ? { username: decodeURIComponent(url.username) } : {}),
    ...(url.password ? { password: decodeURIComponent(url.password) } : {}),
    ...(db !== undefined ? { db } : {}),
    ...(url.protocol === "rediss:" ? { tls: {} } : {}),
  };
}