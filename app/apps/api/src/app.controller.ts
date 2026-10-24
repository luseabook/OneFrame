import { Controller, Get } from "@nestjs/common";
import { Public } from "./common/public.decorator";

// M0 Hello 全链路验证端点（WBS P0）——P1 后由业务模块替代
@Public()
@Controller()
export class AppController {
  @Get("ping")
  ping(): { pong: boolean; ts: string } {
    return { pong: true, ts: new Date().toISOString() };
  }
}
