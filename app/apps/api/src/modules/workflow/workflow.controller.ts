import { Controller, Get, Inject, Query, Req } from "@nestjs/common";
import { z } from "zod";
import type { AuthedRequest } from "../../common/auth.types";
import { parseOrThrow } from "../../common/zod";
import { WorkflowService } from "./workflow.service";

/**
 * 工作流阶段探测（只读）。
 *
 * `GET /v1/workflow/detect?scope=studio|canvas&project_id=&canvas_id=`
 *
 * 路由与参数对齐竞品 `commands/workflow.md:105-114`（`--scope` / `--workspace` /
 * `--canvas`）。我方 `--workspace` 的语义是 script_projects.id，所以查询参数叫
 * `project_id`（与 project_id 一致的内部命名），CLI 负责把 `--workspace` 映射过来。
 *
 * 为什么是独立 `workflow` 模块而不塞进 script/canvas：
 * 本端点跨域只读（script_projects + episodes + project_assets + storyboards +
 * canvases + canvas_nodes），塞进任何一侧都会让该侧反向依赖另一侧，违反 ADR-009
 * 的域边界。独立模块只有只读查询，不持有任何写逻辑。
 */
@Controller("workflow")
export class WorkflowController {
  constructor(@Inject(WorkflowService) private readonly workflow: WorkflowService) {}

  /** 只读探测当前创作阶段；缺项通过 data.missing 表达，不是错误（workflow.md:154） */
  @Get("detect")
  async detect(
    @Req() req: AuthedRequest,
    @Query("scope") scope?: string,
    @Query("project_id") projectId?: string,
    @Query("canvas_id") canvasId?: string,
  ) {
    const query = parseOrThrow(
      z.object({
        scope: z.enum(["studio", "canvas"]).optional(),
        project_id: z.string().min(1).max(40).optional(),
        canvas_id: z.string().min(1).max(40).optional(),
      }),
      { scope, project_id: projectId, canvas_id: canvasId },
    );
    return this.workflow.detect(req.auth?.spaceId ?? "", req.auth?.userId ?? "", query);
  }
}
