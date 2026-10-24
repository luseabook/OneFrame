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
import { ReportsModule } from "./modules/reports/reports.module";
import { ScriptModule } from "./modules/script/script.module";
import { TasksModule } from "./modules/tasks/tasks.module";
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
    AdminModule,
    AssetsModule,
    AuthModule,
    ModelsModule,
    CreditsModule,
    BillingModule,
    GenerationsModule,
    TasksModule,
    ScriptModule,
    ReportsModule,
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
