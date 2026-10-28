import { AppError, ErrorCode } from "@app/shared";

/**
 * 把**用户传入**的 id 字符串转成 bigint。
 *
 * 为什么需要它：`BigInt("abc")` 抛的是 `SyntaxError`，会一路穿到
 * `AllExceptionsFilter` 的「未知异常」分支 → HTTP 500 + code 500000。
 * 对用户来说这是「服务器出错了」，但实际上只是他把 URL 里的 id 拼错了；
 * 对监控来说更糟：客户端拼错参数会持续制造 5xx 告警。
 *
 * 第 69 批用「每个 GET 路由的占位符都换成 abc」的方式扫了一遍（248 条），
 * 抓出 17 条这样的端点（canvas 家族 / 团队 / KDS / 计费），改成走这里统一抛 400101。
 *
 * 只在**入口**用（controller 传下来的路径参数、body 里的 id 字符串）；
 * 库内自己生成的 id（`newId()`）和鉴权上下文里的 spaceId/userId 不必再洗一遍。
 */
export function toBigId(raw: unknown, field = "id"): bigint {
  const text = typeof raw === "string" ? raw.trim() : typeof raw === "number" ? String(raw) : "";
  if (!/^\d{1,20}$/.test(text)) {
    throw new AppError(ErrorCode.INVALID_PARAM, `invalid ${field}`, { field });
  }
  const value = BigInt(text);
  // 我们的主键是雪花 id，恒 > 0；0 只可能来自调用方自己编的占位值
  if (value <= 0n) {
    throw new AppError(ErrorCode.INVALID_PARAM, `invalid ${field}`, { field });
  }
  return value;
}
