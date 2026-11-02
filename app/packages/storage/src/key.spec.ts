import { describe, expect, it } from "vitest";
import { assertKeyInSpace, assertStorageKey, spaceIdOfStorageKey } from "./key";

describe("storage key scope", () => {
  it("accepts keys under the owning space", () => {
    expect(() => assertKeyInSpace("123", "u/123/assets/1/orig.png")).not.toThrow();
    expect(spaceIdOfStorageKey("u/123/assets/1/orig.png")).toBe("123");
  });

  it("rejects keys from another space", () => {
    expect(() => assertKeyInSpace("123", "u/456/assets/1/orig.png")).toThrow(
      /another space/,
    );
  });

  it.each([
    "",
    "assets/1/orig.png",
    "u/assets/1/orig.png",
    "u/0/x",
    "u/123/",
    "u/123//x",
    "u/123/../456/x",
    "u/123/./x",
    "u/123\\x",
    "u/123/%2e%2e/456/x",
    "u/123/%2F456/x",
    "https://example.com/a.png",
    "file:///etc/passwd",
    "mock://x",
  ])("rejects malformed or unscoped key: %s", (key) => {
    expect(() => assertStorageKey(key)).toThrow(/invalid storage key/);
  });

  it("does not trust a non-numeric caller space id", () => {
    expect(() => assertKeyInSpace("u/123", "u/123/x")).toThrow(/invalid space id/);
  });
});
