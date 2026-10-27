import { describe, expect, it } from "vitest";
import type { TrimResult } from "./ffmpeg-trim";
import {
  PUB_STATUS_FAILED,
  PUB_STATUS_QUEUED,
  PUB_STATUS_READY,
  publicationObjectKey,
  runPublishTranscode,
  type PublishTranscodeDeps,
  type PublishTranscodeRow,
} from "./publish-transcode";

/**
 * 切片发布转码状态机（第 57 批从 API 下沉到 shared）。
 *
 * 为什么值得单测：这个状态机原本埋在 `publish.service.ts` 的私有方法里，只有走完整
 * publish 接口（要项目 + 分镜 + 时间线 + 导出产物）才能碰到它；现在 worker 也要用同一份实现，
 * 就必须把它当成**独立单元**锁住语义。
 *
 * 四条不变量（都是曾经真出过问题或一眼会亏的地方）：
 * 1. **终态不覆盖**：worker 重投 / 两个实例抢同一 job 时，不能把已发布（3）或已失败（4）的记录改回去；
 * 2. **降级留痕**：裁剪失败仍要出片，但必须把 `transcode_mode=copy` + 原因写进库
 *    （否则前端徽标会对外说"已按区间裁剪"，实际是整片）；
 * 3. **失败不抛**：转码失败落 status=4 + error；抛出去只会让 BullMQ 白重试一次确定性失败；
 * 4. **不吞终态**：loadPublication 返回 null（记录被删）时返回 skipped 而不是写入非法状态。
 *
 * 本 spec 全部用 fake deps，不碰 DB / 不碰 ffmpeg（`trim` 是注入点）。
 */
function fakeDeps(
  overrides: Partial<PublishTranscodeDeps> & { row?: PublishTranscodeRow | null; claimFails?: boolean } = {},
) {
  const calls: string[] = [];
  let status = overrides.row === undefined ? PUB_STATUS_QUEUED : (overrides.row?.status ?? 0);
  let readyPatch: Parameters<PublishTranscodeDeps["markReady"]>[1] | null = null;
  let failReason: string | null = null;

  const deps: PublishTranscodeDeps = {
    loadPublication: async () => {
      calls.push("loadPublication");
      if (overrides.row === null) return null;
      return overrides.row ?? { status, slice: { start_ms: 1000, end_ms: 3000 } };
    },
    markTranscoding: async () => {
      calls.push("markTranscoding");
      if (overrides.claimFails) return false;
      status = 2;
      return true;
    },
    readSource: async () => {
      calls.push("readSource");
      return Buffer.from("not-a-real-mp4");
    },
    putFile: async (key) => {
      calls.push(`putFile:${key}`);
    },
    nextShareToken: async () => {
      calls.push("nextShareToken");
      return "0123456789abcdef0123456789abcdef";
    },
    markReady: async (_id, patch) => {
      calls.push("markReady");
      readyPatch = patch;
      status = PUB_STATUS_READY;
    },
    markFailed: async (_id, reason) => {
      calls.push("markFailed");
      failReason = reason;
      status = PUB_STATUS_FAILED;
    },
    ...overrides,
  };

  return {
    deps,
    calls,
    get status() {
      return status;
    },
    get readyPatch() {
      return readyPatch;
    },
    get failReason() {
      return failReason;
    },
  };
}

const okTrim = (): ((b: Buffer, s: number, e: number) => Promise<TrimResult>) => async () => ({
  ok: true,
  buffer: Buffer.from("trimmed"),
  ffmpegPath: "ffmpeg",
});

const badTrim = (reason: string) => async (): Promise<TrimResult> => ({ ok: false, reason });

