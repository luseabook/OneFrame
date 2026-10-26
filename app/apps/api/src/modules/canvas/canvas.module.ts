import { Module } from "@nestjs/common";
import { CanvasController } from "./canvas.controller";
import { CanvasNodeTasksController } from "./canvas-node-tasks.controller";
import { CanvasTemplateController } from "./canvas-template.controller";
import { CanvasMaterialController } from "./canvas-material.controller";
import { CanvasGroupController } from "./canvas-group.controller";
import { CanvasService } from "./canvas.service";
import { CanvasNodeTasksService } from "./canvas-node-tasks.service";
import { CanvasTemplateService } from "./canvas-template.service";
import { CanvasMaterialService } from "./canvas-material.service";
import { CanvasGroupService } from "./canvas-group.service";
import { CreditsModule } from "../credits/credits.module";
import { GenerationsModule } from "../generations/generations.module";
import { ModelsModule } from "../models/models.module";

@Module({
  // 节点派生任务复用既有 generations/credits/models 体系，不新建任务表（ADR-003）
  imports: [CreditsModule, GenerationsModule, ModelsModule],
  controllers: [
    CanvasController,
    CanvasNodeTasksController,
    CanvasTemplateController,
    CanvasMaterialController,
    CanvasGroupController,
  ],
  providers: [
    CanvasService,
    CanvasNodeTasksService,
    CanvasTemplateService,
    CanvasMaterialService,
    CanvasGroupService,
  ],
  exports: [
    CanvasService,
    CanvasNodeTasksService,
    CanvasTemplateService,
    CanvasMaterialService,
    CanvasGroupService,
  ],
})
export class CanvasModule {}
