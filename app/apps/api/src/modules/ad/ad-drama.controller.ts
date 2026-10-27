import { Body, Controller, Get, Inject, Param, Post, Req } from "@nestjs/common";
import { z } from "zod";
import { AppError, ErrorCode } from "@app/shared";
import type { AuthedRequest } from "../../common/auth.types";
import { parseOrThrow } from "../../common/zod";
import { AdDramaService } from "./ad-drama.service";
import { AD_RATIOS } from "./ad.constants";

/**
 * 广告剧（drama_ad）控制器 —— 12 端点，逐条对应竞品
 * `/web/v1/df/script_project/drama_ad/*`（`rea-reelmate/routes.txt:680-691`）。
 *
 * 路径映射（ADR-009：保留竞品子域形状便于 1:1 核对，只把
 * `df/script_project/drama_ad/` 收敛成 `/v1/ad-drama/`）：
 *
 * | 竞品路由（routes.txt 行） | 我方 |
 * |---|---|
 * | `drama_ad/asset/extract` (:680) | `POST /ad-drama/projects/:id/asset/extract` |
 * | `drama_ad/asset/image-tips` (:681) | `POST /ad-drama/projects/:id/asset/image-tips` |
 * | `drama_ad/brief/generate` (:682) | `POST /ad-drama/projects/:id/brief/generate` |
 * | `drama_ad/brief/select` (:683) | `POST /ad-drama/projects/:id/brief/select` |
 * | `drama_ad/project/info` (:684) | `GET  /ad-drama/projects/:id` |
 * | `drama_ad/project/point` (:685) | `POST /ad-drama/projects/:id/point` |
 * | `drama_ad/project/save` (:686) | `POST /ad-drama/projects`（`project_id` 有值=更新） |
 * | `drama_ad/script/edit` (:687) | `POST /ad-drama/projects/:id/script/edit` |
 * | `drama_ad/script/generate` (:688) | `POST /ad-drama/projects/:id/script/generate` |
 * | `drama_ad/script/reset` (:689) | `POST /ad-drama/projects/:id/script/reset` |
 * | `drama_ad/selling-point/generate` (:690) | `POST /ad-drama/projects/:id/selling-point/generate` |
 * | `drama_ad/storyboard/generate` (:691) | `POST /ad-drama/projects/:id/storyboard/generate` |
 *
 * 参数名一律沿用竞品 CLI 已取证的名字（`commands/ad.md:57-67`、`:117`、`:133`、`:149`），
 * 不自造同义词：`material_name` / `material_highlight` / `material_image` / `style` /
 * `ratio` / `sp_type` / `theme` / `group_ids` / `brief_id` / `need_voice` / `template_type`。
 */

/** 竞品 `ad save` 的必填 6 项（`commands/ad.md:57-66`） */
const saveProjectBody = z.object({
  /** 非空=更新（竞品 `sp_id` 传值即更新，`commands/ad.md:67`）；空=新建 */
  project_id: z.string().min(1).max(32).optional(),
  material_name: z.string().trim().min(1).max(120),
  material_highlight: z.string().trim().min(1).max(300),
  /** 商品图：已上传资产的 id 或 uri（竞品是 `file_id`） */
  material_image: z.string().trim().min(1).max(2048),
  style: z.string().trim().min(1).max(120),
  ratio: z.enum(AD_RATIOS),
  /** 竞品当前恒用 2（`commands/ad.md:64`）；传其它值只留痕，不改我方模式 */
  sp_type: z.number().int().min(1).max(9).optional(),
  theme: z.string().max(120).optional(),
  group_ids: z.string().max(120).optional(),
  title: z.string().trim().min(1).max(120).optional(),
});

const optionalModel = z.object({ model: z.string().min(1).max(120).optional() });

const sellingPointBody = optionalModel.extend({ count: z.number().int().min(1).max(8).optional() });

const briefGenerateBody = optionalModel.extend({ count: z.number().int().min(1).max(5).optional() });

const briefSelectBody = z.object({ brief_id: z.string().min(1).max(64) });

const scriptGenerateBody = optionalModel.extend({ brief_id: z.string().min(1).max(64).optional() });

const scriptEditBody = z.object({ script_text: z.string().min(1).max(20_000) });

const storyboardBody = optionalModel.extend({
  /** 竞品 `template_type`：1 急速 / 2 至尊（`commands/ad.md:149`） */
  template_type: z.union([z.literal(1), z.literal(2)]).optional(),
  shot_count: z.number().int().min(1).max(30).optional(),
});

const assetExtractBody = optionalModel.extend({
  /** 竞品 `need_voice`：1 生成配音 / 2 不生成（`commands/ad.md:133`） */
  need_voice: z.union([z.literal(1), z.literal(2)]).optional(),
});

