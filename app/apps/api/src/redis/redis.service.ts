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
