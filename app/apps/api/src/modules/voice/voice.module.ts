import { Module } from "@nestjs/common";
import { TasksModule } from "../tasks/tasks.module";
import { VoiceController } from "./voice.controller";
import { VoiceService } from "./voice.service";

/**
 * 音色库模块（第 93 批）。
 *
 * 只 import `TasksModule`：克隆记录的读/改名/删除都必须经 `TasksService`
 * （「禁止跨模块直查 tasks 表」是 ADR 里定下的边界 —— 绕过它会漏掉 space 归属校验）。
 * `StorageService` 由全局 `StorageModule` 提供，不需要显式 import。
 */
@Module({
  imports: [TasksModule],
  controllers: [VoiceController],
  providers: [VoiceService],
  exports: [VoiceService],
})
export class VoiceModule {}
