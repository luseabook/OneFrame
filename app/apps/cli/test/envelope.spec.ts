import { describe, expect, it } from "vitest";
import { failure, isSuccess, success } from "../src/envelope";
import { harness, makeDir, withProfile } from "./helpers";

/**
 * envelope 契约（SKILL.md:43）：
 * stdout 只出 `{ok:true,data,links}` 或 `{ok:false,error}`，且 `--json` 时必须能整段
 * JSON.parse。这些断言看似琐碎，但脚本消费方的第一行代码就是 `JSON.parse(stdout)`，
 * 一旦混入进度文本就会全线崩溃。
 */
describe("envelope 形状", () => {
  it("success() 恒带 ok/data/links 三个键，links 是对象", () => {
    const out = success({ a: 1 });
    expect(out).toEqual({ ok: true, data: { a: 1 }, links: {} });
    expect(Object.keys(out).sort()).toEqual(["data", "links", "ok"]);
  });

  it("failure() 的 error 只带 kind/message，可选 raw/retryable", () => {
    const out = failure("usage", "bad arg");
    expect(out.ok).toBe(false);
    expect(out.error).toEqual({ kind: "usage", message: "bad arg" });
    expect(failure("timeout", "slow", { retryable: false, raw: { n: 1 } }).error).toMatchObject({
      kind: "timeout",
      retryable: false,
      raw: { n: 1 },
    });
  });

  it("isSuccess 能区分两种形状", () => {
    expect(isSuccess(success(1))).toBe(true);
    expect(isSuccess(failure("internal", "x"))).toBe(false);
  });

  it("--json 时 stdout 是单个可解析的 JSON（无进度、无表格）", async () => {
    const dir = makeDir();
    withProfile(dir);
    const result = await harness(["model", "list", "--json"], {
      dir,
      respond: () => ({ status: 200, body: JSON.stringify({ code: 0, msg: "", data: [] }) }),
      cleanup: false,
    });
    expect(result.output).toEqual({ ok: true, data: [], links: {} });
    // 单行（compact），且 trimmed 后以 { 开头 } 结尾
    expect(result.stdout.trimEnd().split("\n")).toHaveLength(1);
    expect(result.stdout.trim().startsWith("{")).toBe(true);
  });

  it("非 --json 时 stdout 仍是 envelope（缩进可解析），人类可读摘要走 stderr", async () => {
    const dir = makeDir();
    withProfile(dir);
    const result = await harness(["credits", "balance"], {
      dir,
      respond: () => ({
        status: 200,
        body: JSON.stringify({ code: 0, msg: "", data: { credits: { balance: 42, frozen: 0 } } }),
      }),
      cleanup: false,
    });
    expect(result.output).toMatchObject({ ok: true, data: { balance: 42 } });
    expect(result.stderr).toContain("balance");
    expect(result.stdout).not.toContain("→ GET");
  });

  it("失败时 stdout 是 {ok:false,error}，退出码由 kind 决定，原文进 raw", async () => {
    const dir = makeDir();
    withProfile(dir);
    const result = await harness(["task", "get", "123", "--json"], {
      dir,
      respond: () => ({
        status: 200,
        body: JSON.stringify({ code: 400102, msg: "task not found", data: null }),
      }),
      cleanup: false,
    });
    expect(result.output.ok).toBe(false);
    expect(result.output.error).toMatchObject({ kind: "not_found", message: "task not found" });
    // NOT_FOUND 属于「一般失败」（error-codes.md:上表 1），不是参数错误
    expect(result.code).toBe(1);
  });
});
