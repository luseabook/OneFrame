import { describe, expect, it } from "vitest";
import { clientIp } from "./client-ip";

const base = {
  ip: "10.0.0.5",
  headers: {},
} as unknown as Parameters<typeof clientIp>[0];

describe("clientIp", () => {
  it("prefers x-real-ip over everything else", () => {
    const req = {
      ...base,
      headers: { "x-real-ip": "203.0.113.9", "x-forwarded-for": "198.51.100.1, 10.0.0.1" },
    } as unknown as Parameters<typeof clientIp>[0];
    expect(clientIp(req)).toBe("203.0.113.9");
  });

  it("takes the leftmost x-forwarded-for entry", () => {
    const req = {
      ...base,
      headers: { "x-forwarded-for": "198.51.100.1, 10.0.0.1, 10.0.0.2" },
    } as unknown as Parameters<typeof clientIp>[0];
    expect(clientIp(req)).toBe("198.51.100.1");
  });

  it("falls back to the socket address when no proxy headers exist", () => {
    expect(clientIp(base)).toBe("10.0.0.5");
  });

  it("ignores empty proxy headers", () => {
    const req = {
      ...base,
      headers: { "x-real-ip": "  ", "x-forwarded-for": "" },
    } as unknown as Parameters<typeof clientIp>[0];
    expect(clientIp(req)).toBe("10.0.0.5");
  });
});
