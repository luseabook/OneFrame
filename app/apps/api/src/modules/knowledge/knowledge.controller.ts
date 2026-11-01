import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, Query, Req } from "@nestjs/common";
import { z } from "zod";
import { AppError, ErrorCode } from "@app/shared";
import type { AuthedRequest } from "../../common/auth.types";
import { parseOrThrow } from "../../common/zod";
import {
  MAX_TAG_ITEMS,
  csvListRaw,
  csvListQuery,
  splitCsvList,
  tooManyListItems,
} from "../../common/list-param";
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
 * | `create`(:739) / `update`(:765) / `info/update`(:758) / `delete`(:740) | 第 59 批：`GET/POST /knowledge/base`、`POST /knowledge/base/update`、`POST /knowledge/base/info/update`、`POST /knowledge/base/delete` |
 *
 * ## 第 59 批纠正的一处误判
 * 原注释把这 4 条记成"知识库实体 CRUD，我方无该表 → 不做（不造假端点）"，
 * 理由是"竞品支持一个空间建多个库"。复核 `routes.txt` 后这理由不成立：这 4 条
 * 端点**都没有路径 id**（同文件的目录端点都带 `dir/:ukd_id`、资产端点都带
 * `asset/{uk_id}`）。要改/删"多个库中的某一个"必须有 id → 没有 id 只能解释为
 * **当前空间唯一的那个库**。所以竞品语义就是「一 team 一库」，我方缺的是这一库
 * 的元数据没落库。第 59 批补 `knowledge_bases` 表 + 5 条端点（含一条我方自加的
 * `GET /knowledge/base`，理由见该方法注释），字段名按我方口径自定、已标待取证。
 */

const pageQuery = z.object({
  page: z.coerce.number().int().min(1).optional(),
  page_size: z.coerce.number().int().min(1).max(100).optional(),
});

/**
 * 模板场景过滤（第 60 批）。合法值校验在 service 里做（`normalizeScene`），
 * 因为非法值要返回 `400101 + field:"scene"`，而 zod 的 enum 报错形状与其它参数不一致。
 * 这里只做类型收敛，避免 `?scene=abc` 变成 NaN 后静默查出空列表。
 */
const sceneQuery = z.object({ scene: z.coerce.number().int().optional() });

/** 目录树只收 scene（竞品该端点 query 为 scene + parent_ukd_id，后者由树结构自身表达） */
const dirQuery = sceneQuery;

/**
 * 标签既可 `?tags=a&tags=b` 也可 `?tags=a,b`（前端两种都常见）。
 * 第 120 批：项数上限与正文 `tags` 的 `.max(20)` 对齐 —— 同一语义不能两个入口两个尺度。
 */
const tagsQuery = csvListQuery("tags", MAX_TAG_ITEMS);

/**
 * 第 75 批：竞品知识库列表请求里的 `sp_type` 是**数组**（`C-jRJshu.js` @10127：
 * `sp_type: [-1, 1, 2, 3]`），故这里支持 `?sp_type=1&sp_type=2` 与 `?sp_type=1,2` 两种写法。
 *
 * 不校验取值集合（只校验整数范围）：竞品自己也在变（-1 是"通用"这一层语义也只在它前端出现），
 * 我方把它当透传维度 —— 硬编码枚举会把竞品新增的类型直接打成 400。
 */
// 第 120 批：union 形状收进 `common/list-param.ts`（全局只有一处），项数上限照旧。
const spTypeQuery = csvListRaw
  .optional()
  .transform((v, ctx) => {
    if (v === undefined) return undefined;
    const parts = splitCsvList(v);
    if (parts.length > MAX_TAG_ITEMS) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: tooManyListItems("sp_type", MAX_TAG_ITEMS) });
      return z.NEVER;
    }
    const out: number[] = [];
    for (const part of parts) {
      if (!/^-?\d{1,5}$/.test(part)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `invalid sp_type: ${part}` });
        return z.NEVER;
      }
      const n = Number(part);
      if (n < -1 || n > 32767) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `invalid sp_type: ${part}` });
        return z.NEVER;
      }
      out.push(n);
    }
    return out;
  });

const dirCreateBody = z.object({
  name: z.string().trim().min(1).max(60),
  parent_id: z.string().min(1).max(32).optional(),
  sort: z.number().int().min(0).max(9999).optional(),
  /** 模板场景（第 60 批）；有 parent_id 时以父目录场景为准 */
  scene: z.number().int().optional(),
});

