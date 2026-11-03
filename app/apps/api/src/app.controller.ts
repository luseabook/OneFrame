import { Controller, Get } from "@nestjs/common";
import { Public } from "./common/public.decorator";

// M0 Hello 全链路验证端点（WBS P0）——P1 后由业务模块替代
@Public()
@Controller()
export class AppController {
  @Get("ping")
  ping(): { pong: boolean; ts: string } {
    // 刻意**不**在这里暴露 llm_mode：ping 匿名可达，把部署形态广播给扫描器没有必要
    // （api-spec §33.1：llm_mode 只对已登录用户暴露，见 GET /v1/me）。
    return { pong: true, ts: new Date().toISOString() };
  }
}
