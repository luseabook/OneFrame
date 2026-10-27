import { describe, expect, it } from "vitest";
import { coerceScalar, parseArgv } from "../src/args";
import { isCliError } from "../src/errors";

/**
 * 参数解析（竞品四种形态，见 args.ts 文件头引用的 commands/*.md 行号）。
 *
 * 最关键的一条：**未知 --flag 必须报错**。CLI 里把 `--dry-run` 拼成 `--dryrun`
 * 却被静默当成位置参数，结果就是「以为只是预演，实际已扣费」。
 */
describe("参数解析", () => {
  it("位置参数与取值选项混排", () => {
    const parsed = parseArgv(["workspace", "info", "42", "--space", "100", "--json"]);
    expect(parsed.positionals).toEqual(["workspace", "info", "42"]);
    expect(parsed.flags.space).toBe("100");
    expect(parsed.flags.json).toBe(true);
    expect(parsed.json).toBe(true);
  });

  it("--name=value 与 --name value 等价", () => {
    expect(parseArgv(["--workspace=7"]).flags.workspace).toBe("7");
    expect(parseArgv(["--workspace", "7"]).flags.workspace).toBe("7");
  });

  it("--set 累积键值，值按 JSON 强转（能解析就用 JSON，否则保留字符串）", () => {
    const parsed = parseArgv([
      "storyboard",
      "batch-generate",
      "9",
      "--set",
      "nums=[1,2]",
      "--set",
      "ratio=16:9",
      "--set",
      "qty=3",
      "--set",
      "is_store_draft=true",
    ]);
    expect(parsed.sets.nums).toEqual([1, 2]);
    expect(parsed.sets.ratio).toBe("16:9");
    expect(parsed.sets.qty).toBe(3);
    expect(parsed.sets.is_store_draft).toBe(true);
  });

  it("--set @file.json 识别为批量载荷文件（episode.md:22）", () => {
    const parsed = parseArgv(["episode", "batch-create", "--set", "@episodes.json"]);
    expect(parsed.batchFile).toBe("episodes.json");
    expect(parsed.sets).toEqual({});
  });

  it("--update 与 --set 分开累积（node.md:12 两种命名）", () => {
    const parsed = parseArgv(["node", "edit", "1", "--update", "name=x", "--set", "y=2"]);
    expect(parsed.updates).toEqual({ name: "x" });
    expect(parsed.sets).toEqual({ y: 2 });
  });

  it("布尔与 --flag=false 形态", () => {
    expect(parseArgv(["--dry-run"]).flags["dry-run"]).toBe(true);
    expect(parseArgv(["--dry-run=false"]).flags["dry-run"]).toBe(false);
    expect(parseArgv(["--in-doubt", "--all"]).flags.all).toBe(true);
  });

  it("`--` 之后全部当位置参数（可传以 -- 开头的名字）", () => {
    const parsed = parseArgv(["workspace", "create", "--", "--weird-name"]);
    expect(parsed.positionals).toEqual(["workspace", "create", "--weird-name"]);
  });

  it("未知选项与缺值都抛 usage 错误（不会静默吞参数）", () => {
    const unknown = (() => {
      try {
        parseArgv(["--dryrun"]);
        return null;
      } catch (e) {
        return e;
      }
    })();
    expect(isCliError(unknown)).toBe(true);
    expect(isCliError(unknown) && unknown.kind).toBe("usage");

    const missing = (() => {
      try {
        parseArgv(["--workspace"]);
        return null;
      } catch (e) {
        return e;
      }
    })();
    expect(isCliError(missing)).toBe(true);

    const badSet = (() => {
      try {
        parseArgv(["--set", "novalue"]);
        return null;
      } catch (e) {
        return e;
      }
    })();
    expect(isCliError(badSet)).toBe(true);
  });

  it("coerceScalar 边界：空串保留、数字/布尔/数组 JSON 化", () => {
    expect(coerceScalar("")).toBe("");
    expect(coerceScalar("0")).toBe(0);
    expect(coerceScalar("false")).toBe(false);
    expect(coerceScalar('["a"]')).toEqual(["a"]);
    expect(coerceScalar("9:16")).toBe("9:16");
    expect(coerceScalar("001")).toBe("001");
  });
});
