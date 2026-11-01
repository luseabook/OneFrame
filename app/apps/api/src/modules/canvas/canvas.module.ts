import { Module } from "@nestjs/common";
import { CanvasController } from "./canvas.controller";
import { CanvasNodeTasksController } from "./canvas-node-tasks.controller";
import { CanvasTemplateController } from "./canvas-template.controller";
import { CanvasMaterialController } from "./canvas-material.controller";
import { CanvasGroupController } from "./canvas-group.controller";
import { CanvasTableController } from "./canvas-table.controller";
import { CanvasDownloadController } from "./canvas-download.controller";
import { CanvasShareController, PublicCanvasShareController } from "./canvas-share.controller";
import { CanvasService } from "./canvas.service";
import { CanvasNodeTasksService } from "./canvas-node-tasks.service";
import { CanvasTemplateService } from "./canvas-template.service";
import { CanvasMaterialService } from "./canvas-material.service";
import { CanvasGroupService } from "./canvas-group.service";
import { CanvasTableService } from "./canvas-table.service";
import { CanvasDownloadService } from "./canvas-download.service";
import { CanvasDeriveService } from "./canvas-derive.service";
import { CanvasShareService } from "./canvas-share.service";
import { CreditsModule } from "../credits/credits.module";
import { GenerationsModule } from "../generations/generations.module";
import { ModelsModule } from "../models/models.module";
import { TasksModule } from "../tasks/tasks.module";

@Module({
  // 节点派生任务复用既有 generations/credits/models 体系，不新建任务表（ADR-003）
  // TasksModule：批量下载要回读任务结果（节点 params 可能只有 task_id，产物在 tasks.results）
  imports: [CreditsModule, GenerationsModule, ModelsModule, TasksModule],
  controllers: [
    CanvasController,
    CanvasNodeTasksController,
    CanvasTemplateController,
    CanvasMaterialController,
    CanvasGroupController,
    CanvasTableController,
    CanvasDownloadController,
    CanvasShareController,
    PublicCanvasShareController,
  ],
  providers: [
    CanvasService,
    CanvasNodeTasksService,
    CanvasTemplateService,
    CanvasMaterialService,
    CanvasGroupService,
    CanvasTableService,
    CanvasDownloadService,
    CanvasDeriveService,
    CanvasShareService,
  ],
  exports: [
    CanvasService,
    CanvasNodeTasksService,
    CanvasTemplateService,
    CanvasMaterialService,
    CanvasGroupService,
    CanvasTableService,
    CanvasDownloadService,
    CanvasDeriveService,
    CanvasShareService,
  ],
})
export class CanvasModule {}
