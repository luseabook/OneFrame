import { LocalStorage } from "./local";
import { S3Storage, type S3Config } from "./s3";
import type { StorageDriver } from "./types";

export * from "./local";
export * from "./s3";
export * from "./types";

export interface StorageOptions {
  driver: "local" | "s3";
  /** local driver 使用 */
  rootDir?: string;
  publicBaseUrl?: string;
  signSecret?: string;
  /** local driver 单次 fs 操作总上限（毫秒，0 = 不设上限，默认 DEFAULT_OPERATION_TIMEOUT_MS） */
  operationTimeoutMs?: number;
  /** s3/OSS driver 使用 */
  s3?: S3Config;
}

export function createStorage(options: StorageOptions): StorageDriver {
  if (options.driver === "local") {
    if (!options.rootDir || !options.publicBaseUrl || !options.signSecret) {
      throw new Error("local storage requires rootDir/publicBaseUrl/signSecret");
    }
    return new LocalStorage({
      rootDir: options.rootDir,
      publicBaseUrl: options.publicBaseUrl,
      signSecret: options.signSecret,
      ...(options.operationTimeoutMs !== undefined
        ? { operationTimeoutMs: options.operationTimeoutMs }
        : {}),
    });
  }
  if (!options.s3) {
    throw new Error("s3 storage requires s3 config (bucket/region/access keys)");
  }
  return new S3Storage(options.s3);
}
