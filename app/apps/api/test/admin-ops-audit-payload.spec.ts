import { describe, expect, it } from "vitest";
import { buildAuditPayload } from "../src/common/admin-audit.interceptor";

/**
 * 审计 payload 脱敏/截断的纯函数单测（不依赖 PG/Redis，本地也能跑）。
 *
 * 为什么这层必须单测：审计表是**长期保留**的，一旦把密码/令牌写进去，
 * 事后没有任何"再跑一次迁移"能补救干净。所以脱敏规则不靠 e2e 抽查，
 * 而是把每条规则钉死在这里：
 * 1. 键名命中敏感词 → `***`（含嵌套对象与数组内的对象）；
 * 2. 字符串 >500 字符截断、数组 >50 项截断、嵌套 >6 层截断；
 * 3. 整体序列化 >8KB → 只留 `_truncated + size_bytes + preview`；
 * 4. 循环引用 → `_unserializable`（不能因为审计序列化失败而抛错）。
 */
describe("admin audit payload sanitizer", () => {
  it("空 body 记为 null（GET/无体请求不该造出假对象）", () => {
    expect(buildAuditPayload(undefined)).toBeNull();
    expect(buildAuditPayload(null)).toBeNull();
  });

  it("敏感键名全部脱敏，普通字段保持原值", () => {
    const payload = buildAuditPayload({
      username: "ops1",
      password: "p@ssw0rd",
      newPassword: "another",
      token: "abc",
      refreshToken: "def",
      secret: "s",
      authorization: "Bearer x",
      api_key: "k",
      privateKey: "pk",
      cookie: "c",
      visible: true,
      sort: 3,
    }) as Record<string, unknown>;

    expect(payload.username).toBe("ops1");
    expect(payload.visible).toBe(true);
    expect(payload.sort).toBe(3);
    for (const key of [
      "password",
      "newPassword",
      "token",
      "refreshToken",
      "secret",
      "authorization",
      "api_key",
      "privateKey",
      "cookie",
    ]) {
      expect(payload[key]).toBe("***");
    }
  });

  it("嵌套对象/数组内的敏感键同样脱敏", () => {
    const payload = buildAuditPayload({
      mode: "universal_reference",
      items: [{ password: "a", name: "n1" }, { token: "t", name: "n2" }],
      nested: { deeper: { secret: "s", keep: "v" } },
    }) as {
      items: Array<Record<string, unknown>>;
      nested: { deeper: Record<string, unknown> };
    };
    expect(payload.items[0]).toEqual({ password: "***", name: "n1" });
    expect(payload.items[1]).toEqual({ token: "***", name: "n2" });
    expect(payload.nested.deeper).toEqual({ secret: "***", keep: "v" });
  });

  it("超长字符串截断到 500 字符并加省略号", () => {
    const payload = buildAuditPayload({ note: "x".repeat(900) }) as { note: string };
    expect(payload.note.length).toBe(501);
    expect(payload.note.endsWith("…")).toBe(true);
  });

  it("超长数组截断到 50 项", () => {
    const payload = buildAuditPayload({ ids: Array.from({ length: 120 }, (_, i) => i) }) as { ids: number[] };
    expect(payload.ids.length).toBe(50);
    expect(payload.ids[49]).toBe(49);
  });

  it("嵌套超过 6 层折叠成 depth-limit", () => {
    const payload = buildAuditPayload({ a: { b: { c: { d: { e: { f: { g: "deep" } } } } } } }) as Record<string, any>;
    expect(JSON.stringify(payload)).toContain("[depth-limit]");
  });

  it("整体超过 8KB 时只保留截断标记与预览", () => {
    const big: Record<string, string> = {};
    for (let i = 0; i < 40; i += 1) big[`field_${i}`] = "x".repeat(400);
    const payload = buildAuditPayload(big) as { _truncated: boolean; size_bytes: number; preview: string };
    expect(payload._truncated).toBe(true);
    expect(payload.size_bytes).toBeGreaterThan(8 * 1024);
    expect(payload.preview.length).toBe(2000);
  });

  it("循环引用被深度上限切断（不会无限递归）", () => {
    const circular: Record<string, unknown> = { name: "loop" };
    circular.self = circular;
    const payload = buildAuditPayload(circular) as Record<string, any>;
    const text = JSON.stringify(payload);
    expect(text).toContain("loop");
    // 关键：不能出现失控的深层展开，深度上限把环切掉了
    expect(text).toContain("[depth-limit]");
    expect(text.length).toBeLessThan(4096);
  });

  it("无法序列化的值不抛错，记为 _unserializable", () => {
    // BigInt 是 JSON.stringify 会直接抛错的值（请求体经 JSON 解析不会出现，
    // 但审计是旁路代码，必须对任意入参都安全）
    expect(buildAuditPayload({ big: BigInt(10) })).toEqual({ _unserializable: true });
  });
});
