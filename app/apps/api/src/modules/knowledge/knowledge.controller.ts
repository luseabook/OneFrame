import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, Query, Req } from "@nestjs/common";
import { z } from "zod";
import { AppError, ErrorCode } from "@app/shared";
import type { AuthedRequest } from "../../common/auth.types";
import { parseOrThrow } from "../../common/zod";
import { KnowledgeService } from "./knowledge.service";

/**
 * 团队知识库（`user_knowledge`，29 端点）控制器 —— 对照 `routes.txt:737-765`。
 *
 * 路径映射（ADR-009：保留竞品路径形状便于 1:1 核对，只把 `/web/v1/df/user_knowledge`
 * 收敛成 `/v1/knowledge`）：
 * | 竞品（routes.txt） | 我方 |
 * |---|---|
 * | `dir`(:741) / `dir/list`(:755) | `POST /knowledge/dirs` / `GET /knowledge/dirs` |
 * | `dir/:ukd_id/name`(:750) | `PATCH /knowledge/dirs/:id` |
 * | `dir/{ukd_id}/move`(:756) | `POST /knowledge/dirs/:id/move` |
 * | `dir/:ukd_id/delete`(:749) | `DELETE /knowledge/dirs/:id`（级联软删子树） |
 * | `tag`(:761) / `tag/list`(:762) / `tag/{tag_id}/name`(:764) / `delete`(:763) | tags CRUD 4 条 |
 * | `dir/:ukd_id/asset/list`(:746) | `GET /knowledge/assets?dir_id=` |
 * | `asset/search`(:737) | `GET /knowledge/assets/search` |
 * | `dir/:ukd_id/asset/import`(:745) | `POST /knowledge/assets` |
 * | `dir/:ukd_id/asset/:uk_id/name`(:743) | `PATCH /knowledge/assets/:id` |
 * | `dir/:ukd_id/asset/:uk_id/delete`(:742) | `DELETE /knowledge/assets/:id` |
 * | `asset/{uk_id}/tag`(:738) | `PATCH /knowledge/assets/:id/tags` |
 * | `dir/:ukd_id/asset/resource/import`(:744) | `POST /knowledge/assets/import-from-asset` |
 * | `dir/:ukd_id/asset/resources`(:748) | `POST /knowledge/assets/:id/to-asset` |
 * | `dir/:ukd_id/asset/resource/delete`(:747) | `DELETE /knowledge/assets/:id/resource` |
 * | `dir/asset/batch-*`(:751-754) | 4 条 batch |
 * | `info`(:757) / `list`(:759) / `scriptwriter/list`(:760) | 3 条 |
 *
 * 不做的 4 条：`create`(:739) / `delete`(:740) / `update`(:765) / `info/update`(:758)——
 * 它们是"知识库实体"CRUD，我方无该表（详见 service 顶部说明），**不造假端点**。
 */

const pageQuery = z.object({
  page: z.coerce.number().int().min(1).optional(),
  page_size: z.coerce.number().int().min(1).max(100).optional(),
});

/** 标签既可 `?tags=a&tags=b` 也可 `?tags=a,b`（前端两种都常见） */
const tagsQuery = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .transform((v) => {
    if (v === undefined) return undefined;
    const arr = Array.isArray(v) ? v : v.split(",");
    return arr.map((s) => s.trim()).filter((s) => s.length > 0);
  });

const dirCreateBody = z.object({
  name: z.string().trim().min(1).max(60),
  parent_id: z.string().min(1).max(32).optional(),
  sort: z.number().int().min(0).max(9999).optional(),
});

const dirPatchBody = z.object({
  name: z.string().trim().min(1).max(60),
  sort: z.number().int().min(0).max(9999).optional(),
});

const dirMoveBody = z.object({
  parent_id: z.string().min(1).max(32).nullable().optional(),
  sort: z.number().int().min(0).max(9999).optional(),
});

const tagBody = z.object({ name: z.string().trim().min(1).max(40) });

const assetCreateBody = z.object({
  title: z.string().trim().min(1).max(200),
  content: z.string().max(200_000).optional(),
  dir_id: z.string().min(1).max(32).optional(),
  tags: z.array(z.string().min(1).max(40)).max(20).optional(),
  /** 1 文本 / 3 链接；2 资产引用必须走 import-from-asset */
  source_type: z.union([z.literal(1), z.literal(3)]).optional(),
});

const assetPatchBody = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  content: z.string().max(200_000).optional(),
  dir_id: z.string().min(1).max(32).nullable().optional(),
  tags: z.array(z.string().min(1).max(40)).max(20).optional(),
});

const assetTagsBody = z.object({ tags: z.array(z.string().min(1).max(40)).max(20) });

const assetMoveBody = z.object({ dir_id: z.string().min(1).max(32).nullable().optional() });

const importBody = z.object({
  asset_id: z.string().min(1).max(32),
  dir_id: z.string().min(1).max(32).optional(),
  title: z.string().trim().min(1).max(200).optional(),
  tags: z.array(z.string().min(1).max(40)).max(20).optional(),
});

