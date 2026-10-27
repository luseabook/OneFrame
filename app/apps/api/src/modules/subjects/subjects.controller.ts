import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, Query, Req } from "@nestjs/common";
import { z } from "zod";
import { AppError, ErrorCode } from "@app/shared";
import type { AuthedRequest } from "../../common/auth.types";
import { parseOrThrow } from "../../common/zod";
import { TeamService } from "../team/team.service";
import { SubjectsService } from "./subjects.service";

/**
 * 主体库（subject）端点 —— 对照竞品 `subject` 子命令族（`cmd/subject.md`）。
 *
 * 路径说明：本域按功能划分挂在 `/subjects`（ADR-009 保留域划分便于逐条核对）；
 * 竞品用的是 `df/subject/resource*` 与 `asset/actor/list`，两套 ID 不混用
 * （`cmd/subject.md:268-274`）。
 */

const kindSchema = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal("character"),
  z.literal("scene"),
  z.literal("prop"),
]);

const KINDS: Record<string, number> = { character: 1, scene: 2, prop: 3 };

const fileInputSchema = z.object({
  uri: z.string().min(1).max(500),
  role: z.number().int().min(1).max(5).optional(),
  sort: z.number().int().min(0).max(999).optional(),
  asset_id: z.string().min(1).optional(),
});

const listQuerySchema = z.object({
  kind: kindSchema.optional(),
  review_status: z.coerce.number().int().min(1).max(3).optional(),
  project_id: z.string().min(1).optional(),
  q: z.string().max(80).optional(),
  page: z.coerce.number().int().min(1).optional(),
  page_size: z.coerce.number().int().min(1).max(100).optional(),
});

const createSchema = z.object({
  name: z.string().min(1).max(80),
  kind: kindSchema.optional(),
  desc: z.string().max(1000).nullish(),
  cover_uri: z.string().max(500).nullish(),
  project_id: z.string().min(1).nullish(),
  business_list: z.array(z.number().int().min(0).max(99)).min(1).max(20).optional(),
  tags: z.array(z.string().max(30)).max(20).optional(),
  files: z.array(fileInputSchema).max(20).optional(),
});

const patchSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  kind: kindSchema.optional(),
  desc: z.string().max(1000).nullish(),
  cover_uri: z.string().max(500).nullish(),
  project_id: z.string().min(1).nullish(),
  business_list: z.array(z.number().int().min(0).max(99)).min(1).max(20).optional(),
  tags: z.array(z.string().max(30)).max(20).optional(),
  review_status: z.number().int().min(1).max(3).optional(),
  reject_reason: z.string().max(500).nullish(),
  files: z.array(fileInputSchema).max(20).optional(),
  remove_file_ids: z.array(z.string().min(1)).max(50).optional(),
});

const fromAssetSchema = z.object({
  project_id: z.string().min(1),
  asset_id: z.string().min(1),
  name: z.string().min(1).max(80).optional(),
  /** 用户选中的生成记录（竞品 `generate_id`）；只校验存在性，不改写原资产 */
  generate_id: z.string().min(1).optional(),
  /** 竞品 `subject_type` 0..5（角色=1） */
  subject_type: z.number().int().min(0).max(5).optional(),
  files: z.array(z.union([z.string().min(1).max(500), fileInputSchema])).max(20).optional(),
  business_list: z.array(z.number().int().min(0).max(99)).min(1).max(20).optional(),
  src_subject_id: z.string().min(1).optional(),
  mate_data: z.record(z.string(), z.unknown()).optional(),
});

const statusQuerySchema = z.object({
  /** 竞品 `business_ids`（subject.md:220）；我方接受 subject id 与 business id 同形 */
  subject_ids: z.array(z.string().min(1)).min(1).max(100),
});

function toKind(value: number | string | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "number") return value;
  return KINDS[value];
}

