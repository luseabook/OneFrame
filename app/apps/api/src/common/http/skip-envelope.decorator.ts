import { SetMetadata } from "@nestjs/common";

/**
 * 跳过统一信封包装（api-spec §1 的唯一例外：`text/event-stream`）。
 *
 * 为什么要有这个豁免：`EnvelopeInterceptor` 是全局的，会把任何返回值包成
 * `{code,msg,data}`。SSE 是一条持续的字节流，一旦被包成 JSON 整条通道就失效了。
 *
 * 为什么用 metadata 而不是给 interceptor 注入 `Reflector`：
 * `main.ts` 里是 `new EnvelopeInterceptor()` 手工实例化（无 DI），
 * 直接读 handler 元数据是改动面最小的做法。
 */
export const SKIP_ENVELOPE = Symbol("skip_envelope");

export const SkipEnvelope = (): MethodDecorator => SetMetadata(SKIP_ENVELOPE, true);
