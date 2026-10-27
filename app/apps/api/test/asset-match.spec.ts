import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import cookie from "@fastify/cookie";
import { eq, sql } from "drizzle-orm";
import { projectAssets, tasks } from "@app/db";
import { AllExceptionsFilter } from "../src/common/http/exception.filter";
import { EnvelopeInterceptor } from "../src/common/http/envelope.interceptor";
import { AppModule } from "../src/app.module";
import { db, pool } from "../src/db/database";

/**
 * 资产 × 分镜匹配 + 一致性三闸门 + 小说来源拆集 契约测试。
 *
 * 证据：
 * - `episode.md:261-300`：match-resources 受理 ≠ 匹配成功，要轮询 match-result；
 * - `_storyboard-asset-match.md:5`：status=2 已匹配 / 1 未定稿 / 3 缺失，三项计数分开；
 * - `_storyboard-asset-match.md:9-17`：智能补充 7 条件、三选项、默认「保持现状」；
 * - `episode.md:368-388`：save-resource-matches 是**完整快照**，空类别显式 `[]`；
 * - `subject.md:228-250`：match-reset 破坏性、先 dry-run；
 * - `target-spec.md:124,174`：未定稿 400105；`subject.md:212`：驳回 retryable=false；
 * - `storyboard.md:308-310`：资产转 `images[]` 注入；
 * - `completion-plan §3.3`：只有 status=16 的小说才能作为拆集来源。
 *
 * 为什么快照语义要用"漏传类别不得被清空"来断：竞品明确说漏传会被清空（这是真实坑），
 * 我方选择**直接 400101 拒绝**而不是静默清空——测试同时验"拒绝"和"数据未变"。
 */
