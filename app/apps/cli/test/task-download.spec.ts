import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EXIT } from "../src/exit-codes";
import { harness, makeDir, withProfile } from "./helpers";

/**
 * `task download` 契约（竞品 `commands/task.md:165`：下载任务产物）。
 *
 * 这条命令此前**只有实现、没有测试**（进度文档 §3 #9 里"`task download` 不落盘"其实是过期描述：
 * 早就写了 `outputs/` 落盘逻辑，但没人验证过，谁也不敢说它对）。本 spec 钉四件事：
 *
 * 1. **真的落盘**：文件写在 `<cwd>/outputs/<task_id>-<n>.<ext>`，内容是下载到的字节（不是占位）；
 * 2. **不泄露签名 URL**：`download-url` 返回的是限时凭据，stdout/stderr 都不能出现它
 *    （与 `error-codes.md:23` "日志不得出现 token/cookie" 同一条红线）；
 * 3. **部分失败不阻断整包**：第 2 个产物下载失败时，第 1 个仍落盘，`failed[]` 记明细，退出码 0；
 * 4. **全失败才算失败**：全部下载失败 → `kind=not_found` + 非 0 退出码；无产物同理；
 *    缺 TASK_ID → usage(2)。
 */
describe("task download：落盘 / 不泄露签名 URL / 部分成功语义", () => {
  const taskId = "108500000000000001";

  /** 组装一个"详情 + 签名 URL"的 transport 应答器 */
  function responder(options: {
    results?: Array<{ uri?: string }>;
    filenames?: Record<number, string>;
    failIndexes?: number[];
  }) {
    const results = options.results ?? [{ uri: "u/1/tasks/x/r0.png" }, { uri: "u/1/tasks/x/r1.mp4" }];
    return (req: { method: string; url: string }) => {
      // TransportRequest 传的是绝对 url（http://api.test/v1/...）：先从 URL 里还原 path
      const reqPath = new URL(req.url).pathname.replace(/^\/v1/, "");
      if (req.method === "GET" && reqPath === `/tasks/${taskId}`) {
        return {
          status: 200,
          body: JSON.stringify({ code: 0, msg: "", data: { task_id: taskId, status: 3, results } }),
        };
      }
      const match = /^\/tasks\/[^/]+\/results\/(\d+)\/download-url$/.exec(reqPath);
      if (req.method === "GET" && match) {
        const index = Number(match[1]);
        if ((options.failIndexes ?? []).includes(index)) {
          return { status: 404, body: JSON.stringify({ code: 400102, msg: "result not found", data: null }) };
        }
        return {
          status: 200,
          body: JSON.stringify({
            code: 0,
            msg: "",
            data: {
              url: `https://files.test/sig-secret-${index}?X-Signature=deadbeef${index}`,
              filename: options.filenames?.[index] ?? `r${index - 1}.bin`,
              expires_in: 86400,
            },
          }),
        };
      }
      return { status: 200, body: JSON.stringify({ code: 0, msg: "", data: {} }) };
    };
  }

  it("成功：两个产物都写进 outputs/，扩展名取服务端 filename，内容就是下载到的字节", async () => {
    const dir = makeDir();
    withProfile(dir);
    const result = await harness(["task", "download", taskId, "--json"], {
      dir,
      cleanup: false,
      respond: responder({
        filenames: { 1: `task-${taskId}-0.png`, 2: `task-${taskId}-1.mp4` },
      }),
      fetchBinary: async (url) => Buffer.from(`payload:${url}`),
    });
    expect(result.code).toBe(EXIT.OK);

    const data = result.output.data as {
      task_id: string;
      count: number;
      files: Array<{ n: number; path: string; bytes: number }>;
      failed: unknown[];
      url_exposed: boolean;
    };
    expect(data.task_id).toBe(taskId);
    expect(data.count).toBe(2);
    expect(data.failed).toHaveLength(0);
    // 明确标记：签名 URL 没有进输出
    expect(data.url_exposed).toBe(false);

    const outDir = join(dir, "outputs");
    const names = readdirSync(outDir).sort();
    expect(names).toEqual([`${taskId}-1.png`, `${taskId}-2.mp4`]);
    for (const [index, name] of names.entries()) {
      const bytes = readFileSync(join(outDir, name), "utf8");
      expect(bytes.startsWith("payload:https://files.test/sig-secret-")).toBe(true);
      expect(data.files[index]!.bytes).toBeGreaterThan(0);
    }
  });

  it("不泄露签名 URL：stdout / stderr 都不含 sig-secret 或 X-Signature", async () => {
    const dir = makeDir();
    withProfile(dir);
    const result = await harness(["task", "download", taskId, "--json"], {
      dir,
      cleanup: false,
      respond: responder({}),
    });
    expect(result.code).toBe(EXIT.OK);
    expect(result.stdout).not.toContain("sig-secret");
    expect(result.stdout).not.toContain("X-Signature");
    expect(result.stderr).not.toContain("sig-secret");
    // 但确实发生了下载（否定断言不能靠"什么都没做"通过）
    expect(result.binaryCalls.length).toBe(2);
    expect(result.binaryCalls[0]).toContain("sig-secret");
  });

  it("部分失败：第 2 个产物失败不影响第 1 个，failed[] 记明细，退出码仍 0", async () => {
    const dir = makeDir();
    withProfile(dir);
    const result = await harness(["task", "download", taskId, "--json"], {
      dir,
      cleanup: false,
      respond: responder({ failIndexes: [2] }),
    });
    expect(result.code).toBe(EXIT.OK);
    const data = result.output.data as {
      count: number;
      files: Array<{ n: number }>;
      failed: Array<{ n: number; error: string }>;
    };
    expect(data.count).toBe(1);
    expect(data.files.map((f) => f.n)).toEqual([1]);
    expect(data.failed).toHaveLength(1);
    expect(data.failed[0]!.n).toBe(2);
    expect(existsSync(join(dir, "outputs", `${taskId}-1.bin`))).toBe(true);
    expect(existsSync(join(dir, "outputs", `${taskId}-2.bin`))).toBe(false);
  });

  it("全部失败：退出码非 0 且 kind=not_found（不是静默成功）", async () => {
    const dir = makeDir();
    withProfile(dir);
    const result = await harness(["task", "download", taskId, "--json"], {
      dir,
      cleanup: false,
      respond: responder({ failIndexes: [1, 2] }),
    });
    expect(result.code).not.toBe(EXIT.OK);
    const envelope = result.output as { error?: { kind?: string } };
    expect(envelope.error?.kind).toBe("not_found");
  });

  it("无产物：明确报 not_found（带任务状态，便于判断是在跑还是失败）", async () => {
    const dir = makeDir();
    withProfile(dir);
    const result = await harness(["task", "download", taskId, "--json"], {
      dir,
      cleanup: false,
      respond: responder({ results: [] }),
    });
    expect(result.code).not.toBe(EXIT.OK);
    const envelope = result.output as { error?: { kind?: string; raw?: { task_id?: string; status?: number } } };
    expect(envelope.error?.kind).toBe("not_found");
    expect(envelope.error?.raw?.task_id).toBe(taskId);
  });

  it("缺 TASK_ID → usage（退出码 2），且不发任何请求", async () => {
    const dir = makeDir();
    withProfile(dir);
    const result = await harness(["task", "download", "--json"], { dir, cleanup: false });
    expect(result.code).toBe(EXIT.USAGE);
    expect(result.calls).toHaveLength(0);
  });
});
