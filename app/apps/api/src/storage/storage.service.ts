import { Injectable } from "@nestjs/common";
import { createStorage, LocalStorage, type StorageDriver } from "@app/storage";
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

  async signDownload(key: string, ttlSeconds = 86_400): Promise<string> {
    return this.driver.signDownload(key, ttlSeconds);
  }

  async put(key: string, data: Buffer, contentType: string) {
    return this.driver.put(key, data, contentType);
  }

  get local(): LocalStorage | null {
    return this.driver instanceof LocalStorage ? this.driver : null;
  }
}
