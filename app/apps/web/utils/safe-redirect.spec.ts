import { describe, expect, it } from "vitest";
import { safeExternalUrl, safeRedirect } from "./safe-redirect";

/**
 * 开放重定向回归：`/login?redirect=` 只允许站内绝对路径，
 * 任何可解析成外部主机的变体必须回落到 fallback。
 */
describe("safeRedirect：只放行站内绝对路径", () => {
  it.each([
    ["/home", "/home"],
    ["/projects", "/projects"],
    ["/projects/42?tab=storyboard", "/projects/42?tab=storyboard"],
    ["/reelflow/list", "/reelflow/list"],
  ])("放行站内路径：%s", (input, expected) => {
    expect(safeRedirect(input)).toBe(expected);
  });

  it.each([
    ["https://evil.com", "/home"],
    ["http://evil.com/login", "/home"],
    ["//evil.com", "/home"],
    ["///evil.com", "/home"],
    ["/\\evil.com", "/home"],
    ["\\\\evil.com", "/home"],
    ["javascript:alert(1)", "/home"],
    ["data:text/html,<script>alert(1)</script>", "/home"],
    ["/\tevil.com", "/home"],
    ["/\u0000evil.com", "/home"],
    ["", "/home"],
    ["   /home", "/home"],
  ])("拒绝并回落：%s", (input) => {
    expect(safeRedirect(input)).toBe("/home");
  });

  it("支持自定义 fallback，非字符串输入同样回落", () => {
    expect(safeRedirect(undefined, "/login")).toBe("/login");
    expect(safeRedirect(null, "/login")).toBe("/login");
    expect(safeRedirect(["/a", "/b"], "/login")).toBe("/login");
  });
});

describe("safeExternalUrl：外部跳转只允许 http(s)", () => {
  it.each([
    ["https://pay.example.com/cashier?order=1", "https://pay.example.com/cashier?order=1"],
    ["http://pay.example.com/h5", "http://pay.example.com/h5"],
  ])("放行：%s", (input, expected) => {
    expect(safeExternalUrl(input)).toBe(expected);
  });

  it.each([
    ["javascript:alert(1)"],
    ["data:text/html,<script>alert(1)</script>"],
    ["file:///etc/passwd"],
    ["ftp://example.com/x"],
    ["//evil.com"],
    ["not a url"],
    [""],
    [null],
    [undefined],
    ["   "],
  ])("拒绝：%s", (input) => {
    expect(safeExternalUrl(input)).toBeNull();
  });
});