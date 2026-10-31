import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import Redis from "ioredis";
import { env } from "../config/env";

export const REDIS = Symbol("REDIS");

// 单连接封装：SMS 验证码/限频、quote、幂等、refresh 轮换都走这里。
@Injectable()
export class RedisService implements OnModuleDestroy {
  readonly client: Redis;

  constructor() {
    this.client = new Redis(env.REDIS_URL, {
      maxRetriesPerRequest: 2,
      enableOfflineQueue: false,
      lazyConnect: false,
    });
    this.client.on("error", () => {
      // 连接错误由调用方（业务 try/catch / 健康检查）处理，避免 unhandled error
    });
  }

  // enableOfflineQueue=false 时首个请求可能早于 ready；显式等待，避免启动竞态被当成 500
  private async ready(timeoutMs = 3000): Promise<void> {
    if (this.client.status === "ready") return;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error("redis not ready"));
      }, timeoutMs);
      const cleanup = (): void => {
        clearTimeout(timer);
        this.client.off("ready", onReady);
        this.client.off("error", onError);
      };
      const onReady = (): void => {
        cleanup();
        resolve();
      };
      const onError = (err: Error): void => {
        cleanup();
        reject(err);
      };
      this.client.once("ready", onReady);
      this.client.once("error", onError);
    });
  }

  async get(key: string): Promise<string | null> {
    await this.ready();
    return this.client.get(key);
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    await this.ready();
    if (ttlSeconds && ttlSeconds > 0) {
      await this.client.set(key, value, "EX", ttlSeconds);
    } else {
      await this.client.set(key, value);
    }
  }

  async setNx(key: string, value: string, ttlSeconds: number): Promise<boolean> {
    await this.ready();
    const result = await this.client.set(key, value, "EX", ttlSeconds, "NX");
    return result === "OK";
  }

  async del(...keys: string[]): Promise<void> {
    if (keys.length === 0) return;
    await this.ready();
    await this.client.del(...keys);
  }

  /**
   * 原子「比较并删除」：仅当 `guardKey` 的当前值等于 `guardValue` 时，
   * 删除 `guardKey` 与 `keys` 中的所有键，返回是否删除。
   *
   * 为什么必须是原子的：refresh 轮换是「读当前 jti → 比对 → 删两把键」，
   * 分开的 GET + DEL 会让两个并发续期都读到同一个 jti、都成功轮换，
   * 于是同一枚 refresh token 被用两次（重放检测失效），且后写的会话把先写的顶掉。
   * Lua 在 Redis 单线程内执行，天然互斥。
   */
  async delIfCurrent(guardKey: string, guardValue: string, ...keys: string[]): Promise<boolean> {
    await this.ready();
    const script =
      "if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end\n" +
      "for i = 1, #KEYS do redis.call('DEL', KEYS[i]) end\n" +
      "return 1";
    const result = (await this.client.eval(
      script,
      1 + keys.length,
      guardKey,
      ...keys,
      guardValue,
    )) as number;
    return result === 1;
  }

  async incrWithTtl(key: string, ttlSeconds: number): Promise<number> {
    await this.ready();
    const value = await this.client.incr(key);
    if (value === 1) await this.client.expire(key, ttlSeconds);
    return value;
  }

  async ttl(key: string): Promise<number> {
    await this.ready();
    return this.client.ttl(key);
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit().catch(() => undefined);
  }
}
