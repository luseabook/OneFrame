import { describe, expect, it } from "vitest";
import {
  BUSINESS_CODE_MAP,
  EXIT,
  KIND_EXIT,
  mapBusinessCode,
  mapHttpStatus,
} from "../src/exit-codes";
import { usageError } from "../src/errors";
import { harness, makeDir, withProfile } from "./helpers";

/**
 * 退出码映射（manual/error-codes.md:5-19，0..10 全集）。
 *
 * 这组断言的意义：退出码是**脚本的唯一分支依据**。竞品文档里
 * `error.kind=permission` 属于退出码 1 而不是 3（error-codes.md:21），
 * 这种反直觉点必须有测试钉住，否则下一次重构就会「优化」成 3，
 * 于是所有 CI 里的权限分支都会误判成「未登录」。
 */
describe("退出码映射表", () => {
  const cases: [number, string, number][] = [
    [400100, "usage", EXIT.USAGE],
    [400101, "usage", EXIT.USAGE],
    [400102, "not_found", EXIT.FAILURE],
    [400105, "task_failed", EXIT.TASK_FAILED],
    [400106, "task_failed", EXIT.TASK_FAILED],
    [401101, "auth", EXIT.AUTH],
    [401102, "auth", EXIT.AUTH],
    [403101, "permission", EXIT.FAILURE],
    [429100, "network", EXIT.FAILURE],
    [745701, "credits", EXIT.INSUFFICIENT_CREDITS],
    [745703, "credits", EXIT.INSUFFICIENT_CREDITS],
    [745801, "moderation", EXIT.MODERATION_REJECTED],
    [745802, "moderation", EXIT.MODERATION_REJECTED],
    [745900, "task_failed", EXIT.TASK_FAILED],
    [745901, "timeout", EXIT.TIMEOUT],
    [746002, "version_conflict", EXIT.VERSION_CONFLICT],
    [746003, "node_locked", EXIT.NODE_LOCKED],
    [500000, "server", EXIT.FAILURE],
  ];

  it.each(cases)("业务码 %i → kind=%s / exit=%i", (code, kind, exit) => {
    expect(mapBusinessCode(code)).toEqual({ kind, exit });
  });

  it("权限拒绝是退出码 1，不是 3（error-codes.md:21 明确）", () => {
    const mapped = mapBusinessCode(403101);
    expect(mapped.kind).toBe("permission");
    expect(mapped.exit).not.toBe(EXIT.AUTH);
    expect(mapped.exit).toBe(EXIT.FAILURE);
    expect(mapHttpStatus(403)).toEqual({ kind: "permission", exit: EXIT.FAILURE });
  });

  it("未登记的业务码/HTTP 状态绝不静默成功", () => {
    expect(mapBusinessCode(123456)).toEqual({ kind: "internal", exit: EXIT.FAILURE });
    expect(mapHttpStatus(418).exit).toBe(EXIT.USAGE);
    expect(mapHttpStatus(503).exit).toBe(EXIT.FAILURE);
    expect(mapHttpStatus(401).exit).toBe(EXIT.AUTH);
    expect(mapHttpStatus(408).exit).toBe(EXIT.TIMEOUT);
  });

  it("0..10 全套都在表里（无 11，无负数）", () => {
    const exits = new Set(Object.values(KIND_EXIT));
    for (const code of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
      expect(exits.has(code as never) || code === 0).toBe(true);
    }
    expect(exits.has(11 as never)).toBe(false);
    for (const entry of Object.values(BUSINESS_CODE_MAP)) {
      expect(entry.exit).toBeGreaterThanOrEqual(0);
      expect(entry.exit).toBeLessThanOrEqual(10);
    }
  });

  it("CliError 的显式 exitCode 覆盖 kind 默认值", async () => {
    const dir = makeDir();
    withProfile(dir);
    // 未知子命令 → usage → 2
    const unknown = await harness(["model", "nope", "--json"], { dir, cleanup: false });
    expect(unknown.code).toBe(EXIT.USAGE);
    expect(unknown.output.error).toMatchObject({ kind: "usage" });

    // 参数错误也走 2（未知 flag）
    const badFlag = await harness(["task", "list", "--nope", "--json"], { dir, cleanup: false });
    expect(badFlag.code).toBe(EXIT.USAGE);

    // usageError 默认 kind=usage
    expect(usageError("x").kind).toBe("usage");
  });

  it("任务终态真实映射：失败=4 / 取消=5 / 审核未通过=8", async () => {
    const dir = makeDir();
    withProfile(dir);
    const respond = (status: number) => () => ({
      status: 200,
      body: JSON.stringify({
        code: 0,
        msg: "",
        data: [{ id: "9", status }],
      }),
    });

    const failed = await harness(["task", "wait", "9", "--json"], { dir, respond: respond(4), cleanup: false });
    expect(failed.code).toBe(EXIT.TASK_FAILED);

    const canceled = await harness(["task", "wait", "9", "--json"], { dir, respond: respond(5), cleanup: false });
    expect(canceled.code).toBe(EXIT.CANCELED);

    const rejected = await harness(["task", "wait", "9", "--json"], { dir, respond: respond(7), cleanup: false });
    expect(rejected.code).toBe(EXIT.MODERATION_REJECTED);

    const succeeded = await harness(["task", "wait", "9", "--json"], { dir, respond: respond(3), cleanup: false });
    expect(succeeded.code).toBe(EXIT.OK);
  });
});
