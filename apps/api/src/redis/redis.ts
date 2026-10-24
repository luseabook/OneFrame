import Redis from "ioredis";
import { env } from "../config/env";

let client: Redis | null = null;

export function getRedis(): Redis {
  if (!client) {
    client = new Redis(env.REDIS_URL, {
      lazyConnect: false,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false, // 断连即失败，健康检查不被假 PONG 麻痹
    });
    client.on("error", () => {
      // 连接失败由调用方处理；此处只吞掉 unhandled 'error' 事件
    });
  }
  return client;
}

// enableOfflineQueue=false 时，未 ready 的命令会被立即拒绝；
// 探活/首请求必须先等 ready 事件（上限 1.5s）
function waitForReady(c: Redis, timeoutMs = 1500): Promise<void> {
  if (c.status === "ready") return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("redis not ready"));
    }, timeoutMs);
    const cleanup = () => {
      clearTimeout(timer);
      c.off("ready", onReady);
      c.off("error", onError);
    };
    const onReady = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error("redis connect error"));
    };
    c.once("ready", onReady);
    c.once("error", onError);
  });
}

export async function pingRedis(): Promise<boolean> {
  try {
    const c = getRedis();
    await waitForReady(c);
    return (await c.ping()) === "PONG";
  } catch {
    return false;
  }
}
