import { BadRequestException, Controller, Get, Query , Inject} from "@nestjs/common";
import { ModelsService } from "./models.service";
import { imageEffectsCatalog } from "./image-effects";

@Controller()
export class ModelsController {
  constructor(@Inject(ModelsService) private readonly models: ModelsService) {}

  @Get("models")
  async list(
    @Query("capability") capability?: string,
    @Query("mode") mode?: string,
    @Query("visible") visible?: string,
  ) {
    if (visible !== undefined && visible !== "true" && visible !== "false") {
      throw new BadRequestException("visible must be true|false");
    }
    return this.models.list({
      capability,
      mode,
      visible: visible === undefined ? undefined : visible === "true",
    });
  }

  /**
   * 图像风格迁移效果清单（图生图页的风格选择器数据源）。
   *
   * 数据来源是剪影网关 `GET /v1/effects`；网关未配置或不可达时回落到 `image-effects.ts`
   * 的静态表（同一份 18 项 + 中文名），因此**这个端点永远返回 200 与可用列表**——
   * 目录断供不该让前端选择器白屏。返回体是数组，与 `GET /models` 同风格。
   *
   * 见 docs/02-architecture/jianying-gateway-integration.md §5。
   */
  @Get("effects")
  async effects() {
    return imageEffectsCatalog.list();
  }
}