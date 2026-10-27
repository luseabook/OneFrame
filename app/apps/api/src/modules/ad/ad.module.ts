import { Module } from "@nestjs/common";
import { CreditsModule } from "../credits/credits.module";
import { ScriptModule } from "../script/script.module";
import { AdDramaController } from "./ad-drama.controller";
import { AdDramaService } from "./ad-drama.service";
import { AdLlmService } from "./ad-llm.service";

/**
 * 广告剧（drama_ad）域 —— 对照竞品 `df/script_project/drama_ad/*` 12 端点
 * （`routes.txt:680-691`）+ 页面 `/ad-drama/{create,workspace}`（`:11-12`）。
 *
 * 依赖说明（两个都必要，且方向都是单向、不成环）：
 * - `CreditsModule` → 生成动作要 `CreditsService.price()` 拿目录真实价
 *   （文本模型按次 2 积分）；不借用就等于自造一套计价，会与全站对不上账。
 * - `ScriptModule` → 只借用它导出的 `LlmService`（mock/real 单一开关 `LLM_MODE`）。
 *   各模块自己 new DeepSeek 客户端会让"缺 Key 怎么办"的策略漂移
 *   （`script.module.ts:41-43` 已明确这个理由）。
 *
 * 不 import `AssetsModule`：商品图只是一个字符串（asset id 或 uri），
 * 本域不负责上传/转码/审核，读了只会把知识库式的间接依赖引进来。
 */
@Module({
  imports: [CreditsModule, ScriptModule],
  controllers: [AdDramaController],
  providers: [AdLlmService, AdDramaService],
  exports: [AdDramaService],
})
export class AdModule {}
