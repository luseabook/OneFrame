import { Controller, Get, Inject, Query, Req } from "@nestjs/common";
import { z } from "zod";
import { AppError, ErrorCode } from "@app/shared";
import type { AuthedRequest } from "../../common/auth.types";
import { parseOrThrow } from "../../common/zod";
import { FilmAccessService } from "./film.access";

/**
 * 功能准入白名单 —— `GET /v1/func-whitelist?scene=ai_film` → `{check:boolean}`。
 *
 * 竞品证据：`GET /web/v1/func-whitelist?scene=ai_film` → `{check:bool}`，前端用
 * `checkFilmWhitelist()` 判定影视版是否对本团队开放（contract §1.3，源脚本 `Dso67aSD.js`）。
 * 影视版是**商务开通制**（不是自助订阅）——所以我方只把它落成 `spaces.film_enabled` 开关，
 * 由运营/商务侧开通，页面在 `check=false` 时显示「联系商务开通」。
 *
 * 为什么放在 film 模块而不是新建 whitelist 模块：它的**唯一**调用方就是影视版入口，
 * 单独建模块只会多一层目录；将来若出现 `scene=mv` 等第二场景再拆。
 */
@Controller("func-whitelist")
export class FilmWhitelistController {
  constructor(@Inject(FilmAccessService) private readonly access: FilmAccessService) {}

  @Get()
  async check(@Req() req: AuthedRequest, @Query() query: unknown) {
    const auth = req.auth;
    if (!auth) throw new AppError(ErrorCode.UNAUTHORIZED, "login required");
    const q = parseOrThrow(
      z.object({ scene: z.string().min(1).max(32).default("ai_film") }),
      query ?? {},
    );
    if (q.scene !== "ai_film") {
      // 未知场景一律 false（而不是报错）：白名单接口被前端在启动时无条件调用，
      // 报错会让整页白屏；未知场景的正确表现是"没有这个功能"。
      return { check: false, scene: q.scene };
    }
    const enabled = await this.access.isFilmEnabled(auth.spaceId);
    return {
      check: enabled,
      scene: q.scene,
      // 前端引导文案要区分"未开通"与"已开通"；enabled 与 check 同源，便于埋点
      enabled,
    };
  }
}