describe("asset-match + consistency gates e2e", () => {
  let app: NestFastifyApplication;
  let token = "";
  let tokenOther = "";
  let projectId = "";
  let episodeId = "";
  let shotIds: string[] = [];
  let characterId = "";
  let sceneAssetId = "";
  const stamp = `am${Date.now()}`;
  const sceneRef = `u/test/am-scene-${stamp}.png`;

  interface Envelope {
    code: number;
    msg: string;
    data: any;
  }

  const raw = async (
    asToken: string,
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
    url: string,
    payload?: Record<string, unknown>,
  ): Promise<Envelope> => {
    const res = await app.inject({
      method,
      url: `/v1${url}`,
      payload,
      headers: { authorization: `Bearer ${asToken}` },
    });
    return res.json() as Envelope;
  };
  const inject = (
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
    url: string,
    payload?: Record<string, unknown>,
  ) => raw(token, method, url, payload);

  const login = async (phone: string) => {
    const sms = (await app.inject({ method: "POST", url: "/v1/auth/sms-code", payload: { phone } })).json() as Envelope;
    expect(sms.code).toBe(0);
    const body = (
      await app.inject({
        method: "POST",
        url: "/v1/auth/login",
        payload: { phone, code: sms.data.debug_code as string, age_confirmed: true },
      })
    ).json() as Envelope;
    expect(body.code).toBe(0);
    return body.data.access_token as string;
  };

  const matchResult = () => inject("GET", `/projects/${projectId}/episodes/${episodeId}/match-result`);
  const generate = (shotId: string, extra: Record<string, unknown> = {}) =>
    inject("POST", `/projects/${projectId}/episodes/${episodeId}/storyboards/generate-videos`, {
      shot_ids: [shotId],
      budget_credits_max: 1000,
      model: "wan-3.0",
      ...extra,
    });

  /** 直接读绑定行数：快照语义要证明"真的改了库"，不能只看返回体 */
  const bindingCount = async (assetId?: string) => {
    const rows = (await db.execute(sql`
      select count(*)::int as count from storyboard_assets sa
      join storyboards s on s.id = sa.storyboard_id
      where s.episode_id = ${BigInt(episodeId)}
      ${assetId ? sql`and sa.project_asset_id = ${BigInt(assetId)}` : sql``}
    `)) as { rows?: Array<{ count: number }> };
    return Number(rows.rows?.[0]?.count ?? 0);
  };

  beforeAll(async () => {
    app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), {
      logger: false,
    });
    await app.register(cookie as never);
    app.setGlobalPrefix("v1");
    app.useGlobalFilters(new AllExceptionsFilter());
    app.useGlobalInterceptors(new EnvelopeInterceptor());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    token = await login(`17${String(Math.floor(Math.random() * 900000000) + 100000000)}`);
    tokenOther = await login(`17${String(Math.floor(Math.random() * 900000000) + 100000000)}`);

    // 故意让 source_text 不含 LLM mock 候选池里的场景/道具名，
    // 这样"缺失（status=3）"不会被文本提及关系误判成"已有"
    const project = await inject("POST", "/projects", {
      title: `匹配测试-${stamp}`,
      source_type: 1,
      source_text: "第一章：林晚在城外醒来。第二章：她做了一个决定。",
    });
    expect(project.code).toBe(0);
    projectId = project.data.id;

    const outline = await inject("POST", `/projects/${projectId}/outline/generate`);
    expect(outline.code).toBe(0);
    episodeId = outline.data[0].id;

    const script = await inject("POST", `/projects/${projectId}/episodes/${episodeId}/script-draft/generate`, {});
    expect(script.code).toBe(0);

    const chars = await inject("POST", `/projects/${projectId}/characters/generate`, { count: 2 });
    expect(chars.code).toBe(0);
    characterId = chars.data[0].id;

    const shots = await inject("POST", `/projects/${projectId}/episodes/${episodeId}/storyboards/generate`, {
      shot_count: 4,
    });
    expect(shots.code).toBe(0);
    shotIds = shots.data.map((shot: { id: string }) => shot.id);
    // 生成分镜时角色已绑定（既有行为），所以"匹配前"角色就已经有 status
    expect(shots.data[0].character_ids).toContain(characterId);

    const scene = await inject("POST", `/projects/${projectId}/assets`, {
      kind: "scene",
      name: `匹配场景-${stamp}`,
      prompt: "电影感场景，用于匹配",
      ref_image_uri: sceneRef,
    });
    expect(scene.code).toBe(0);
    sceneAssetId = scene.data.id;
    expect((await inject("PATCH", `/projects/${projectId}/assets/${sceneAssetId}`, { status: 2 })).code).toBe(0);
  });

  afterAll(async () => {
    // 逐条 best-effort：tasks/exports 等外键会让项目删除失败，而带随机后缀的遗留夹具
    // 对其它用例无影响；能删的先删（绑定 → 分镜 → 集 → 资产 → 主体）。
    const cleanup = (query: Parameters<typeof db.execute>[0]) => db.execute(query).catch(() => {});
    await cleanup(sql`delete from storyboard_assets where storyboard_id in (
      select id from storyboards where episode_id in (
        select id from episodes where project_id in (
          select id from script_projects where title like ${`%${stamp}%`}
        )
      )
    )`);
    await cleanup(sql`delete from storyboards where episode_id in (
      select id from episodes where project_id in (
        select id from script_projects where title like ${`%${stamp}%`}
      )
    )`);
    await cleanup(sql`delete from episodes where project_id in (
      select id from script_projects where title like ${`%${stamp}%`}
    )`);
    await cleanup(sql`delete from project_assets where project_id in (
      select id from script_projects where title like ${`%${stamp}%`}
    )`);
    await cleanup(sql`delete from subject_files where subject_id in (
      select id from subjects where name like ${`%${stamp}%`}
    )`);
    await cleanup(sql`delete from subjects where name like ${`%${stamp}%`}`);
    await cleanup(sql`delete from script_projects where title like ${`%${stamp}%`}`);
    // 小说链夹具（拆集来源用例造的）
    await cleanup(sql`delete from novel_episodes where novel_id in (
      select id from novels where title like ${`%${stamp}%`}
    )`);
    await cleanup(sql`delete from novel_episode_outlines where novel_id in (
      select id from novels where title like ${`%${stamp}%`}
    )`);
    await cleanup(sql`delete from novel_chapters where novel_id in (
      select id from novels where title like ${`%${stamp}%`}
    )`);
    await cleanup(sql`delete from novels where title like ${`%${stamp}%`}`);
    await app.close();
    await pool.end().catch(() => {});
  });

  it("match-result is empty before matching: snapshot is the only source (no projection)", async () => {
    const res = await matchResult();
    expect(res.code).toBe(0);
    expect(res.data.ep_id).toBe(episodeId);
    // task-18：`match-result` 改为**只读 `episode_resources` 快照**。
    // 未跑过匹配的本集快照为空 → 三类清单都为空、总状态 0（上轮的"按绑定投影"已按 Lead 要求移除，
    // 因为投影无法表达"属于本集但没有镜头提到"的资源，也把占位项绑进了分镜）。
    expect(res.data.snapshot.populated).toBe(false);
    expect(res.data.characters).toEqual([]);
    expect(res.data.scenes).toEqual([]);
    expect(res.data.props).toEqual([]);
    expect(res.data.status).toBe(0);
    expect(res.data.status_name).toBe("none");
    expect(res.data.supplement.target_count).toBe(0);
    // 三选项仍在，默认第三项「保持现状」
    const options = res.data.supplement.options as Array<{ value: string; default: boolean }>;
    expect(options.map((option) => option.value)).toEqual(["smart-supplement", "rematch", "keep"]);
    expect(options.filter((option) => option.default).map((option) => option.value)).toEqual(["keep"]);
  });

  it("match-resources writes the episode snapshot without creating placeholder assets", async () => {
    const before = (await inject("GET", `/projects/${projectId}/assets`)).data.list.length as number;
    const dry = await inject("POST", `/projects/${projectId}/episodes/${episodeId}/match-resources`, {
      dry_run: true,
    });
    expect(dry.code).toBe(0);
    expect(dry.data.dry_run).toBe(true);
    expect(dry.data.candidates.length).toBeGreaterThan(0);
    expect((await matchResult()).data.snapshot.populated).toBe(false);
    expect((await inject("GET", `/projects/${projectId}/assets`)).data.list.length).toBe(before);

    const real = await inject("POST", `/projects/${projectId}/episodes/${episodeId}/match-resources`, {});
    expect(real.code).toBe(0);
    expect(real.data.created_placeholders).toEqual([]);
    // 本轮不再预建占位资产（竞品是补充时才 resource add）→ 资产数不变
    expect((await inject("GET", `/projects/${projectId}/assets`)).data.list.length).toBe(before);

    // 快照落地：三类合计 > 0，且存在无资产的"缺失"条目
    const result = await matchResult();
    expect(result.data.snapshot.populated).toBe(true);
    expect(result.data.snapshot.row_count).toBeGreaterThan(0);
    expect(result.data.status).toBe(3);
    expect(result.data.totals.missing).toBeGreaterThan(0);
    expect(result.data.supplement.target_count).toBeGreaterThan(0);
    const missing = [
      ...(result.data.characters as Array<{ status: number; resource_id: string | null; prompt: string | null }>),
      ...(result.data.scenes as Array<{ status: number; resource_id: string | null; prompt: string | null }>),
      ...(result.data.props as Array<{ status: number; resource_id: string | null; prompt: string | null }>),
    ].filter((entry) => entry.status === 3);
    expect(missing.length).toBeGreaterThan(0);
    // 缺失项只有 name（resource_id / prompt 都是空）——这是"补充时才建资源"的口径
    expect(missing.every((entry) => entry.resource_id === null && entry.prompt === null)).toBe(true);

    // 幂等：重跑匹配后快照行数稳定（按 (episode,kind,name) 唯一键重写）
    const rowCount = result.data.snapshot.row_count as number;
    const again = await inject("POST", `/projects/${projectId}/episodes/${episodeId}/match-resources`, {});
    expect(again.code).toBe(0);
    expect((await matchResult()).data.snapshot.row_count).toBe(rowCount);
  });

  it("supplement-missing: dry-run writes nothing, real run completes prompts then returns image targets", async () => {
    const dry = await inject("POST", `/projects/${projectId}/episodes/${episodeId}/supplement-missing`, {
      dry_run: true,
    });
    expect(dry.code).toBe(0);
    expect(dry.data.pending_image.length).toBe(dry.data.targets.length);
    const missingBefore = (await matchResult()).data.supplement.target_count as number;
    expect(missingBefore).toBeGreaterThan(0);

    const real = await inject("POST", `/projects/${projectId}/episodes/${episodeId}/supplement-missing`, {});
    expect(real.code).toBe(0);
    // ① 提示词补全 + ③ 查重 + ④ resource add：缺失项要么复用已定稿资产、要么建了草稿资产
    const filled = real.data.pending_image as Array<{ resource_id: string; prompt: string }>;
    expect(filled.length).toBeGreaterThan(0);
    for (const item of filled) {
      const [row] = await db
        .select()
        .from(projectAssets)
        .where(eq(projectAssets.id, BigInt(item.resource_id)));
      expect(row?.prompt).toBe(item.prompt);
      expect(item.prompt.length).toBeGreaterThan(0);
      // prompt_status 落 2（已完备）：7 条件里"prompt 为空/生成中/被拦截"都要可判
      expect(row?.promptStatus).toBe(2);
      expect(row?.status).toBe(1); // 新资产是草稿态，待生图+定稿
    }
    // 生图不在本端点扣费：返回 next_actions 指向既有生图端点
    expect(String(real.data.next_actions[0].path)).toContain("/generate-image");
    // 补全后这些项从「缺失」变成「未定稿」（还没有定稿图）
    const after = await matchResult();
    expect(after.data.supplement.target_count).toBe(0);
    expect(after.data.status).toBe(1);
    // 快照条目的 project_asset_id 已回填（不留悬空条目）
    const allEntries = [
      ...(after.data.characters as Array<{ resource_id: string | null }>),
      ...(after.data.scenes as Array<{ resource_id: string | null }>),
      ...(after.data.props as Array<{ resource_id: string | null }>),
    ];
    expect(allEntries.every((entry) => entry.resource_id !== null)).toBe(true);
  });

  it("supplement-missing skips prompts that are blocked (prompt_status=3) or generating (1)", async () => {
    // 造两个"缺失"目标：一个被内容安全拦截、一个提示词生成中
    const blocked = await inject("POST", `/projects/${projectId}/assets`, {
      kind: "prop",
      name: `被拦截道具-${stamp}`,
    });
    expect(blocked.code).toBe(0);
    const generating = await inject("POST", `/projects/${projectId}/assets`, {
      kind: "prop",
      name: `生成中道具-${stamp}`,
    });
    expect(generating.code).toBe(0);
    await db
      .update(projectAssets)
      .set({ promptStatus: 3 })
      .where(eq(projectAssets.id, BigInt(blocked.data.id)));
    await db
      .update(projectAssets)
      .set({ promptStatus: 1 })
      .where(eq(projectAssets.id, BigInt(generating.data.id)));

    // 用完整快照把它们放进本集清单（prompt 为空 → status=3）
    const saved = await inject("POST", `/projects/${projectId}/episodes/${episodeId}/save-resource-matches`, {
      resources: {
        characters: [],
        scenes: [],
        props: [{ resource_id: blocked.data.id }, { resource_id: generating.data.id }],
      },
    });
    expect(saved.code).toBe(0);

    const result = await matchResult();
    const props = result.data.props as Array<{
      resource_id: string;
      status: number;
      prompt_blocked: boolean;
      prompt_generating: boolean;
      supplementable: boolean;
    }>;
    const blockedEntry = props.find((entry) => entry.resource_id === blocked.data.id);
    const generatingEntry = props.find((entry) => entry.resource_id === generating.data.id);
    // 7 条件第 6/7 条：生成中/被拦截都不可补（本轮用 prompt_status 真正实现的部分）
    expect(blockedEntry?.status).toBe(3);
    expect(blockedEntry?.prompt_blocked).toBe(true);
    expect(blockedEntry?.supplementable).toBe(false);
    expect(generatingEntry?.prompt_generating).toBe(true);
    expect(generatingEntry?.supplementable).toBe(false);
    expect(result.data.supplement.target_count).toBe(0);

    // 真调补充：两个目标都不该被补（也不会改动它们的 prompt_status）
    const supplement = await inject("POST", `/projects/${projectId}/episodes/${episodeId}/supplement-missing`, {});
    expect(supplement.code).toBe(0);
    expect(supplement.data.targets).toEqual([]);
    const [blockedRow] = await db
      .select()
      .from(projectAssets)
      .where(eq(projectAssets.id, BigInt(blocked.data.id)));
    const [generatingRow] = await db
      .select()
      .from(projectAssets)
      .where(eq(projectAssets.id, BigInt(generating.data.id)));
    expect(blockedRow?.promptStatus).toBe(3);
    expect(blockedRow?.prompt).toBeNull();
    expect(generatingRow?.promptStatus).toBe(1);
    expect(generatingRow?.prompt).toBeNull();
  });

  it("save-resource-matches rejects partial/invalid snapshots with 400101 and leaves data untouched", async () => {
    const beforeAll = await bindingCount();
    const beforeCounts = (await matchResult()).data.counts;

    // 漏传 props → 400101（**不得**被静默清空）
    const missingCategory = await inject(
      "POST",
      `/projects/${projectId}/episodes/${episodeId}/save-resource-matches`,
      { resources: { characters: [], scenes: [] } },
    );
    expect(missingCategory.code).toBe(400101);

    // 跨项目资产
    const otherProject = await inject("POST", "/projects", { title: `其它-${stamp}`, source_type: 1, source_text: "素材" });
    expect(otherProject.code).toBe(0);
    const otherAsset = await inject("POST", `/projects/${otherProject.data.id}/assets`, {
      kind: "scene",
      name: "别的项目的场景",
    });
    const crossProject = await inject(
      "POST",
      `/projects/${projectId}/episodes/${episodeId}/save-resource-matches`,
      { resources: { characters: [], scenes: [{ resource_id: otherAsset.data.id }], props: [] } },
    );
    expect(crossProject.code).toBe(400101);

    // 类别与资产 kind 不符（场景塞进 characters）
    const wrongKind = await inject(
      "POST",
      `/projects/${projectId}/episodes/${episodeId}/save-resource-matches`,
      { resources: { characters: [{ resource_id: sceneAssetId }], scenes: [], props: [] } },
    );
    expect(wrongKind.code).toBe(400101);

    // 三次失败都是零写入
    expect(await bindingCount()).toBe(beforeAll);
    expect((await matchResult()).data.counts).toEqual(beforeCounts);
  });

  it("save-resource-matches replaces the whole snapshot per category (empty category clears)", async () => {
    const saved = await inject(
      "POST",
      `/projects/${projectId}/episodes/${episodeId}/save-resource-matches`,
      {
        resources: {
          characters: [{ resource_id: characterId }],
          scenes: [{ resource_id: sceneAssetId }],
          // 空类别显式 []：该类绑定必须被清空
          props: [],
        },
      },
    );
    expect(saved.code).toBe(0);
    expect(saved.data.snapshot.props).toEqual([]);
    expect(saved.data.counts.props.total).toBe(0);
    // 角色/场景重新绑定：每个都绑到至少 1 镜
    expect(await bindingCount(characterId)).toBeGreaterThan(0);
    expect(await bindingCount(sceneAssetId)).toBeGreaterThan(0);
    // props 一条不剩
    const props = (await matchResult()).data.props as unknown[];
    expect(props).toHaveLength(0);

    // 快照表（episode_resources）才是权威：按类整类重写，空类别 0 行
    const snapshotRows = (await db.execute(sql`
      select kind, count(*)::int as count from episode_resources
      where episode_id = ${BigInt(episodeId)}
      group by kind
    `)) as unknown as { rows?: Array<{ kind: number; count: number }> };
    const kindCounts = new Map(
      (snapshotRows.rows ?? []).map((row) => [Number(row.kind), Number(row.count)]),
    );
    expect(kindCounts.get(1)).toBe(1); // characters
    expect(kindCounts.get(2)).toBe(1); // scenes
    expect(kindCounts.get(3) ?? 0).toBe(0); // props 显式 [] → 这一类一条不留

    // 重复提交同一快照 → 幂等（绑定数不变、统计不变、行数不变）
    const bindingsAfterFirst = await bindingCount();
    const again = await inject(
      "POST",
      `/projects/${projectId}/episodes/${episodeId}/save-resource-matches`,
      {
        resources: {
          characters: [{ resource_id: characterId }],
          scenes: [{ resource_id: sceneAssetId }],
          props: [],
        },
      },
    );
    expect(again.code).toBe(0);
    expect(await bindingCount()).toBe(bindingsAfterFirst);
    expect(again.data.counts).toEqual(saved.data.counts);
    const afterAgain = (await db.execute(sql`
      select count(*)::int as count from episode_resources where episode_id = ${BigInt(episodeId)}
    `)) as unknown as { rows?: Array<{ count: number }> };
    expect(Number(afterAgain.rows?.[0]?.count ?? 0)).toBe(2);
  });

  it("match-reset is destructive: dry-run only previews, real run clears bindings + snapshot", async () => {
    const filled = await bindingCount();
    expect(filled).toBeGreaterThan(0);
    const dry = await inject("POST", `/projects/${projectId}/episodes/${episodeId}/match-reset`, {
      dry_run: true,
    });
    expect(dry.code).toBe(0);
    expect(dry.data.dry_run).toBe(true);
    expect(dry.data.would_remove).toBe(filled);
    expect(dry.data.would_remove_resources).toBe(2);
    expect(await bindingCount()).toBe(filled); // dry-run 没动数据

    const real = await inject("POST", `/projects/${projectId}/episodes/${episodeId}/match-reset`, {});
    expect(real.code).toBe(0);
    expect(real.data.removed).toBe(filled);
    // 快照也一起清（这是本轮把"投影"换成快照后的破坏性口径：重置 = 回到未匹配）
    expect(real.data.removed_resources).toBeGreaterThan(0);
    expect(await bindingCount()).toBe(0);
    const afterReset = await matchResult();
    expect(afterReset.data.snapshot.populated).toBe(false);
    expect(afterReset.data.status).toBe(0);
    expect(afterReset.data.totals.total).toBe(0);
  });

  it("gate 1 (finalize): generation returns 400105 per shot when no finalized asset is bound", async () => {
    const res = await generate(shotIds[0]!);
    expect(res.code).toBe(0);
    const item = res.data.items.find((row: { shot_id: string }) => row.shot_id === shotIds[0]);
    expect(item.submitted).toBe(false);
    expect(item.code).toBe(400105);
    expect(item.reason).toBe("asset_not_ready");
    expect(item.gate).toBe("finalize");
  });

  it("gate 1 (finalize): an unfinalized bound asset also blocks with 400105", async () => {
    const draft = await inject("POST", `/projects/${projectId}/assets`, {
      kind: "prop",
      name: `未定稿道具-${stamp}`,
      ref_image_uri: `u/test/draft-${stamp}.png`,
    });
    expect(draft.code).toBe(0);
    const bound = await inject(
      "PUT",
      `/projects/${projectId}/episodes/${episodeId}/storyboards/${shotIds[0]}/assets`,
      { asset_ids: [draft.data.id] },
    );
    expect(bound.code).toBe(0);

    const res = await generate(shotIds[0]!);
    const item = res.data.items.find((row: { shot_id: string }) => row.shot_id === shotIds[0]);
    expect(item.submitted).toBe(false);
    expect(item.code).toBe(400105);
    expect(item.gate).toBe("finalize");
    expect(item.blocked[0].reason).toBe("not_finalized");
  });

  it("gate 3 (generate): finalized assets are injected as images[] plus reference_uris", async () => {
    const bound = await inject(
      "PUT",
      `/projects/${projectId}/episodes/${episodeId}/storyboards/${shotIds[1]}/assets`,
      { asset_ids: [sceneAssetId] },
    );
    expect(bound.code).toBe(0);

    const res = await generate(shotIds[1]!);
    expect(res.code).toBe(0);
    const item = res.data.items.find((row: { shot_id: string }) => row.shot_id === shotIds[1]);
    expect(item.submitted).toBe(true);
    expect(item.task_id).toBeTruthy();

    const [task] = await db.select().from(tasks).where(eq(tasks.id, BigInt(item.task_id)));
    const input = task!.input as {
      reference_uris?: string[];
      images?: string[];
      image_subjects?: Array<{ marker: string; resource_id: string }>;
      prompt_with_images?: string;
    };
    expect(input.reference_uris).toEqual([sceneRef]);
    // 生成闸门的产物：有序 images[] + 「名称 → [[@imgN]」映射
    expect(input.images).toEqual([sceneRef]);
    expect(input.image_subjects?.[0]?.marker).toBe("[[@img1]]");
    expect(input.image_subjects?.[0]?.resource_id).toBe(sceneAssetId);
  });

  it("prompt_inject_mode=replace injects [[@imgN]] into prompt; default append keeps it untouched", async () => {
    const sceneName = `匹配场景-${stamp}`;
    const promptWithName = `电影感特写：${sceneName}，9:16 竖屏`;
    for (const shotId of [shotIds[2]!, shotIds[3]!]) {
      expect(
        (
          await inject("PATCH", `/projects/${projectId}/episodes/${episodeId}/storyboards/${shotId}`, {
            video_prompt: promptWithName,
          })
        ).code,
      ).toBe(0);
      expect(
        (
          await inject("PUT", `/projects/${projectId}/episodes/${episodeId}/storyboards/${shotId}/assets`, {
            asset_ids: [sceneAssetId],
          })
        ).code,
      ).toBe(0);
    }

    // 默认 append：原 prompt 不改写，标记版只作为附加字段（上轮与既有 spec 的契约）
    const appended = await generate(shotIds[2]!);
    expect(appended.code).toBe(0);
    const appendItem = appended.data.items.find((row: { shot_id: string }) => row.shot_id === shotIds[2]);
    expect(appendItem.submitted).toBe(true);
    const [appendTask] = await db.select().from(tasks).where(eq(tasks.id, BigInt(appendItem.task_id)));
    const appendInput = appendTask!.input as {
      prompt?: string;
      prompt_with_images?: string;
      prompt_inject_mode?: string;
    };
    expect(appendInput.prompt).toBe(promptWithName);
    expect(appendInput.prompt_with_images).toContain("[[@img1]]");
    expect(appendInput.prompt_inject_mode).toBe("append");

    // replace：把「名称 → [[@imgN]]」改写后的 prompt 直接当 video_prompt 注入
    // （对齐 storyboard.md:308-310；需产品确认，默认不启用）
    const replaced = await generate(shotIds[3]!, { prompt_inject_mode: "replace" });
    expect(replaced.code).toBe(0);
    const replaceItem = replaced.data.items.find((row: { shot_id: string }) => row.shot_id === shotIds[3]);
    expect(replaceItem.submitted).toBe(true);
    const [replaceTask] = await db.select().from(tasks).where(eq(tasks.id, BigInt(replaceItem.task_id)));
    const replaceInput = replaceTask!.input as {
      prompt?: string;
      prompt_with_images?: string;
      prompt_inject_mode?: string;
    };
    expect(replaceInput.prompt_inject_mode).toBe("replace");
    expect(replaceInput.prompt).toBe(replaceInput.prompt_with_images);
    expect(replaceInput.prompt).toContain("[[@img1]]");
    expect(replaceInput.prompt).not.toContain(sceneName);

    // 非法枚举值 → 400101
    expect((await generate(shotIds[3]!, { prompt_inject_mode: "prepend" })).code).toBe(400101);
  });

  it("subject gate: a reviewing subject linked to a bound asset blocks generation (400105, retryable)", async () => {
    const saved = await inject("POST", "/subjects/from-asset", {
      project_id: projectId,
      asset_id: sceneAssetId,
      name: `${stamp}-场景主体`,
    });
    expect(saved.code).toBe(0);
    expect(saved.data.review_status).toBe(1);

    const blocked = await generate(shotIds[1]!);
    const item = blocked.data.items.find((row: { shot_id: string }) => row.shot_id === shotIds[1]);
    expect(item.submitted).toBe(false);
    expect(item.code).toBe(400105);
    expect(item.reason).toBe("subject_not_approved");
    expect(item.gate).toBe("subject");
    expect(item.retryable).toBe(true); // 审核中可等待后重试

    // 驳回后 retryable=false：禁止自动重试（风控红线）
    expect(
      (await inject("PATCH", `/subjects/${saved.data.id}`, { review_status: 3, reject_reason: "不符" })).code,
    ).toBe(0);
    const rejected = await generate(shotIds[1]!);
    const rejectedItem = rejected.data.items.find((row: { shot_id: string }) => row.shot_id === shotIds[1]);
    expect(rejectedItem.reason).toBe("subject_not_approved");
    expect(rejectedItem.retryable).toBe(false);

    // 通过审核后放行
    expect((await inject("PATCH", `/subjects/${saved.data.id}`, { review_status: 2 })).code).toBe(0);
    const passed = await generate(shotIds[1]!);
    const passedItem = passed.data.items.find((row: { shot_id: string }) => row.shot_id === shotIds[1]);
    expect(passedItem.submitted).toBe(true);
  });

  /** 建一个已定稿（status=16）的本子：create → 分集大纲 → 生成剧本 → finalize */
  const createFinalizedNovel = async (suffix: string): Promise<{ ntId: string; episodeCount: number }> => {
    const novel = await inject("POST", "/novel", {
      title: `本子-${suffix}-${stamp}`,
      source_type: 1,
      source_text: "第一章：开端。第二章：转折。",
    });
    expect(novel.code).toBe(0);
    const ntId = String(novel.data.id);
    expect((await inject("POST", `/novel/${ntId}/episode_outline/generate`, {})).code).toBe(0);
    const scripts = await inject("POST", `/novel/${ntId}/script-generate`, {});
    expect(scripts.code).toBe(0);
    const finalized = await inject("POST", `/novel/${ntId}/finalize`, { snapshot_episodes: false });
    expect(finalized.code).toBe(0);
    expect(finalized.data.status).toBe(16);
    return { ntId, episodeCount: scripts.data.count as number };
  };

  it("episodes/split keeps script behavior and accepts a novel source (only finalized novels)", async () => {
    // 1) 不传 source：保持既有行为（用项目正文拆集）
    const plainProject = await inject("POST", "/projects", {
      title: `拆集-${stamp}`,
      source_type: 1,
      source_text: "第一章：开端。第二章：转折。第三章：结局。",
    });
    expect(plainProject.code).toBe(0);
    const plain = await inject("POST", `/projects/${plainProject.data.id}/episodes/split`, {});
    expect(plain.code).toBe(0);
    expect(plain.data.length).toBe(3);
    expect(plain.data[0].title).toBe("第1集");
    // 非 novel 来源：source_novel_id 必须为 null（novel 侧 reopen 据此判断"没被本子拆过"）
    const plainDetail = await inject("GET", `/projects/${plainProject.data.id}`);
    expect(plainDetail.data.project.source_novel_id).toBeNull();

    // 2) 传 source：不存在的本子 → novel 侧 400102（证明真的转到 NovelService 而不是糊过去）
    const novelProject = await inject("POST", "/projects", {
      title: `小说拆集-${stamp}`,
      source_type: 1,
      source_text: "占位",
    });
    expect(novelProject.code).toBe(0);
    const notFound = await inject("POST", `/projects/${novelProject.data.id}/episodes/split`, {
      source: { kind: "novel", nt_id: "123456789012345" },
    });
    expect(notFound.code).toBe(400102);

    // 3) 未定稿的本子 → 400100 reason=not_finalized（§3.3：只有 status=16 可作来源）
    const novel = await inject("POST", "/novel", {
      title: `本子-${stamp}`,
      source_type: 1,
      source_text: "第一章：开端。第二章：转折。",
    });
    expect(novel.code).toBe(0);
    const ntId = String(novel.data.id);
    const notFinalized = await inject("POST", `/projects/${novelProject.data.id}/episodes/split`, {
      source: { kind: "novel", nt_id: ntId },
    });
    expect(notFinalized.code).toBe(400100);
    expect(notFinalized.msg).toContain("finalized");
    // 未定稿被拒时不得写入来源本子（否则 novel 侧会以为已被拆集）
    expect((await inject("GET", `/projects/${novelProject.data.id}`)).data.project.source_novel_id).toBeNull();

    // 4) 定稿后可作来源：集边界取本子的 episodeScripts，不再二次切分
    const outlineGenerated = await inject("POST", `/novel/${ntId}/episode_outline/generate`, {});
    expect(outlineGenerated.code).toBe(0);
    const scripts = await inject("POST", `/novel/${ntId}/script-generate`, {});
    expect(scripts.code).toBe(0);
    expect(scripts.data.count).toBeGreaterThan(0);
    const finalized = await inject("POST", `/novel/${ntId}/finalize`, { snapshot_episodes: false });
    expect(finalized.code).toBe(0);
    expect(finalized.data.status).toBe(16);

    const split = await inject("POST", `/projects/${novelProject.data.id}/episodes/split`, {
      source: { kind: "novel", nt_id: ntId },
    });
    expect(split.code).toBe(0);
    expect(split.data.length).toBe(scripts.data.count);
    // 集号顺序与标题都来自本子（不是"第N集"的默认名）
    expect(split.data.map((ep: { ep_no: number }) => ep.ep_no)).toEqual(
      Array.from({ length: scripts.data.count }, (_, i) => i + 1),
    );
    expect(split.data[0].script_text.length).toBeGreaterThan(0);
    expect(split.data[0].title).not.toBe("第1集");

    // 来源标记 + 来源本子落库：详情里 source_type=1（ProjectSourceType.NOVEL）、source_novel_id=ntId
    const detail = await inject("GET", `/projects/${novelProject.data.id}`);
    expect(detail.data.project.source_type).toBe(1);
    expect(detail.data.project.source_novel_id).toBe(ntId);

    void tokenOther;
  });

  it("split keeps the first source_novel_id when another finalized novel re-splits the project", async () => {
    const project = await inject("POST", "/projects", {
      title: `二次拆集-${stamp}`,
      source_type: 1,
      source_text: "占位正文",
    });
    expect(project.code).toBe(0);
    const first = await createFinalizedNovel("first");
    const firstSplit = await inject("POST", `/projects/${project.data.id}/episodes/split`, {
      source: { kind: "novel", nt_id: first.ntId },
    });
    expect(firstSplit.code).toBe(0);
    expect((await inject("GET", `/projects/${project.data.id}`)).data.project.source_novel_id).toBe(first.ntId);

    // 换另一个已定稿本子再拆一次（集未确认，允许重拆）：来源标记不覆盖
    const second = await createFinalizedNovel("second");
    const secondSplit = await inject("POST", `/projects/${project.data.id}/episodes/split`, {
      source: { kind: "novel", nt_id: second.ntId },
    });
    expect(secondSplit.code).toBe(0);
    expect((await inject("GET", `/projects/${project.data.id}`)).data.project.source_novel_id).toBe(first.ntId);
    void first.episodeCount;
    void second.episodeCount;
  });
});


