import { afterAll, describe, expect, it } from "vitest";
import { RedisService } from "../src/redis/redis.service";
import { TokenService } from "../src/modules/auth/token.service";

/**
 * refresh 轮换的并发正确性（P1：重放检测不能有 TOCTOU）。
 *
 * 背景：`consumeRefresh` 原来是 `GET refresh:user:<uid>` → 比对 → `DEL` 两把键。
 * 两个并发的 `/auth/refresh` 会读到同一个 jti、**都**判定成功、各自签发新会话：
 * 一枚 refresh token 被用了两次（重放检测失效），而且后写的 `refresh:user` 把先写的顶掉。
 * 现在改成 Lua 原子「比对并删除」，同一 jti 只有一个调用能成功。
 *
 * 纯 Redis 单测（不连库）：直接实例化 RedisService + TokenService。
 */
describe("refresh rotation (atomic consume)", () => {
  const redis = new RedisService();
  const tokens = new TokenService(redis);
  const created: string[] = [];
  const uid = (label: string): string => {
    const id = `p1-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    return id;
  };

  afterAll(async () => {
    if (created.length > 0) await redis.del(...created);
    await redis.onModuleDestroy();
  });

  it("同一枚 refresh token 只能被消费一次", async () => {
    const user = uid("once");
    const refresh = await tokens.issueRefresh(user, "1");
    const payload = tokens.verifyRefresh(refresh);
    created.push(`refresh:user:${user}`, `refresh:jti:${payload.jti}`);

    expect(await tokens.consumeRefresh(user, payload.jti)).toBe(true);
    expect(await tokens.consumeRefresh(user, payload.jti)).toBe(false);
  });

  it("并发消费同一枚 token：恰好一个成功（Lua 原子性）", async () => {
    const user = uid("race");
    const refresh = await tokens.issueRefresh(user, "1");
    const payload = tokens.verifyRefresh(refresh);
    created.push(`refresh:user:${user}`, `refresh:jti:${payload.jti}`);

    const results = await Promise.all(
      Array.from({ length: 8 }, () => tokens.consumeRefresh(user, payload.jti)),
    );
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it("当前 jti 已被新会话覆盖时，旧 token 不能消费（也不误删新会话）", async () => {
    const user = uid("stale");
    const oldToken = await tokens.issueRefresh(user, "1");
    const oldPayload = tokens.verifyRefresh(oldToken);
    // 模拟"另一个标签页刚轮换成功"：user 指针换成新 jti
    const newToken = await tokens.issueRefresh(user, "1");
    const newPayload = tokens.verifyRefresh(newToken);
    created.push(`refresh:user:${user}`, `refresh:jti:${oldPayload.jti}`, `refresh:jti:${newPayload.jti}`);

    expect(await tokens.consumeRefresh(user, oldPayload.jti)).toBe(false);
    // 新会话仍然有效：旧 token 的失败不能把新会话一起删掉
    expect(await redis.get(`refresh:user:${user}`)).toBe(newPayload.jti);
    expect(await tokens.consumeRefresh(user, newPayload.jti)).toBe(true);
  });

  it("delIfCurrent 在守卫值不匹配时不删任何键", async () => {
    const key = uid("guard");
    const other = `${key}:other`;
    created.push(key, other);
    await redis.set(key, "v", 60);
    await redis.set(other, "x", 60);

    expect(await redis.delIfCurrent(key, "not-v", other)).toBe(false);
    expect(await redis.get(key)).toBe("v");
    expect(await redis.get(other)).toBe("x");

    expect(await redis.delIfCurrent(key, "v", other)).toBe(true);
    expect(await redis.get(key)).toBeNull();
    expect(await redis.get(other)).toBeNull();
  });
});