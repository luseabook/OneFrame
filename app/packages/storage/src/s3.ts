import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { StorageDriver, StoredObject } from "./types";

export interface S3Config {
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  endpoint?: string;
  /** 预签名 URL 使用的对外 endpoint（内网 SDK + 公网下载分离） */
  publicEndpoint?: string;
  forcePathStyle?: boolean;
}

// S3 兼容（AWS S3 / 阿里云 OSS S3 兼容端点 / MinIO）驱动。
// 结果 URL 一律预签名，不暴露 bucket 公网权限（ADR-005）。
export class S3Storage implements StorageDriver {
  readonly driver = "s3" as const;
  private readonly client: S3Client;
  private readonly signClient: S3Client;

  constructor(private readonly config: S3Config) {
    const base = {
      region: config.region,
      ...(config.forcePathStyle ? { forcePathStyle: true } : {}),
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    };
    this.client = new S3Client({
      ...base,
      ...(config.endpoint ? { endpoint: config.endpoint } : {}),
    });
    // 预签名必须使用浏览器/客户端可访问的地址（生产为 CDN 或公网 OSS endpoint）
    this.signClient = new S3Client({
      ...base,
      ...(config.publicEndpoint ?? config.endpoint
        ? { endpoint: config.publicEndpoint ?? config.endpoint }
        : {}),
    });
  }

  async put(key: string, data: Buffer, contentType: string): Promise<StoredObject> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
        Body: data,
        ContentType: contentType,
      }),
    );
    return { key, uri: key, content_type: contentType, bytes: data.byteLength };
  }

  async read(key: string): Promise<Buffer> {
    const res = await this.client.send(
      new GetObjectCommand({ Bucket: this.config.bucket, Key: key }),
    );
    if (!res.Body) throw new Error(`s3 object body missing: ${key}`);
    return Buffer.from(await res.Body.transformToByteArray());
  }

  async signDownload(key: string, ttlSeconds: number): Promise<string> {
    return getSignedUrl(
      this.signClient,
      new GetObjectCommand({ Bucket: this.config.bucket, Key: key }),
      { expiresIn: ttlSeconds },
    );
  }
}