const dirPatchBody = z.object({
  name: z.string().trim().min(1).max(60),
  sort: z.number().int().min(0).max(9999).optional(),
});

const dirMoveBody = z.object({
  parent_id: z.string().min(1).max(32).nullable().optional(),
  sort: z.number().int().min(0).max(9999).optional(),
});

const tagBody = z.object({
  name: z.string().trim().min(1).max(40),
  /** 模板场景（第 60 批）：标签按场景隔离，同名标签可在不同场景各存一份 */
  scene: z.number().int().optional(),
});

const assetCreateBody = z.object({
  title: z.string().trim().min(1).max(200),
  content: z.string().max(200_000).optional(),
  dir_id: z.string().min(1).max(32).optional(),
  tags: z.array(z.string().min(1).max(40)).max(20).optional(),
  /** 模板场景（第 60 批）。注意每类场景对 title/content 的上限与必填不同，
   *  这里给的是**绝对上限**，按场景收窄在 service 的 `validateKnowledgeSceneFields` 里做。 */
  scene: z.number().int().optional(),
  /** 1 文本 / 3 链接；2 资产引用必须走 import-from-asset */
  source_type: z.union([z.literal(1), z.literal(3)]).optional(),
  // ── 第 75 批：竞品条目级字段（`ArT8U6Tg.js` 的 payload builder 逐字）──────
  /** 竞品 `cover_file`；不传则读时回落 `image_asset_ids[0]` */
  cover_asset_id: z.string().min(1).max(20).nullable().optional(),
  /** 竞品 `image_files`；上限 20 与其它素材数组同量级（竞品未给上限）。
   *  上限/下限都自写 message：zod 默认文案不含字段名，CLI/agent 看不出是哪个参数错。 */
  image_asset_ids: z
    .array(z.string().min(1).max(20), { invalid_type_error: "image_asset_ids must be an array of asset ids" })
    .max(20, "image_asset_ids must contain at most 20 ids")
    .optional(),
  /** 1 官方 / 2 团队，默认 2 */
  use_type: z.union([z.literal(1), z.literal(2)]).optional(),
  /** 1 启用 / 2 停用，默认 1 */
  status: z.union([z.literal(1), z.literal(2)]).optional(),
  /** 竞品 `sp_type`（语义未取证，仅透传） */
  sp_type: z.number().int().min(0).max(32767).optional(),
  /** 竞品 `res_type`（语义未取证，仅透传；列表请求里当筛选用） */
  res_type: z.number().int().min(0).max(32767).optional(),
  /** 竞品 `meta_data`：竞品发 JSON 字符串，我方收对象（落 jsonb） */
  meta_data: z.record(z.unknown()).nullable().optional(),
  /** 竞品 `sort`，默认 0 */
  sort: z.number().int().min(0).max(9999).optional(),
});

const assetPatchBody = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  content: z.string().max(200_000).optional(),
  dir_id: z.string().min(1).max(32).nullable().optional(),
  tags: z.array(z.string().min(1).max(40)).max(20).optional(),
  scene: z.number().int().optional(),
  // 第 75 批：`undefined` 不动、`null` 清空（仅可空字段）；数组传 `[]` 表示清空
  cover_asset_id: z.string().min(1).max(20).nullable().optional(),
  image_asset_ids: z
    .array(z.string().min(1).max(20), { invalid_type_error: "image_asset_ids must be an array of asset ids" })
    .max(20, "image_asset_ids must contain at most 20 ids")
    .optional(),
  use_type: z.union([z.literal(1), z.literal(2)]).optional(),
  status: z.union([z.literal(1), z.literal(2)]).optional(),
  sp_type: z.number().int().min(0).max(32767).optional(),
  /** 竞品 `res_type`（语义未取证；列表请求里当筛选用） */
  res_type: z.number().int().min(0).max(32767).optional(),
  meta_data: z.record(z.unknown()).nullable().optional(),
  sort: z.number().int().min(0).max(9999).optional(),
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

// ── 知识库实体（第 59 批，rt:739/740/758/765）──────────────
/** 建库：全字段可选（未给的走表默认值）；名称上限与竞品目录名一致取 60 */
const baseCreateBody = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  description: z.string().max(2000).optional(),
  cover_uri: z.string().max(500).optional(),
});

