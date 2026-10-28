import { describe, expect, it } from "vitest";
import { CliError } from "../src/errors";
import { paginatedView, applyTransform } from "../src/transforms";
import { harness, makeDir, withProfile } from "./helpers";

/**
 * 响应整形。契约来自竞品命令页写明的字段，例如：
 * - `credits balance` 输出余额 ← commands/credits.md:23
 * - `model params image NAME` 输出 `generation.<mode>` ← commands/model.md:115
 * - `episode list` / `storyboard list` 取剧集与分镜列表 ← commands/episode.md:57、storyboard.md:61
 * - 列表分页统一带 count/page/has_more ← commands/task.md:58
 */
describe("响应整形", () => {
  it("credits balance 只取 credits 段", () => {
    const me = { user: { id: "1" }, space: { id: "100" }, credits: { balance: 88, frozen: 3 } };
    expect(applyTransform("credits", me)).toEqual({ balance: 88, frozen: 3 });
  });

  it("model search 按展示名/说明做大小写不敏感过滤", () => {
    const models = [
      { name: "tgi-2", display_name: "TGI 2", description: "图像模型" },
      { name: "seedance", display_name: "Seedance", description: "视频" },
    ];
    expect(applyTransform("modelSearch", models, { keyword: "seed" })).toHaveLength(1);
    expect(applyTransform("modelSearch", models, { keyword: "图像" })).toHaveLength(1);
    expect(applyTransform("modelSearch", models, { keyword: "zzz" })).toHaveLength(0);
  });

  it("model params 找不到模型 → not_found（不返回空对象冒充成功）", () => {
    try {
      applyTransform("modelByName", [{ name: "a", display_name: "A" }], { modelName: "B" });
      throw new Error("should throw");
    } catch (error) {
      expect(error).toBeInstanceOf(CliError);
      expect((error as CliError).kind).toBe("not_found");
    }
  });

  it("model params 把 modes 映射成竞品的 params.generation 口径", () => {
    const shaped = applyTransform(
      "modelByName",
      [{ name: "tgi-2", display_name: "TGI 2", types: ["image"], modes: { text2image: { ratios: ["16:9"] } } }],
      { modelName: "TGI 2" },
    ) as Record<string, unknown>;
    expect(shaped.params).toEqual({ text2image: { ratios: ["16:9"] } });
  });

  it("storyboard list/get 取 storyboards 段并支持按 id 精确取", () => {
    const detail = {
      episode: { id: "9" },
      storyboards: [
        { id: "1", shot_no: 1 },
        { id: "2", shot_no: 2 },
      ],
    };
    const list = applyTransform("storyboardsOfEpisode", detail) as { count: number };
    expect(list.count).toBe(2);
    expect(applyTransform("storyboardsOfEpisode", detail, { storyboardId: "2" })).toMatchObject({
      id: "2",
    });
    try {
      applyTransform("storyboardsOfEpisode", detail, { storyboardId: "404" });
      throw new Error("should throw");
    } catch (error) {
      expect((error as CliError).kind).toBe("not_found");
    }
  });

  it("node get 在客户端按 id 过滤，找不到 → not_found", () => {
    const nodes = { list: [{ id: "a" }, { id: "b" }] };
    expect(applyTransform("nodeById", nodes, { nodeId: "b" })).toMatchObject({ id: "b" });
    try {
      applyTransform("nodeById", nodes, { nodeId: "z" });
      throw new Error("should throw");
    } catch (error) {
      expect((error as CliError).kind).toBe("not_found");
    }
  });

  it("分页视图统一 count/page/has_more/next_page", () => {
    expect(paginatedView([1, 2], 5, 1, 2)).toMatchObject({
      count: 5,
      page: 1,
      page_size: 2,
      has_more: true,
      next_page: 2,
    });
    expect(paginatedView([1, 2], 2, 1, 2)).toMatchObject({ has_more: false, next_page: null });
  });

  /**
   * 第 72 批：竞品有 `credits log`（旧接口，`event_type` + 无符号 `val`）与 `credits flows`
   * （新接口，带符号 `points`）两个语义不同的接口，文档自己写明不能混用（commands/credits.md:68）。
   * 我方只有一份带符号账本，旧语义由 CLI 派生 —— 这里钉住换算规则，防止有人"顺手"把符号改掉。
   */
  it("credits log 把带符号 delta 派生成旧接口口径（event_type 1/2 + 无符号 val）", () => {
    const flows = {
      list: [
        { id: "1", kind: "recharge", delta: 80, frozen_delta: 0, balance_after: 80, task_id: null, memo: "gift", created_at: "t1" },
        { id: "2", kind: "settle", delta: -12, frozen_delta: 0, balance_after: 68, task_id: "9", memo: null, created_at: "t2" },
        { id: "3", kind: "freeze", delta: 0, frozen_delta: 5, balance_after: 68, task_id: "9", memo: null, created_at: "t3" },
      ],
      total: 3,
      page: 1,
      page_size: 20,
    };
    const shaped = applyTransform("creditsLog", flows) as {
      count: number;
      has_more: boolean;
      list: Array<Record<string, unknown>>;
    };
    expect(shaped.count).toBe(3);
    expect(shaped.has_more).toBe(false);
    expect(shaped.list.map((row) => [row.event_type, row.val])).toEqual([
      [1, 80],
      [2, 12],
      [1, 0],
    ]);
    // 原始带符号字段不被改写（只增不改）：kind/task_id/created_at 照旧透出
    expect(shaped.list[1]).toMatchObject({ kind: "settle", task_id: "9", created_at: "t2" });
  });

  it("通过 run 链路：task list 归一页；episode list 取 episodes", async () => {
    const dir = makeDir();
    withProfile(dir);
    const tasks = await harness(["task", "list", "--json"], {
      dir,
      respond: () => ({
        status: 200,
        body: JSON.stringify({ code: 0, msg: "", data: { list: [{ id: "1" }], total: 9, page: 1, page_size: 1 } }),
      }),
      cleanup: false,
    });
    expect(tasks.output.data).toMatchObject({ count: 9, has_more: true, next_page: 2 });

    const episodes = await harness(["episode", "list", "--workspace", "5", "--json"], {
      dir,
      respond: () => ({
        status: 200,
        body: JSON.stringify({
          code: 0,
          msg: "",
          data: { project: { id: "5" }, episodes: [{ id: "1" }, { id: "2" }] },
        }),
      }),
      cleanup: false,
    });
    expect(episodes.output.data).toMatchObject({ count: 2 });
    expect((episodes.output.data as { episodes: unknown[] }).episodes).toHaveLength(2);
    expect(episodes.calls[0].url).toBe("http://api.test/v1/projects/5/matrix");
  });
});