@Controller("subjects")
export class SubjectsController {
  constructor(
    @Inject(SubjectsService) private readonly subjects: SubjectsService,
    @Inject(TeamService) private readonly team: TeamService,
  ) {}

  /** 权限闸门：非该 space 成员一律 403（不泄露主体是否存在） */
  private async ctx(req: AuthedRequest) {
    const auth = req.auth;
    if (!auth) throw new AppError(ErrorCode.UNAUTHORIZED, "login required");
    return this.team.requireMember(auth.spaceId, auth.userId);
  }

  /** 1. 列表：按 kind / 审核态 / 项目筛（竞品 `subject list`，subject.md:38-52） */
  @Get()
  async list(@Req() req: AuthedRequest, @Query() query: unknown) {
    const m = await this.ctx(req);
    const q = parseOrThrow(listQuerySchema, query ?? {});
    return this.subjects.list(m.spaceId, { ...q, kind: toKind(q.kind) });
  }

  /** 2. 详情（竞品 `subject get`，subject.md:108-122） */
  @Get(":id")
  async detail(@Req() req: AuthedRequest, @Param("id") id: string) {
    const m = await this.ctx(req);
    return this.subjects.detail(m.spaceId, id);
  }

  /** 3. 新建（竞品 `subject create`，subject.md:54-71；必填只有 name，其余透传） */
  @Post()
  async create(@Req() req: AuthedRequest, @Body() body: unknown) {
    const m = await this.ctx(req);
    const input = parseOrThrow(createSchema, body);
    return this.subjects.create(m.spaceId, m.userId, { ...input, kind: toKind(input.kind) });
  }

  /**
   * 4. 从项目资产保存为主体（`save-from-resource`，subject.md:73-106）：
   * 绑定原资产、**不新建资产**；同一资产重复保存幂等返回既有主体。
   */
  @Post("from-asset")
  async fromAsset(@Req() req: AuthedRequest, @Body() body: unknown) {
    const m = await this.ctx(req);
    const input = parseOrThrow(fromAssetSchema, body);
    return this.subjects.fromAsset(m.spaceId, m.userId, input);
  }

  /** 5. 批量审核状态（竞品 `subject status`，subject.md:200-226；三态 + 驳回 retryable=false） */
  @Post("status")
  async status(@Req() req: AuthedRequest, @Body() body: unknown) {
    const m = await this.ctx(req);
    const input = parseOrThrow(statusQuerySchema, body);
    // assertApproved 在未过审时抛 400105；这里要的是「逐条状态」而不是整体拒绝，故逐条查
    const items: Array<{ subject_id: string; status: string; retryable: boolean; reject_reason: string | null }> = [];
    for (const id of input.subject_ids) {
      try {
        const row = await this.subjects.detail(m.spaceId, id);
        items.push({
          subject_id: row.id,
          status: row.review_status_name,
          retryable: row.retryable,
          reject_reason: row.reject_reason,
        });
      } catch (error) {
        if (error instanceof AppError && error.code === ErrorCode.NOT_FOUND) {
          // 找不到已知状态字段时标 unknown，**不默认当 approved**（subject.md:216）
          items.push({ subject_id: id, status: "unknown", retryable: false, reject_reason: null });
          continue;
        }
        throw error;
      }
    }
    return { items };
  }

  /** 6. 修改（竞品 `subject edit`；审核态也走这里：1 审核中 / 2 通过 / 3 驳回） */
  @Patch(":id")
  async patch(@Req() req: AuthedRequest, @Param("id") id: string, @Body() body: unknown) {
    const m = await this.ctx(req);
    const input = parseOrThrow(patchSchema, body);
    return this.subjects.patch(m.spaceId, id, { ...input, kind: toKind(input.kind) });
  }

  /** 7. 删除（软删；列表/生成侧一律过滤） */
  @Delete(":id")
  async remove(@Req() req: AuthedRequest, @Param("id") id: string) {
    const m = await this.ctx(req);
    return this.subjects.remove(m.spaceId, id);
  }
}
