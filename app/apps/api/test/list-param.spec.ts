import { describe, expect, it } from "vitest";
import { z } from "zod";
import { AppError, ErrorCode } from "@app/shared";
import {
  MAX_ID_ITEMS,
  MAX_TAG_ITEMS,
  csvListQuery,
  parseListParam,
  splitCsvList,
  tooManyListItems,
} from "../src/common/list-param";

/**
 * 入站列表参数封顶的纯函数单测（第 120 批）。
 *
 * 为什么单独测这一层：`common/list-param.ts` 是本批 11 个入口共用的**唯一**口径，
 * e2e 只能抽几个端点，抽不到「三种入参形状是否给出同一句文案」。这里不连库、不起服务，
 * 是本批「红→绿」最快的证据：改坏任何一个入口，下面的边界用例立刻红。
 *
 * 被测语义（改造前后**故意保持不变**的部分也要钉住）：
 * - `undefined` → `undefined`（不参与过滤），空串 / 只有逗号 → `[]`（调用方按「不过滤」处理）；
 * - 去空白、去空项；`?k=a&k=b` 的重复参数形状与 `?k=a,b` 等价；
 * - 恰好 `max` 项通过，`max + 1` 项拒绝，且**三种入口的文案逐字一致**（防措辞漂移）。
 */
describe("列表参数封顶（第 120 批）", () => {
  it("上限常量复用仓库既有业务尺度（20 / 100）", () => {
    // 20 = knowledge / market 正文 `tags` / `tag_ids` 的 `.max(20)`；
    // 100 = 列表分页 `page_size` 的上限。改这两个数等于改业务契约，先过这里。
    expect(MAX_TAG_ITEMS).toBe(20);
    expect(MAX_ID_ITEMS).toBe(100);
  });

  describe("splitCsvList", () => {
    it("逗号串按项切开，并去掉每项两侧空白", () => {
      expect(splitCsvList("a,b,c")).toEqual(["a", "b", "c"]);
      expect(splitCsvList(" a , b\t, c ")).toEqual(["a", "b", "c"]);
    });

    it("空串与只有逗号的串都归一成空数组（不是 ['']）", () => {
      expect(splitCsvList("")).toEqual([]);
      expect(splitCsvList(",")).toEqual([]);
      expect(splitCsvList(" , , ")).toEqual([]);
    });

    it("中间的空项直接丢弃，顺序不变", () => {
      expect(splitCsvList("a,,b,")).toEqual(["a", "b"]);
    });

    it("重复参数形状（数组）同样去空白、去空项，且不修改入参", () => {
      const raw = [" a ", "", "b"];
      expect(splitCsvList(raw)).toEqual(["a", "b"]);
      expect(raw).toEqual([" a ", "", "b"]);
    });
  });

  it("超限文案只有一个来源（手写路径与 zod 路径共用）", () => {
    expect(tooManyListItems("tags", MAX_TAG_ITEMS)).toBe("too many tags: at most 20");
  });

  describe("parseListParam（controller 手写路径）", () => {
    it("undefined 原样返回 —— 不参与过滤，而不是当成空过滤", () => {
      expect(parseListParam(undefined, "ids", MAX_ID_ITEMS)).toBeUndefined();
    });

    it("恰好 max 项通过", () => {
      const exactly = Array.from({ length: MAX_ID_ITEMS }, (_, i) => `id-${i}`).join(",");
      expect(parseListParam(exactly, "ids", MAX_ID_ITEMS)).toHaveLength(MAX_ID_ITEMS);
      const tags = Array.from({ length: MAX_TAG_ITEMS }, (_, i) => `t${i}`).join(",");
      expect(parseListParam(tags, "tags", MAX_TAG_ITEMS)).toHaveLength(MAX_TAG_ITEMS);
    });

    it("max + 1 项拒绝：400101 + 字段名 + 统一文案", () => {
      const over = Array.from({ length: MAX_TAG_ITEMS + 1 }, (_, i) => `t${i}`).join(",");
      let caught: unknown;
      try {
        parseListParam(over, "tags", MAX_TAG_ITEMS);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(AppError);
      const err = caught as AppError;
      expect(err.code).toBe(ErrorCode.INVALID_PARAM);
      expect(err.message).toBe("too many tags: at most 20");
      expect(err.details).toEqual({ field: "tags" });
    });

    it("重复参数形状也按同样上限拒绝", () => {
      const over = Array.from({ length: MAX_ID_ITEMS + 1 }, (_, i) => `id-${i}`);
      expect(() => parseListParam(over, "ids", MAX_ID_ITEMS)).toThrow(AppError);
    });
  });

  describe("csvListQuery（zod query schema 路径）", () => {
    const schema = z.object({ tags: csvListQuery("tags", MAX_TAG_ITEMS) });

    it("缺省与 undefined 都回到 undefined（可选字段不能变成必填）", () => {
      expect(schema.parse({}).tags).toBeUndefined();
      expect(schema.parse({ tags: undefined }).tags).toBeUndefined();
    });

    it("两种 query 形状解析成同一个数组", () => {
      expect(schema.parse({ tags: "a,b" }).tags).toEqual(["a", "b"]);
      expect(schema.parse({ tags: ["a", "b"] }).tags).toEqual(["a", "b"]);
    });

    it("空串归一成空数组（与 parseListParam 同语义）", () => {
      expect(schema.parse({ tags: "" }).tags).toEqual([]);
    });

    it("恰好 max 项通过，max + 1 项报同一句文案", () => {
      const ok = Array.from({ length: MAX_TAG_ITEMS }, (_, i) => `t${i}`).join(",");
      expect(schema.safeParse({ tags: ok }).success).toBe(true);

      const over = Array.from({ length: MAX_TAG_ITEMS + 1 }, (_, i) => `t${i}`).join(",");
      const result = schema.safeParse({ tags: over });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.message).toBe("too many tags: at most 20");
        // parseOrThrow 只取第一条 issue，且把 path 当 field —— 与手写路径的 details 对齐
        expect(result.error.issues[0]?.path).toEqual(["tags"]);
      }
    });
  });

  it("手写路径与 zod 路径的拒绝文案逐字一致（改一处必须改另一处）", () => {
    let handWritten = "";
    try {
      parseListParam("a,b", "tags", 1);
    } catch (e) {
      handWritten = (e as AppError).message;
    }
    const zodResult = z.object({ tags: csvListQuery("tags", 1) }).safeParse({ tags: "a,b" });
    const zodMessage = zodResult.success ? "" : (zodResult.error.issues[0]?.message ?? "");
    expect(handWritten).toBe("too many tags: at most 1");
    expect(zodMessage).toBe(handWritten);
  });
});