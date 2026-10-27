import { Module } from "@nestjs/common";
import { CreditsModule } from "../credits/credits.module";
import { ModelsModule } from "../models/models.module";
import { PublicShareController, TaskShareController } from "./task-share.controller";
import { TasksController } from "./tasks.controller";
import { TasksService } from "./tasks.service";
import { ShareStreamService } from "./share-stream.service";

@Module({
  imports: [CreditsModule, ModelsModule],
  controllers: [TasksController, TaskShareController, PublicShareController],
  providers: [TasksService, ShareStreamService],
  // agent 域要做"任务标题/反馈"写入与批量下载，统一经 TasksService
  // （禁止跨模块直查 tasks 表，见 system-design §2）
  exports: [TasksService],
})
export class TasksModule {}