const attachResourceBody = z.object({ asset_id: z.string().min(1).max(32) });

const batchIdsBody = z.object({ ids: z.array(z.string().min(1).max(32)).min(1).max(200) });
const batchTagsBody = batchIdsBody.extend({ tags: z.array(z.string().min(1).max(40)).min(1).max(20) });
const batchMoveBody = batchIdsBody.extend({ dir_id: z.string().min(1).max(32).nullable().optional() });

function requireAuth(req: AuthedRequest) {
  const auth = req.auth;
  if (!auth) throw new AppError(ErrorCode.UNAUTHORIZED, "login required");
  return auth;
}

@Controller("knowledge")
export class KnowledgeController {
  constructor(@Inject(KnowledgeService) private readonly knowledge: KnowledgeService) {}

  // ── 目录树（5）─────────────────────────────────────────

  /** 1. 目录树（rt:755） */
  @Get("dirs")
  dirs(@Req() req: AuthedRequest) {
    return this.knowledge.dirTree(requireAuth(req));
  }

  /** 2. 建目录（rt:741）：深度 ≤ 5 */
  @Post("dirs")
  createDir(@Req() req: AuthedRequest, @Body() body: unknown) {
    return this.knowledge.createDir(requireAuth(req), parseOrThrow(dirCreateBody, body ?? {}));
  }

  /** 3. 改名（rt:750） */
  @Patch("dirs/:id")
  renameDir(@Req() req: AuthedRequest, @Param("id") id: string, @Body() body: unknown) {
    return this.knowledge.renameDir(requireAuth(req), id, parseOrThrow(dirPatchBody, body ?? {}));
  }

  /** 4. 移动（rt:756）：拒绝成环、拒绝超过 5 层 */
  @Post("dirs/:id/move")
  moveDir(@Req() req: AuthedRequest, @Param("id") id: string, @Body() body: unknown) {
    return this.knowledge.moveDir(requireAuth(req), id, parseOrThrow(dirMoveBody, body ?? {}));
  }

  /** 5. 删目录（rt:749）：**级联软删**子树与子树内资产 */
  @Delete("dirs/:id")
  deleteDir(@Req() req: AuthedRequest, @Param("id") id: string) {
    return this.knowledge.deleteDir(requireAuth(req), id);
  }

  // ── 标签（5）───────────────────────────────────────────

  /** 6. 标签列表（rt:762） */
  @Get("tags")
  tags(@Req() req: AuthedRequest) {
    return this.knowledge.listTags(requireAuth(req));
  }

  /** 7. 建标签（rt:761）：同名幂等 */
  @Post("tags")
  createTag(@Req() req: AuthedRequest, @Body() body: unknown) {
    return this.knowledge.createTag(requireAuth(req), parseOrThrow(tagBody, body ?? {}));
  }

  /** 8. 标签改名（rt:764）：同步改写资产上的标签文本 */
  @Patch("tags/:id")
  renameTag(@Req() req: AuthedRequest, @Param("id") id: string, @Body() body: unknown) {
    return this.knowledge.renameTag(requireAuth(req), id, parseOrThrow(tagBody, body ?? {}));
  }

  /** 9. 删标签（rt:763）：同步从资产标签数组摘掉 */
  @Delete("tags/:id")
  deleteTag(@Req() req: AuthedRequest, @Param("id") id: string) {
    return this.knowledge.deleteTag(requireAuth(req), id);
  }

  /** 10. 按标签查资产（我方补充，见 service 说明） */
  @Get("tags/:id/assets")
  assetsByTag(@Req() req: AuthedRequest, @Param("id") id: string, @Query() query: unknown) {
    return this.knowledge.assetsByTag(requireAuth(req), id, parseOrThrow(pageQuery, query ?? {}));
  }

  // ── 资产（9）───────────────────────────────────────────

  /** 11. 资产列表（rt:746）：按目录（可含子目录）/标签/类型过滤 */
  @Get("assets")
  assets(@Req() req: AuthedRequest, @Query() query: unknown) {
    const q = parseOrThrow(
      pageQuery.extend({
        dir_id: z.string().min(1).max(32).optional(),
        include_children: z.coerce.boolean().optional(),
        tags: tagsQuery,
        source_type: z.coerce.number().int().min(1).max(3).optional(),
      }),
      query ?? {},
    );
    return this.knowledge.listAssets(requireAuth(req), q);
  }

  /** 12. 搜索（rt:737）：跨目录关键词 + 标签 */
  @Get("assets/search")
  search(@Req() req: AuthedRequest, @Query() query: unknown) {
    const q = parseOrThrow(
      pageQuery.extend({
        keyword: z.string().max(100).optional(),
        tags: tagsQuery,
        dir_id: z.string().min(1).max(32).optional(),
        source_type: z.coerce.number().int().min(1).max(3).optional(),
      }),
      query ?? {},
    );
    return this.knowledge.searchAssets(requireAuth(req), q);
  }

  /** 13. 新建条目（rt:745）：文本/链接 */
  @Post("assets")
  createAsset(@Req() req: AuthedRequest, @Body() body: unknown) {
    return this.knowledge.createAsset(requireAuth(req), parseOrThrow(assetCreateBody, body ?? {}));
  }

