import { describe, expect, it } from "vitest";
import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import * as schema from "./schema";

// 数据层契约测试：锁定 database.md 的 P1 表/关键列/索引，防止 schema 漂移。
// 不连接数据库（纯结构断言），可在 CI 无 PG 环境运行。
const cols = (table: PgTable): string[] => getTableConfig(table).columns.map((c) => c.name);
const indexes = (table: PgTable) => getTableConfig(table).indexes.map((i) => i.config);

describe("db schema contract (database.md P1)", () => {
  it("contains the 26 P1/P1' tables", () => {
    const names = [
      schema.adminUsers,
      schema.assetFolders,
      schema.assets,
      schema.contentReports,
      schema.creditAccounts,
      schema.creditFlows,
      schema.episodes,
      schema.exportJobs,
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
      schema.taskShares,
      schema.tasks,
      schema.users,
      schema.waitlistEntries,
    ].map((t) => getTableConfig(t).name);

    expect(names).toHaveLength(26);
    expect(names).toEqual(
      expect.arrayContaining([
        "script_projects",
        "episodes",
        "project_assets",
        "storyboards",
        "storyboard_assets",
        "assets",
        "asset_folders",
        "exports",
        "task_shares",
        "content_reports",
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

  it("users keeps age declaration and account deletion columns", () => {
    expect(cols(schema.users)).toEqual(
      expect.arrayContaining(["status", "age_declared_at", "deleted_at"]),
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

  it("content_reports keeps reason/status/handling columns", () => {
    expect(cols(schema.contentReports)).toEqual(
      expect.arrayContaining(["task_id", "share_id", "reason", "detail", "status", "handled_by", "handled_at"]),
    );
  });

  it("task_shares keeps token/expiry/revocation columns", () => {
    expect(cols(schema.taskShares)).toEqual(
      expect.arrayContaining(["task_id", "space_id", "token", "expires_at", "revoked_at"]),
    );
  });

  it("exports keeps async packaging columns", () => {
    expect(cols(schema.exportJobs)).toEqual(
      expect.arrayContaining(["space_id", "episode_id", "status", "file_uri", "expires_at", "error"]),
    );
  });

  it("tasks.dedupe_key has a partial unique index", () => {
    const dedupe = indexes(schema.tasks).find((i) => i.name === "uq_tasks_dedupe");
    expect(dedupe).toBeDefined();
    expect(dedupe?.unique).toBe(true);
    expect(dedupe?.where).toBeDefined();
  });
});

// 第 0 批地基：小说改编链（11 张）+ 影视版（8 张）。锁表名与关键列，
// 防止后续批次为了"顺手改个名"把迁移链打断（0018 之后每个改动都是新迁移）。
describe("db schema contract (第 0 批地基：novel + film 共 19 张)", () => {
  const novelTables = {
    novels: schema.novels,
    novel_chapters: schema.novelChapters,
    novel_worldviews: schema.novelWorldviews,
    novel_characters: schema.novelCharacters,
    novel_chapter_outlines: schema.novelChapterOutlines,
    novel_episode_outlines: schema.novelEpisodeOutlines,
    novel_episodes: schema.novelEpisodes,
    novel_script_versions: schema.novelScriptVersions,
    novel_edit_sessions: schema.novelEditSessions,
    novel_edit_messages: schema.novelEditMessages,
    novel_edit_pendings: schema.novelEditPendings,
  };
  const filmTables = {
    film_tables: schema.filmTables,
    film_fields: schema.filmFields,
    film_tasks: schema.filmTasks,
    film_cells: schema.filmCells,
    film_review_versions: schema.filmReviewVersions,
    film_review_comments: schema.filmReviewComments,
    film_review_reads: schema.filmReviewReads,
    film_canvas_bindings: schema.filmCanvasBindings,
  };

  it("declares exactly the 11 novel + 8 film tables with expected names", () => {
    expect(Object.keys(novelTables)).toHaveLength(11);
    expect(Object.keys(filmTables)).toHaveLength(8);
    for (const [name, table] of Object.entries({ ...novelTables, ...filmTables })) {
      expect(getTableConfig(table).name).toBe(name);
    }
  });

  it("novels 是唯一带 space_id 的 novel 表，其余都能追溯到 novel（含会话链路）", () => {
    expect(cols(schema.novels)).toEqual(
      expect.arrayContaining(["space_id", "title", "source_type", "status", "sp_type", "ratio", "episode_count", "meta", "archived_at"]),
    );
    // 子表只有 novel_id；冗余 space_id 会引入"写错的 space_id 即越权面"的风险
    // 例外：会话链两张表（messages / pendings）经 session_id 归属，
    // 它们若各自再存 novel_id，就可能出现"会话属于小说 A、消息属于小说 B"的不可判状态。
    const viaNovelId = [
      schema.novelChapters, schema.novelWorldviews, schema.novelCharacters,
      schema.novelChapterOutlines, schema.novelEpisodeOutlines, schema.novelEpisodes,
      schema.novelScriptVersions, schema.novelEditSessions,
    ];
    const viaSessionId = [schema.novelEditMessages, schema.novelEditPendings];
    for (const table of [...viaNovelId, ...viaSessionId]) {
      expect(cols(table)).not.toContain("space_id");
    }
    for (const table of viaNovelId) {
      expect(cols(table)).toContain("novel_id");
    }
    for (const table of viaSessionId) {
      expect(cols(table)).toContain("session_id");
    }
  });

  it("每一张 film 表都冗余 space_id（按空间直接列表/统计）", () => {
    for (const table of Object.values(filmTables)) {
      expect(cols(table)).toContain("space_id");
    }
  });

  it("film_canvas_bindings 的 canvas_id/node_id 故意不带外键（跨域不透明指针）", () => {
    const fks = getTableConfig(schema.filmCanvasBindings).foreignKeys;
    const columns = fks.flatMap((fk) => fk.reference().columns.map((c) => c.name));
    expect(columns).not.toContain("canvas_id");
    expect(columns).not.toContain("node_id");
    // task_id 仍要带 FK：行是 film 域内的，跨域才不加
    expect(columns).toContain("task_id");
  });

  it("film_fields.is_unique_type 是列存在性开关，默认 false（不是值唯一）", () => {
    expect(cols(schema.filmFields)).toEqual(
      expect.arrayContaining(["table_id", "key", "field_type", "is_system", "is_unique_type", "config_json", "width"]),
    );
    const col = getTableConfig(schema.filmFields).columns.find((c) => c.name === "is_unique_type");
    expect(col).toBeDefined();
    expect(col?.notNull).toBe(true);
    // 默认必须是 false —— 若默认 true，每张表能建的字段会被静默限制
    expect(col?.default).toBe(false);
  });

  it("film_cells 稀疏且 (task_id, field_id) 唯一", () => {
    const cellUnique = indexes(schema.filmCells).find((i) => i.name === "uq_film_cells");
    expect(cellUnique?.unique).toBe(true);
    // value 列可空：null 代表"无值"语义（实际清空走 DELETE 行）
    const valueCol = getTableConfig(schema.filmCells).columns.find((c) => c.name === "value_json");
    expect(valueCol?.notNull).toBe(false);
  });

  it("novel_script_versions 用两条部分索引锁版本号（NULL 侧不能靠普通唯一键）", () => {
    const names = indexes(schema.novelScriptVersions);
    const episodeSide = names.find((i) => i.name === "uq_novel_script_versions_episode");
    const novelSide = names.find((i) => i.name === "uq_novel_script_versions_novel");
    expect(episodeSide?.unique).toBe(true);
    expect(episodeSide?.where).toBeDefined();
    expect(novelSide?.unique).toBe(true);
    expect(novelSide?.where).toBeDefined();
  });

  it("film_tasks.status/review_version_no 双轨并存", () => {
    expect(cols(schema.filmTasks)).toEqual(
      expect.arrayContaining(["table_id", "parent_id", "status", "version", "title", "review_version_no", "assignee_user_id"]),
    );
    expect(cols(schema.filmReviewVersions)).toEqual(
      expect.arrayContaining(["task_id", "version_no", "status", "submitted_by", "decided_by", "decided_at"]),
    );
    const vUnique = indexes(schema.filmReviewVersions).find((i) => i.name === "uq_film_review_versions_no");
    expect(vUnique?.unique).toBe(true);
  });
});

// 第 0 批地基（续，迁移 0019）：主体库 / 抽取 / Agent Skill / 知识库 / 生态 / 运营。
// 与上一条同样的理由：表名与关键列一旦被"顺手改名"，后面每一批的迁移链都会断，
// 而断掉的迁移在 dev 库上不会报错（drizzle 只比对快照），只有新环境重建时才炸。
describe("db schema contract (第 0 批续：22 张域表)", () => {
  const domainTables = {
    // 第 1 批 出片质量
    subjects: schema.subjects,
    subject_files: schema.subjectFiles,
    extraction_tasks: schema.extractionTasks,
    extraction_drafts: schema.extractionDrafts,
    // 第 4 批 Agent 收口
    agent_skills: schema.agentSkills,
    agent_skill_favorites: schema.agentSkillFavorites,
    // 第 6 批 生态
    knowledge_dirs: schema.knowledgeDirs,
    knowledge_tags: schema.knowledgeTags,
    knowledge_assets: schema.knowledgeAssets,
    creator_profiles: schema.creatorProfiles,
    creator_follows: schema.creatorFollows,
    creator_assets: schema.creatorAssets,
    campaigns: schema.campaigns,
    campaign_signups: schema.campaignSignups,
    market_works: schema.marketWorks,
    market_agreements: schema.marketAgreements,
    market_withdrawals: schema.marketWithdrawals,
    redeem_codes: schema.redeemCodes,
    redeem_code_redemptions: schema.redeemCodeRedemptions,
    distributor_relations: schema.distributorRelations,
    ab_experiments: schema.abExperiments,
    ab_hits: schema.abHits,
  };

  it("声明的 22 张域表名与表对象一一对应", () => {
    expect(Object.keys(domainTables)).toHaveLength(22);
    for (const [name, table] of Object.entries(domainTables)) {
      expect(getTableConfig(table).name).toBe(name);
    }
  });

  it("主体库：审核三态落库、business_list 是数组、参考图按主体唯一", () => {
    expect(cols(schema.subjects)).toEqual(
      expect.arrayContaining(["space_id", "kind", "review_status", "reject_reason", "business_list", "project_id"]),
    );
    // 未过审主体投递必须能被拒，判定依据在库里而不是只在服务层（多副本重启后一致）
    const reviewCol = getTableConfig(schema.subjects).columns.find((c) => c.name === "review_status");
    expect(reviewCol?.notNull).toBe(true);
    expect(reviewCol?.default).toBe(1);
    const uq = indexes(schema.subjectFiles).find((i) => i.name === "uq_subject_files_subject_uri");
    expect(uq?.unique).toBe(true);
  });

  it("抽取：四态 + eed_id 批次；草稿有 parent_state_id 承载多形态", () => {
    expect(cols(schema.extractionTasks)).toEqual(
      expect.arrayContaining(["space_id", "task_type", "status", "eed_id", "result", "finished_at"]),
    );
    expect(cols(schema.extractionDrafts)).toEqual(
      expect.arrayContaining(["task_id", "eed_id", "kind", "payload", "state", "parent_state_id"]),
    );
  });

  it("Agent Skill：广场/私有可见性 + 收藏 (skill,user) 唯一", () => {
    expect(cols(schema.agentSkills)).toEqual(
      expect.arrayContaining(["space_id", "owner_user_id", "visibility", "use_count", "favorite_count", "status"]),
    );
    const fav = indexes(schema.agentSkillFavorites).find((i) => i.name === "uq_agent_skill_favorites");
    expect(fav?.unique).toBe(true);
  });

  it("知识库：目录 parent_id 故意不加自引用外键（软删语义）", () => {
    const fks = getTableConfig(schema.knowledgeDirs).foreignKeys;
    const fkCols = fks.flatMap((fk) => fk.reference().columns.map((c) => c.name));
    expect(fkCols).not.toContain("parent_id");
    expect(cols(schema.knowledgeAssets)).toEqual(
      expect.arrayContaining(["space_id", "dir_id", "asset_id", "title", "content", "tags", "source_type"]),
    );
  });

  it("集市收益与消耗积分为两种钱：revenue_credits 只记累计，提现单独成表", () => {
    expect(cols(schema.marketWorks)).toEqual(
      expect.arrayContaining(["novel_id", "owner_user_id", "price_credits", "preorder_price_credits", "revenue_credits", "status"]),
    );
    expect(cols(schema.marketWithdrawals)).toEqual(
      expect.arrayContaining(["user_id", "amount_credits", "status", "channel", "account_info", "paid_at"]),
    );
    // 提现表里不能出现 credit_accounts 的外键列：那会把两种钱混成一个池子
    expect(cols(schema.marketWithdrawals)).not.toContain("credit_account_id");
  });

  it("运营增长：兑换码 (code,user) 唯一、分销单层、AB 一人一变体", () => {
    const redeem = indexes(schema.redeemCodeRedemptions).find((i) => i.name === "uq_redeem_code_redemptions");
    expect(redeem?.unique).toBe(true);
    const dist = indexes(schema.distributorRelations).find((i) => i.name === "uq_distributor_relations_user");
    expect(dist?.unique).toBe(true);
    const hit = indexes(schema.abHits).find((i) => i.name === "uq_ab_hits");
    expect(hit?.unique).toBe(true);
  });
});

describe("db schema contract (第 93 批：音色收藏 1 张)", () => {
  it("voice_favorites 按 (space,user,timbre_key) 唯一，且 timbre_key 不是外键", () => {
    expect(cols(schema.voiceFavorites)).toEqual(
      expect.arrayContaining(["space_id", "user_id", "timbre_key", "created_at"]),
    );
    const uq = indexes(schema.voiceFavorites).find((i) => i.name === "uq_voice_favorites");
    expect(uq?.unique).toBe(true);
    /**
     * `timbre_key` 故意不带外键：它要同时表达「内置音色」（`builtin:<voice_id>`，
     * 库里没有对应行）与「我的克隆音色」（`clone:<task_id>`）。加外键就只能表达后者，
     * 内置音色的收藏会直接写不进去。
     */
    const fkCols = getTableConfig(schema.voiceFavorites).foreignKeys.flatMap((fk) =>
      fk.reference().columns.map((c) => c.name),
    );
    expect(fkCols).not.toContain("timbre_key");
    expect(fkCols).toEqual(expect.arrayContaining(["space_id", "user_id"]));
  });
});

describe("db schema contract (第 126 批：画布分享 1 张)", () => {
  it("canvas_shares 冻结快照、令牌唯一、关闭/过期可判", () => {
    expect(cols(schema.canvasShares)).toEqual(
      expect.arrayContaining([
        "canvas_id",
        "space_id",
        "token",
        "snapshot",
        "allow_clone",
        "expires_at",
        "revoked_at",
      ]),
    );
    const uq = indexes(schema.canvasShares).find((i) => i.name === "uq_canvas_shares_token");
    expect(uq?.unique).toBe(true);
    // 快照必须是 NOT NULL：分享时没冻结内容，公开页就没有可读的东西。
    const snapshot = getTableConfig(schema.canvasShares).columns.find((c) => c.name === "snapshot");
    expect(snapshot?.notNull).toBe(true);
    // task_id 只允许出现在 snapshot 内部；表上出现就把内部任务身份摆进了公开面。
    expect(cols(schema.canvasShares)).not.toContain("task_id");
  });
});