const pointBody = z.object({
  include_media: z.boolean().optional(),
  shot_count: z.number().int().min(1).max(30).optional(),
  model: z.string().max(120).optional(),
});

function requireAuth(req: AuthedRequest) {
  const auth = req.auth;
  if (!auth) throw new AppError(ErrorCode.UNAUTHORIZED, "login required");
  return auth;
}

@Controller("ad-drama")
export class AdDramaController {
  constructor(@Inject(AdDramaService) private readonly ad: AdDramaService) {}

  /** 1/7. 新建或更新项目（竞品 `project/save`，rt:686） */
  @Post("projects")
  save(@Req() req: AuthedRequest, @Body() body: unknown) {
    return this.ad.save(requireAuth(req), parseOrThrow(saveProjectBody, body ?? {}));
  }

  /** 2. 项目详情 + 五段进度（竞品 `project/info`，rt:684） */
  @Get("projects/:id")
  info(@Req() req: AuthedRequest, @Param("id") id: string) {
    return this.ad.info(requireAuth(req), id);
  }

  /** 3. 生成卖点（竞品 `selling-point/generate`，rt:690） */
  @Post("projects/:id/selling-point/generate")
  sellingPoints(@Req() req: AuthedRequest, @Param("id") id: string, @Body() body: unknown) {
    return this.ad.generateSellingPoints(requireAuth(req), id, parseOrThrow(sellingPointBody, body ?? {}));
  }

  /** 4. 生成剧情方案候选（竞品 `brief/generate`，rt:682） */
  @Post("projects/:id/brief/generate")
  briefs(@Req() req: AuthedRequest, @Param("id") id: string, @Body() body: unknown) {
    return this.ad.generateBriefs(requireAuth(req), id, parseOrThrow(briefGenerateBody, body ?? {}));
  }

  /** 5. 选定方案（竞品 `brief/select`，rt:683） */
  @Post("projects/:id/brief/select")
  selectBrief(@Req() req: AuthedRequest, @Param("id") id: string, @Body() body: unknown) {
    return this.ad.selectBrief(requireAuth(req), id, parseOrThrow(briefSelectBody, body ?? {}));
  }

  /** 6. 生成脚本（竞品 `script/generate`，rt:688） */
  @Post("projects/:id/script/generate")
  scriptGenerate(@Req() req: AuthedRequest, @Param("id") id: string, @Body() body: unknown) {
    return this.ad.generateScript(requireAuth(req), id, parseOrThrow(scriptGenerateBody, body ?? {}));
  }

  /** 7. 编辑脚本（竞品 `script/edit`，rt:687） */
  @Post("projects/:id/script/edit")
  scriptEdit(@Req() req: AuthedRequest, @Param("id") id: string, @Body() body: unknown) {
    return this.ad.editScript(requireAuth(req), id, parseOrThrow(scriptEditBody, body ?? {}));
  }

  /** 8. 重置脚本（竞品 `script/reset`，rt:689） */
  @Post("projects/:id/script/reset")
  scriptReset(@Req() req: AuthedRequest, @Param("id") id: string) {
    return this.ad.resetScript(requireAuth(req), id);
  }

  /** 9. 生成分镜（竞品 `storyboard/generate`，rt:691；CLI `plan` 的 `template_type`） */
  @Post("projects/:id/storyboard/generate")
  storyboard(@Req() req: AuthedRequest, @Param("id") id: string, @Body() body: unknown) {
    return this.ad.generateStoryboard(requireAuth(req), id, parseOrThrow(storyboardBody, body ?? {}));
  }

  /** 10. 抽取资产（竞品 `asset/extract`，rt:680；CLI `asset` 的 `need_voice`） */
  @Post("projects/:id/asset/extract")
  assetExtract(@Req() req: AuthedRequest, @Param("id") id: string, @Body() body: unknown) {
    return this.ad.extractAssets(requireAuth(req), id, parseOrThrow(assetExtractBody, body ?? {}));
  }

  /** 11. 资产提示词（竞品 `asset/image-tips`，rt:681） */
  @Post("projects/:id/asset/image-tips")
  imageTips(@Req() req: AuthedRequest, @Param("id") id: string, @Body() body: unknown) {
    return this.ad.generateImageTips(requireAuth(req), id, parseOrThrow(optionalModel, body ?? {}));
  }

  /** 12. 积分预估（竞品 `project/point`，rt:685） */
  @Post("projects/:id/point")
  point(@Req() req: AuthedRequest, @Param("id") id: string, @Body() body: unknown) {
    return this.ad.estimate(requireAuth(req), id, parseOrThrow(pointBody, body ?? {}));
  }
}
