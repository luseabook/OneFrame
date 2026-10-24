import { LocalStorage } from "./local";
import type { StorageDriver } from "./types";

export * from "./local";
export * from "./types";

export interface StorageOptions {
  driver: "local" | "s3";
  rootDir: string;
  publicBaseUrl: string;
  signSecret: string;
}

export function createStorage(options: StorageOptions): StorageDriver {
  if (options.driver === "local") {
    return new LocalStorage(options);
  }
  // S3/OSS 驱动在 P1.5 接入（ADR-005）；当前显式失败，避免静默降级
  throw new Error("s3 storage driver not implemented yet (set STORAGE_DRIVER=local for dev)");
}
