import { Module } from "@nestjs/common";
import { LlmService } from "./llm.service";
import { ScriptController } from "./script.controller";
import { ScriptService } from "./script.service";

@Module({
  controllers: [ScriptController],
  providers: [LlmService, ScriptService],
})
export class ScriptModule {}
