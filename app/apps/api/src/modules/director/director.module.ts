import { Module } from "@nestjs/common";
import { RedisModule } from "../../redis/redis.module";
import { StorageModule } from "../../storage/storage.module";
import { TeamModule } from "../team/team.module";
import { DirectorController } from "./director.controller";
import { DirectorService } from "./director.service";

/**
 * 3D 导演台（director）域 —— 场景快照持久化 + 姿态预设 + 编辑心跳。
 *
 * 依赖说明：
 * - `TeamModule`：复用 `requireMember`（非成员 403），不另写一套权限；
 * - `RedisModule`：编辑心跳（TTL 60s）——高频易失信息不落库；
 * - `StorageModule`：缩略图是 `/assets/upload` 存下的 storage key，读时签名成可访问 URL。
 *
 * 不 import ScriptModule：项目/剧集归属校验只读 `script_projects` / `episodes` 的两列，
 * 直接查表即可，跨域调 service 会把域边界搅浑（ADR-009）。
 */
@Module({
  imports: [TeamModule, RedisModule, StorageModule],
  controllers: [DirectorController],
  providers: [DirectorService],
  exports: [DirectorService],
})
export class DirectorModule {}
