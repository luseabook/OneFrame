import { Module } from "@nestjs/common";
import { CreditsModule } from "../credits/credits.module";
import { ModelsModule } from "../models/models.module";
import { TasksController } from "./tasks.controller";
import { TasksService } from "./tasks.service";

@Module({
  imports: [CreditsModule, ModelsModule],
  controllers: [TasksController],
  providers: [TasksService],
})
export class TasksModule {}
