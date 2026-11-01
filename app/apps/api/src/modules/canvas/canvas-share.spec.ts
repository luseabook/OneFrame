import { describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { AppError, ErrorCode } from "@app/shared";
import {
  collectFiles,
  isShareToken,
  readShareSnapshot,
  sanitizeParams,
} from "./canvas-share.service";

// 画布分享的纯函数契约（第 126 批）：不发一条 SQL，锁定"公开面能看到什么"。
// 撤销/过期/空间隔离靠 `mustGetPublicShare` 的库查询，那部分属集成测试范畴，
// 这里只保证喂给它的令牌形状与读回的快照结构不会把内部信息带出去。

describe("share token shape", () => {
  it("accepts the exact shape we mint", () => {
    const token = randomBytes(24).toString("base64url");
    expect(token).toHaveLength(32);
    expect(isShareToken(token)).toBe(true);
  });

  it("accepts the 16..64 boundary", () => {
    expect(isShareToken("a".repeat(16))).toBe(true);
    expect(isShareToken("a".repeat(64))).toBe(true);
    expect(isShareToken("a".repeat(15))).toBe(false);
    expect(isShareToken("a".repeat(65))).toBe(false);
  });

  it("rejects anything that is not base64url", () => {
    for (const bad of [
      "",
      "short",
      "has space in it 1234",
      "has/slash/1234567890",
      "has+plus+1234567890",
      "trailing==1234567890",
      "../../etc/passwd00000",
      "汉字令牌汉字令牌汉字令牌",
    ]) {
      expect(isShareToken(bad)).toBe(false);
    }
  });
});

describe("sanitizeParams", () => {
  it("drops identity, credential and task keys", () => {
    const out = sanitizeParams({
      prompt: "一只猫",
      space_id: 42,
      user_id: 7,
      owner_user_id: 7,
      credits: 10,
      credits_frozen: 10,
      credits_settled: 3,
      api_key: "sk-x",
      authorization: "Bearer x",
      token: "t",
      secret: "s",
      password: "p",
      task_id: "123",
      image_task_id: "123",
      source_task_ids: ["1", "2"],
      result_uri: "u/1/a.png",
      result_uris: ["u/1/a.png"],
      result_preview_uri: "u/1/p.png",
      mode: "text2image",
    });
    expect(out).toEqual({ prompt: "一只猫", mode: "text2image" });
  });

  it("keeps ordinary nested settings", () => {
    expect(
      sanitizeParams({ settings: { resolution: "1080p", duration: 5 }, tags: ["a", "b"] }),
    ).toEqual({ settings: { resolution: "1080p", duration: 5 }, tags: ["a", "b"] });
  });

  it("blanks our storage keys but keeps external URLs and plain text", () => {
    expect(
      sanitizeParams({
        a: "u/12/2026/01/abc.png",
        b: "https://cdn.example.com/a.png",
        c: "一段提示词",
        d: { nested: "u/3/x.mp4" },
        e: ["u/3/y.mp4", "keep"],
      }),
    ).toEqual({
      a: null,
      b: "https://cdn.example.com/a.png",
      c: "一段提示词",
      d: { nested: null },
      e: [null, "keep"],
    });
  });

  it("deep-copies: the caller's params object is untouched", () => {
    const source = { prompt: "原文", settings: { resolution: "720p" } };
    const out = sanitizeParams(source) as Record<string, unknown>;
    (out.settings as Record<string, unknown>).resolution = "1080p";
    out.prompt = "改过";
    expect(source).toEqual({ prompt: "原文", settings: { resolution: "720p" } });
  });

  it("caps depth at 8 and arrays at 200", () => {
    let deep: unknown = "bottom";
    for (let i = 0; i < 12; i += 1) deep = { next: deep };
    let cursor = sanitizeParams(deep) as Record<string, unknown>;
    let levels = 0;
    while (cursor && typeof cursor === "object" && "next" in cursor) {
      cursor = cursor.next as Record<string, unknown>;
      levels += 1;
    }
    // depth 0 是入参本身，超过 8 层直接截成 null
    expect(levels).toBeLessThanOrEqual(9);

    const long = Array.from({ length: 250 }, (_, i) => i);
    expect((sanitizeParams(long) as unknown[]).length).toBe(200);
  });
});

describe("collectFiles", () => {
  it("orders results before preview and dedupes", () => {
    expect(
      collectFiles("n1", {
        result_uris: ["u/1/a.png", "u/1/b.png"],
        result_uri: "u/1/a.png",
        result_preview_uri: "u/1/p.png",
      }),
    ).toEqual([
      { node_id: "n1", kind: "result", uri: "u/1/a.png" },
      { node_id: "n1", kind: "result", uri: "u/1/b.png" },
      { node_id: "n1", kind: "preview", uri: "u/1/p.png" },
    ]);
  });

  it("ignores empty and non-string values", () => {
    expect(
      collectFiles("n2", {
        result_uris: ["", null, 3, "u/1/a.png"],
        result_uri: 42,
        result_preview_uri: "",
      }),
    ).toEqual([{ node_id: "n2", kind: "result", uri: "u/1/a.png" }]);
  });

  it("returns nothing when the node has no products", () => {
    expect(collectFiles("n3", { prompt: "还没有产物" })).toEqual([]);
  });
});

describe("readShareSnapshot", () => {
  const valid = {
    format: 1,
    canvas: { title: "一张画布", source_version: 3, cover: null },
    nodes: [],
    edges: [],
    groups: [],
    files: [],
    truncated: false,
  };

  it("accepts the snapshot we write", () => {
    expect(readShareSnapshot(valid).canvas.title).toBe("一张画布");
  });

  it("treats unknown formats and broken structure as 'no such link'", () => {
    const broken: unknown[] = [
      null,
      "snapshot",
      [],
      { ...valid, format: 2 },
      { ...valid, canvas: null },
      { ...valid, canvas: { title: 42 } },
      { ...valid, nodes: {} },
      { ...valid, edges: null },
      { ...valid, groups: "x" },
      { ...valid, files: 0 },
    ];
    for (const value of broken) {
      expect(() => readShareSnapshot(value)).toThrow(AppError);
      try {
        readShareSnapshot(value);
      } catch (e) {
        expect((e as AppError).code).toBe(ErrorCode.NOT_FOUND);
      }
    }
  });
});