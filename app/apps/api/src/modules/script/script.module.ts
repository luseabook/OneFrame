import { Module } from "@nestjs/common";
import { CreditsModule } from "../credits/credits.module";
import { GenerationsModule } from "../generations/generations.module";
import { ModelsModule } from "../models/models.module";
import { NovelModule } from "../novel/novel.module";
import { SubjectsModule } from "../subjects/subjects.module";
import { AssetGatesService } from "./asset-gates.service";
import { AssetMatchService } from "./asset-match.service";
import { LlmService } from "./llm.service";
import { ScriptController } from "./script.controller";
import { ScriptService } from "./script.service";

/**
 * 剧本/制片流水线域。
 *
 * 依赖方向（单向，避免环）：
 * - `NovelModule` → 拆集来源要用 `NovelService.assertSplittable`（§3.3 衔接契约）；
 * - `SubjectsModule` → 生成前要判「主体未过审」（400105，`subject.md:204-226`）。
 * novel 与 subject 都不反向依赖 script，所以不会成环。
 */
@Module({
  imports: [GenerationsModule, CreditsModule, ModelsModule, SubjectsModule, NovelModule],
  controllers: [ScriptController],
  providers: [LlmService, ScriptService, AssetMatchService, AssetGatesService],
  // agent 域复用同一个 LLM 入口（mock/real 单一开关 LLM_MODE），
  // 而不是各自 new 一个 DeepSeek 客户端——否则两处对"缺 Key 怎么办"的策略会漂移
  exports: [LlmService],
})
export class ScriptModule {}
