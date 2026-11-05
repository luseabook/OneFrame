import { describe, expect, it } from "vitest";
import {
  extractH3Results,
  H3GatewayAdapter,
  normalizeH3Status,
} from "./h3-gateway";
import type { NormalizedGenRequest } from "./types";

const request: NormalizedGenRequest = {
  task_id: "task-1",
  model: { name: "minimax-h3", vendor: "hailuo", adapter_code: "h3:video" },
  request: {
    mode: "universal_reference",
    model: "minimax-h3",
    scene: null,
    input: {
      prompt: "雨夜霓虹街道，少女撑伞回头",
      reference_uris: ["oss://ref/1.png"],
      first_frame_uri: "oss://ref/first.png",
    },
    options: { ratio: "9:16", resolution: "768P", duration: 5, count: 1, seed: 42 },
  } as unknown as NormalizedGenRequest["request"],
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("h3-gateway：状态归一化", () => {
  it("把排队/开机/加载阶段都当 pending，避免前端显示 running 却一直没进度", () => {
    for (const s of ["queued", "provisioning", "booting", "loading", "PENDING"]) {
      expect(normalizeH3Status(s)).toBe("pending");
    }
  });

  it("审核拒绝必须先于 failed/running 被识别（否则会无限轮询）", () => {
    expect(normalizeH3Status("review_rejected")).toBe("review_rejected");
    expect(normalizeH3Status("rejected")).toBe("review_rejected");
  });

  it("未知状态按 running 处理，交给上层超时兜底", () => {
    expect(normalizeH3Status("weird")).toBe("running");
  });
});

describe("h3-gateway：结果解析", () => {
  it("认得我方 OSS key（不是供应商 URL），并带元数据", () => {
    const results = extractH3Results({
      results: [{ key: "gen/2026/11/t/0.mp4", width: 1344, height: 768, duration_s: 5.17, has_audio: true }],
    });
    expect(results).toHaveLength(1);
    expect(results[0]!.uri).toBe("gen/2026/11/t/0.mp4");
    expect(results[0]!.meta).toMatchObject({ has_audio: true });
  });

  it("空数组不报错，交给上层判 vendor_error", () => {
    expect(extractH3Results({ results: [] })).toEqual([]);
    expect(extractH3Results(null)).toEqual([]);
  });
});

describe("h3-gateway：提交与轮询", () => {
  it("请求体带 client_task_id/variant/refs，且参考图按 9 张封顶", async () => {
    let sent: Record<string, unknown> | undefined;
    const adapter = new H3GatewayAdapter(
      { baseUrl: "http://gw.test", apiKey: "k" },
      async (_url, init) => {
        sent = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return jsonResponse({ job_id: "job-1", queue_position: 2 });
      },
    );

    const out = await adapter.submit(request);
    expect(out.vendor_task_id).toBe("job-1");
    expect(sent).toMatchObject({
      client_task_id: "task-1",
      variant: "ref2va", // universal_reference 走参考驱动 checkpoint
      duration_s: 5,
      seed: 42,
    });
    const refs = sent!.refs as { images: string[] };
    expect(refs.images).toHaveLength(2); // first_frame + reference_uris
  });

  it("queued 轮询返回 pending，成功时 results 用 key 透传", async () => {
    const replies = [
      jsonResponse({ data: { status: "queued", queue_position: 1 } }),
      jsonResponse({
        data: { status: "succeeded", results: [{ key: "gen/x/0.mp4", duration_s: 5, has_audio: true }] },
      }),
    ];
    const adapter = new H3GatewayAdapter({ baseUrl: "http://gw.test" }, async () => replies.shift()!);

    const first = await adapter.poll("job-1");
    expect(first.status).toBe("pending");

    const second = await adapter.poll("job-1");
    expect(second.status).toBe("succeeded");
    expect(second.results?.[0]?.uri).toBe("gen/x/0.mp4");
  });

  it("审核拒绝带上 output_rejected，交给上层 745802", async () => {
    const adapter = new H3GatewayAdapter(
      { baseUrl: "http://gw.test" },
      async () => jsonResponse({ data: { status: "review_rejected", message: "敏感内容" } }),
    );
    const state = await adapter.poll("job-1");
    expect(state.status).toBe("review_rejected");
    expect(state.error?.code).toBe("output_rejected");
  });
});

describe("h3-gateway：variant 推导", () => {
  it("参考驱动模式用 ref2va，其余用 fl2va", () => {
    expect(H3GatewayAdapter.variantFor("universal_reference")).toBe("ref2va");
    expect(H3GatewayAdapter.variantFor("storyboard_reference_video")).toBe("ref2va");
    expect(H3GatewayAdapter.variantFor("image2video")).toBe("fl2va");
    expect(H3GatewayAdapter.variantFor("text2video")).toBe("fl2va");
  });
});