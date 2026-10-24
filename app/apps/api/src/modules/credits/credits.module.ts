import { Module } from "@nestjs/common";
import { ModelsModule } from "../models/models.module";
import { CreditsController } from "./credits.controller";
import { CreditsService } from "./credits.service";

@Module({
  imports: [ModelsModule],
  controllers: [CreditsController],
  providers: [CreditsService],
  exports: [CreditsService],
})
export class CreditsModule {}
