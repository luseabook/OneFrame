import { describe, expect, it } from "vitest";
import { EXIT } from "../src/exit-codes";
import { harness, makeDir, withProfile } from "./helpers";

/**
 * `--dry-run` 契约（`manual/workflow/_stage-machine.md:101`：批量或付费写操作先
 * `--dry-run --json`；`commands/material.md:26`：预演不发写请求，退出码 0）。
 *
 * 断言方式：注入一个「被调用就记数」的 transport，dry-run 后 calls 必须为空。
 * 这是唯一能真正证明「没发请求」的测法（只看输出无法证明）。
 */
describe("--dry-run 不发请求", () => {
  it("写命令 dry-run：0 个请求、退出 0、输出 method/path/body", async () => {
    const dir = makeDir();
    withProfile(dir);
    const result = await harness(
      ["workspace", "create", "demo", "--set", "creation_mode=1", "--dry-run", "--json"],
      { dir, cleanup: false },
    );
    expect(result.calls).toHaveLength(0);
    expect(result.code).toBe(EXIT.OK);
    const data = result.output.data as Record<string, unknown>;
    expect(data.dry_run).toBe(true);
    expect(data.method).toBe("POST");
    expect(data.path).toBe("/projects");
    expect(data.body).toMatchObject({ title: "demo", creation_mode: 1 });
    expect(data.credits_estimate).toBeNull();
  });

  it("付费命令 dry-run 给出明确的预估口径（source=unavailable + 原因）", async () => {
    const dir = makeDir();
    withProfile(dir);
    const result = await harness(
      [
        "storyboard",
        "batch-generate",
        "88",
        "--workspace",
        "5",
        "--set",
        "ai_model_mark=MODEL",
        "--dry-run",
        "--json",
      ],
      { dir, cleanup: false },
    );
    expect(result.calls).toHaveLength(0);
    const data = result.output.data as Record<string, unknown>;
    expect(data.credits_estimate).toMatchObject({ source: "unavailable" });
    expect(String((data.credits_estimate as { reason: string }).reason)).toContain("credits estimate");
  });

  it("dry-run 不需要登录也不会发请求（只打印将发送的请求）", async () => {
    // 不写 profile：dry-run 在鉴权检查之前短路
    const result = await harness(["canvas", "delete", "9", "--dry-run", "--json"]);
    expect(result.calls).toHaveLength(0);
    expect(result.code).toBe(EXIT.OK);
    expect((result.output.data as Record<string, unknown>).method).toBe("DELETE");
  });

  it("不带 --dry-run 的写命令会真的发请求，并带 Idempotency-Key", async () => {
    const dir = makeDir();
    withProfile(dir);
    const result = await harness(
      ["workspace", "edit", "5", "renamed", "--idempotency-key", "k-1", "--json"],
      {
        dir,
        respond: () => ({ status: 200, body: JSON.stringify({ code: 0, msg: "", data: { id: "5" } }) }),
        cleanup: false,
      },
    );
    expect(result.calls).toHaveLength(1);
    const call = result.calls[0];
    expect(call.method).toBe("PATCH");
    expect(call.url).toBe("http://api.test/v1/projects/5");
    expect(call.headers["idempotency-key"]).toBe("k-1");
    expect(JSON.parse(call.body ?? "{}")).toMatchObject({ title: "renamed" });
  });

  it("参数缺失时 dry-run 也报参数错（退出 2），不会静默成功", async () => {
    const dir = makeDir();
    withProfile(dir);
    const result = await harness(["workspace", "delete", "--dry-run", "--json"], { dir, cleanup: false });
    expect(result.code).toBe(EXIT.USAGE);
    expect(result.output.ok).toBe(false);
    expect(result.calls).toHaveLength(0);
  });
});
