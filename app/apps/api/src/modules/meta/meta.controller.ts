import { Controller, Get } from "@nestjs/common";
import { probeFfmpeg, type MediaCapability } from "@app/shared";
import { Public } from "../../common/public.decorator";

/**
 * 运行时能力探测（公开只读）。
 *
 * 存在的理由：有些能力由**部署环境**决定，不由产品开关决定（典型是 `ffmpeg`）。
 * 以前这类能力在代码里被"假设没有"，环境装了也要改代码才能用；
 * 现在统一由这个端点透出，前端/CLI/运维都能看到"这台机器能做什么、为什么不能做"。
 *
 * 安全：只暴露 `available / version / reason`，**不暴露**存储路径、密钥、内部地址。
 * `path` 只回可执行名（如 `ffmpeg` 或运维配的 `FFMPEG_PATH` 值），便于排查但无敏感信息。
 */
@Controller("meta")
export class MetaController {
  /**
   * `GET /meta/capabilities`：当前进程的能力快照。
   * 探测结果进程内缓存 5 分钟（见 `probeFfmpeg`），`?refresh=1` 可强制重探（运维排查用）。
   */
  @Public()
  @Get("capabilities")
  async capabilities(): Promise<{
    media: { ffmpeg: MediaCapability };
    /** 采样时间，便于前端判断是否过期 */
    sampled_at: string;
  }> {
    const ffmpeg = await probeFfmpeg(process.env.FFMPEG_PATH);
    // 刻意不暴露 llm 状态：本端点匿名可达 —— 与 `GET /v1/me` 的 llm_mode 分工不同
    // （api-spec §33.1：部署形态只对已登录用户与 /healthz/ready 暴露）。
    return { media: { ffmpeg }, sampled_at: new Date().toISOString() };
  }
}
