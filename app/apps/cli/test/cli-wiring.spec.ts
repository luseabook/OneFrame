import { describe, expect, it } from "vitest";
import { EXIT } from "../src/exit-codes";
import { COMMANDS } from "../src/registry";
import { harness, makeDir, withProfile } from "./helpers";

/**
 * 第 89 批：把「后端已有、CLI 没接」的 7 条骨架接上（骨架 40 → 33）。
 *
 * 断言口径：
 * - 请求**形状**（method/path/query/body）直接对照服务端契约，而不是只断言「退出 0」；
 * - `POST /generations` 强制 `Idempotency-Key`，所以这里断言「不传 --idempotency-key 时
 *   CLI 也真的带上了头」（自动生成），这是本批最容易悄悄回归的一条；
 * - `resource extract-wait` 是纯客户端轮询，用两轮 respond 造「运行中 → 成功」，
 *   并用失败终态/超时两条反例锁住退出码。
 */

const WIRED: Array<[string, string]> = [
  ["asset-lib", "get"],
  ["asset-lib", "move"],
  ["asset-lib", "tag-add"],
  ["ai", "upscale"],
  ["ai", "subtitle-erase"],
  ["voice", "list"],
  ["resource", "extract-wait"],
];

function specOf(group: string, cmd: string) {
  const found = COMMANDS.find((c) => c.group === group && c.cmd === cmd);
  if (!found) throw new Error(`registry 里找不到 ${group} ${cmd}`);
  return found;
}

function profileDir(): string {
  const dir = makeDir();
  withProfile(dir);
  return dir;
}

function okRespond(data: unknown) {
  return () => ({ status: 200, body: JSON.stringify({ code: 0, msg: "", data }) });
}