describe("publish transcode: 状态机语义", () => {
  it("裁剪成功 → 写 copy? 不是：mode=ffmpeg、无降级原因，落点按 space 归档", async () => {
    const h = fakeDeps({ trim: okTrim() });
    const outcome = await runPublishTranscode(h.deps, {
      publicationId: "42",
      spaceId: "7",
      sourceKey: "u/7/exports/9.mp4",
    });

    expect(outcome).toEqual({ result: "ready", transcodeMode: "ffmpeg" });
    expect(h.readyPatch).toEqual({
      fileUri: publicationObjectKey("7", "42"),
      shareToken: "0123456789abcdef0123456789abcdef",
      transcodeMode: "ffmpeg",
      transcodeReason: null,
    });
    expect(h.calls).toContain("putFile:u/7/publications/42.mp4");
  });

  it("裁剪失败 → 仍出片（copy），并把降级原因带回 + 落库", async () => {
    const h = fakeDeps({ trim: badTrim("ffmpeg not available") });
    const outcome = await runPublishTranscode(h.deps, {
      publicationId: "42",
      spaceId: "7",
      sourceKey: "u/7/exports/9.mp4",
    });

    expect(outcome.result).toBe("ready");
    expect(outcome.transcodeMode).toBe("copy");
    expect(outcome.reason).toBe("ffmpeg not available");
    expect(h.readyPatch?.transcodeMode).toBe("copy");
    expect(h.readyPatch?.transcodeReason).toBe("ffmpeg not available");
  });

  it("已到终态（3/4/5）→ skipped，不重跑、不写库", async () => {
    for (const status of [PUB_STATUS_READY, PUB_STATUS_FAILED, 5]) {
      const h = fakeDeps({ row: { status, slice: {} } });
      const outcome = await runPublishTranscode(h.deps, {
        publicationId: "42",
        spaceId: "7",
        sourceKey: "k",
      });
      expect(outcome.result).toBe("skipped");
      expect(h.calls).toEqual(["loadPublication"]);
    }
  });

  it("记录不存在 → skipped（不是 failed，不能凭空造一条失败记录）", async () => {
    const h = fakeDeps({ row: null });
    const outcome = await runPublishTranscode(h.deps, {
      publicationId: "42",
      spaceId: "7",
      sourceKey: "k",
    });
    expect(outcome.result).toBe("skipped");
    expect(h.readyPatch).toBeNull();
  });

  it("源产物为空 → 落 status=4 + 原因，且**不抛**（抛出去只会让队列白重试）", async () => {
    const h = fakeDeps({
      trim: okTrim(),
      readSource: async () => null,
    });
    const outcome = await runPublishTranscode(h.deps, {
      publicationId: "42",
      spaceId: "7",
      sourceKey: "missing",
    });

    expect(outcome.result).toBe("failed");
    expect(outcome.reason).toMatch(/empty/);
    expect(h.failReason).toMatch(/empty/);
    expect(h.status).toBe(PUB_STATUS_FAILED);
    expect(h.calls).not.toContain("markReady");
  });

  it("putFile 抛错 → 同样落 status=4，不向上抛", async () => {
    const h = fakeDeps({
      trim: okTrim(),
      putFile: async () => {
        throw new Error("disk full");
      },
    });
    const outcome = await runPublishTranscode(h.deps, {
      publicationId: "42",
      spaceId: "7",
      sourceKey: "k",
    });
    expect(outcome.result).toBe("failed");
    expect(h.failReason).toBe("disk full");
  });

  it("没抢到转码权（另一个执行者已在跑）→ skipped，不读源、不写产物", async () => {
    const h = fakeDeps({ trim: okTrim(), claimFails: true });
    const outcome = await runPublishTranscode(h.deps, {
      publicationId: "42",
      spaceId: "7",
      sourceKey: "k",
    });

    expect(outcome.result).toBe("skipped");
    expect(outcome.reason).toMatch(/claimed/);
    // 关键：不能退化成"照转不误" —— 否则同一条发布会并行转两遍、shareToken 被后写者换掉
    expect(h.calls).not.toContain("readSource");
    expect(h.calls).not.toContain("markReady");
    expect(h.readyPatch).toBeNull();
  });
});
