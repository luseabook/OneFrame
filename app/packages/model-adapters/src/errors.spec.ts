import { describe, expect, it } from "vitest";
import {
  classifyVendorHttpError,
  classifyVendorNetworkError,
  isRetryableVendorError,
  isVendorError,
  looksLikeContentRejection,
  parseVendorErrorBody,
  RetryableVendorError,
  VendorError,
  type VendorErrorKind,
} from "./errors";

const arkContext = { vendor: "ark", operation: "POST /api/v3/images/generations" };

describe("classifyVendorHttpError 状态码映射表", () => {
  const cases: Array<{ status: number; kind: VendorErrorKind; retryable: boolean; label: string }> = [
    { status: 401, kind: "auth_error", retryable: false, label: "Key 无效" },
    { status: 403, kind: "auth_error", retryable: false, label: "权限不足" },
    { status: 402, kind: "quota_exceeded", retryable: false, label: "余额不足" },
    { status: 400, kind: "invalid_param", retryable: false, label: "参数错误" },
    { status: 404, kind: "invalid_param", retryable: false, label: "模型/路径不存在" },
    { status: 422, kind: "invalid_param", retryable: false, label: "不可处理实体" },
    { status: 418, kind: "vendor_error", retryable: false, label: "其他 4xx" },
    { status: 429, kind: "rate_limited", retryable: true, label: "限流" },
    { status: 500, kind: "vendor_error", retryable: true, label: "服务端错误" },
    { status: 503, kind: "vendor_error", retryable: true, label: "服务不可用" },
  ];

  for (const item of cases) {
    it(`${item.status} (${item.label}) → ${item.kind} / retryable=${item.retryable}`, () => {
      const err = classifyVendorHttpError(item.status, '{"error":{"code":"E","message":"m"}}', arkContext);
      expect(err).toBeInstanceOf(VendorError);
      expect(err.kind).toBe(item.kind);
      expect(err.retryable).toBe(item.retryable);
      expect(err.status).toBe(item.status);
      expect(isRetryableVendorError(err)).toBe(item.retryable);
      if (item.retryable) expect(err).toBeInstanceOf(RetryableVendorError);
      else expect(err).not.toBeInstanceOf(RetryableVendorError);
    });
  }

  it("keeps vendor code and status for observability", () => {
    const err = classifyVendorHttpError(429, '{"error":{"code":"RateLimitExceeded","message":"slow down"}}', arkContext);
    expect(err.vendorCode).toBe("RateLimitExceeded");
    expect(err.vendor).toBe("ark");
    expect(err.operation).toBe("POST /api/v3/images/generations");
    expect(err.message).toContain("429");
    expect(err.message).toContain("slow down");
  });

  it("honours explicit non-retryable override (polling must not retry)", () => {
    const err = classifyVendorHttpError(503, "{}", { ...arkContext, retryable: false });
    expect(err.retryable).toBe(false);
    expect(err.kind).toBe("vendor_error");
  });
});

describe("classifyVendorHttpError 错误体解析", () => {
  it("parses {error:{code,message,type}} (Ark 标准错误体)", () => {
    const err = classifyVendorHttpError(
      400,
      JSON.stringify({
        error: { code: "InvalidParameter", message: "size is invalid", type: "BadRequest", param: "size" },
      }),
      arkContext,
    );
    expect(err.vendorCode).toBe("InvalidParameter");
    expect(err.kind).toBe("invalid_param");
    expect(err.message).toContain("size is invalid");
    // 不泄露完整 JSON 结构
    expect(err.message).not.toContain('"param"');
  });

  it("parses {code,message} and numeric code", () => {
    const a = classifyVendorHttpError(400, '{"code":"BadRequest","message":"bad prompt"}', arkContext);
    expect(a.vendorCode).toBe("BadRequest");
    expect(a.message).toContain("bad prompt");

    const b = classifyVendorHttpError(401, '{"code":10001,"message":"invalid api key"}', arkContext);
    expect(b.vendorCode).toBe("10001");
    expect(b.kind).toBe("auth_error");
  });

  it("parses {error:'message'} and non-JSON bodies", () => {
    const a = classifyVendorHttpError(500, '{"error":"upstream exploded"}', arkContext);
    expect(a.kind).toBe("vendor_error");
    expect(a.message).toContain("upstream exploded");

    const b = classifyVendorHttpError(400, "bad request", arkContext);
    expect(b.message).toContain("bad request");
    expect(b.vendorCode).toBeUndefined();
  });

  it("parseVendorErrorBody returns empty object for unparsable input", () => {
    expect(parseVendorErrorBody("not json")).toEqual({});
    expect(parseVendorErrorBody("[1,2,3]")).toEqual({});
    expect(parseVendorErrorBody('{"message":"m"}')).toEqual({ message: "m" });
  });
});

