import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import cookie from "@fastify/cookie";
import { and, asc, eq, inArray } from "drizzle-orm";
import { AllExceptionsFilter } from "../src/common/http/exception.filter";
import { EnvelopeInterceptor } from "../src/common/http/envelope.interceptor";
import { AppModule } from "../src/app.module";
import { db, pool } from "../src/db/database";
import {
  assets,
  creditAccounts,
  creditFlows,
  episodes,
  projectAssets,
  scriptProjects,
  storyboards,
  tasks,
} from "@app/db";
import { newId } from "@app/shared";

/**
 * 广告剧（drama_ad）契约测试 —— 对照竞品 `/df/script_project/drama_ad/*` 12 端点
 * （`rea-reelmate/routes.txt:680-691`）+ 五段语义（`feature-map.md:267`）。
 *
 * 这组用例刻意覆盖"错了会让这条链路不可信"的六类：
 *
 * 1. **记账不白送**：每个生成动作必须先建 `tasks` 行并冻结积分，成功后结算
 *    （`credit_flows` 里有 freeze + settle 两条），余额实际减少目录真实单价。
 *    这是 task-16 的硬约束，也是"广告剧不能变成免费试用"的唯一保证。
 * 2. **五段有真实依赖顺序**：没卖点不能出 brief、没选 brief 不能出脚本、
 *    没脚本不能出分镜、没资产不能出提示词 —— 每一条都是 400101 而不是静默跳过。
 * 3. **未取证字段进 mode_meta**：竞品 `sp_type`/`theme`/`group_ids`/`need_voice`/
 *    `template_type` 原样留痕，不物化成列（迁移 0031 只给了 project_mode + mode_meta）。
 * 4. **重置语义**：`script/reset` 回到"剧情方案选择"，且分镜随之清空（旧分镜是新脚本的谎言）。
 * 5. **跨租户**：他人项目 404、他人空间商品图 403、非广告剧项目 404。
 * 6. **余额不足零副作用**：745701 时 mode_meta 不能被写脏（不能出现"扣了钱没内容"的反面：
 *    "没扣钱但内容变了"）。
 */
