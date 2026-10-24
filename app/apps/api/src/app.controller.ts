import { Controller, Get } from "@nestjs/common";

// M0 Hello 全链路验证端点（WBS P0）——P1 后由业务模块替代
@Controller()
export class AppController {
  @Get("ping")
  ping(): { pong: boolean; ts: string } {
    return { pong: true, ts: new Date().toISOString() };
  }
}
