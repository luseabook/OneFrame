import { Body, Controller, Delete, Get, Inject, Param, Post, Req } from "@nestjs/common";
import {
  AppError,
  ErrorCode,
  novelEditChatSchema,
  novelEditDecideAllSchema,
  novelEditDecideSchema,
  novelEditHeartbeatSchema,
  novelEditSessionCreateSchema,
} from "@app/shared";
import type { AuthedRequest } from "../../common/auth.types";
import { parseOrThrow } from "../../common/zod";
import { NovelAgentService } from "./novel-agent.service";
import { sessionSwitchSchema } from "./novel.schemas";

/**
 * 剧本编辑 Agent —— `/v1/novel/:ntId/script_edit_agent/*`。
 *
 * 路径与竞品逐条对齐（`rea-reelmate/routes.txt:570-600`）：
 * enter / exit / heartbeat / sessions(CRUD) / sessions/switch /
 * sessions/:sid/chat / abort / episodes/:neId/{pending,apply,reject} /
 * apply_all / reject_all / version/:vid/{finalize,delete}。
 *
 * 竞品把 `enter` 单列在 `:nt_id` 级，而 `exit/heartbeat/sessions/*` 在
 * `{nt_id}/script_edit_agent/*` 下 —— 两者最终指向同一控制器，故这里统一挂在
 * `novel/:ntId/script_edit_agent` 上（我方路径不出现两套前缀）。
 */
@Controller("novel/:ntId/script_edit_agent")
export class NovelAgentController {
  constructor(@Inject(NovelAgentService) private readonly agent: NovelAgentService) {}

  private ctx(req: AuthedRequest): { spaceId: string; userId: string } {
    const auth = req.auth;
    if (!auth) throw new AppError(ErrorCode.UNAUTHORIZED, "login required");
    return { spaceId: auth.spaceId, userId: auth.userId };
  }

  /** 进入编辑态（已有 ACTIVE 会话则复用，replayed=true） */
  @Post("enter")
  async enter(@Req() req: AuthedRequest, @Param("ntId") ntId: string, @Body() body: unknown) {
    const { spaceId, userId } = this.ctx(req);
    return this.agent.enter(spaceId, userId, ntId, parseOrThrow(novelEditSessionCreateSchema, body ?? {}));
  }

  /** 退出编辑态（关闭本人全部 ACTIVE 会话，并作废未确认 diff） */
  @Post("exit")
  async exit(@Req() req: AuthedRequest, @Param("ntId") ntId: string) {
    const { spaceId, userId } = this.ctx(req);
    return this.agent.exit(spaceId, userId, ntId);
  }

  /** 心跳（无 ACTIVE 会话 → 400101 no_active_session，不静默） */
  @Post("heartbeat")
  async heartbeat(@Req() req: AuthedRequest, @Param("ntId") ntId: string, @Body() body: unknown) {
    const { spaceId, userId } = this.ctx(req);
    return this.agent.heartbeat(spaceId, userId, ntId, parseOrThrow(novelEditHeartbeatSchema, body ?? {}));
  }

  /**
   * 编辑态探针（第 90 批；竞品 `GET /df/novel/:nt_id/script_edit_agent`）。
   *
   * 与 `heartbeat` 的分工：这是**只读**的"现在能不能编辑"，
   * 没有 ACTIVE 会话也回 200（`active:false`）；`heartbeat` 才是有副作用的续命。
   * 前端进入页面前调这条，避免用 400 当状态信号。
   */
  @Get()
  async state(@Req() req: AuthedRequest, @Param("ntId") ntId: string) {
    const { spaceId, userId } = this.ctx(req);
    return this.agent.state(spaceId, userId, ntId);
  }

  @Get("sessions")
  async listSessions(@Req() req: AuthedRequest, @Param("ntId") ntId: string) {
    const { spaceId } = this.ctx(req);
    return this.agent.listSessions(spaceId, ntId);
  }

  @Post("sessions")
  async createSession(@Req() req: AuthedRequest, @Param("ntId") ntId: string, @Body() body: unknown) {
    const { spaceId, userId } = this.ctx(req);
    return this.agent.createNewSession(spaceId, userId, ntId, parseOrThrow(novelEditSessionCreateSchema, body ?? {}));
  }

  @Post("sessions/switch")
  async switchSession(@Req() req: AuthedRequest, @Param("ntId") ntId: string, @Body() body: unknown) {
    const { spaceId } = this.ctx(req);
    return this.agent.switchSession(spaceId, ntId, parseOrThrow(sessionSwitchSchema, body ?? {}));
  }

