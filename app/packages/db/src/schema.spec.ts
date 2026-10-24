import { describe, expect, it } from "vitest";
import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import * as schema from "./schema";

// 数据层契约测试：锁定 database.md 的 P1 表/关键列/索引，防止 schema 漂移。
// 不连接数据库（纯结构断言），可在 CI 无 PG 环境运行。
const cols = (table: PgTable): string[] => getTableConfig(table).columns.map((c) => c.name);
const indexes = (table: PgTable) => getTableConfig(table).indexes.map((i) => i.config);

describe("db schema contract (database.md P1)", () => {
  it("contains the 23 P1/P1' tables", () => {
    const names = [
      schema.adminUsers,
      schema.assetFolders,
      schema.assets,
      schema.creditAccounts,
      schema.creditFlows,
      schema.episodes,
      schema.idempotencyRecords,
      schema.identities,
      schema.inviteCodes,
      schema.inviteRedemptions,
      schema.modelPrices,
      schema.models,
      schema.projectAssets,
      schema.scriptProjects,
      schema.skus,
      schema.spaceMembers,
      schema.spaces,
      schema.storyboardAssets,
      schema.storyboards,
      schema.taskEvents,
      schema.tasks,
      schema.users,
      schema.waitlistEntries,
    ].map((t) => getTableConfig(t).name);

    expect(names).toHaveLength(23);
    expect(names).toEqual(
      expect.arrayContaining([
        "script_projects",
        "episodes",
        "project_assets",
        "storyboards",
        "storyboard_assets",
        "assets",
        "asset_folders",
      ]),
    );
    expect(names).toEqual(
      expect.arrayContaining([
        "users",
        "identities",
        "spaces",
        "credit_accounts",
        "credit_flows",
        "models",
        "model_prices",
        "tasks",
        "task_events",
        "idempotency_records",
      ]),
    );
  });

  it("tasks keeps pipeline/idempotency/credit columns", () => {
    expect(cols(schema.tasks)).toEqual(
      expect.arrayContaining([
        "space_id",
        "user_id",
        "episode_id",
        "shot_id",
        "attempt_no",
        "origin_task_id",
        "scene",
        "dedupe_key",
        "credits_frozen",
        "credits_settled",
        "expire_at",
      ]),
    );
  });

  it("models carries the RE catalog fields", () => {
    expect(cols(schema.models)).toEqual(
      expect.arrayContaining(["mode_order", "modes", "scene_modes", "types", "description", "logo", "tags"]),
    );
  });

  it("model_prices carries the three price channels", () => {
    expect(cols(schema.modelPrices)).toEqual(
      expect.arrayContaining(["credits", "strike_credits", "member_credits", "time_limited_credits", "duration_s"]),
    );
  });

  it("credit_flows uses the split delta/frozen_delta ledger", () => {
    expect(cols(schema.creditFlows)).toEqual(expect.arrayContaining(["delta", "frozen_delta", "kind", "balance_after"]));
  });

  it("pipeline tables keep outline/asset/finalize columns", () => {
    expect(cols(schema.episodes)).toEqual(expect.arrayContaining(["ep_no", "synopsis", "script_text", "status"]));
    expect(cols(schema.projectAssets)).toEqual(
      expect.arrayContaining(["kind", "portrait_asset_id", "ref_image_uri", "status", "finalized_at"]),
    );
    expect(cols(schema.storyboards)).toEqual(
      expect.arrayContaining(["shot_no", "video_prompt", "duration_s", "image_task_id", "video_task_id"]),
    );
    const storyboardUnique = indexes(schema.storyboards).find((i) => i.name === "uq_storyboards_episode_shot");
    expect(storyboardUnique?.unique).toBe(true);
  });

  it("tasks.dedupe_key has a partial unique index", () => {
    const dedupe = indexes(schema.tasks).find((i) => i.name === "uq_tasks_dedupe");
    expect(dedupe).toBeDefined();
    expect(dedupe?.unique).toBe(true);
    expect(dedupe?.where).toBeDefined();
  });
});