describe("内容审核拒绝识别", () => {
  it("maps Ark sensitive-output code to output_rejected (非重试)", () => {
    const err = classifyVendorHttpError(
      400,
      '{"error":{"code":"OutputImageSensitiveContentDetected","message":"The output image may contain sensitive content."}}',
      arkContext,
    );
    expect(err.kind).toBe("output_rejected");
    expect(err.retryable).toBe(false);
    expect(isRetryableVendorError(err)).toBe(false);
  });

  it("maps Chinese review wording to output_rejected even on 403", () => {
    const err = classifyVendorHttpError(403, '{"code":"AuditFailed","message":"内容审核未通过"}', arkContext);
    expect(err.kind).toBe("output_rejected");
    expect(err.retryable).toBe(false);
  });

  it("does not treat generic failures as review rejections", () => {
    expect(looksLikeContentRejection("internal server error")).toBe(false);
    expect(looksLikeContentRejection("rate limit exceeded")).toBe(false);
    expect(looksLikeContentRejection("OutputImageSensitiveContentDetected")).toBe(true);
    expect(looksLikeContentRejection("内容含敏感信息")).toBe(true);
    expect(classifyVendorHttpError(500, '{"error":{"message":"internal"}}', arkContext).kind).toBe("vendor_error");
  });

  it("recognises review wording variants", () => {
    expect(looksLikeContentRejection("ContentReviewFailed")).toBe(true);
    expect(looksLikeContentRejection("review_rejected")).toBe(true);
    expect(looksLikeContentRejection("content-policy violation")).toBe(true);
    expect(looksLikeContentRejection("The request was rejected by the safety filter")).toBe(true);
  });
});

describe("错误信息不泄露完整响应体", () => {
  it("truncates long bodies", () => {
    const longTail = "TAIL_MARKER_SHOULD_NOT_LEAK";
    const body = JSON.stringify({ error: { code: "Boom", message: `${"x".repeat(5000)}${longTail}` } });
    const err = classifyVendorHttpError(500, body, arkContext);
    expect(err.message.length).toBeLessThan(400);
    expect(err.message).not.toContain(longTail);
  });

  it("preserves legacy message prefixes", () => {
    const deepseek = classifyVendorHttpError(500, '{"error":"boom"}', {
      vendor: "deepseek",
      operation: "POST /chat/completions",
      messagePrefix: "deepseek http ",
    });
    expect(deepseek.message.startsWith("deepseek http 500:")).toBe(true);

    const ark = classifyVendorHttpError(400, "bad request", arkContext);
    expect(ark.message.startsWith("ark POST /api/v3/images/generations -> 400:")).toBe(true);
  });
});

describe("网络/超时归一化", () => {
  it("maps AbortError to retryable timeout", () => {
    const abort = new Error("This operation was aborted");
    abort.name = "AbortError";
    const err = classifyVendorNetworkError(abort, { vendor: "ark", operation: "POST /x" });
    expect(err).toBeInstanceOf(RetryableVendorError);
    expect(err.kind).toBe("timeout");
    expect(isRetryableVendorError(err)).toBe(true);
    expect(err.message).toContain("timeout");
  });

  it("maps fetch TypeError to retryable network_error", () => {
    const err = classifyVendorNetworkError(new TypeError("fetch failed"), { vendor: "deepseek" });
    expect(err.kind).toBe("network_error");
    expect(err.retryable).toBe(true);
    expect(err.message.startsWith("deepseek network error:")).toBe(true);
  });

  it("isVendorError narrows only VendorError instances", () => {
    expect(isVendorError(new VendorError("vendor_error", "x", { retryable: false }))).toBe(true);
    expect(isVendorError(new Error("plain"))).toBe(false);
  });
});
