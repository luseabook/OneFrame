import type { FastifyRequest } from "fastify";

/**
 * 解析真实客户端 IP（限流与审计用）。
 *
 * 反向代理（nginx/CDN）后 `req.ip` 默认是代理节点 IP，会让全站用户共用同一个频控桶。
 * 优先级：X-Real-IP（由 nginx 的 real_ip 模块按可信代理链改写）→ X-Forwarded-For 最左 → socket 远端地址。
 * X-Real-IP 优先是为了避免用户自行伪造 X-Forwarded-For 绕过频控。
 */
export function clientIp(req: FastifyRequest): string {
  const realIp = req.headers["x-real-ip"];
  if (typeof realIp === "string" && realIp.trim() !== "") return realIp.trim();

  const forwarded = req.headers["x-forwarded-for"];
  const raw = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  if (typeof raw === "string" && raw.trim() !== "") {
    const first = raw.split(",")[0]?.trim();
    if (first) return first;
  }
  return req.ip ?? "unknown";
}
