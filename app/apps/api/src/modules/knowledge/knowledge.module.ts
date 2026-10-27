import { Module } from "@nestjs/common";
import { KnowledgeController } from "./knowledge.controller";
import { KnowledgeService } from "./knowledge.service";

/**
 * 团队知识库（knowledge）域 —— 对照竞品 `df/user_knowledge` 29 端点（`routes.txt:737-765`）。
 *
 * 依赖说明：
 * - **不 import AssetsModule**：与资产库的"双向导入"只读写 `assets` 表的行
 *   （读引用 / 导出一份副本），不需要资产域的业务逻辑（上传、转码、审核）。
 *   反向依赖会让知识库被资产域的上传队列生命周期绑住，而它本质只是"素材索引"。
 * - **不 import TeamModule**：鉴权靠全局 `AuthGuard` 的 X-Space-Id 成员校验 +
 *   所有查询第一条件 `auth.spaceId`（越权面已被数据条件锁死），与 kds 的
 *   `requireMember` 相比少一次每请求的成员查询。
 */
@Module({
  controllers: [KnowledgeController],
  providers: [KnowledgeService],
  exports: [KnowledgeService],
})
export class KnowledgeModule {}