describe("第 89 批：7 条骨架接到真实端点/客户端能力", () => {
  it("注册表：骨架只剩 33 条，这 7 条都已就绪且有 method 或 impl", () => {
    const skeletons = COMMANDS.filter((c) => !c.ready);
    expect(skeletons).toHaveLength(33);
    for (const [group, cmd] of WIRED) {
      const spec = specOf(group, cmd);
      expect(spec.ready, `${group} ${cmd} 仍未见 ready`).toBe(true);
      expect(Boolean(spec.method) || Boolean(spec.impl), `${group} ${cmd} 缺 method/impl`).toBe(true);
      expect(spec.reason, `${group} ${cmd} 不该再有未就绪原因`).toBeUndefined();
    }
  });

  it("asset-lib get：GET /assets/{id}（第 88 批补的单资源端点）", async () => {
    const dir = profileDir();
    const result = await harness(["asset-lib", "get", "7", "--json"], {
      dir,
      cleanup: false,
      respond: okRespond({ id: "7", kind: "image" }),
    });
    expect(result.code).toBe(EXIT.OK);
    expect(result.calls).toHaveLength(1);
    expect(result.calls[0].method).toBe("GET");
    expect(result.calls[0].url).toBe("http://api.test/v1/assets/7");
    expect(result.output.data).toMatchObject({ id: "7", kind: "image" });
  });

  it("asset-lib move：位置参数进 body.folder_id；--set folder_id=null 表示移出目录", async () => {
    const dir = profileDir();
    const positional = await harness(["asset-lib", "move", "7", "12", "--json"], {
      dir,
      cleanup: false,
      respond: okRespond({ id: "7" }),
    });
    expect(positional.calls[0].method).toBe("PATCH");
    expect(positional.calls[0].url).toBe("http://api.test/v1/assets/7");
    expect(JSON.parse(positional.calls[0].body ?? "{}")).toMatchObject({ folder_id: "12" });

    const cleared = await harness(["asset-lib", "move", "7", "--set", "folder_id=null", "--dry-run", "--json"], {
      dir,
      cleanup: false,
    });
    expect(cleared.calls).toHaveLength(0);
    expect((cleared.output.data as Record<string, unknown>).body).toMatchObject({ folder_id: null });
    // 写命令的 --set 是给 body 的，不该再报「不接受 --set」（第 89 批修掉的误导警告）
    expect(cleared.stderr).not.toContain("不接受 --set");
  });

  it("asset-lib tag-add：--set 'tags=[…]' 按 JSON 解析成数组（整体替换语义）", async () => {
    const dir = profileDir();
    const dry = await harness(["asset-lib", "tag-add", "7", "--set", 'tags=["a","b"]', "--dry-run", "--json"], {
      dir,
      cleanup: false,
    });
    expect((dry.output.data as Record<string, unknown>).method).toBe("PATCH");
    expect((dry.output.data as Record<string, unknown>).body).toMatchObject({ tags: ["a", "b"] });

    const real = await harness(["asset-lib", "tag-add", "7", "--set", 'tags=["a"]', "--json"], {
      dir,
      cleanup: false,
      respond: okRespond({ id: "7", tags: ["a"] }),
    });
    expect(real.code).toBe(EXIT.OK);
    expect(JSON.parse(real.calls[0].body ?? "{}")).toMatchObject({ tags: ["a"] });
  });

  it("ai upscale：POST /generations 的 body 形状 + 自动 Idempotency-Key", async () => {
    const dir = profileDir();
    const dry = await harness(["ai", "upscale", "https://cdn.test/x.mp4", "--dry-run", "--json"], {
      dir,
      cleanup: false,
    });
    const data = dry.output.data as Record<string, unknown>;
    expect(data.method).toBe("POST");
    expect(data.path).toBe("/generations");
    expect(data.body).toMatchObject({
      mode: "video_upscale",
      model: "toolbox-video-upscale",
      options: { resolution: "1080p" },
      input: { reference_uris: ["https://cdn.test/x.mp4"] },
    });
    expect(typeof data.idempotency_key).toBe("string");
    expect(String(data.idempotency_key)).not.toBe("");

    const real = await harness(["ai", "upscale", "https://cdn.test/x.mp4", "--json"], {
      dir,
      cleanup: false,
      respond: okRespond({ task_id: "9001" }),
    });
    expect(real.code).toBe(EXIT.OK);
    expect(real.calls).toHaveLength(1);
    const header = real.calls[0].headers["idempotency-key"];
    expect(typeof header).toBe("string");
    expect(String(header)).not.toBe("");
    expect(real.output.data).toMatchObject({ task_id: "9001" });
  });

  it("ai subtitle-erase：默认自动检测；框选区域用 --set 覆盖 mode/model", async () => {
    const dir = profileDir();
    const auto = await harness(["ai", "subtitle-erase", "https://cdn.test/y.mp4", "--dry-run", "--json"], {
      dir,
      cleanup: false,
    });
    expect((auto.output.data as Record<string, unknown>).body).toMatchObject({
      mode: "de_subtitle_auto",
      model: "toolbox-de-subtitle-auto",
      options: { resolution: "per_call" },
      input: { reference_uris: ["https://cdn.test/y.mp4"] },
    });

    const region = await harness(
      [
        "ai",
        "subtitle-erase",
        "https://cdn.test/y.mp4",
        "--set",
        "mode=de_subtitle_region",
        "--set",
        "model=toolbox-de-subtitle-region",
        "--dry-run",
        "--json",
      ],
      { dir, cleanup: false },
    );
    expect((region.output.data as Record<string, unknown>).body).toMatchObject({
      mode: "de_subtitle_region",
      model: "toolbox-de-subtitle-region",
    });
  });

  it("voice list：GET /models?capability=speech（fixedQuery 生效，--set 白名单仍可覆盖）", async () => {
    const dir = profileDir();
    const plain = await harness(["voice", "list", "--json"], {
      dir,
      cleanup: false,
      respond: okRespond([]),
    });
    expect(plain.calls[0].method).toBe("GET");
    expect(plain.calls[0].url).toBe("http://api.test/v1/models?capability=speech");

    const filtered = await harness(["voice", "list", "--set", "visible=1", "--json"], {
      dir,
      cleanup: false,
      respond: okRespond([]),
    });
    const url = new URL(filtered.calls[0].url);
    expect(url.searchParams.get("capability")).toBe("speech");
    expect(url.searchParams.get("visible")).toBe("1");
  });

  it("resource extract-wait：轮询到成功终态（两轮 GET /extraction/tasks/{id}）", async () => {
    const dir = profileDir();
    const rows = [
      { id: "ET1", status: 1, status_name: "running" },
      { id: "ET1", status: 2, status_name: "succeeded" },
    ];
    let index = 0;
    // 不带 --json 才能看到进度行（`--json` 时 stderr 只留必要信息）
    const result = await harness(["resource", "extract-wait", "ET1"], {
      dir,
      cleanup: false,
      respond: () => {
        const row = rows[Math.min(index, rows.length - 1)];
        index += 1;
        return { status: 200, body: JSON.stringify({ code: 0, msg: "", data: row }) };
      },
    });
    expect(result.code).toBe(EXIT.OK);
    expect(result.calls).toHaveLength(2);
    expect(result.calls[0].method).toBe("GET");
    expect(result.calls[0].url).toBe("http://api.test/v1/extraction/tasks/ET1");
    expect(result.stderr).toContain("[wait] ET1");
    expect(result.output.data).toMatchObject({ task: { status: 2 } });
  });

  it("resource extract-wait：失败终态映射成退出码 4（task_failed），不是泛指失败", async () => {
    const dir = profileDir();
    const result = await harness(["resource", "extract-wait", "ET1", "--json"], {
      dir,
      cleanup: false,
      respond: okRespond({ id: "ET1", status: 3, status_name: "failed" }),
    });
    expect(result.code).toBe(EXIT.TASK_FAILED);
    expect(result.output.error).toMatchObject({ kind: "task_failed" });
  });

  it("resource extract-wait：--timeout 到点抛 timeout（退出码 6），不无限挂住", async () => {
    const dir = profileDir();
    const result = await harness(["resource", "extract-wait", "ET1", "--timeout", "1ms", "--json"], {
      dir,
      cleanup: false,
      respond: okRespond({ id: "ET1", status: 1, status_name: "running" }),
    });
    expect(result.code).toBe(EXIT.TIMEOUT);
    expect(result.output.error).toMatchObject({ kind: "timeout" });
    expect(result.calls.length).toBeGreaterThanOrEqual(1);
  });
});
