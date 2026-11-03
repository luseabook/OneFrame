/**
 * 文件/blob 端点的「信封 vs 文件」分流判据。
 *
 * 为什么不能看 HTTP 状态码：本项目的全局异常过滤器把 `AppError` 一律输出成
 * **HTTP 200 + `{code,msg,data}`**（`apps/api/src/common/http/exception.filter.ts:19-22`），
 * 所以「未购买」「未登录」在 HTTP 层都是 200。只看 `response.ok` 会把错误 JSON 当文件返回。
 *
 * 为什么不用「先当文本取回再 JSON.parse 试探」：
 * 剧本正文恰好是合法 JSON 时会被误判成错误。**content-type 是唯一稳定的分流点**。
 *
 * 契约（Backend 确认）：成功 = `text/markdown` / `text/plain` / `text/csv`；
 * 失败 = `application/json`。
 */

/** 响应是否为信封（业务错误）；是则调用方必须先解信封再抛错，不得落盘 */
export function isEnvelopeContentType(contentType: string | null | undefined): boolean {
  const ct = String(contentType ?? "").toLowerCase();
  return ct.includes("application/json") || ct.includes("application/problem+json");
}

/** 从信封里取业务码与消息；解析失败时回落到 HTTP 状态码，保证调用方总有 code 可用 */
export function readEnvelopeError(
  envelope: unknown,
  fallbackStatus: number,
): { code: number; message: string } {
  const obj = (envelope ?? {}) as { code?: unknown; msg?: unknown };
  const code = typeof obj.code === "number" && obj.code !== 0 ? obj.code : fallbackStatus || 500;
  const message = typeof obj.msg === "string" && obj.msg.trim() !== "" ? obj.msg : "下载失败";
  return { code, message };
}

/**
 * 从 `content-disposition` 取文件名。
 * 兼容 `filename="a.md"`、`filename=a.md`、`filename*=UTF-8''a.md` 三种常见写法；
 * 取不到返回空串，由调用方兜底（不要在这里编一个默认名，调用方更清楚该叫什么）。
 */
export function filenameFromDisposition(disposition: string | null | undefined): string {
  const raw = String(disposition ?? "");
  if (raw === "") return "";
  const star = /filename\*\s*=\s*(?:UTF-8|utf-8)''([^;]+)/.exec(raw);
  if (star?.[1]) {
    try {
      return decodeURIComponent(star[1].trim().replace(/^"|"$/g, ""));
    } catch {
      return star[1].trim().replace(/^"|"$/g, "");
    }
  }
  const plain = /filename\s*=\s*"?([^";]+)"?/i.exec(raw);
  return plain?.[1] ? plain[1].trim() : "";
}
