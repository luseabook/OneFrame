import { describe, expect, it } from "vitest";
import { harness } from "./helpers";

/**
 * `oneframe env info` 报告**服务端媒体能力**（`GET /meta/capabilities`）。
 *
 * 为什么这条要测：`ffmpeg` 决定"切片真裁剪 / 显式水印"能不能做，是部署环境属性。
 * 排障时最常见的问题是"为什么我的切片时长不对/没有水印"——答案往往在机器的 ffmpeg 上。
 * 把它放进 env info 意味着**排障工具本身不能因为这个可选能力而失败**，所以这里锁两件事：
 * 1. 成功应答时，`media` 原样透出（含 available/version/reason）；
 * 2. 该接口失败/网络异常时，env info **仍然成功**，只是 `media:null` + `media_error` 有值。
 */
describe("cli env info: media capability", () => {
  it("把 /meta/capabilities 的 media 透出到 env info", async () => {
    const h = await harness(["env", "info", "--json"], {
      respond: (req) =>
        req.url.includes("/meta/capabilities")
          ? {
              status: 200,
              body: JSON.stringify({
                code: 0,
                msg: "ok",
                data: {
                  media: {
                    ffmpeg: {
                      available: true,
                      path: "ffmpeg",
                      version: "8.1.1-full_build",
                      reason: null,
                      checked_at: "2026-10-29T00:00:00.000Z",
                    },
                  },
                  sampled_at: "2026-10-29T00:00:00.000Z",
                },
              }),
            }
          : { status: 200, body: JSON.stringify({ code: 0, msg: "ok", data: {} }) },
    });
    expect(h.code).toBe(0);
    const data = (h.output as { data?: Record<string, unknown> }).data ?? {};
    const media = data.media as { ffmpeg?: { available?: boolean; version?: string } } | null;
    expect(media?.ffmpeg?.available).toBe(true);
    expect(media?.ffmpeg?.version).toBe("8.1.1-full_build");
    expect(data.media_error).toBeNull();
  });

  it("能力接口失败时 env info 仍成功（media:null + media_error 有值）", async () => {
    const h = await harness(["env", "info", "--json"], {
      respond: (req) =>
        req.url.includes("/meta/capabilities")
          ? { status: 500, body: JSON.stringify({ code: 500000, msg: "boom", data: null }) }
          : { status: 200, body: JSON.stringify({ code: 0, msg: "ok", data: {} }) },
    });
    expect(h.code).toBe(0);
    const data = (h.output as { data?: Record<string, unknown> }).data ?? {};
    expect(data.media).toBeNull();
    expect(String(data.media_error ?? "").length).toBeGreaterThan(0);
    // 排障工具的核心字段不受影响
    expect(typeof data.api_base_url).toBe("string");
    expect(typeof data.cli_version).toBe("string");
  });
});
