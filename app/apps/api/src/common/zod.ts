import type { z } from "zod";
import { AppError, ErrorCode } from "@app/shared";

// 保留 Zod 的 output 类型（含 default 展开），避免调用方拿到 input 类型
export function parseOrThrow<S extends z.ZodTypeAny>(schema: S, value: unknown): z.output<S> {
  const result = schema.safeParse(value);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new AppError(ErrorCode.INVALID_PARAM, issue?.message ?? "Invalid parameter", {
      field: issue?.path.join("."),
    });
  }
  return result.data as z.output<S>;
}
