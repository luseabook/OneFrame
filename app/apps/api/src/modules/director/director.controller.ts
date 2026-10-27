import { Body, Controller, Delete, Get, Inject, Param, Post, Put, Query, Req } from "@nestjs/common";
import { z } from "zod";
import { AppError, ErrorCode } from "@app/shared";
import type { AuthedRequest } from "../../common/auth.types";
import { parseOrThrow } from "../../common/zod";
import { DirectorService } from "./director.service";

/**
 * 3D 导演台端点（`/v1/director/*`）—— 对照参照站 director 域 8 个操作。
 *
 * 路径按资源划分（scenes / pose-presets / heartbeat），不照抄竞品把动作塞进
 * `director/save`、`director/info` 这种动词式路径（ADR-009：协议自研，保留域名）。
 * 权限：登录（全局 AuthGuard）+ 是 space 成员（每个方法先 `requireMember`，非成员 403）。
 *
 * payload 的语义由前端编辑器定义，这里只做形状（对象）与大小上限校验，
 * 详见 `director.service.ts` 顶部注释。
 */

/** payload 只要求是「对象」；具体字段由编辑器决定，服务端不解析（见 service 注释） */
const payloadSchema = z.record(z.unknown());

const createSceneBody = z.object({
  project_id: z.string().min(1).optional(),
  episode_id: z.string().min(1).optional(),
  name: z.string().min(1).max(60).optional(),
  payload: payloadSchema,
  thumbnail_uri: z.string().max(2048).nullish(),
});

const updateSceneBody = z.object({
  /** 乐观锁：客户端必须回传读到的版本 */
  version: z.number().int().min(1),
  name: z.string().min(1).max(60).optional(),
  payload: payloadSchema.optional(),
  thumbnail_uri: z.string().max(2048).nullish(),
});

const listQuery = z.object({
  project_id: z.string().min(1).optional(),
  episode_id: z.string().min(1).optional(),
  page: z.coerce.number().int().min(1).optional(),
  page_size: z.coerce.number().int().min(1).max(100).optional(),
});

const duplicateBody = z.object({ name: z.string().min(1).max(60).optional() }).default({});

const presetBody = z.object({
  name: z.string().min(1).max(60),
  payload: payloadSchema,
  /** 1 个人 / 2 团队共享 */
  scope: z.number().int().min(1).max(2).optional(),
});

const presetQuery = z.object({ scope: z.coerce.number().int().min(1).max(2).optional() });

const heartbeatBody = z.object({ scene_id: z.string().min(1) });

@Controller("director")
export class DirectorController {
  constructor(@Inject(DirectorService) private readonly director: DirectorService) {}

  private async ctx(req: AuthedRequest) {
    const auth = req.auth;
    if (!auth) throw new AppError(ErrorCode.UNAUTHORIZED, "login required");
    const member = await this.director.requireMember(auth.spaceId, auth.userId);
    return { spaceId: member.spaceId, userId: member.userId };
  }

  /** 1. 保存场景（新场景，version 从 1 起） */
  @Post("scenes")
  async create(@Req() req: AuthedRequest, @Body() body: unknown) {
    const c = await this.ctx(req);
    return this.director.createScene(c.spaceId, c.userId, parseOrThrow(createSceneBody, body));
  }

  /** 2. 场景列表（按项目/剧集筛，最近编辑优先，带缩略图） */
  @Get("scenes")
  async list(@Req() req: AuthedRequest, @Query() query: unknown) {
    const c = await this.ctx(req);
    const q = parseOrThrow(listQuery, query ?? {});
    return this.director.listScenes(c.spaceId, {
      project_id: q.project_id,
      episode_id: q.episode_id,
      page: q.page ?? 1,
      page_size: q.page_size ?? 20,
    });
  }

  /** 3. 读单个场景（软删后 404） */
  @Get("scenes/:id")
  async detail(@Req() req: AuthedRequest, @Param("id") id: string) {
    const c = await this.ctx(req);
    return this.director.getScene(c.spaceId, id);
  }

  /** 4. 更新场景（乐观锁；版本不一致 → 746002 且 msg 里带 current=N） */
  @Put("scenes/:id")
  async update(@Req() req: AuthedRequest, @Param("id") id: string, @Body() body: unknown) {
    const c = await this.ctx(req);
    return this.director.updateScene(c.spaceId, id, parseOrThrow(updateSceneBody, body));
  }

  /** 5. 软删（删后 GET/PUT/duplicate 一律 404） */
  @Delete("scenes/:id")
  async remove(@Req() req: AuthedRequest, @Param("id") id: string) {
    const c = await this.ctx(req);
    return this.director.deleteScene(c.spaceId, id);
  }

  /** 6. 复制场景（新场景 version=1，快照与缩略图一并复制） */
  @Post("scenes/:id/duplicate")
  async duplicate(@Req() req: AuthedRequest, @Param("id") id: string, @Body() body: unknown) {
    const c = await this.ctx(req);
    const input = parseOrThrow(duplicateBody, body ?? {});
    return this.director.duplicateScene(c.spaceId, c.userId, id, input.name);
  }

  /** 7a. 保存姿态预设 */
  @Post("pose-presets")
  async createPreset(@Req() req: AuthedRequest, @Body() body: unknown) {
    const c = await this.ctx(req);
    return this.director.createPreset(c.spaceId, c.userId, parseOrThrow(presetBody, body));
  }

  /** 7b. 姿态预设列表（团队共享 + 我的个人预设） */
  @Get("pose-presets")
  async presets(@Req() req: AuthedRequest, @Query() query: unknown) {
    const c = await this.ctx(req);
    const q = parseOrThrow(presetQuery, query ?? {});
    return this.director.listPresets(c.spaceId, c.userId, q.scope);
  }

  /** 8. 编辑心跳（Redis TTL 60s；返回除自己之外的协作者） */
  @Post("heartbeat")
  async heartbeat(@Req() req: AuthedRequest, @Body() body: unknown) {
    const c = await this.ctx(req);
    const input = parseOrThrow(heartbeatBody, body);
    return this.director.heartbeat(c.spaceId, c.userId, input.scene_id);
  }
}
