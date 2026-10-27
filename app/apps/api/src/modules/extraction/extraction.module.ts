import { Module } from "@nestjs/common";
import { ScriptModule } from "../script/script.module";
import { TeamModule } from "../team/team.module";
import { ExtractionController } from "./extraction.controller";
import { ExtractionService } from "./extraction.service";

/**
 * 抽取流水线（extraction）域 —— 对照竞品 `resource extract*` / `draft-*`
 * （`cmd/resource.md:536-727`）。
 *
 * 只 import ScriptModule 取 `LlmService`（mock/real 单一开关在那边，不在这里 new 客户端）；
 * 不 import SubjectsModule：抽取产出是**草稿**，不直接写主体库（抽错不能污染主体库）。
 */
@Module({
  imports: [TeamModule, ScriptModule],
  controllers: [ExtractionController],
  providers: [ExtractionService],
  exports: [ExtractionService],
})
export class ExtractionModule {}
