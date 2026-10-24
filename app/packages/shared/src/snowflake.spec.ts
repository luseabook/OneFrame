import { describe, expect, it } from "vitest";
import { Snowflake } from "./snowflake";

describe("Snowflake", () => {
  it("generates unique, increasing ids under burst", () => {
    const s = new Snowflake(1n);
    const seen = new Set<bigint>();
    let prev = 0n;
    for (let i = 0; i < 10000; i++) {
      const id = s.nextId();
      expect(id).toBeGreaterThan(prev);
      expect(seen.has(id)).toBe(false);
      seen.add(id);
      prev = id;
    }
  });

  it("keeps ids unique across worker ids", () => {
    const a = new Snowflake(1n);
    const b = new Snowflake(2n);
    const set = new Set<bigint>();
    for (let i = 0; i < 5000; i++) {
      set.add(a.nextId());
      set.add(b.nextId());
    }
    expect(set.size).toBe(10000);
  });

  it("rejects invalid worker id", () => {
    expect(() => new Snowflake(1024n)).toThrow();
  });
});