/** 改名：只收 name（简介/封面走 info/update，避免表单误清空） */
const baseUpdateBody = z.object({ name: z.string().trim().min(1).max(60) });

/** 改概览：三个字段都可选，"不传=不动" */
const baseInfoPatchBody = z.object({
  description: z.string().max(2000).optional(),
  cover_uri: z.string().max(500).optional(),
  note: z.string().max(2000).optional(),
});

/**
 * 删库：`purge` 默认 false。
 *
 * 显式要求传 body 而不是空 POST —— 级联清内容是不可逆意图，必须让调用方
 * 写出 `{"purge":true}`，避免"手滑点了页头删除按钮"把整个团队知识库清空。
 */
const baseDeleteBody = z.object({ purge: z.boolean().optional() });

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
  dirs(@Req() req: AuthedRequest, @Query() query: unknown) {
    return this.knowledge.dirTree(requireAuth(req), parseOrThrow(dirQuery, query ?? {}));
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
  tags(@Req() req: AuthedRequest, @Query() query: unknown) {
    return this.knowledge.listTags(requireAuth(req), parseOrThrow(sceneQuery, query ?? {}));
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
        scene: sceneQuery.shape.scene,
        // 第 75 批：启停/归属/来源类型筛选（竞品列表有 status 列、`use_type` 区分官方/团队，
        // `sp_type` 是多值、`res_type` 单值 —— 都取自 `C-jRJshu.js` @10127 的列表请求）
        status: z.coerce.number().int().min(1).max(2).optional(),
        use_type: z.coerce.number().int().min(1).max(2).optional(),
        sp_type: spTypeQuery,
        res_type: z.coerce.number().int().min(0).max(32767).optional(),
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
        scene: sceneQuery.shape.scene,
        status: z.coerce.number().int().min(1).max(2).optional(),
        use_type: z.coerce.number().int().min(1).max(2).optional(),
        sp_type: spTypeQuery,
        res_type: z.coerce.number().int().min(0).max(32767).optional(),
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

  // ── 知识库实体（4）—— 第 59 批 ──────────────────────────

  /**
   * 知识库实体（我方 `GET /knowledge/base`）。
   *
   * 竞品这里没有独立 GET（实体信息混在 `info`:757 里）。我方单独给一条是因为
   * 页头要的只有名称/简介/封面，不该为此拉三个 count 聚合（`info` 一次 4 条查询）。
   */
  @Get("base")
  base(@Req() req: AuthedRequest) {
    return this.knowledge.baseInfo(requireAuth(req));
  }

  /** 建库（rt:739 `POST /create`）：一 space 一库，已存在即幂等返回 `created:false` */
  @Post("base")
  createBase(@Req() req: AuthedRequest, @Body() body: unknown) {
    return this.knowledge.createBase(requireAuth(req), parseOrThrow(baseCreateBody, body ?? {}));
  }

  /** 改库名（rt:765 `POST /update`） */
  @Post("base/update")
  updateBase(@Req() req: AuthedRequest, @Body() body: unknown) {
    return this.knowledge.updateBase(requireAuth(req), parseOrThrow(baseUpdateBody, body ?? {}));
  }

  /** 改概览信息（rt:758 `POST /info/update`）：简介 / 封面 / 提示文案，传了才改 */
  @Post("base/info/update")
  updateBaseInfo(@Req() req: AuthedRequest, @Body() body: unknown) {
    return this.knowledge.updateInfo(requireAuth(req), parseOrThrow(baseInfoPatchBody, body ?? {}));
  }

  /** 删库（rt:740 `POST /delete`）：默认只软删库行，`purge=true` 才级联清内容 */
  @Post("base/delete")
  deleteBase(@Req() req: AuthedRequest, @Body() body: unknown) {
    return this.knowledge.deleteBase(requireAuth(req), parseOrThrow(baseDeleteBody, body ?? {}));
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
      parseOrThrow(
        pageQuery.extend({ sort: z.enum(["created", "updated"]).optional(), scene: sceneQuery.shape.scene }),
        query ?? {},
      ),
    );
  }

  /** 29. 创建人聚合（rt:760 `scriptwriter/list`） */
  @Get("scriptwriter/list")
  scriptwriters(@Req() req: AuthedRequest) {
    return this.knowledge.scriptwriterList(requireAuth(req));
  }
}
