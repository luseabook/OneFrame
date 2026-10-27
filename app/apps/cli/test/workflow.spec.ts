import { describe, expect, it } from "vitest";
import { readConfig } from "../src/config";
import { EXIT } from "../src/exit-codes";
import { harness, makeDir, withProfile } from "./helpers";

/**
 * `workflow detect/status/resume`（commands/workflow.md）。
 *
 * 三条契约要点：
 * 1. detect 只发 GET，且缺项走 `data.missing`（workflow.md:154：探测不是错误路径）；
 * 2. status 附本地记录，但**不参与**阶段判定（workflow.md:157）；
 * 3. resume 的 `--from` 不证明前置条件（_stage-machine.md:97），远端已前进时不得回退
 *    （_stage-machine.md:105）——这里断言 warnings 而非静默接受。
 */
const DETECTION = {
  scope: "studio",
  project_id: "1001",
  canvas_id: null,
  stage: "asset",
  completed: ["project", "script"],
  pending: ["asset", "storyboard", "render"],
  missing: [{ key: "resource", reason: "项目下没有已定稿资产", goto_stage: "asset" }],
  next_command: "oneframe resource extract 1001 --dry-run --json",
};

const respondDetection = () => ({
  status: 200,
  body: JSON.stringify({ code: 0, msg: "", data: DETECTION }),
});

describe("workflow 客户端", () => {
  it("detect 带 scope 与 project_id，退出 0（缺项不算失败）", async () => {
    const dir = makeDir();
    withProfile(dir);
    const result = await harness(
      ["workflow", "detect", "--scope", "studio", "--workspace", "1001", "--json"],
      { dir, respond: respondDetection, cleanup: false },
    );
    expect(result.code).toBe(EXIT.OK);
    expect(result.calls).toHaveLength(1);
    expect(result.calls[0].method).toBe("GET");
    expect(result.calls[0].url).toBe("http://api.test/v1/workflow/detect?scope=studio&project_id=1001");
    const data = result.output.data as typeof DETECTION;
    expect(data.stage).toBe("asset");
    expect(data.missing[0]).toMatchObject({ key: "resource", goto_stage: "asset" });
    expect(data.next_command).toContain("resource extract");
  });

  it("detect 用本地绑定作为 workspace 兜底（workspace use 之后不带 --workspace）", async () => {
    const dir = makeDir();
    withProfile(dir, { bindings: { workspace_id: "2002" } });
    const result = await harness(["workflow", "detect", "--json"], { dir, cleanup: false });
    expect(result.calls[0].url).toBe("http://api.test/v1/workflow/detect?scope=studio&project_id=2002");
  });

  it("canvas 作用域改传 canvas_id", async () => {
    const dir = makeDir();
    withProfile(dir);
    const result = await harness(
      ["workflow", "detect", "--scope", "canvas", "--canvas", "33", "--json"],
      { dir, respond: respondDetection, cleanup: false },
    );
    expect(result.calls[0].url).toBe("http://api.test/v1/workflow/detect?scope=canvas&canvas_id=33");
    expect(result.code).toBe(EXIT.OK);
  });

  it("status 附 local_record，但不改判定", async () => {
    const dir = makeDir();
    withProfile(dir);
    await harness(["workflow", "resume", "--from", "script", "--name", "demo", "--json"], {
      dir,
      respond: respondDetection,
      cleanup: false,
    });
    const result = await harness(["workflow", "status", "--name", "demo", "--json"], {
      dir,
      respond: respondDetection,
      cleanup: false,
    });
    const data = result.output.data as { stage: string; local_record: { stage: string } };
    expect(data.local_record.stage).toBe("script");
    // 本地记录是 script，但远端判定是 asset：以远端为准
    expect(data.stage).toBe("asset");
  });

  it("resume 记录位置；远端已前进时给 warning 而不是回退", async () => {
    const dir = makeDir();
    withProfile(dir);
    const result = await harness(
      ["workflow", "resume", "--from", "script", "--name", "run1", "--json"],
      { dir, respond: respondDetection, cleanup: false },
    );
    expect(result.code).toBe(EXIT.OK);
    const data = result.output.data as {
      from_stage: string;
      pending_from: string[];
      warnings: string[];
    };
    expect(data.from_stage).toBe("script");
    expect(data.pending_from).toEqual(["script", "asset", "storyboard", "render"]);
    expect(data.warnings[0]).toContain("未回退");
    expect(readConfig(dir).workflow_records.run1.stage).toBe("script");
  });

  it("resume 缺 --from 或取值非法 → 退出 2", async () => {
    const dir = makeDir();
    withProfile(dir);
    const missing = await harness(["workflow", "resume", "--json"], { dir, cleanup: false });
    expect(missing.code).toBe(EXIT.USAGE);

    const invalid = await harness(["workflow", "resume", "--from", "render2", "--json"], {
      dir,
      cleanup: false,
    });
    expect(invalid.code).toBe(EXIT.USAGE);
    expect(invalid.calls).toHaveLength(0);
  });

  it("未登录时 detect 退出 3（鉴权），不发请求", async () => {
    const result = await harness(["workflow", "detect", "--json"]);
    expect(result.code).toBe(EXIT.AUTH);
    expect(result.calls).toHaveLength(0);
    expect(result.output.error).toMatchObject({ kind: "auth" });
  });
});
