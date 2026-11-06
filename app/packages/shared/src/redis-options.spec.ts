import { describe, expect, it } from "vitest";
import { redisConnectionOptions } from "./redis-options";

/**
 * REDIS_URL 解析回归：旧实现只取 host/port/password，丢掉 TLS / ACL 用户名 / db 序号，
 * 生产表现为「连到 db0 队列数据消失」「rediss 握手失败」「ACL 用户被当成 default」。
 */
describe("redisConnectionOptions", () => {
  it("解析基础 url", () => {
    expect(redisConnectionOptions("redis://localhost:6379")).toEqual({
      host: "localhost",
      port: 6379,
    });
  });

  it("默认端口 6379", () => {
    expect(redisConnectionOptions("redis://cache.internal").port).toBe(6379);
  });

  it("保留 ACL 用户名与密码，并解码转义字符", () => {
    expect(redisConnectionOptions("redis://worker:p%40ss%3Aword@cache:6380")).toEqual({
      host: "cache",
      port: 6380,
      username: "worker",
      password: "p@ss:word",
    });
  });

  it("保留 db 序号", () => {
    expect(redisConnectionOptions("redis://localhost:6379/2").db).toBe(2);
    expect(redisConnectionOptions("redis://localhost:6379/").db).toBeUndefined();
  });

  it("rediss 带 TLS，redis 不带", () => {
    expect(redisConnectionOptions("rediss://cache:6380").tls).toEqual({});
    expect(redisConnectionOptions("redis://cache:6379").tls).toBeUndefined();
  });

  it("拒绝非 redis 协议与非法 db", () => {
    expect(() => redisConnectionOptions("http://cache:6379")).toThrow(/unsupported/);
    expect(() => redisConnectionOptions("redis://cache:6379/abc")).toThrow(/db index/);
    expect(() => redisConnectionOptions("redis://cache:6379/-1")).toThrow(/db index/);
  });
});