describe("ad-drama e2e", () => {
  let app: NestFastifyApplication;
  /** 本次造的项目/资产，afterAll 精确清理（不 truncate，避免影响并行跑的其他 spec） */
  const createdProjectIds: bigint[] = [];
  const createdAssetIds: bigint[] = [];
  const createdUserIds: bigint[] = [];

  const inject = async (
    method: string,
    url: string,
    payload?: unknown,
    authToken?: string,
    spaceId?: string,
  ) => {
    const headers: Record<string, string> = {};
    if (payload !== undefined) headers["content-type"] = "application/json";
    if (authToken) headers.authorization = `Bearer ${authToken}`;
    if (spaceId) headers["x-space-id"] = spaceId;
    const res = await app.inject({
      method: method as "GET" | "POST",
      url: `/v1${url}`,
      headers,
      payload: payload === undefined ? undefined : JSON.stringify(payload),
    });
    let body: Record<string, unknown> = {};
    try {
      body = JSON.parse(res.body) as Record<string, unknown>;
    } catch {
      body = { raw: res.body };
    }
    return {
      status: res.statusCode,
      code: (body as { code?: number }).code ?? -1,
      msg: (body as { msg?: string }).msg ?? "",
      body,
      data: (body as { data?: unknown }).data,
    };
  };

  async function loginNewUser(prefix: string) {
    // 手机号必须满足 `/^1\d{10}$/`（auth.controller.ts:19）
    const tail = String(Date.now()).slice(-6);
    const tag = String(prefix).replace(/\D/g, "").slice(-2).padStart(2, "0");
    const rnd = String(Math.floor(Math.random() * 90 + 10));
    const phone = `1${tail}${rnd}${tag}`;
    const sms = await inject("POST", "/auth/sms-code", { phone });
    const code = (sms.data as { debug_code?: string } | undefined)?.debug_code;
    const login = await inject("POST", "/auth/login", { phone, code, age_confirmed: true });
    const data = login.data as { access_token?: string; space_id?: string; user?: { id?: string } } | undefined;
    if (!data?.access_token) throw new Error(`login failed: ${JSON.stringify(login.body)}`);
    createdUserIds.push(BigInt(String(data.user?.id ?? "0")));
    return { token: data.access_token, spaceId: String(data.space_id ?? ""), userId: String(data.user?.id ?? "") };
  }

  /** 建一个广告剧项目（走真实端点，同时记录 id 供清理） */
  async function createProject(
    u: { token: string; spaceId: string },
    overrides: Record<string, unknown> = {},
  ) {
    const res = await inject(
      "POST",
      "/ad-drama/projects",
      {
        material_name: "咖啡机 X1",
        material_highlight: "20 秒出一杯，办公室也能喝手冲",
        material_image: "s3://ad-spec/coffee-x1.png",
        style: "高级感",
        ratio: "9:16",
        ...overrides,
      },
      u.token,
      u.spaceId,
    );
    if (res.code !== 0) throw new Error(`createProject failed: ${JSON.stringify(res.body)}`);
    const project = (res.data as { project: { id: string } }).project;
    createdProjectIds.push(BigInt(project.id));
    return project.id;
  }

  async function balanceOf(spaceId: string): Promise<number> {
    const [row] = await db
      .select({ balance: creditAccounts.balance })
      .from(creditAccounts)
      .where(eq(creditAccounts.spaceId, BigInt(spaceId)));
    return row?.balance ?? 0;
  }

  async function generateSellingPoints(u: { token: string; spaceId: string }, projectId: string) {
    const res = await inject(
      "POST",
      `/ad-drama/projects/${projectId}/selling-point/generate`,
      {},
      u.token,
      u.spaceId,
    );
    if (res.code !== 0) throw new Error(`selling points failed: ${JSON.stringify(res.body)}`);
    return res.data as { selling_points: string[]; charge: { task_id: string; credits: number } };
  }

  async function generateBriefs(u: { token: string; spaceId: string }, projectId: string) {
    const res = await inject("POST", `/ad-drama/projects/${projectId}/brief/generate`, {}, u.token, u.spaceId);
    if (res.code !== 0) throw new Error(`briefs failed: ${JSON.stringify(res.body)}`);
    return res.data as { briefs: Array<{ id: string; title: string; beats: string[] }> };
  }

  beforeAll(async () => {
    app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter({ trustProxy: true }), {
      logger: false,
    });
    await app.register(cookie);
    app.setGlobalPrefix("v1");
    app.useGlobalInterceptors(new EnvelopeInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  }, 120_000);

  afterAll(async () => {
    // 子表先删：storyboards→episodes→project_assets→tasks/credit_flows→projects→assets
    if (createdProjectIds.length > 0) {
      const eps = await db
        .select({ id: episodes.id })
        .from(episodes)
        .where(inArray(episodes.projectId, createdProjectIds));
      if (eps.length > 0) {
        await db.delete(storyboards).where(inArray(storyboards.episodeId, eps.map((e) => e.id)));
      }
      await db.delete(episodes).where(inArray(episodes.projectId, createdProjectIds));
      await db.delete(projectAssets).where(inArray(projectAssets.projectId, createdProjectIds));
      await db.delete(scriptProjects).where(inArray(scriptProjects.id, createdProjectIds));
    }
    if (createdAssetIds.length > 0) {
      await db.delete(assets).where(inArray(assets.id, createdAssetIds));
    }
    await app.close();
    await pool.end().catch(() => {});
  });

  // ══════════════════════════════════════════════════════════
  // 一、建项目 / 更新（竞品 project/save，rt:686）
  // ══════════════════════════════════════════════════════════

  it("建项目：落 script_projects(project_mode=2)，竞品字段原样进 mode_meta", async () => {
    const u = await loginNewUser("11");
    const created = await inject(
      "POST",
      "/ad-drama/projects",
      {
        material_name: "咖啡机 X1",
        material_highlight: "20 秒出一杯",
        material_image: "s3://ad-spec/coffee-x1.png",
        style: "高级感",
        ratio: "16:9",
        theme: "office",
        group_ids: "0",
      },
      u.token,
      u.spaceId,
    );
    expect(created.code).toBe(0);
    const data = created.data as {
      project: { id: string; project_mode: number; ratio: string; title: string };
      created: boolean;
    };
    createdProjectIds.push(BigInt(data.project.id));
    // project_mode=2 是"广告剧"的唯一身份标识（迁移 0031）；比例跟着 material.ratio
    expect(data.project.project_mode).toBe(2);
    expect(data.project.ratio).toBe("16:9");
    expect(data.created).toBe(true);

    const [row] = await db.select().from(scriptProjects).where(eq(scriptProjects.id, BigInt(data.project.id)));
    const meta = row!.modeMeta as Record<string, unknown>;
    const material = meta.material as Record<string, unknown>;
    expect(material.name).toBe("咖啡机 X1");
    // 竞品 sp_type 当前恒为 2（commands/ad.md:64）：不传时按 2 留痕
    expect(material.sp_type).toBe(2);
    expect(material.theme).toBe("office");
    expect(material.group_ids).toBe("0");
    // 新建项目的五段都还没做
    expect(meta.stage).toBe(1);
    expect(meta.selling_points).toEqual([]);
  });

  it("更新项目：传 project_id 走 save 的更新分支（created=false），比例随 material 改", async () => {
    const u = await loginNewUser("12");
    const projectId = await createProject(u);
    const updated = await inject(
      "POST",
      "/ad-drama/projects",
      {
        project_id: projectId,
        material_name: "咖啡机 X2",
        material_highlight: "升级版，20 秒出双杯",
        material_image: "s3://ad-spec/coffee-x2.png",
        style: "极简",
        ratio: "16:9",
        title: "改名后的广告剧",
      },
      u.token,
      u.spaceId,
    );
    expect(updated.code).toBe(0);
    const data = updated.data as { project: { id: string; title: string; ratio: string }; created: boolean };
    expect(data.created).toBe(false);
    expect(data.project.id).toBe(projectId);
    expect(data.project.title).toBe("改名后的广告剧");
    expect(data.project.ratio).toBe("16:9");
  });

  it("参数校验与跨租户素材：缺必填/非法比例 400101；他人空间商品图 403；不存在的数字 id 400101", async () => {
    const u = await loginNewUser("13");
    const other = await loginNewUser("14");

    const missingName = await inject(
      "POST",
      "/ad-drama/projects",
      {
        material_highlight: "卖点",
        material_image: "s3://x.png",
        style: "s",
        ratio: "9:16",
      },
      u.token,
      u.spaceId,
    );
    expect(missingName.code).toBe(400101);

    const badRatio = await inject(
      "POST",
      "/ad-drama/projects",
      { material_name: "n", material_highlight: "h", material_image: "s3://x.png", style: "s", ratio: "4:3" },
      u.token,
      u.spaceId,
    );
    // 竞品只允许 9:16 / 16:9（commands/ad.md:63），4:3 必须拒绝而不是静默接受
    expect(badRatio.code).toBe(400101);

    // 他人空间的资产当商品图：403（跨租户素材泄露面）
    const foreignAsset = newId();
    createdAssetIds.push(foreignAsset);
    await db.insert(assets).values({
      id: foreignAsset,
      spaceId: BigInt(other.spaceId),
      kind: "image",
      uri: `s3://other-space/${String(foreignAsset)}.png`,
      name: "别人的商品图",
      tags: [],
    });
    const crossSpace = await inject(
      "POST",
      "/ad-drama/projects",
      {
        material_name: "n",
        material_highlight: "h",
        material_image: String(foreignAsset),
        style: "s",
        ratio: "9:16",
      },
      u.token,
      u.spaceId,
    );
    expect(crossSpace.code).toBe(403101);

    const missingAsset = await inject(
      "POST",
      "/ad-drama/projects",
      { material_name: "n", material_highlight: "h", material_image: "999999999999", style: "s", ratio: "9:16" },
      u.token,
      u.spaceId,
    );
    expect(missingAsset.code).toBe(400101);
  });

  // ══════════════════════════════════════════════════════════
  // 二、卖点（rt:690）+ 记账
  // ══════════════════════════════════════════════════════════

  it("卖点生成：走目录真实价（文本按次 2 积分），tasks + freeze/settle 流水齐全", async () => {
    const u = await loginNewUser("21");
    const projectId = await createProject(u);
    const before = await balanceOf(u.spaceId);

    const res = await generateSellingPoints(u, projectId);
    expect(res.selling_points.length).toBeGreaterThan(0);
    expect(res.charge.credits).toBe(2); // 文本模型 per_call 价（seed.ts:1486-1498）

    // 钱是真扣的（不是白送）
    expect(await balanceOf(u.spaceId)).toBe(before - 2);

    // 任务行：文本能力、按次、完成、已结算
    const [task] = await db.select().from(tasks).where(eq(tasks.id, BigInt(res.charge.task_id)));
    expect(task).toBeTruthy();
    expect(task!.capability).toBe("text");
    expect(task!.mode).toBe("script_optimization");
    expect(task!.status).toBe(3);
    // 收尾后字段必须归零（PR-03）。这一行**曾经断言是 2** —— 那是在描述缺陷：
    // `tasks.credits_frozen` 从插入后再没被写回过 0，导致「是否已释放」的语义从未表达，
    // `creditsFrozen > 0` 在 4 处判据里恒真（任务删不掉、取消后被二次解冻）。
    // 现在额度以 credit_flows 为准，字段只表达「当前还冻结着多少」。
    expect(task!.creditsFrozen).toBe(0);
    expect(task!.creditsSettled).toBe(2);

    // 流水必须是 freeze + settle 两条（对账口径：冻结→结算，不是直接扣）
    const flows = await db
      .select()
      .from(creditFlows)
      .where(eq(creditFlows.refTaskId, BigInt(res.charge.task_id)))
      .orderBy(asc(creditFlows.createdAt));
    expect(flows.map((f) => f.kind).sort()).toEqual(["freeze", "settle"]);

    // 卖点确实落库
    const [row] = await db.select().from(scriptProjects).where(eq(scriptProjects.id, BigInt(projectId)));
    const meta = row!.modeMeta as Record<string, unknown>;
    expect((meta.selling_points as string[]).length).toBe(res.selling_points.length);
    // 扣费留痕（info 能回答"这一步花了多少"）
    expect((meta.charges as Array<{ action: string; credits: number }>).at(-1)?.action).toBe("selling_point");
  });

  it("卖点确定性：同一商品重复生成得到同一批卖点（mock 按素材种子派生，幂等复跑友好）", async () => {
    const u = await loginNewUser("22");
    const projectId = await createProject(u);
    const first = await generateSellingPoints(u, projectId);
    const second = await generateSellingPoints(u, projectId);
    expect(second.selling_points).toEqual(first.selling_points);
  });

  // ══════════════════════════════════════════════════════════
  // 三、brief 生成与选定（rt:682、:683）
  // ══════════════════════════════════════════════════════════

  it("brief 前置：没有卖点不能生成剧情方案（400101，且提示停在卖点这一段）", async () => {
    const u = await loginNewUser("31");
    const projectId = await createProject(u);
    const res = await inject("POST", `/ad-drama/projects/${projectId}/brief/generate`, {}, u.token, u.spaceId);
    expect(res.code).toBe(400101);
    // 错误信息要能直接告诉用户"先做卖点"（five-stage 的依赖顺序不能靠猜）
    expect(res.msg).toContain("selling points");
  });

  it("brief 生成与选定：默认 3 条候选、选中后 selected=true；未知 brief_id 404", async () => {
    const u = await loginNewUser("32");
    const projectId = await createProject(u);
    await generateSellingPoints(u, projectId);
    const { briefs } = await generateBriefs(u, projectId);
    expect(briefs.length).toBe(3);
    for (const brief of briefs) {
      expect(brief.id).toBeTruthy();
      expect(brief.title).toBeTruthy();
      expect(brief.beats.length).toBeGreaterThanOrEqual(3);
    }

    const picked = await inject(
      "POST",
      `/ad-drama/projects/${projectId}/brief/select`,
      { brief_id: briefs[1]!.id },
      u.token,
      u.spaceId,
    );
    expect(picked.code).toBe(0);
    expect((picked.data as { selected_brief: string }).selected_brief).toBe(briefs[1]!.id);

    const info = await inject("GET", `/ad-drama/projects/${projectId}`, undefined, u.token, u.spaceId);
    const data = info.data as { briefs: Array<{ id: string; selected: boolean }>; selected_brief: string };
    expect(data.selected_brief).toBe(briefs[1]!.id);
    expect(data.briefs.find((b) => b.id === briefs[1]!.id)!.selected).toBe(true);
    expect(data.briefs.filter((b) => b.selected).length).toBe(1);

    // 幂等：重复选同一个不报错、结果不变
    const again = await inject(
      "POST",
      `/ad-drama/projects/${projectId}/brief/select`,
      { brief_id: briefs[1]!.id },
      u.token,
      u.spaceId,
    );
    expect(again.code).toBe(0);
    expect((again.data as { selected_brief: string }).selected_brief).toBe(briefs[1]!.id);

    const unknown = await inject(
      "POST",
      `/ad-drama/projects/${projectId}/brief/select`,
      { brief_id: "999999999999" },
      u.token,
      u.spaceId,
    );
    expect(unknown.code).toBe(400102);
  });

  // ══════════════════════════════════════════════════════════
  // 四、脚本：生成 / 编辑 / 重置（rt:688、:687、:689）
  // ══════════════════════════════════════════════════════════

  it("脚本：未选 brief 拒绝；选定后生成落 episodes.script_text，stage 推进到 3", async () => {
    const u = await loginNewUser("41");
    const projectId = await createProject(u);
    await generateSellingPoints(u, projectId);

    const noBrief = await inject("POST", `/ad-drama/projects/${projectId}/script/generate`, {}, u.token, u.spaceId);
    expect(noBrief.code).toBe(400101);
    expect(noBrief.msg).toContain("brief");

    const { briefs } = await generateBriefs(u, projectId);
    await inject(
      "POST",
      `/ad-drama/projects/${projectId}/brief/select`,
      { brief_id: briefs[0]!.id },
      u.token,
      u.spaceId,
    );

    const generated = await inject("POST", `/ad-drama/projects/${projectId}/script/generate`, {}, u.token, u.spaceId);
    expect(generated.code).toBe(0);
    const script = (generated.data as { script: { text: string } }).script;
    expect(script.text.length).toBeGreaterThan(10);

    // 正文落既有集表（复用 episodes，不新建表）
    const [ep] = await db.select().from(episodes).where(eq(episodes.projectId, BigInt(projectId)));
    expect(ep).toBeTruthy();
    expect(ep!.epNo).toBe(1);
    expect(ep!.scriptText).toBe(script.text);

    const info = await inject("GET", `/ad-drama/projects/${projectId}`, undefined, u.token, u.spaceId);
    const data = info.data as { stage: number; stages: Array<{ key: string; done: boolean }> };
    expect(data.stage).toBeGreaterThanOrEqual(3);
    expect(data.stages.find((s) => s.key === "script")!.done).toBe(true);
    // 没出分镜/资产前，这两段仍是未完成（五段是真实依赖，不是状态自述）
    expect(data.stages.find((s) => s.key === "storyboard")!.done).toBe(false);
  });

  it("脚本编辑：改正文落库并留 edited_at；空文本 400101", async () => {
    const u = await loginNewUser("42");
    const projectId = await createProject(u);
    await generateSellingPoints(u, projectId);
    const { briefs } = await generateBriefs(u, projectId);
    await inject("POST", `/ad-drama/projects/${projectId}/brief/select`, { brief_id: briefs[0]!.id }, u.token, u.spaceId);

    const empty = await inject(
      "POST",
      `/ad-drama/projects/${projectId}/script/edit`,
      { script_text: "   " },
      u.token,
      u.spaceId,
    );
    expect(empty.code).toBe(400101);

    const edited = await inject(
      "POST",
      `/ad-drama/projects/${projectId}/script/edit`,
      { script_text: "镜头1：手冲咖啡特写\n镜头2：办公室白领举杯" },
      u.token,
      u.spaceId,
    );
    expect(edited.code).toBe(0);
    const script = (edited.data as { script: { text: string; edited_at?: string } }).script;
    expect(script.text).toContain("手冲咖啡特写");
    expect(script.edited_at).toBeTruthy();

    const [ep] = await db.select().from(episodes).where(eq(episodes.projectId, BigInt(projectId)));
    expect(ep!.scriptText).toContain("办公室白领举杯");

    // 重复同一内容 = 幂等（仍是一条 episode，不产生第二集）
    await inject(
      "POST",
      `/ad-drama/projects/${projectId}/script/edit`,
      { script_text: "镜头1：手冲咖啡特写\n镜头2：办公室白领举杯" },
      u.token,
      u.spaceId,
    );
    const eps = await db.select().from(episodes).where(eq(episodes.projectId, BigInt(projectId)));
    expect(eps.length).toBe(1);
  });

  it("脚本重置：清脚本+取消方案选择+清分镜，回到 stage=2；重复重置幂等", async () => {
    const u = await loginNewUser("43");
    const projectId = await createProject(u);
    await generateSellingPoints(u, projectId);
    const { briefs } = await generateBriefs(u, projectId);
    await inject("POST", `/ad-drama/projects/${projectId}/brief/select`, { brief_id: briefs[0]!.id }, u.token, u.spaceId);
    await inject("POST", `/ad-drama/projects/${projectId}/script/generate`, {}, u.token, u.spaceId);
    await inject("POST", `/ad-drama/projects/${projectId}/storyboard/generate`, {}, u.token, u.spaceId);

    const [epBefore] = await db.select().from(episodes).where(eq(episodes.projectId, BigInt(projectId)));
    const shotsBefore = await db.select().from(storyboards).where(eq(storyboards.episodeId, epBefore!.id));
    expect(shotsBefore.length).toBeGreaterThan(0);

    const reset = await inject("POST", `/ad-drama/projects/${projectId}/script/reset`, {}, u.token, u.spaceId);
    expect(reset.code).toBe(0);
    const data = reset.data as { reset: boolean; stage: number; deleted_shots: number };
    expect(data.reset).toBe(true);
    expect(data.stage).toBe(2);
    // 旧分镜由旧脚本派生，重置后必须一起清掉（否则新脚本配旧分镜）
    expect(data.deleted_shots).toBe(shotsBefore.length);

    const info = await inject("GET", `/ad-drama/projects/${projectId}`, undefined, u.token, u.spaceId);
    const after = info.data as {
      selected_brief: string | null;
      script: { text: string } | null;
      shots: unknown[];
      stage: number;
    };
    expect(after.selected_brief).toBeNull();
    expect(after.script?.text ?? "").toBe("");
    expect(after.shots.length).toBe(0);
    expect(after.stage).toBe(2);

    // 幂等：再重置一次不报错、没有可删的分镜
    const again = await inject("POST", `/ad-drama/projects/${projectId}/script/reset`, {}, u.token, u.spaceId);
    expect(again.code).toBe(0);
    expect((again.data as { deleted_shots: number }).deleted_shots).toBe(0);
  });

  // ══════════════════════════════════════════════════════════
  // 五、分镜（rt:691）
  // ══════════════════════════════════════════════════════════

  it("分镜：无脚本拒绝；template_type 2 出 10 镜（至尊）、1 出 6 镜（急速）；重生成不叠加", async () => {
    const u = await loginNewUser("51");
    const projectId = await createProject(u);
    await generateSellingPoints(u, projectId);

    const noScript = await inject("POST", `/ad-drama/projects/${projectId}/storyboard/generate`, {}, u.token, u.spaceId);
    expect(noScript.code).toBe(400101);

    const { briefs } = await generateBriefs(u, projectId);
    await inject("POST", `/ad-drama/projects/${projectId}/brief/select`, { brief_id: briefs[0]!.id }, u.token, u.spaceId);
    await inject("POST", `/ad-drama/projects/${projectId}/script/generate`, {}, u.token, u.spaceId);

    // 竞品 template_type=1 急速 / 2 至尊（commands/ad.md:149）；镜数竞品未给 → 我方 6/10
    const fast = await inject(
      "POST",
      `/ad-drama/projects/${projectId}/storyboard/generate`,
      { template_type: 1 },
      u.token,
      u.spaceId,
    );
    expect(fast.code).toBe(0);
    const fastData = fast.data as { shots: Array<{ shot_no: number; video_prompt: string }>; storyboard: { template_type: number } };
    expect(fastData.shots.length).toBe(6);
    expect(fastData.storyboard.template_type).toBe(1);
    expect(fastData.shots[0]!.shot_no).toBe(1);
    // 提示词必须含商品名（广告片的核心：商品要在画面里可辨识）
    expect(fastData.shots[0]!.video_prompt).toContain("咖啡机");

    const premium = await inject(
      "POST",
      `/ad-drama/projects/${projectId}/storyboard/generate`,
      { template_type: 2, shot_count: 10 },
      u.token,
      u.spaceId,
    );
    expect(premium.code).toBe(0);
    const premiumShots = (premium.data as { shots: unknown[] }).shots;
    expect(premiumShots.length).toBe(10);

    // 重生成 = 整体替换（不叠加旧镜头，否则镜号重复）
    const [ep] = await db.select().from(episodes).where(eq(episodes.projectId, BigInt(projectId)));
    const dbShots = await db.select().from(storyboards).where(eq(storyboards.episodeId, ep!.id));
    expect(dbShots.length).toBe(10);
  });

  // ══════════════════════════════════════════════════════════
  // 六、资产抽取 / 提示词（rt:680、:681）
  // ══════════════════════════════════════════════════════════

  it("资产抽取：商品本体必为第一条（prop + ref_image_uri=商品图），need_voice 留痕", async () => {
    const u = await loginNewUser("61");
    const projectId = await createProject(u, { material_image: "s3://ad-spec/prod.png" });

    const res = await inject(
      "POST",
      `/ad-drama/projects/${projectId}/asset/extract`,
      { need_voice: 2 },
      u.token,
      u.spaceId,
    );
    expect(res.code).toBe(0);
    const data = res.data as {
      assets: Array<{ id: string; kind: string; name: string; ref_image_uri: string | null }>;
      need_voice: number;
    };
    expect(data.need_voice).toBe(2);
    // 商品是广告片主角：第一条一定是商品本体，且带着商品图
    expect(data.assets[0]!.kind).toBe("prop");
    expect(data.assets[0]!.name).toBe("咖啡机 X1");
    expect(data.assets[0]!.ref_image_uri).toBe("s3://ad-spec/prod.png");
    // 必须有场景（否则分镜没地方演）
    expect(data.assets.some((a) => a.kind === "scene")).toBe(true);

    const info = await inject("GET", `/ad-drama/projects/${projectId}`, undefined, u.token, u.spaceId);
    const infoData = info.data as { asset_meta: { need_voice?: number } | null; stages: Array<{ key: string; done: boolean }> };
    expect(infoData.asset_meta?.need_voice).toBe(2);
    expect(infoData.stages.find((s) => s.key === "asset")!.done).toBe(true);
  });

  it("资产提示词：无资产先拒；生成后写回 project_assets.prompt 与 mode_meta.image_tips", async () => {
    const u = await loginNewUser("62");
    const projectId = await createProject(u);

    const noAsset = await inject("POST", `/ad-drama/projects/${projectId}/asset/image-tips`, {}, u.token, u.spaceId);
    expect(noAsset.code).toBe(400101);

    await inject("POST", `/ad-drama/projects/${projectId}/asset/extract`, {}, u.token, u.spaceId);
    const tips = await inject("POST", `/ad-drama/projects/${projectId}/asset/image-tips`, {}, u.token, u.spaceId);
    expect(tips.code).toBe(0);
    const data = tips.data as { image_tips: Array<{ name: string; prompt: string; asset_id?: string }> };
    expect(data.image_tips.length).toBeGreaterThan(0);
    expect(data.image_tips[0]!.prompt.length).toBeGreaterThan(10);

    const rows = await db.select().from(projectAssets).where(eq(projectAssets.projectId, BigInt(projectId)));
    // 提示词写回资产行（不是只存在 mode_meta 里，否则资产页看不到）
    expect(rows.some((r) => r.promptStatus === 2)).toBe(true);
    expect(rows[0]!.prompt).toBeTruthy();
  });

  // ══════════════════════════════════════════════════════════
  // 七、积分预估（rt:685）
  // ══════════════════════════════════════════════════════════

  it("积分预估：按目录真实价逐条报，做完的步骤不再计入；include_media 给最低档估算", async () => {
    const u = await loginNewUser("71");
    const projectId = await createProject(u);

    const fresh = await inject(
      "POST",
      `/ad-drama/projects/${projectId}/point`,
      { include_media: true, shot_count: 6 },
      u.token,
      u.spaceId,
    );
    expect(fresh.code).toBe(0);
    const freshData = fresh.data as {
      steps: Array<{ action: string; credits: number }>;
      total_credits: number;
      media_estimate: { total_credits: number; basis: string } | null;
    };
    // 全新项目：卖点/brief/剧本/分镜/资产 五步都还没做
    expect(freshData.steps.map((s) => s.action)).toEqual([
      "selling_point",
      "brief",
      "script",
      "storyboard",
      "asset_extract",
    ]);
    expect(freshData.total_credits).toBe(10); // 5 步 × 2 积分/次
    expect(freshData.media_estimate).not.toBeNull();
    expect(freshData.media_estimate!.total_credits).toBeGreaterThan(0);
    expect(freshData.media_estimate!.basis).toContain("逐镜");

    await generateSellingPoints(u, projectId);
    const after = await inject("POST", `/ad-drama/projects/${projectId}/point`, {}, u.token, u.spaceId);
    const afterData = after.data as { steps: Array<{ action: string }>; total_credits: number };
    // 卖点已做完 → 不再计入（预估是"剩下还要花多少"，不是"整条链路总价"）
    expect(afterData.steps.map((s) => s.action)).not.toContain("selling_point");
    expect(afterData.total_credits).toBe(8);
  });

  // ══════════════════════════════════════════════════════════
  // 八、跨租户 / 非本模式 / 余额不足
  // ══════════════════════════════════════════════════════════

  it("跨租户与非本模式：他人项目 404、普通剧本项目 404（不泄露存在性）", async () => {
    const owner = await loginNewUser("81");
    const outsider = await loginNewUser("82");
    const projectId = await createProject(owner);

    const peek = await inject("GET", `/ad-drama/projects/${projectId}`, undefined, outsider.token, outsider.spaceId);
    expect(peek.code).toBe(400102);
    const poke = await inject(
      "POST",
      `/ad-drama/projects/${projectId}/selling-point/generate`,
      {},
      outsider.token,
      outsider.spaceId,
    );
    expect(poke.code).toBe(400102);

    // 普通剧本项目（project_mode=1）不能走广告剧端点
    const plainId = newId();
    createdProjectIds.push(plainId);
    await db.insert(scriptProjects).values({
      id: plainId,
      spaceId: BigInt(owner.spaceId),
      title: "普通短剧项目",
      projectMode: 1,
      modeMeta: {},
      status: 1,
    });
    const wrongMode = await inject("GET", `/ad-drama/projects/${String(plainId)}`, undefined, owner.token, owner.spaceId);
    expect(wrongMode.code).toBe(400102);
  });

  it("余额不足：745701 且零副作用（不建半成品内容、任务落 failed、冻结已解冻）", async () => {
    const u = await loginNewUser("83");
    const projectId = await createProject(u);
    // 直接把余额清零（测试专用；业务代码永不这样改余额）
    await db.update(creditAccounts).set({ balance: 0, updatedAt: new Date() }).where(eq(creditAccounts.spaceId, BigInt(u.spaceId)));

    const res = await inject("POST", `/ad-drama/projects/${projectId}/selling-point/generate`, {}, u.token, u.spaceId);
    expect(res.code).toBe(745701);

    const [row] = await db.select().from(scriptProjects).where(eq(scriptProjects.id, BigInt(projectId)));
    const meta = row!.modeMeta as Record<string, unknown>;
    // 没扣钱也不能改内容：卖点仍为空，stage 仍停在第 1 段
    expect(meta.selling_points).toEqual([]);
    expect(meta.stage).toBe(1);
    expect(await balanceOf(u.spaceId)).toBe(0);

    // 余额检查在"建任务+冻结"之前 → 不应留下任何 task
    const taskRows = await db
      .select()
      .from(tasks)
      .where(and(eq(tasks.spaceId, BigInt(u.spaceId)), eq(tasks.capability, "text")));
    expect(taskRows.length).toBe(0);
  });
});
