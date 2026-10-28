import { type MiddlewareConsumer, Module, type NestModule } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { AppController } from "./app.controller";
import { AuthGuard } from "./common/auth.guard";
import { LoggingModule, RequestLoggingMiddleware } from "./common/logging";
import { HealthController } from "./health/health.controller";
import { MetricsController } from "./health/metrics.controller";
import { AdminModule } from "./modules/admin/admin.module";
import { AssetsModule } from "./modules/assets/assets.module";
import { AuthModule } from "./modules/auth/auth.module";
import { CreditsModule } from "./modules/credits/credits.module";
import { BillingModule } from "./modules/billing/billing.module";
import { GenerationsModule } from "./modules/generations/generations.module";
import { ModelsModule } from "./modules/models/models.module";
import { ModerationModule } from "./modules/moderation/moderation.module";
import { MetaModule } from "./modules/meta/meta.module";
import { ReportsModule } from "./modules/reports/reports.module";
import { ScriptModule } from "./modules/script/script.module";
import { SubjectsModule } from "./modules/subjects/subjects.module";
import { ExtractionModule } from "./modules/extraction/extraction.module";
import { TeamModule } from "./modules/team/team.module";
import { CanvasModule } from "./modules/canvas/canvas.module";
import { AgentModule } from "./modules/agent/agent.module";
import { KdsModule } from "./modules/kds/kds.module";
import { HomeModule } from "./modules/home/home.module";
import { NovelModule } from "./modules/novel/novel.module";
import { FilmModule } from "./modules/film/film.module";
import { WorkflowModule } from "./modules/workflow/workflow.module";
import { DirectorModule } from "./modules/director/director.module";
// 第 6 批「生态」：创作者中心 + 运营增长 + 激励活动
import { CreatorModule } from "./modules/creator/creator.module";
import { OpModule } from "./modules/op/op.module";
import { CampaignModule } from "./modules/campaign/campaign.module";
// 第 6 批「生态」B 组：剧本集市（market，含 ops/admin）+ 团队知识库（knowledge）
import { MarketModule } from "./modules/market/market.module";
import { KnowledgeModule } from "./modules/knowledge/knowledge.module";
// 第 8 批「补充」：视频转绘（复用 script_project 骨架，project_mode=3）
import { RedrawModule } from "./modules/redraw/redraw.module";
// 第 8 批「补充」：广告剧（复用 script_project 骨架，project_mode=2）
import { AdModule } from "./modules/ad/ad.module";
import { TasksModule } from "./modules/tasks/tasks.module";
// 第 93 批「音色库」：我的音色（克隆任务投影）+ 音色目录 + 收藏
import { VoiceModule } from "./modules/voice/voice.module";
import { QueueModule } from "./queue/queue.module";
import { RedisModule } from "./redis/redis.module";
import { StorageModule } from "./storage/storage.module";

// 模块化单体入口（docs/02-architecture/system-design.md §2）
@Module({
  imports: [
    LoggingModule,
    RedisModule,
    QueueModule,
    StorageModule,
    ModerationModule,
    MetaModule,
    AdminModule,
    AssetsModule,
    AuthModule,
    ModelsModule,
    CreditsModule,
    BillingModule,
    GenerationsModule,
    TasksModule,
    ScriptModule,
    TeamModule,
    CanvasModule,
    AgentModule,
    KdsModule,
    HomeModule,
    // 第 1 批「出片质量」：主体库 + 抽取流水线（迁移 0019 已建表）
    SubjectsModule,
    ExtractionModule,
    NovelModule,
    FilmModule,
    WorkflowModule,
    ReportsModule,
    DirectorModule,
    // 第 6 批「生态」：crc 30 + op 31 + campaign 6（迁移 0019/0024 已建表）
    OpModule,
    CampaignModule,
    CreatorModule,
    // 第 6 批「生态」B 组：集市 29+admin + 知识库 29
    MarketModule,
    KnowledgeModule,
    // 视频转绘（模块 #14）：8 端点 + 我方补充 1 条列表
    RedrawModule,
    // 广告剧（模块 #13）：竞品 12 端点
    AdModule,
    // 音色库（模块 #6 补支撑面）：我的音色 4 条 + 音色目录 3 条 + 收藏 1 条
    VoiceModule,
  ],
  controllers: [AppController, HealthController, MetricsController],
  providers: [{ provide: APP_GUARD, useClass: AuthGuard }],
})
export class AppModule implements NestModule {
  // 请求日志：全路由生效（request_id 回传 + 单行 JSON 请求日志，observability.md §1）
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestLoggingMiddleware).forRoutes("*");
  }
}
