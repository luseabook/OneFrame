import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { AppController } from "./app.controller";
import { AuthGuard } from "./common/auth.guard";
import { HealthController } from "./health/health.controller";
import { AuthModule } from "./modules/auth/auth.module";
import { CreditsModule } from "./modules/credits/credits.module";
import { GenerationsModule } from "./modules/generations/generations.module";
import { ModelsModule } from "./modules/models/models.module";
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
    AuthModule,
    ModelsModule,
    CreditsModule,
    GenerationsModule,
    TasksModule,
    ScriptModule,
  ],
  controllers: [AppController, HealthController],
  providers: [{ provide: APP_GUARD, useClass: AuthGuard }],
})
export class AppModule {}
