import { Module } from "@nestjs/common";
import { CanvasModule } from "../canvas/canvas.module";
import { CreditsModule } from "../credits/credits.module";
import { GenerationsModule } from "../generations/generations.module";
import { ModelsModule } from "../models/models.module";
import { ScriptModule } from "../script/script.module";
import { TasksModule } from "../tasks/tasks.module";
import { AgentController } from "./agent.controller";
import { AgentChatService } from "./agent-chat.service";
import { AgentEventsService } from "./agent-events.service";
import { AgentMessagesService } from "./agent-messages.service";
import { AgentReplyService } from "./agent-reply.service";
import { AgentSessionsService } from "./agent-sessions.service";
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
 */
@Module({
  imports: [CreditsModule, GenerationsModule, ModelsModule, TasksModule, CanvasModule, ScriptModule],
  controllers: [AgentController, CanvasChatController],
  providers: [
    AgentEventsService,
    AgentSessionsService,
    AgentMessagesService,
    AgentStreamService,
    AgentReplyService,
    AgentChatService,
    AgentTaskService,
  ],
  exports: [AgentSessionsService, AgentMessagesService, AgentEventsService],
})
export class AgentModule {}
