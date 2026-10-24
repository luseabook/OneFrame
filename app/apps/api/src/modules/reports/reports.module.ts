import { Module } from "@nestjs/common";
import { PublicReportController } from "./reports.controller";
import { ReportsService } from "./reports.service";

@Module({
  controllers: [PublicReportController],
  providers: [ReportsService],
})
export class ReportsModule {}
