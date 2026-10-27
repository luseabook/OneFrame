import { Module } from "@nestjs/common";
import { WorkflowController } from "./workflow.controller";
import { WorkflowService } from "./workflow.service";
import { TeamModule } from "../team/team.module";

/**
 * 工作流阶段机域（模块 #9 CLI/MCP 外延的服务端配套）。
 *
 * 只提供 `GET /v1/workflow/detect` 一个只读端点：阶段判定必须由服务端基于真实
 * 数据算（竞品 `commands/workflow.md:5`「阶段判定由 CLI 完成，不要凭对话记忆推断」，
 * 我方把判定下沉到服务端，CLI 只渲染，避免客户端各自实现一套口径）。
 *
 * 依赖 TeamModule 只为了复用 `requireMember`（非成员 403）。
 */
@Module({
  imports: [TeamModule],
  controllers: [WorkflowController],
  providers: [WorkflowService],
  exports: [WorkflowService],
})
export class WorkflowModule {}
