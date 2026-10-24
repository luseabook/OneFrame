import { Controller, Get, Inject, Query, Res } from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { AppError, ErrorCode } from "@app/shared";
import { Public } from "../common/public.decorator";
import { StorageService } from "./storage.service";

const CONTENT_TYPES: Record<string, string> = {
  mp4: "video/mp4",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  txt: "text/plain; charset=utf-8",
};

@Controller()
export class FilesController {
  constructor(@Inject(StorageService) private readonly storage: StorageService) {}

  // 本地存储驱动的预签名下载入口（生产走 OSS 预签名，不经过 API）
  @Public()
  @Get("files/local")
  async download(
    @Query("key") key: string | undefined,
    @Query("expires") expiresRaw: string | undefined,
    @Query("sig") sig: string | undefined,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const local = this.storage.local;
    if (!local) throw new AppError(ErrorCode.NOT_FOUND, "local storage disabled");
    if (!key || !sig || !expiresRaw) throw new AppError(ErrorCode.NOT_FOUND, "missing file signature");

    const expires = Number(expiresRaw);
    if (!local.verify(key, expires, sig)) {
      throw new AppError(ErrorCode.NOT_FOUND, "invalid or expired file signature");
    }
    const data = await local.read(key).catch(() => {
      throw new AppError(ErrorCode.NOT_FOUND, "file not found");
    });
    const ext = key.split(".").pop()?.toLowerCase() ?? "bin";
    void reply
      .header("content-type", CONTENT_TYPES[ext] ?? "application/octet-stream")
      .header("cache-control", "private, max-age=3600")
      .send(data);
  }
}
