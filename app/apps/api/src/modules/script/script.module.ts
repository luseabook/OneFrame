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
  // agent 域复用同一个 LLM 入口（mock/real 单一开关 LLM_MODE），
  // 而不是各自 new 一个 DeepSeek 客户端——否则两处对"缺 Key 怎么办"的策略会漂移
  exports: [LlmService],
})
export class ScriptModule {}
