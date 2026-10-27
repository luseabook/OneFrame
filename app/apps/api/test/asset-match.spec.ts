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

  it("match-result before matching: projects the shot bindings into 3 arrays with status counts", async () => {
    const res = await matchResult();
    expect(res.code).toBe(0);
    expect(res.data.ep_id).toBe(episodeId);
    // 角色在生成分镜时就已绑定（但还没定妆图）→ 一定出现在清单里且算「未定稿」
    expect(res.data.characters.length).toBeGreaterThan(0);
    expect(res.data.counts.characters.total).toBe(res.data.characters.length);
    expect(res.data.counts.characters.unfinalized).toBeGreaterThan(0);
    // 绑定关系可回溯：至少一个角色被 4 个分镜引用
    expect(
      (res.data.characters as Array<{ bound_shot_count: number }>).some((row) => row.bound_shot_count > 0),
    ).toBe(true);
    // 三项计数之和必须等于总数（判据 §2：三态统计与实际一致）
    for (const key of ["characters", "scenes", "props"] as const) {
      const c = res.data.counts[key];
      expect(c.matched + c.unfinalized + c.missing).toBe(c.total);
    }
    expect([0, 1, 2, 3]).toContain(res.data.status);
    // 三选项，默认第三项「保持现状」
    const options = res.data.supplement.options as Array<{ value: string; default: boolean }>;
    expect(options.map((option) => option.value)).toEqual(["smart-supplement", "rematch", "keep"]);
    expect(options.filter((option) => option.default).map((option) => option.value)).toEqual(["keep"]);
  });

  it("match-resources dry-run creates nothing, real run creates placeholders for missing assets", async () => {
    const before = (await inject("GET", `/projects/${projectId}/assets`)).data.list.length as number;
    const dry = await inject("POST", `/projects/${projectId}/episodes/${episodeId}/match-resources`, {
      dry_run: true,
    });
    expect(dry.code).toBe(0);
    expect(dry.data.dry_run).toBe(true);
    expect(dry.data.candidates.length).toBeGreaterThan(0);
    expect(dry.data.created_placeholders).toEqual([]);
    expect((await inject("GET", `/projects/${projectId}/assets`)).data.list.length).toBe(before);

    const real = await inject("POST", `/projects/${projectId}/episodes/${episodeId}/match-resources`, {});
    expect(real.code).toBe(0);
    expect(real.data.created_placeholders.length).toBeGreaterThan(0);
    const after = (await inject("GET", `/projects/${projectId}/assets`)).data.list.length as number;
    expect(after).toBeGreaterThan(before);

    // 占位资产没有提示词 → 匹配结果里出现「缺失(3)」
    const result = await matchResult();
    expect(result.data.status).toBe(3);
    expect(result.data.counts.characters.missing + result.data.counts.scenes.missing + result.data.counts.props.missing)
      .toBeGreaterThan(0);
    expect(result.data.supplement.target_count).toBeGreaterThan(0);
    // 幂等：再跑一次不重复建占位资产
    const again = await inject("POST", `/projects/${projectId}/episodes/${episodeId}/match-resources`, {});
    expect(again.code).toBe(0);
    expect(again.data.created_placeholders).toEqual([]);
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
    // 提示词已补全的目标要落到 asset.prompt（否则生图仍无提示词）
    const filled = real.data.pending_image as Array<{ resource_id: string; prompt: string }>;
    expect(filled.length).toBeGreaterThan(0);
    for (const item of filled) {
      const [row] = await db
        .select()
        .from(projectAssets)
        .where(eq(projectAssets.id, BigInt(item.resource_id)));
      expect(row?.prompt).toBe(item.prompt);
      expect(item.prompt.length).toBeGreaterThan(0);
    }
    // 生图不在本端点扣费：返回 next_actions 指向既有生图端点
    expect(String(real.data.next_actions[0].path)).toContain("/generate-image");
    // 补全后这些项从「缺失」变成「未定稿」（还没有定稿图）
    const after = await matchResult();
    expect(after.data.supplement.target_count).toBe(0);
    expect(after.data.status).toBe(1);
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

    // 重复提交同一快照 → 幂等（绑定数不变、统计不变）
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
  });

  it("match-reset is destructive: dry-run only previews, real run clears the episode bindings", async () => {
    const filled = await bindingCount();
    expect(filled).toBeGreaterThan(0);
    const dry = await inject("POST", `/projects/${projectId}/episodes/${episodeId}/match-reset`, {
      dry_run: true,
    });
    expect(dry.code).toBe(0);
    expect(dry.data.dry_run).toBe(true);
    expect(dry.data.would_remove).toBe(filled);
    expect(await bindingCount()).toBe(filled); // dry-run 没动数据

    const real = await inject("POST", `/projects/${projectId}/episodes/${episodeId}/match-reset`, {});
    expect(real.code).toBe(0);
    expect(real.data.removed).toBe(filled);
    expect(await bindingCount()).toBe(0);
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

    // 来源标记落库：详情里 source_type=1（ProjectSourceType.NOVEL）
    const detail = await inject("GET", `/projects/${novelProject.data.id}`);
    expect(detail.data.project.source_type).toBe(1);

    void tokenOther;
  });
});