  @Get("sessions/:sid")
  async getSession(@Req() req: AuthedRequest, @Param("ntId") ntId: string, @Param("sid") sid: string) {
    const { spaceId } = this.ctx(req);
    return this.agent.getSession(spaceId, ntId, sid);
  }

  /**
   * 对话（产出逐集 pending diff）。
   *
   * 同一会话并发两轮 → `746005 AGENT_TURN_IN_FLIGHT`（不是排队、不是静默丢弃）。
   */
  @Post("sessions/:sid/chat")
  async chat(
    @Req() req: AuthedRequest,
    @Param("ntId") ntId: string,
    @Param("sid") sid: string,
    @Body() body: unknown,
  ) {
    const { spaceId } = this.ctx(req);
    return this.agent.chat(spaceId, ntId, sid, parseOrThrow(novelEditChatSchema, body ?? {}));
  }

  /** 中止本轮（无在途轮次 → aborted:false + reason，不假装成功） */
  @Post("sessions/:sid/abort")
  async abort(@Req() req: AuthedRequest, @Param("ntId") ntId: string, @Param("sid") sid: string) {
    const { spaceId } = this.ctx(req);
    return this.agent.abort(spaceId, ntId, sid);
  }

  /** 某集待确认 diff（无 diff → pending:null，不是 404） */
  @Get("sessions/:sid/episodes/:neId/pending")
  async pending(
    @Req() req: AuthedRequest,
    @Param("ntId") ntId: string,
    @Param("sid") sid: string,
    @Param("neId") neId: string,
  ) {
    const { spaceId } = this.ctx(req);
    return this.agent.getPending(spaceId, ntId, sid, neId);
  }

  /** 应用某集：写正文 + 落版本 + pending 置 applied（重复 apply → 746002） */
  @Post("sessions/:sid/episodes/:neId/apply")
  async apply(
    @Req() req: AuthedRequest,
    @Param("ntId") ntId: string,
    @Param("sid") sid: string,
    @Param("neId") neId: string,
    @Body() body: unknown,
  ) {
    const { spaceId, userId } = this.ctx(req);
    return this.agent.apply(spaceId, userId, ntId, sid, neId, parseOrThrow(novelEditDecideSchema, body ?? {}));
  }

  /** 驳回某集：只改 pending 状态，正文一字节不动 */
  @Post("sessions/:sid/episodes/:neId/reject")
  async reject(
    @Req() req: AuthedRequest,
    @Param("ntId") ntId: string,
    @Param("sid") sid: string,
    @Param("neId") neId: string,
    @Body() body: unknown,
  ) {
    const { spaceId } = this.ctx(req);
    return this.agent.reject(spaceId, ntId, sid, neId, parseOrThrow(novelEditDecideSchema, body ?? {}));
  }

  @Post("sessions/:sid/apply_all")
  async applyAll(
    @Req() req: AuthedRequest,
    @Param("ntId") ntId: string,
    @Param("sid") sid: string,
    @Body() body: unknown,
  ) {
    const { spaceId, userId } = this.ctx(req);
    return this.agent.applyAll(spaceId, userId, ntId, sid, parseOrThrow(novelEditDecideAllSchema, body ?? {}));
  }

  @Post("sessions/:sid/reject_all")
  async rejectAll(
    @Req() req: AuthedRequest,
    @Param("ntId") ntId: string,
    @Param("sid") sid: string,
    @Body() body: unknown,
  ) {
    const { spaceId } = this.ctx(req);
    return this.agent.rejectAll(spaceId, ntId, sid, parseOrThrow(novelEditDecideAllSchema, body ?? {}));
  }

  /** 版本定稿（单集/整本版本行打 finalized_at；重复定稿幂等） */
  @Post("version/:vid/finalize")
  async finalizeVersion(@Req() req: AuthedRequest, @Param("ntId") ntId: string, @Param("vid") vid: string) {
    const { spaceId } = this.ctx(req);
    return this.agent.finalizeVersion(spaceId, ntId, vid);
  }

  /** 删除版本（删完重算该集 version，维持 episode.version == max(version_no)） */
  @Delete("version/:vid/delete")
  async deleteVersion(@Req() req: AuthedRequest, @Param("ntId") ntId: string, @Param("vid") vid: string) {
    const { spaceId } = this.ctx(req);
    return this.agent.deleteVersion(spaceId, ntId, vid);
  }
}
