import { Module } from "@nestjs/common";
import { MetaController } from "./meta.controller";

/** 运行时能力探测（无依赖：只读环境变量与子进程探测） */
@Module({
  controllers: [MetaController],
})
export class MetaModule {}
