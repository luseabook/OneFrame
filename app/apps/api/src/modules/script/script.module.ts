import { Module } from "@nestjs/common";
import { CreditsModule } from "../credits/credits.module";
import { GenerationsModule } from "../generations/generations.module";
import { ModelsModule } from "../models/models.module";
import { LlmService } from "./llm.service";
import { ScriptController } from "./script.controller";
import { ScriptService } from "./script.service";

@Module({
  imports: [GenerationsModule, CreditsModule, ModelsModule],
  controllers: [ScriptController],
  providers: [LlmService, ScriptService],
})
export class ScriptModule {}
