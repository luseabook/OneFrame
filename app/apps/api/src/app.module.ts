import { Module } from "@nestjs/common";
import { AppController } from "./app.controller";
import { HealthController } from "./health/health.controller";

// P0 模块化单体入口。模块边界与依赖规则见 docs/02-architecture/system-design.md §2
// P1 依次挂：AuthModule / ModelsModule / GenerationsModule / TasksModule / BillingModule / FilesModule / AssetsModule / ScriptModule
@Module({
  controllers: [AppController, HealthController],
})
export class AppModule {}
