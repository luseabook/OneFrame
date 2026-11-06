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

  it("小回拨（≤5s）自旋等待，绝不发重复 id", () => {
    const realNow = Date.now;
    let fake = 1_800_000_000_000;
    Date.now = () => fake;
    try {
      const s = new Snowflake(1n);
      const first = s.nextId();
      // 时钟回拨 3ms：nextId 会自旋等时钟追上（模拟：第一次读返回回拨值，之后返回原值）
      fake -= 3;
      let calls = 0;
      Date.now = () => (calls++ === 0 ? fake : 1_800_000_000_000);
      const second = s.nextId();
      expect(second).toBeGreaterThan(first);
      expect(second).not.toBe(first);
    } finally {
      Date.now = realNow;
    }
  });

  it("大回拨（>5s）拒绝发号而不是产出重复键", () => {
    const realNow = Date.now;
    let fake = 1_800_000_000_000;
    Date.now = () => fake;
    try {
      const s = new Snowflake(1n);
      s.nextId();
      fake -= 60_000; // 回拨 1 分钟
      expect(() => s.nextId()).toThrow(/clock moved backwards/);
    } finally {
      Date.now = realNow;
    }
  });
});
