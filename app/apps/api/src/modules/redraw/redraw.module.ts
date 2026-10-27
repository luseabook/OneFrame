import { Module } from "@nestjs/common";
import { CreditsModule } from "../credits/credits.module";
import { GenerationsModule } from "../generations/generations.module";
import { TeamModule } from "../team/team.module";
import { RedrawController } from "./redraw.controller";
import { RedrawService } from "./redraw.service";

/**
 * 视频转绘（video_redraw）域 —— 对照参照产品
 * `/web/v1/df/script_project/video_redraw/*` 8 端点（`rt:703-710`）
 * + 我方补充 1 条项目列表（workspace 页入口）。
 *
 * 为什么单独成模块而不是塞进 `modules/script`：
 *
 * 1. **所有权**：`script/` 是既有剧本流水线域（86+ 端点、正在被别人改），转绘只是
 *    复用了它的**四张骨架表**（project/episode/storyboard/project_asset），业务语义完全不同
 *    （源视频 → 切镜 → 重绘 → 绑定），塞进去会让那个模块继续变大且难测。
 * 2. **依赖方向单向**：本模块 → `GenerationsModule`（生成/记账）、`CreditsModule`（报价）、
 *    `TeamModule`（成员校验）。**不**反向依赖 script 域，也不 export 给 script。
 * 3. 竞品本身也是 script_project 下的独立子域路径（`df/script_project/video_redraw/*`），
 *    我方按域切分前缀（ADR-009），行为与字段对齐。
 *
 * 注意：`ScriptModule` **没有** export `ScriptService`，所以本模块不注入它，
 * 而是直接复用四张表 + 自己的不变量（ep_no/shot_no 唯一、绑定快照语义）。
 * 这样不必改动别人的 module（避免与并行改动冲突）。
 */
@Module({
  imports: [TeamModule, CreditsModule, GenerationsModule],
  controllers: [RedrawController],
  providers: [RedrawService],
  exports: [RedrawService],
})
export class RedrawModule {}
