import { describe, expect, it } from "vitest";
import { EXIT } from "../src/exit-codes";
import { decideWrite, readLedger, upsertEntry, writeLedger } from "../src/ledger";
import { harness, makeDir, withProfile } from "./helpers";

/**
 * 幂等：两件事分两层测。
 *
 * 1. **透传**：写命令必须把 `Idempotency-Key` 放进请求头（服务端表
 *    `idempotency_records`，schema.ts:342）。
 * 2. **本地账本**：三态保护（commands/ledger.md:5-16）——applied 短路重放、
 *    pending/in_doubt 拒绝。竞品 `ledger.md:11` 说拒绝时用退出码 11，但
 *    `error-codes.md` 只定义 0..10；我方按 0..10 取 1，并断言 state 仍可见。
 */
describe("幂等键与本地账本", () => {
  it("写命令把 Idempotency-Key 放进请求头", async () => {
    const dir = makeDir();
    withProfile(dir);
    const result = await harness(
      ["task", "cancel", "77", "--idempotency-key", "idem-1", "--json"],
      {
        dir,
        respond: () => ({ status: 200, body: JSON.stringify({ code: 0, msg: "", data: { ok: true } }) }),
        cleanup: false,
      },
    );
    expect(result.calls).toHaveLength(1);
    expect(result.calls[0].headers["idempotency-key"]).toBe("idem-1");
    expect(result.calls[0].method).toBe("POST");
    expect(result.calls[0].url).toBe("http://api.test/v1/tasks/77/cancel");
    expect(result.code).toBe(EXIT.OK);
  });

  it("成功后账本记为 applied，同键再写按重放短路（第二次 0 请求）", async () => {
    const dir = makeDir();
    withProfile(dir);
    const respond = () => ({
      status: 200,
      body: JSON.stringify({ code: 0, msg: "", data: { canceled: true, task_id: "77" } }),
    });

    const first = await harness(["task", "cancel", "77", "--idempotency-key", "idem-2", "--json"], {
      dir,
      respond,
      cleanup: false,
    });
    expect(first.calls).toHaveLength(1);
    const entry = readLedger(dir).find((e) => e.key === "idem-2");
    expect(entry?.state).toBe("applied");

    const second = await harness(["task", "cancel", "77", "--idempotency-key", "idem-2", "--json"], {
      dir,
      respond,
      cleanup: false,
    });
    expect(second.calls).toHaveLength(0);
    expect(second.code).toBe(EXIT.OK);
    expect(second.output.data).toEqual({ canceled: true, task_id: "77" });
  });

  it("pending 状态拒绝同键写（退出 1，raw.state 可见）", async () => {
    const dir = makeDir();
    withProfile(dir);
    writeLedger(dir, [
      {
        key: "idem-3",
        state: "pending",
        endpoint: "POST /tasks/1/cancel",
        item_count: 1,
        at: "2026-01-01T00:00:00.000Z",
      },
    ]);
    const result = await harness(["task", "cancel", "1", "--idempotency-key", "idem-3", "--json"], {
      dir,
      cleanup: false,
    });
    expect(result.calls).toHaveLength(0);
    expect(result.code).toBe(EXIT.FAILURE);
    expect(result.output.error).toMatchObject({ kind: "internal" });
    expect((result.output.error as { raw: { state: string } }).raw.state).toBe("pending");
  });

  it("in_doubt 需要人工复核；网络失败会留下 in_doubt", async () => {
    const dir = makeDir();
    withProfile(dir);
    // 第一次：transport 抛网络错 → 账本落 in_doubt
    const networkFail = await harness(
      ["task", "retry", "5", "--idempotency-key", "idem-4", "--json"],
      {
        dir,
        respond: () => {
          throw new Error("socket hang up");
        },
        cleanup: false,
      },
    );
    expect(networkFail.calls).toHaveLength(1);
    expect(networkFail.code).toBe(EXIT.FAILURE);
    expect(networkFail.output.error).toMatchObject({ kind: "network" });
    const entry = readLedger(dir).find((e) => e.key === "idem-4");
    expect(entry?.state).toBe("in_doubt");

    // 第二次：同键被拦（0 请求）
    const blocked = await harness(["task", "retry", "5", "--idempotency-key", "idem-4", "--json"], {
      dir,
      cleanup: false,
    });
    expect(blocked.calls).toHaveLength(0);
    expect((blocked.output.error as { raw: { state: string } }).raw.state).toBe("in_doubt");

    // --force-replay 放行一次（ledger.md:112）
    const replay = await harness(
      ["task", "retry", "5", "--idempotency-key", "idem-4", "--force-replay", "idem-4", "--json"],
      {
        dir,
        respond: () => ({ status: 200, body: JSON.stringify({ code: 0, msg: "", data: { ok: true } }) }),
        cleanup: false,
      },
    );
    expect(replay.calls).toHaveLength(1);
    expect(replay.code).toBe(EXIT.OK);
  });

  it("decideWrite 纯函数语义（applied 重放 / pending 拦 / in_doubt 拦 / 无键放行）", () => {
    const base = { endpoint: "POST /x", item_count: 1, at: "t" };
    const entries = upsertEntry(
      [
        { key: "a", state: "applied", data: { v: 1 }, ...base },
        { key: "b", state: "pending", ...base },
        { key: "c", state: "in_doubt", ...base },
      ],
      { key: "d", state: "applied", ...base },
    );
    expect(decideWrite(entries, "missing").action).toBe("proceed");
    expect(decideWrite(entries, "a").action).toBe("replay");
    expect(decideWrite(entries, "b").action).toBe("blocked");
    expect(decideWrite(entries, "c").action).toBe("blocked");
    expect(decideWrite(entries, "c", { forceReplay: "c" }).action).toBe("proceed");
    // applied 不接受 force-replay（删掉等于放开重放保护）
    expect(decideWrite(entries, "a", { forceReplay: "a" }).action).toBe("replay");
  });
});
