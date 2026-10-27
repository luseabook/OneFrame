import { Module } from "@nestjs/common";
import { TeamModule } from "../team/team.module";
import { SubjectsController } from "./subjects.controller";
import { SubjectsService } from "./subjects.service";

/**
 * 主体库（subject）域 —— 对照竞品 `subject` 子命令族（`cmd/subject.md`）。
 *
 * 依赖 TeamModule 只为一件事：复用 `requireMember`（非成员 403），不重复实现权限。
 * 导出 SubjectsService 是为了让生成侧能调用 `assertApproved`（未过审主体不得投递）。
 */
@Module({
  imports: [TeamModule],
  controllers: [SubjectsController],
  providers: [SubjectsService],
  exports: [SubjectsService],
})
export class SubjectsModule {}
