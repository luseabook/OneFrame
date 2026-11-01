import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LocalStorage } from "@app/storage";
import type { GenResult } from "@app/model-adapters";
import { findUnlabeledResults, isResultLabeled, labelResults } from "./label";

let dir = "";
let storage: LocalStorage;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "ai-label-"));
  storage = new LocalStorage({
    rootDir: dir,
    publicBaseUrl: "http://127.0.0.1:3000/v1",
    signSecret: "test-secret",
  });
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("labelResults", () => {
  it("writes implicit sidecar and degrades explicit when ffmpeg is unavailable", async () => {
    await storage.put("u/1/tasks/2/r0.mp4", Buffer.from("not-a-real-video"), "video/mp4");
    const results = await labelResults(
      storage,
      { id: "2", capability: "video" },
      [{ uri: "u/1/tasks/2/r0.mp4" }],
      { enabled: true, text: "AI生成", ffmpegPath: "false" },
    );
    const label = results[0]?.meta?.ai_label as {
      implicit: boolean;
      explicit: boolean;
      explicit_reason?: string;
    };
    expect(label.implicit).toBe(true);
    expect(label.explicit).toBe(false);
    expect(label.explicit_reason).toBeTruthy();
    const sidecar = (await storage.read("u/1/tasks/2/r0.mp4.ai.json")).toString();
    expect(JSON.parse(sidecar).ai_generated).toBe(true);
  });

  it("skips labeling when disabled", async () => {
    const results = await labelResults(
      storage,
      { id: "3", capability: "image" },
      [{ uri: "u/1/tasks/3/r0.png" }],
      { enabled: false, text: "AI生成" },
    );
    expect((results[0]?.meta?.ai_label as { enabled: boolean }).enabled).toBe(false);
  });
});

/**
 * 结算门（第 112 批）：合规标识判定。
 *
 * 这些用例锁的是「什么算无标识」，因为 `succeed()` 用它决定结算还是 FAILED+解冻。
 * 口径错一边就会出事：判严了会把只有隐式旁车的正常产物判失败；
 * 判松了会把两条路径都失败的裸产物当成功交付。
 */
describe("合规标识判定（结算门）", () => {
  const media = (label: unknown, uri = "u/1/tasks/9/r0.mp4"): GenResult =>
    ({ uri, meta: { ai_label: label } }) as GenResult;

  it("显式水印成功或隐式旁车成功，任一即可结算", () => {
    expect(isResultLabeled(media({ enabled: true, explicit: true, implicit: false }))).toBe(true);
    expect(isResultLabeled(media({ enabled: true, explicit: false, implicit: true }))).toBe(true);
    expect(isResultLabeled(media({ enabled: true, explicit: true, implicit: true }))).toBe(true);
  });

  it("两条路径都失败 = 无标识产物，必须拦下", () => {
    const bare = media({ enabled: true, explicit: false, implicit: false });
    expect(isResultLabeled(bare)).toBe(false);
    expect(findUnlabeledResults([bare])).toHaveLength(1);
  });

  it("完全没有 ai_label 字段也按无标识处理（防止绕过 labelResults 的路径）", () => {
    expect(isResultLabeled({ uri: "u/1/tasks/9/r0.mp4" } as GenResult)).toBe(false);
  });

  it("纯文本结果与显式关闭标识不计入漏标", () => {
    expect(isResultLabeled({ text: "hello" } as GenResult)).toBe(true);
    expect(isResultLabeled(media({ enabled: false }))).toBe(true);
    expect(findUnlabeledResults([{ text: "hello" } as GenResult, media({ enabled: false })])).toEqual([]);
  });

  it("混合结果只筛出无标识的那条", () => {
    const good = media({ enabled: true, explicit: true, implicit: true }, "u/1/tasks/9/r0.mp4");
    const bad = media({ enabled: true, explicit: false, implicit: false }, "u/1/tasks/9/r1.mp4");
    expect(findUnlabeledResults([good, bad])).toEqual([bad]);
  });
});
