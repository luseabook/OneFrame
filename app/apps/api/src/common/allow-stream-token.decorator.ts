import { SetMetadata } from "@nestjs/common";

/**
 * 允许用 `?stream_token=` 代替 Authorization 头（ADR-012）。
 *
 * 为什么需要显式标注：浏览器 `EventSource` 不能设请求头，SSE 端点只能把凭据放
 * 查询参数。但 `AuthGuard` 原来对**所有**受保护路由都接受 stream_token，等于给
 * 短时效、无 jti、无法吊销的令牌开了一个通用后门（P1-9）。现在只有标了本装饰器
 * 的处理器才走查询参数通道，其余路由一律要求 Bearer access token。
 *
 * 只有 `GET/POST /agent/task/stream` 使用；新增 SSE 端点时才考虑加。
 */
export const ALLOW_STREAM_TOKEN_KEY = "allowStreamToken";
export const AllowStreamToken = (): MethodDecorator & ClassDecorator =>
  SetMetadata(ALLOW_STREAM_TOKEN_KEY, true);