import { Controller, Get, Inject, Query, Res } from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { AppError, ErrorCode } from "@app/shared";
import { Public } from "../common/public.decorator";
import { StorageService } from "./storage.service";

const CONTENT_TYPES: Record<string, string> = {
  mp4: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  m4a: "audio/mp4",
  txt: "text/plain; charset=utf-8",
  json: "application/json; charset=utf-8",
  // zip 必须有：画布批量下载的产物就是 zip。缺了会退化成 application/octet-stream，
  // 浏览器不再按压缩包处理（部分浏览器直接内联展示乱码），用户以为下载坏了
  zip: "application/zip",
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
