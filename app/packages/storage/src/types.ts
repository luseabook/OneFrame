export interface StoredObject {
  key: string;
  /** 存储层内部标识；对用户不直接暴露（下载统一走预签名） */
  uri: string;
  content_type: string;
  bytes: number;
}

export interface StorageDriver {
  readonly driver: "local" | "s3";
  put(key: string, data: Buffer, contentType: string): Promise<StoredObject>;
  /** 返回带时效的下载地址（local=API 路由 + HMAC；s3=预签名 URL） */
  signDownload(key: string, ttlSeconds: number): Promise<string>;
  read(key: string): Promise<Buffer>;
}
