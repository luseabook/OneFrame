import jwt from "jsonwebtoken";
import { AppError, ErrorCode } from "@app/shared";
import { env } from "../config/env";

/**
 * SSE 专用短时效令牌（ADR-012）。
 *
 * 为什么需要：浏览器的 `EventSource` **不能设置请求头**，而全站鉴权是
 * `Authorization: Bearer`（ADR-006）。若不给一条带外凭据，SSE 在原生
 * `EventSource` 场景下根本无法鉴权。因此签发一个只能用于流式通道的短令牌，
 * 通过 `?stream_token=` 传递。
 *
 * 为什么不是"一次性"（契约草案原建议）：
 * 断线重连是 SSE 的常态（网络抖动/网关空闲超时），一次性令牌会让**每一次重连
 * 都必然 401**，而 ADR-012 明确要求"断线回落到轮询"。所以这里取短 TTL（120s）
 * + 绑定 (user, space) 的可复用令牌，并在校验时只放行流式端点。
 *
 * 安全边界：令牌只带 `aud="agent-stream"`，`verifyAccess()` 会因 audience 不符而
 * 拒绝它当普通 access token 用；反向也校验 audience，两套令牌不通用。
 */
const STREAM_AUDIENCE = "agent-stream";
export const STREAM_TOKEN_TTL_S = 120;

export interface StreamTokenPayload {
  sub: string;
  sid: string;
  /** 绑定到具体会话，避免令牌被拿去连别的会话（可选） */
  ses: string | null;
}

export function signStreamToken(payload: StreamTokenPayload): string {
  return jwt.sign({ ...payload, aud: STREAM_AUDIENCE }, env.JWT_SECRET, {
    expiresIn: STREAM_TOKEN_TTL_S,
  });
}

export function streamTokenExpiresAt(): string {
  return new Date(Date.now() + STREAM_TOKEN_TTL_S * 1000).toISOString();
}

/** 校验失败一律 401：调用方（AuthGuard）需要与"token 无效"同一处理路径 */
export function verifyStreamToken(raw: string | undefined): StreamTokenPayload {
  if (!raw) throw new AppError(ErrorCode.UNAUTHORIZED, "missing stream token");
  let decoded: unknown;
  try {
    decoded = jwt.verify(raw, env.JWT_SECRET, { audience: STREAM_AUDIENCE });
  } catch {
    throw new AppError(ErrorCode.UNAUTHORIZED, "invalid or expired stream token");
  }
  const value = decoded as Partial<StreamTokenPayload> & { sub?: unknown; sid?: unknown };
  if (typeof value.sub !== "string" || typeof value.sid !== "string") {
    throw new AppError(ErrorCode.UNAUTHORIZED, "invalid stream token payload");
  }
  return {
    sub: value.sub,
    sid: value.sid,
    ses: typeof value.ses === "string" ? value.ses : null,
  };
}
