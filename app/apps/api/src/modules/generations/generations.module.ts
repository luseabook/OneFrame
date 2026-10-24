import { Module } from "@nestjs/common";
import { CreditsModule } from "../credits/credits.module";
import { ModelsModule } from "../models/models.module";
import { GenerationsController } from "./generations.controller";
import { GenerationsService } from "./generations.service";

@Module({
  imports: [CreditsModule, ModelsModule],
  controllers: [GenerationsController],
  providers: [GenerationsService],
  exports: [GenerationsService],
})
export class GenerationsModule {}
