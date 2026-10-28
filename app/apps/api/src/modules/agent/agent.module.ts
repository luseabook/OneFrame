import { Module } from "@nestjs/common";
import { AdminModule } from "../admin/admin.module";
import { CanvasModule } from "../canvas/canvas.module";
import { CreditsModule } from "../credits/credits.module";
import { GenerationsModule } from "../generations/generations.module";
import { ModelsModule } from "../models/models.module";
import { ScriptModule } from "../script/script.module";
import { TasksModule } from "../tasks/tasks.module";
import { AgentController } from "./agent.controller";
import { AgentChatService } from "./agent-chat.service";
import { AgentConversationsController } from "./agent-conversations.controller";
import { AgentEventsService } from "./agent-events.service";
import { AgentMessagesService } from "./agent-messages.service";
import { AgentRecommendController } from "./agent-recommend.controller";
import { AgentRecommendService } from "./agent-recommend.service";
import { AgentReplyService } from "./agent-reply.service";
import { AgentSessionsService } from "./agent-sessions.service";
import { AgentSkillsAdminController } from "./agent-skills-admin.controller";
import { AgentSkillsController } from "./agent-skills.controller";
import { AgentSkillsService } from "./agent-skills.service";
import { AgentSttController, AgentSttRelayController } from "./agent-stt.controller";
import { AgentSttService } from "./agent-stt.service";
import { AgentStreamService } from "./agent-stream.service";
import { AgentTaskService } from "./agent-task.service";
import { CanvasChatController } from "./canvas-chat.controller";

/**
 * agent 对话域（F1 契约 §13）。
 *
 * 依赖方向（只允许单向）：
 * - 生成任务 → `GenerationsModule`（冻结/幂等都在那里，**本域不碰 billing**）；
 * - 任务读写 → `TasksModule`（经 service，不直查表）；
 * - 目录 → `ModelsModule`（默认档位由目录决定，禁止写死）；
 * - 画布节点只读 → `CanvasModule`（按契约 §5.1 允许）；
 * - LLM → `ScriptModule` 导出的 `LlmService`（全站单一 LLM 入口，mock/real 同一开关）。
 *
 * `RedisModule`/`ModerationModule` 是 @Global，无需在此导入。
 *
 * 第 4 批新增（`/agent` 入口收口）：
 * - `AgentSkillsController`：Skill 卡市场 8 端点 + `/details` 别名（竞品 `routes.txt:378-385`）；
 * - `AgentSttController` / `AgentSttRelayController`：`stt-token` + 转写中继（`routes.txt:126`）；
 * - `AgentRecommendController`：推荐卡（`routes.txt:378`）；
 * - `AgentConversationsController`：独立创作会话（scope=1）的 CRUD / 消息 / SSE / 已读。
 */
@Module({
  imports: [
    CreditsModule,
    GenerationsModule,
    ModelsModule,
    TasksModule,
    CanvasModule,
    ScriptModule,
    // 第 102 批：`AgentSkillsAdminController` 用 `AdminGuard`，它注入 `AdminAuthService`
    // （`AdminModule` 才 exports 它）。漏了这句会让 `NestFactory.create(AppModule)` DI 失败
    // —— 不是一个 spec 红，而是全仓 e2e 归零（与 market.module.ts 同一条注释）。
    AdminModule,
  ],
  controllers: [
    AgentController,
    CanvasChatController,
    AgentConversationsController,
    AgentSkillsController,
    // 第 102 批：Skill 卡运营编排（首页推荐位）。平台卡 space_id 为 NULL、无用户拥有，
    // 所以 C 端的 PUT /agent-skills 永远改不了它 —— 必须另开一个 AdminGuard 入口。
    AgentSkillsAdminController,
    AgentSttController,
    AgentSttRelayController,
    AgentRecommendController,
  ],
  providers: [
    AgentEventsService,
    AgentSessionsService,
    AgentMessagesService,
    AgentStreamService,
    AgentReplyService,
    AgentChatService,
    AgentTaskService,
    AgentSkillsService,
    AgentSttService,
    AgentRecommendService,
  ],
  exports: [AgentSessionsService, AgentMessagesService, AgentEventsService],
})
export class AgentModule {}
