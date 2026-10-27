import { Module } from "@nestjs/common";
import { NovelAgentController } from "./novel-agent.controller";
import { NovelAgentService } from "./novel-agent.service";
import { NovelController } from "./novel.controller";
import { NovelLlmService } from "./novel-llm.service";
import { NovelService } from "./novel.service";
import { NovelFissionController, NovelOverseasController } from "./novel-variant.controller";
import { NovelVariantService } from "./novel-variant.service";

/**
 * 小说改编链（novel）域 —— 对照竞品 `/web/v1/df/novel/*` 86 端点中的第 2 批子链。
 *
 * 依赖说明：
 * - **不 import TeamModule**：novel 的越权判断不需要 space 成员表 ——
 *   `novels.space_id` 就是唯一归属，成员身份已由全局 `AuthGuard` 在解析
 *   `X-Space-Id` 时校验过（`common/auth.guard.ts:69-94`）。少一层依赖，
 *   也少一次每个请求都多跑的成员查询。
 * - **不 import ScriptModule**：拆集衔接由 asset-core 在 `script` 侧反向调用
 *   `NovelService.assertSplittable`（跨批次契约），依赖方向是 script → novel，单向。
 * - `NovelLlmService` 自带 mock/real 双模（无 `DEEPSEEK_API_KEY` 时确定性输出），
 *   所以整个模块在 CI 里不需要任何外部模型即可跑通全链。
 */
@Module({
  controllers: [NovelController, NovelAgentController, NovelFissionController, NovelOverseasController],
  providers: [NovelService, NovelLlmService, NovelAgentService, NovelVariantService],
  exports: [NovelService],
})
export class NovelModule {}
