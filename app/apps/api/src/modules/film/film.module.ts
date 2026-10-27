import { Module } from "@nestjs/common";
import { CanvasModule } from "../canvas/canvas.module";
import { TeamModule } from "../team/team.module";
import { FilmAccessService } from "./film.access";
import { FilmCanvasService } from "./film.canvas.service";
import { FilmController } from "./film.controller";
import { FilmExportsService } from "./film.exports.service";
import { FilmFieldsService } from "./film.fields.service";
import { FilmRealtimeService } from "./film.realtime";
import { FilmReviewService } from "./film.review.service";
import { FilmTablesService } from "./film.tables.service";
import { FilmTasksService } from "./film.tasks.service";
import { FilmWhitelistController } from "./film.whitelist.controller";

/**
 * 影视版（film）域模块 —— 对照参照产品 `/web/v1/film/projects/*` 37 路径 / 48 操作。
 *
 * 依赖方向（`system-design.md §2` 的模块化单体约束）：
 * - `TeamModule`：成员/特权闸门（L2/L3），film **不自建权限表**（契约 §5.4 第 4 条）；
 * - `CanvasModule`：画布归属校验（`canvas_id` 在 film 侧是无 FK 的不透明指针，
 *   必须走 canvas 域 service 判存在性，不能直查 canvases 表）；
 * - `StorageModule` 是 @Global（导出落文件用），无需显式 import。
 *
 * 不依赖 `TasksModule`：契约 §5.4 第 6 条说"submit-result 才真正建生成任务"，
 * 但那需要模型/报价/积分链路（属于生成域），本期影视版的任务表是**工单表**，
 * 不产生生成任务；已在回报里登记为后续接入项。
 */
@Module({
  imports: [TeamModule, CanvasModule],
  controllers: [FilmController, FilmWhitelistController],
  providers: [
    FilmAccessService,
    FilmRealtimeService,
    FilmFieldsService,
    FilmTablesService,
    FilmReviewService,
    FilmTasksService,
    FilmCanvasService,
    FilmExportsService,
  ],
  exports: [FilmAccessService, FilmRealtimeService, FilmTablesService, FilmTasksService],
})
export class FilmModule {}
