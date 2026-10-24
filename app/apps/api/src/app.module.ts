import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { AppController } from "./app.controller";
import { AuthGuard } from "./common/auth.guard";
import { HealthController } from "./health/health.controller";
import { AdminModule } from "./modules/admin/admin.module";
import { AssetsModule } from "./modules/assets/assets.module";
import { AuthModule } from "./modules/auth/auth.module";
import { CreditsModule } from "./modules/credits/credits.module";
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
    RedisModule,
    QueueModule,
    StorageModule,
    ModerationModule,
    AdminModule,
    AssetsModule,
    AuthModule,
    ModelsModule,
    CreditsModule,
    GenerationsModule,
    TasksModule,
    ScriptModule,
    ReportsModule,
  ],
  controllers: [AppController, HealthController],
  providers: [{ provide: APP_GUARD, useClass: AuthGuard }],
})
export class AppModule {}
