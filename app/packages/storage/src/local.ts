import { createHmac, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import type { StorageDriver, StoredObject } from "./types";

// 本地存储驱动：dev/CI 用；生产替换为 OSS/S3 驱动（ADR-005 仍需转存自有桶）
export class LocalStorage implements StorageDriver {
  readonly driver = "local" as const;
  private readonly root: string;

  constructor(
    private readonly options: {
      rootDir: string;
      /** 预签名下载 URL 的前缀（通常为 API 公网地址 + /v1） */
      publicBaseUrl: string;
      signSecret: string;
    },
  ) {
    this.root = resolve(options.rootDir);
  }

  async put(key: string, data: Buffer, contentType: string): Promise<StoredObject> {
    const target = this.resolveKey(key);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, data);
    return { key, uri: key, content_type: contentType, bytes: data.byteLength };
  }

  async read(key: string): Promise<Buffer> {
    return readFile(this.resolveKey(key));
  }

  async signDownload(key: string, ttlSeconds: number): Promise<string> {
    const expires = Math.floor(Date.now() / 1000) + ttlSeconds;
    const sig = this.sign(key, expires);
    const base = this.options.publicBaseUrl.replace(/\/$/, "");
    return `${base}/files/local?key=${encodeURIComponent(key)}&expires=${expires}&sig=${sig}`;
  }

  verify(key: string, expires: number, sig: string): boolean {
    if (!Number.isFinite(expires) || expires < Math.floor(Date.now() / 1000)) return false;
    const expected = this.sign(key, expires);
    const a = Buffer.from(expected);
    const b = Buffer.from(sig);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  private sign(key: string, expires: number): string {
    return createHmac("sha256", this.options.signSecret).update(`${key}:${expires}`).digest("hex");
  }

  private resolveKey(key: string): string {
    const target = resolve(this.root, key);
    if (target !== this.root && !target.startsWith(this.root + sep)) {
      throw new Error("invalid storage key");
    }
    return target;
  }
}
