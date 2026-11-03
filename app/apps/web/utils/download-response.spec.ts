import { describe, expect, it } from "vitest";
import { filenameFromDisposition, isEnvelopeContentType, readEnvelopeError } from "./download-response";

/**
 * N-13 的判据单测：文件端点必须按 content-type 分流。
 *
 * 这两个缺陷的来历：后端全局异常过滤器把 AppError 输出成 **HTTP 200 + 信封**
 * （`exception.filter.ts:19-22`），于是「未购买」「未登录」在 HTTP 层全是 200。
 * 前端两处只看 `response.ok`，把错误 JSON 当文件落盘：
 *   - `novel-market/[id].vue`：`{code:403001}` 被写成 `.md`，还提示"下载已开始"；
 *   - `useAdminApi.ts` 的 `adminApiBlob`：错误 JSON 被当成 CSV 返回。
 */
describe("isEnvelopeContentType：按 content-type 分流", () => {
  it.each([
    ["application/json", true],
    ["application/json; charset=utf-8", true],
    ["application/problem+json", true],
    ["APPLICATION/JSON", true],
  ])("信封：%s", (ct, expected) => {
    expect(isEnvelopeContentType(ct)).toBe(expected);
  });

  it.each([
    ["text/markdown; charset=utf-8", false],
    ["text/plain", false],
    ["text/csv; charset=utf-8", false],
    ["application/octet-stream", false],
    ["", false],
    [null, false],
    [undefined, false],
  ])("文件：%s", (ct, expected) => {
    expect(isEnvelopeContentType(ct as string | null | undefined)).toBe(expected);
  });

  it("正文恰好是合法 JSON 的剧本不会被误判（判据只看 content-type，不试解析）", () => {
    // 若实现改成「先 text 再 JSON.parse 试探」，这条就会翻车
    expect(isEnvelopeContentType("text/markdown; charset=utf-8")).toBe(false);
  });
});

describe("readEnvelopeError：从信封取业务码", () => {
  it("取到 code 与 msg", () => {
    expect(readEnvelopeError({ code: 403001, msg: "尚未购买" }, 200)).toEqual({
      code: 403001,
      message: "尚未购买",
    });
  });

  it("code 缺失或为 0 时回落到 HTTP 状态（保证调用方总有 code）", () => {
    expect(readEnvelopeError({ msg: "x" }, 500).code).toBe(500);
    expect(readEnvelopeError({ code: 0, msg: "x" }, 502).code).toBe(502);
  });

  it("msg 缺失时给兜底文案，不返回空串", () => {
    expect(readEnvelopeError({ code: 403001 }, 200).message).toBe("下载失败");
    expect(readEnvelopeError(null, 200).message).toBe("下载失败");
  });

  it("非对象输入不抛异常", () => {
    expect(() => readEnvelopeError("oops", 200)).not.toThrow();
    expect(readEnvelopeError(undefined, 403).code).toBe(403);
  });
});

describe("filenameFromDisposition", () => {
  it.each([
    ['attachment; filename="雨夜来信.md"', "雨夜来信.md"],
    ["attachment; filename=export.csv", "export.csv"],
    ["attachment; filename*=UTF-8''%E9%9B%A8%E5%A4%9C.md", "雨夜.md"],
  ])("%s → %s", (disposition, expected) => {
    expect(filenameFromDisposition(disposition)).toBe(expected);
  });

  it("取不到时返回空串，由调用方兜底（不在这里编默认名）", () => {
    expect(filenameFromDisposition("")).toBe("");
    expect(filenameFromDisposition(null)).toBe("");
    expect(filenameFromDisposition("attachment")).toBe("");
  });
});