  // 注意：批量与导入路由必须**排在** `assets/:id` 之前声明，
  // 否则 `assets/batch-delete` 会被 `:id` 抢先匹配（Fastify 静态优先，但显式排序更稳）
  /** 14. 批量加标签（rt:751） */
  @Post("assets/batch-add-tags")
  batchAddTags(@Req() req: AuthedRequest, @Body() body: unknown) {
    return this.knowledge.batchAddTags(requireAuth(req), parseOrThrow(batchTagsBody, body ?? {}));
  }

  /** 15. 批量去标签（rt:754） */
  @Post("assets/batch-remove-tags")
  batchRemoveTags(@Req() req: AuthedRequest, @Body() body: unknown) {
    return this.knowledge.batchRemoveTags(requireAuth(req), parseOrThrow(batchTagsBody, body ?? {}));
  }

  /** 16. 批量移动（rt:753） */
  @Post("assets/batch-move")
  batchMove(@Req() req: AuthedRequest, @Body() body: unknown) {
    return this.knowledge.batchMove(requireAuth(req), parseOrThrow(batchMoveBody, body ?? {}));
  }

  /** 17. 批量删除（rt:752）：软删 */
  @Post("assets/batch-delete")
  batchDelete(@Req() req: AuthedRequest, @Body() body: unknown) {
    return this.knowledge.batchDelete(requireAuth(req), parseOrThrow(batchIdsBody, body ?? {}));
  }

  /** 18. 从资产库导入（rt:744/745）：**必须同 space** */
  @Post("assets/import-from-asset")
  importFromAsset(@Req() req: AuthedRequest, @Body() body: unknown) {
    return this.knowledge.importFromAsset(requireAuth(req), parseOrThrow(importBody, body ?? {}));
  }

  /** 19. 单条详情 */
  @Get("assets/:id")
  assetDetail(@Req() req: AuthedRequest, @Param("id") id: string) {
    return this.knowledge.assetDetail(requireAuth(req), id);
  }

  /** 20. 编辑（rt:743） */
  @Patch("assets/:id")
  patchAsset(@Req() req: AuthedRequest, @Param("id") id: string, @Body() body: unknown) {
    return this.knowledge.patchAsset(requireAuth(req), id, parseOrThrow(assetPatchBody, body ?? {}));
  }

  /** 21. 删除（rt:742）：软删 */
  @Delete("assets/:id")
  deleteAsset(@Req() req: AuthedRequest, @Param("id") id: string) {
    return this.knowledge.deleteAsset(requireAuth(req), id);
  }

  /** 22. 设置标签（rt:738）：整体替换 */
  @Patch("assets/:id/tags")
  setTags(@Req() req: AuthedRequest, @Param("id") id: string, @Body() body: unknown) {
    return this.knowledge.setAssetTags(requireAuth(req), id, parseOrThrow(assetTagsBody, body ?? {}));
  }

  /** 23. 单条移动 */
  @Post("assets/:id/move")
  moveAsset(@Req() req: AuthedRequest, @Param("id") id: string, @Body() body: unknown) {
    return this.knowledge.moveAsset(requireAuth(req), id, parseOrThrow(assetMoveBody, body ?? {}));
  }

  /** 24. 导出到资产库（rt:748）：仅 source_type=2，且**必须同 space** */
  @Post("assets/:id/to-asset")
  toAsset(@Req() req: AuthedRequest, @Param("id") id: string) {
    return this.knowledge.exportToAsset(requireAuth(req), id);
  }

  /** 25. 挂/换资产引用（rt:744） */
  @Post("assets/:id/resource/import")
  attachResource(@Req() req: AuthedRequest, @Param("id") id: string, @Body() body: unknown) {
    return this.knowledge.attachResource(requireAuth(req), id, parseOrThrow(attachResourceBody, body ?? {}));
  }

  /** 26. 解除资产引用（rt:747） */
  @Delete("assets/:id/resource")
  detachResource(@Req() req: AuthedRequest, @Param("id") id: string) {
    return this.knowledge.detachResource(requireAuth(req), id);
  }

  // ── 概览 / 平铺 / 创建人（3）────────────────────────────

  /** 27. 知识库概览（rt:757） */
  @Get("info")
  info(@Req() req: AuthedRequest) {
    return this.knowledge.info(requireAuth(req));
  }

  /** 28. 平铺列表（rt:759）：跨目录，按更新时间/创建时间 */
  @Get("list")
  list(@Req() req: AuthedRequest, @Query() query: unknown) {
    return this.knowledge.flatList(
      requireAuth(req),
      parseOrThrow(pageQuery.extend({ sort: z.enum(["created", "updated"]).optional() }), query ?? {}),
    );
  }

  /** 29. 创建人聚合（rt:760 `scriptwriter/list`） */
  @Get("scriptwriter/list")
  scriptwriters(@Req() req: AuthedRequest) {
    return this.knowledge.scriptwriterList(requireAuth(req));
  }
}
