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
    });
  }

  async signDownload(key: string, ttlSeconds = 86_400): Promise<string> {
    return this.driver.signDownload(key, ttlSeconds);
  }

  get local(): LocalStorage | null {
    return this.driver instanceof LocalStorage ? this.driver : null;
  }
}
