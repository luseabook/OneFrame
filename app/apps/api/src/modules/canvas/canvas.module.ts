import { Module } from "@nestjs/common";
import { CanvasController } from "./canvas.controller";
import { CanvasNodeTasksController } from "./canvas-node-tasks.controller";
import { CanvasTemplateController } from "./canvas-template.controller";
import { CanvasService } from "./canvas.service";
import { CanvasNodeTasksService } from "./canvas-node-tasks.service";
import { CanvasTemplateService } from "./canvas-template.service";
import { CreditsModule } from "../credits/credits.module";
import { GenerationsModule } from "../generations/generations.module";
import { ModelsModule } from "../models/models.module";

@Module({
  // 节点派生任务复用既有 generations/credits/models 体系，不新建任务表（ADR-003）
  imports: [CreditsModule, GenerationsModule, ModelsModule],
  controllers: [CanvasController, CanvasNodeTasksController, CanvasTemplateController],
  providers: [CanvasService, CanvasNodeTasksService, CanvasTemplateService],
  exports: [CanvasService, CanvasNodeTasksService, CanvasTemplateService],
})
export class CanvasModule {}
