import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from "@nestjs/common";
import { map, Observable } from "rxjs";
import { ok } from "@app/shared";
import { SKIP_ENVELOPE } from "./skip-envelope.decorator";

// 成功响应统一包信封（api-spec §1）
@Injectable()
export class EnvelopeInterceptor implements NestInterceptor {
  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    // SSE 等流式响应显式豁免；其余一律包信封。
    // 不能靠"看返回值类型"判断：流式响应的返回值是 undefined（响应已由处理函数直写）。
    if (Reflect.getMetadata(SKIP_ENVELOPE, ctx.getHandler()) === true) {
      return next.handle();
    }
    return next.handle().pipe(map((data) => ok(data)));
  }
}
