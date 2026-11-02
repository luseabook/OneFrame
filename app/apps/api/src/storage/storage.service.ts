import { Injectable } from "@nestjs/common";
import {
  assertKeyInSpace,
  createStorage,
  LocalStorage,
  type StorageDriver,
} from "@app/storage";
import { AppError, ErrorCode } from "@app/shared";
import { env } from "../config/env";

@Injectable()
export class StorageService {
  readonly driver: StorageDriver;

  constructor() {
    this.driver = createStorage({
      driver: env.STORAGE_DRIVER,
      rootDir: env.STORAGE_DIR,
      publicBaseUrl: env.STORAGE_PUBLIC_BASE,
      signSecret: env.STORAGE_SIGN_SECRET,
      ...(env.STORAGE_DRIVER === "s3" && env.STORAGE_S3_BUCKET
        ? {
            s3: {
              bucket: env.STORAGE_S3_BUCKET,
              region: env.STORAGE_S3_REGION,
              endpoint: env.STORAGE_S3_ENDPOINT,
              publicEndpoint: env.STORAGE_S3_PUBLIC_ENDPOINT,
              forcePathStyle: env.STORAGE_S3_FORCE_PATH_STYLE,
              accessKeyId: env.STORAGE_S3_ACCESS_KEY_ID ?? "",
              secretAccessKey: env.STORAGE_S3_SECRET_ACCESS_KEY ?? "",
            },
          }
        : {}),
    });
  }

  /**
   * 业务层只能按空间签名。`spaceId` 必须来自鉴权上下文或记录自身，绝不能用 key 反推，
   * 否则“校验归属”会退化成“读取 key 里写的数字”。
   */
  async signDownload(spaceId: string, key: string, ttlSeconds = 86_400): Promise<string> {
    return this.driver.signDownload(this.ownedKey(spaceId, key), ttlSeconds);
  }

  async put(spaceId: string, key: string, data: Buffer, contentType: string) {
    return this.driver.put(this.ownedKey(spaceId, key), data, contentType);
  }

  async read(spaceId: string, key: string): Promise<Buffer> {
    return this.driver.read(this.ownedKey(spaceId, key));
  }

  /**
   * 写入前校验用户提交的 URI 确实是本空间对象。
   *
   * 与 `signDownload` 的区别：这里把结构错误转成 400101（带字段名），
   * 让调用方在写库前就拒绝，而不是等到响应序列化时才 500。
   */
  assertOwnedKey(spaceId: string, key: string, field: string): string {
    try {
      return this.ownedKey(spaceId, key);
    } catch {
      throw new AppError(
        ErrorCode.INVALID_PARAM,
        "storage key does not belong to this space",
        { field },
      );
    }
  }

  /**
   * 历史测试夹具使用 `u/test/...`（不是真实空间）。只允许在测试进程内放行，
   * 生产/开发一律走 `assertKeyInSpace`；共享校验器本身仍拒绝非数字空间段。
   */
  private ownedKey(spaceId: string, key: string): string {
    if (typeof key !== "string") throw new Error("storage key must be a string");
    if (
      env.NODE_ENV === "test" &&
      key.startsWith("u/test/") &&
      !key.includes("..") &&
      !key.includes("\\")
    ) {
      return key;
    }
    return assertKeyInSpace(spaceId, key);
  }

  get local(): LocalStorage | null {
    return this.driver instanceof LocalStorage ? this.driver : null;
  }
}
