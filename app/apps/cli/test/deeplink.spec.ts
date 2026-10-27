import { describe, expect, it } from "vitest";
import { parseArgv } from "../src/args";
import { buildDeeplink } from "../src/deeplinks";
import { isCliError } from "../src/errors";
import { harness } from "./helpers";

/**
 * 深链（commands/deeplink.md:4：离线生成、不读凭据、不发请求）。
 *
 * 断言两件事：URL 用的是**我方真实路由**（apps/web/pages）；缺必填上下文时
 * 返回 usage + `raw.needs_input=true`（deeplink.md:105），而不是生成半成品 URL。
 */
const webBaseUrl = "http://web.test";

const build = (argv: string[]): string => {
  const parsed = parseArgv(argv);
  return buildDeeplink(parsed.positionals[1], { parsed, webBaseUrl });
};

describe("deeplink", () => {
  it("canvas / task / pricing / credits / asset-lib 用我方路由", () => {
    expect(build(["deeplink", "canvas", "--canvas", "9"])).toBe("http://web.test/canvas/9");
    expect(build(["deeplink", "canvas", "--canvas", "9", "--episode", "8"])).toBe(
      "http://web.test/canvas/9?episode=8",
    );
    expect(build(["deeplink", "task", "--task-id", "77"])).toBe(
      "http://web.test/tasks?task_id=77",
    );
    expect(build(["deeplink", "pricing"])).toBe("http://web.test/pricing");
    expect(build(["deeplink", "credits"])).toBe("http://web.test/credits");
    expect(build(["deeplink", "asset-lib"])).toBe("http://web.test/assets");
  });

  it("project 的 tab 由 creation_mode 推导，显式 tab 优先", () => {
    expect(build(["deeplink", "project", "--set", "sp_id=5"])).toBe(
      "http://web.test/projects/5?tab=workshop",
    );
    expect(build(["deeplink", "project", "--set", "sp_id=5", "--set", "creation_mode=2"])).toBe(
      "http://web.test/projects/5?tab=canvas",
    );
    expect(
      build(["deeplink", "project", "--set", "sp_id=5", "--set", "tab=workshop", "--set", "creation_mode=2"]),
    ).toBe("http://web.test/projects/5?tab=workshop");
  });

  it("episode 有/无 --episode 生成不同页面", () => {
    expect(build(["deeplink", "episode", "--workspace", "5"])).toBe(
      "http://web.test/projects/5?tab=workshop&episode_list=1",
    );
    expect(build(["deeplink", "episode", "--workspace", "5", "--episode", "3"])).toBe(
      "http://web.test/projects/5?tab=workshop&episode=3",
    );
  });

  it("缺 sp_id 时返回 needs_input 的 usage 错误，不生成半成品 URL", () => {
    const parsed = parseArgv(["deeplink", "project"]);
    try {
      buildDeeplink("project", { parsed, webBaseUrl });
      throw new Error("should have thrown");
    } catch (error) {
      expect(isCliError(error)).toBe(true);
      if (isCliError(error)) {
        expect(error.kind).toBe("usage");
        expect((error.raw as { needs_input: boolean }).needs_input).toBe(true);
        expect((error.raw as { missing: string[] }).missing).toContain("sp_id");
      }
    }
  });

  it("命令走 envelope，link 同时放进 links.web", async () => {
    const result = await harness(["deeplink", "canvas", "--canvas", "9", "--json"]);
    expect(result.code).toBe(0);
    expect(result.calls).toHaveLength(0); // 不发请求
    expect((result.output.data as { url: string }).url).toBe("http://web.test/canvas/9");
    expect(result.output.links).toMatchObject({ web: "http://web.test/canvas/9" });
  });
});
