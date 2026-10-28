import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import cookie from "@fastify/cookie";
import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import {
  agentEvents,
  agentMessages,
  agentSessions,
  agentSkillFavorites,
  agentSkills,
  assets,
  canvases,
  scriptProjects,
} from "@app/db";
import { AllExceptionsFilter } from "../src/common/http/exception.filter";
import { EnvelopeInterceptor } from "../src/common/http/envelope.interceptor";
import { AppModule } from "../src/app.module";
import { db, pool } from "../src/db/database";
import { SKILL_CATALOG } from "../src/modules/agent/agent-skills.catalog";
import { AgentSttService } from "../src/modules/agent/agent-stt.service";

/**
 * 第 4 批入口收口 e2e：Skill 卡市场 8 端点 + STT + 推荐卡 + 独立创作会话。
 *
 * 竞品对照：`rea-reelmate/routes.txt:378-385`（agent-skills 8 条 + recommend-cards）、
 * `routes.txt:126`（agent/stt-token）；完成计划 `completion-plan-to-100.md:173-183`。
 *
 * 锁住六条会静默腐化体验的行为：
 *
 * 1. **广场基线 = 33 张平台卡**（竞品实测 33 张）。目录幂等 upsert 的依据是
 *    `config->>'slug'`，重复读不会插重复卡；这条不复用数据库迁移夹具，
 *    因为它验证的正是"服务自己能补齐目录"。
 * 2. **收藏幂等**：显式 `favorite:true/false` 重复调用后 `favorite_count`
 *    必须等于真实收藏行数（双击不能变 2、取消后不能变 -1）。
 * 3. **可见性三分**：平台卡公开可读不可删；本空间私有卡只有本空间可见；
 *    跨 space 私卡一律 400102（不泄漏存在性），删别人的卡也是 400102。
 * 4. **无 Key 的 STT 不能 500**：必须 200 + `available:false` + `fallback:"browser"`，
 *    这是"能力位"与"报错"的区别；配好 Key 后要发得出短期令牌且令牌带 audience 区分。
 * 5. **推荐卡 3~6 张且 skills[].skill_id 必须是真实卡**：空态给竞品那 4 张兜底卡；
 *    有项目信号后切到 `source:"signals"` 并包含剧本类卡。
 * 6. **独立创作会话作用域**：scope=1 端点不能读写画布会话（scope=2）；
 *    发消息带 `skill_ids` 要给卡片 `use_count` +1（广场排序信号）。
 */
describe("agent skills / stt / recommend e2e", () => {
  let app: NestFastifyApplication;
  let tokenA = "";
  let spaceA = "";
  let userIdA = "";
  let tokenB = "";
  let spaceB = "";
  let userIdB = "";
  /** 测试期间造的行，afterAll 统一清理（按 space 删，不碰别人的数据） */
  const createdSkillIds: string[] = [];
  const createdSessionIds: string[] = [];

  const inject = async (
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
    url: string,
    payload?: unknown,
    authToken?: string,
    spaceId?: string,
  ) => {
    const headers: Record<string, string> = {};
    if (payload !== undefined) headers["content-type"] = "application/json";
    const bearer = authToken === undefined ? tokenA : authToken;
    if (bearer) headers.authorization = `Bearer ${bearer}`;
    if (spaceId) headers["x-space-id"] = spaceId;
    const res = await app.inject({
      method,
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
      data: (body as { data?: unknown }).data,
      body,
    };
  };

  async function loginNewUser(tag: string): Promise<{ token: string; spaceId: string; userId: string }> {
    const tail = String(Date.now()).slice(-8);
    const phone = `1${tail}${String(tag).replace(/\D/g, "").slice(-2).padStart(2, "0")}`;
    const sms = await inject("POST", "/auth/sms-code", { phone }, "");
    const code = (sms.data as { debug_code?: string } | undefined)?.debug_code;
    const login = await inject("POST", "/auth/login", { phone, code, age_confirmed: true }, "");
    const data = login.data as
      | { access_token?: string; space_id?: string; user?: { id?: string } }
      | undefined;
    if (!data?.access_token) throw new Error(`login failed: ${JSON.stringify(login.body).slice(0, 200)}`);
    return {
      token: data.access_token,
      spaceId: String(data.space_id ?? ""),
      userId: String(data.user?.id ?? ""),
    };
  }

  const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

  /** 等助手回复（LLM 那一轮是后台跑的，REST 才是权威来源 —— ADR-012） */
  async function waitForAssistant(sessionId: string, timeoutMs = 20_000) {
    const started = Date.now();
    for (;;) {
      const res = await inject("GET", `/agent/sessions/${sessionId}/messages?page_size=50`);
      const list = (res.data?.list ?? []) as Array<{ role: number }>;
      if (list.some((item) => item.role === 2)) return list;
      if (Date.now() - started > timeoutMs) {
        throw new Error(`assistant reply timeout, got ${list.length} messages`);
      }
      await sleep(150);
    }
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

    const a = await loginNewUser("01");
    tokenA = a.token;
    spaceA = a.spaceId;
    userIdA = a.userId;
    const b = await loginNewUser("02");
    tokenB = b.token;
    spaceB = b.spaceId;
    userIdB = b.userId;

    // 上一次跑到一半留下的 E2E 行会污染"广场 = 33 张"的基线断言（发布卡是全局可见的），
    // 这里按名字前缀先清一遍；只碰本 spec 自己造的数据。
    await db.execute(sql`delete from agent_skills where space_id is not null and name like 'E2E%'`);
  }, 120_000);

  afterAll(async () => {
    const userBigs = [BigInt(userIdA || "0"), BigInt(userIdB || "0")];
    const spaceBigs = [BigInt(spaceA || "0"), BigInt(spaceB || "0")];
    if (createdSkillIds.length > 0) {
      const ids = createdSkillIds.map((id) => BigInt(id));
      await db.delete(agentSkillFavorites).where(inArray(agentSkillFavorites.skillId, ids));
    }
    await db.delete(agentSkillFavorites).where(inArray(agentSkillFavorites.userId, userBigs));
    await db
      .delete(agentSkills)
      .where(and(isNotNull(agentSkills.spaceId), inArray(agentSkills.spaceId, spaceBigs)));
    // 收藏数按真实行数重算：测试加的收藏被清掉后，平台卡计数不能留着脏值
    await db.execute(sql`
      update agent_skills s
         set favorite_count = (select count(*) from agent_skill_favorites f where f.skill_id = s.id)
       where s.space_id is null
    `);
    if (createdSessionIds.length > 0) {
      const ids = createdSessionIds.map((id) => BigInt(id));
      await db.delete(agentEvents).where(inArray(agentEvents.sessionId, ids));
      await db.delete(agentMessages).where(inArray(agentMessages.sessionId, ids));
      await db.delete(agentSessions).where(inArray(agentSessions.id, ids));
    }
    // 独立会话列表断言用的 space 里可能还留着别的会话（例如本文件造过的），按 space 收尾
    await db.delete(agentSessions).where(inArray(agentSessions.spaceId, spaceBigs));
    await app.close();
    await pool.end().catch(() => {});
  });

  // ── 1. 广场基线 ────────────────────────────────────────
  it("广场：33 张平台卡、分类筛选、关键词搜索、分页不重叠", async () => {
    const plaza = await inject("GET", "/agent-skills/plaza?page_size=100");
    expect(plaza.code).toBe(0);
    const page = plaza.data as {
      list: Array<Record<string, unknown>>;
      total: number;
      page: number;
      page_size: number;
    };
    // 竞品实测 33 张（completion-plan-to-100.md:178），我方目录必须与之一致
    expect(page.total).toBe(SKILL_CATALOG.length);
    expect(page.total).toBe(33);
    expect(page.list.length).toBe(33);

    const first = page.list[0] as {
      skill_id: string;
      name_en: string;
      prompt_template: string;
      category: string;
      use_count: number;
      is_favorite: boolean;
    };
    expect(first.skill_id).toMatch(/^\d+$/);
    // name_en = 斜杠指令名，前端靠它把输入框首词识别成技能（d-canvas-agent.md:349）
    expect(first.name_en).toMatch(/^[a-z0-9-]+$/);
    // 卡片必须自带可用 prompt，否则"点卡即用"是假的
    expect(first.prompt_template.startsWith(`/${first.name_en}`)).toBe(true);
    expect(first.is_favorite).toBe(false);

    // 默认按使用次数降序（广场排序信号）
    const counts = page.list.map((item) => (item as { use_count: number }).use_count);
    expect(counts).toEqual([...counts].sort((x, y) => y - x));

    const video = await inject("GET", "/agent-skills/plaza?category=video&page_size=100");
    expect(video.code).toBe(0);
    const videoPage = video.data as { list: Array<{ category: string }>; total: number };
    expect(videoPage.total).toBeGreaterThan(0);
    expect(videoPage.list.every((item) => item.category === "video")).toBe(true);

    const searched = await inject("GET", `/agent-skills/plaza?q=${encodeURIComponent("人物")}`);
    expect(searched.code).toBe(0);
    const searchedPage = searched.data as { list: Array<{ name: string; summary: string }>; total: number };
    expect(searchedPage.total).toBeGreaterThan(0);
    expect(
      searchedPage.list.every((item) => item.name.includes("人物") || item.summary.includes("人物")),
    ).toBe(true);

    // 分页：两页 id 不重叠，且页大小生效
    const p1 = await inject("GET", "/agent-skills/plaza?page=1&page_size=5");
    const p2 = await inject("GET", "/agent-skills/plaza?page=2&page_size=5");
    const ids1 = (p1.data as { list: Array<{ skill_id: string }> }).list.map((item) => item.skill_id);
    const ids2 = (p2.data as { list: Array<{ skill_id: string }> }).list.map((item) => item.skill_id);
    expect(ids1.length).toBe(5);
    expect(ids2.length).toBe(5);
    expect(ids1.some((id) => ids2.includes(id))).toBe(false);

    const badCategory = await inject("GET", "/agent-skills/plaza?category=not-a-category");
    expect(badCategory.code).toBe(400101);
  });

  // ── 2. 收藏幂等 ────────────────────────────────────────
  it("收藏：显式 true/false 幂等，favorite_count 永远等于真实行数", async () => {
    const plaza = await inject("GET", "/agent-skills/plaza?page_size=1");
    const skillId = (plaza.data as { list: Array<{ skill_id: string }> }).list[0]!.skill_id;

    const on1 = await inject("POST", `/agent-skills/${skillId}/favorite`, { favorite: true });
    expect(on1.code).toBe(0);
    expect(on1.data).toMatchObject({ favorited: true, favorite_count: 1 });
    // 关键：重复收藏不能把计数变成 2（唯一索引 + 重算）
    const on2 = await inject("POST", `/agent-skills/${skillId}/favorite`, { favorite: true });
    expect(on2.data).toMatchObject({ favorited: true, favorite_count: 1 });

    const fav = await inject("GET", "/agent-skills/favorites?page_size=100");
    expect(fav.code).toBe(0);
    const favPage = fav.data as { list: Array<{ skill_id: string; is_favorite: boolean }>; total: number };
    expect(favPage.total).toBe(1);
    expect(favPage.list[0]).toMatchObject({ skill_id: skillId, is_favorite: true });

    // 详情里的 is_favorite 必须与列表一致，否则卡片心形状态会闪
    const detail = await inject("GET", `/agent-skills/${skillId}`);
    expect((detail.data as { is_favorite: boolean }).is_favorite).toBe(true);

    const off1 = await inject("POST", `/agent-skills/${skillId}/favorite`, { favorite: false });
    expect(off1.data).toMatchObject({ favorited: false, favorite_count: 0 });
    const off2 = await inject("POST", `/agent-skills/${skillId}/favorite`, { favorite: false });
    expect(off2.data).toMatchObject({ favorited: false, favorite_count: 0 });

    const { rows } = await pool.query<{ count: string }>(
      "select count(*)::text as count from agent_skill_favorites where skill_id = $1",
      [skillId],
    );
    expect(rows[0]?.count).toBe("0");

    // 省略 favorite = 切换（UI 点一下就反转）
    const toggled = await inject("POST", `/agent-skills/${skillId}/favorite`, {});
    expect(toggled.data).toMatchObject({ favorited: true, favorite_count: 1 });
  });

  // ── 3. 自建卡：mine / create / detail / delete + 跨空间隔离 ──
  it("自建卡：建 → mine → 详情（含 details 别名）→ 他人不可见 → 删除后不可读", async () => {
    const empty = await inject("GET", "/agent-skills/mine");
    expect(empty.code).toBe(0);
    expect((empty.data as { total: number }).total).toBe(0);

    const created = await inject("POST", "/agent-skills", {
      name: "E2E 私卡",
      summary: "只属于本空间",
      category: "script",
      prompt_template: "/e2e-private 写一段三幕短片方案",
    });
    expect(created.code).toBe(0);
    const card = created.data as { skill_id: string; name: string; visibility: number; is_mine: boolean; space_id: string };
    expect(card.name).toBe("E2E 私卡");
    // 默认私有：不发布就不进广场（竞品"广场卡才能被复用"）
    expect(card.visibility).toBe(1);
    expect(card.is_mine).toBe(true);
    expect(card.space_id).toBe(spaceA);
    createdSkillIds.push(card.skill_id);

    const mine = await inject("GET", "/agent-skills/mine");
    expect((mine.data as { total: number }).total).toBe(1);

    const detail = await inject("GET", `/agent-skills/${card.skill_id}`);
    expect(detail.code).toBe(0);
    const alias = await inject("GET", `/agent-skills/details?id=${card.skill_id}`);
    expect(alias.code).toBe(0);
    expect((alias.data as { skill_id: string }).skill_id).toBe(card.skill_id);

    // 别人（另一个 space）看不到私有卡：400102 而不是 403（不泄漏存在性）
    const foreignRead = await inject("GET", `/agent-skills/${card.skill_id}`, undefined, tokenB);
    expect(foreignRead.code).toBe(400102);
    const foreignDelete = await inject("DELETE", `/agent-skills/${card.skill_id}`, undefined, tokenB);
    expect(foreignDelete.code).toBe(400102);

    const removed = await inject("DELETE", `/agent-skills/${card.skill_id}`);
    expect(removed.code).toBe(0);
    expect((removed.data as { ok: boolean }).ok).toBe(true);
    // 软删：再读就是 400102，且 mine 归零
    expect((await inject("GET", `/agent-skills/${card.skill_id}`)).code).toBe(400102);
    expect((await inject("GET", "/agent-skills/mine")).data as { total: number }).toMatchObject({ total: 0 });
  });

  it("平台卡不可删（403）；发布卡进广场后其他空间可见但不能被别人删", async () => {
    const plaza = await inject("GET", "/agent-skills/plaza?page_size=1");
    const platformId = (plaza.data as { list: Array<{ skill_id: string }> }).list[0]!.skill_id;
    const forbidden = await inject("DELETE", `/agent-skills/${platformId}`);
    expect(forbidden.code).toBe(403101);

    const published = await inject(
      "POST",
      "/agent-skills",
      { name: "E2E 发布卡", category: "custom", prompt_template: "/e2e-published 生成封面标题", visibility: 2 },
      tokenB,
    );
    expect(published.code).toBe(0);
    const card = published.data as { skill_id: string };
    createdSkillIds.push(card.skill_id);

    const plazaAfter = await inject("GET", "/agent-skills/plaza?page_size=100");
    const ids = (plazaAfter.data as { list: Array<{ skill_id: string }> }).list.map((item) => item.skill_id);
    // 发布卡对所有空间公开（visibility=2）
    expect(ids).toContain(card.skill_id);
    const detailByA = await inject("GET", `/agent-skills/${card.skill_id}`);
    expect(detailByA.code).toBe(0);
    // 但删除权只属于创建人所在的 space
    const deleteByA = await inject("DELETE", `/agent-skills/${card.skill_id}`);
    expect(deleteByA.code).toBe(400102);

    const deleteByB = await inject("DELETE", `/agent-skills/${card.skill_id}`, undefined, tokenB);
    expect(deleteByB.code).toBe(0);
  });

  it("参数校验：缺 name / 非法 category / 非法 id 都返回 400101", async () => {
    expect((await inject("POST", "/agent-skills", {})).code).toBe(400101);
    expect((await inject("POST", "/agent-skills", { name: "" })).code).toBe(400101);
    expect((await inject("POST", "/agent-skills", { name: "x", category: "nope" })).code).toBe(400101);
    expect((await inject("GET", "/agent-skills/not-a-number")).code).toBe(400101);
    expect((await inject("GET", "/agent-skills/details")).code).toBe(400101);
  });

  // ── 4. STT ────────────────────────────────────────────
  it("STT：默认 browser 模式 available:false（不是 500）；custom 配 Key 后发短期令牌", async () => {
    // 默认 `AGENT_STT_PROVIDER=browser`：能力位为 false，前端据此隐藏"服务端转写"并回退浏览器识别。
    // 关键断言是 **code===0 且 HTTP 200**：能力缺失不是错误（这是"能力位"与"报错"的区别）。
    const off = await inject("GET", "/agent/stt-token");
    expect(off.code).toBe(0);
    expect(off.data).toMatchObject({
      available: false,
      provider: null,
      token: null,
      reason: "stt_provider_browser",
      fallback: "browser",
    });

    const stt = app.get(AgentSttService);
    const auth = { userId: userIdA, spaceId: spaceA };

    // 已接入的 provider（custom = OpenAI 兼容）：发得出 120s 中继令牌
    const on = stt.token(auth, { provider: "custom", apiKey: "sk-e2e-placeholder" });
    expect(on.available).toBe(true);
    expect(on.provider).toMatchObject({ id: "custom", mode: "relay", model: "whisper-1" });
    expect(on.token?.split(".").length).toBe(3);
    expect(on.ttl_s).toBe(120);
    expect(on.transcribe_path).toBe("/v1/agent/stt/transcribe");
    // 令牌绑定 (user, space)：中继端点据此确定归属，不信任前端传的 space
    expect(stt.verifyToken(on.token ?? undefined)).toEqual({ userId: userIdA, spaceId: spaceA });

    // 未接入的厂商必须明确说"不支持"，不能假装可用（volc/minimax 的签名交换本批未接）
    const unsupported = stt.token(auth, { provider: "volc", apiKey: "any" });
    expect(unsupported.available).toBe(false);
    expect(unsupported.reason).toBe("stt_provider_unsupported:volc");

    // 中继端点：默认 env 下 provider=browser → 400100（前端据此回退手打）。
    // 注意：信封只回 `{code,msg,data:null}`，`AppError.details` 不下发（全站统一），
    // 所以前端只能按 code + msg 判断，不能依赖 details.reason。
    const issued = stt.token(auth, { provider: "custom", apiKey: "sk-e2e-placeholder" });
    const relayed = await inject("POST", "/agent/stt/transcribe", {
      audio_base64: "AAAAAAAAAAAAAAAAAAAA",
      stt_token: issued.token,
    });
    expect(relayed.code).toBe(400100);
    expect(relayed.msg).toContain("语音转写");

    // 伪造/过期票一律 401：中继端点是 @Public，票据闸门必须自己扛住
    const bad = await inject("POST", "/agent/stt/transcribe", {
      audio_base64: "AAAAAAAAAAAAAAAAAAAA",
      stt_token: "x".repeat(32),
    });
    expect(bad.code).toBe(401101);
  });

  // ── 5. 推荐卡 ──────────────────────────────────────────
  it("推荐卡：无信号给 4 张兜底卡；有项目信号切 signals 并含剧本卡", async () => {
    // 新用户默认会带示例作品（`SEED_SAMPLE_PROJECT`），所以"空态"必须自己清干净：
    // 清的是测试用户 B 自己的信号行（项目归档 / 资产软删 / 会话软删）。
    // 用软标记而不是 DELETE：示例作品挂着 episodes 外键，物理删除会破坏夹具。
    const spaceBBig = BigInt(spaceB);
    await db.update(scriptProjects).set({ archivedAt: new Date() }).where(eq(scriptProjects.spaceId, spaceBBig));
    await db.update(assets).set({ deletedAt: new Date() }).where(eq(assets.spaceId, spaceBBig));
    await db.update(agentSessions).set({ deletedAt: new Date() }).where(eq(agentSessions.spaceId, spaceBBig));

    const fallback = await inject("GET", "/agent-recommend-cards", undefined, tokenB);
    expect(fallback.code).toBe(0);
    const fallbackDto = fallback.data as {
      list: Array<{
        recommend_id: string;
        title: string;
        description: string;
        preset_prompt: string;
        tag: number;
        tag_label: string;
        skills: Array<{ skill_id: string; skill_name: string; skill_name_en: string }>;
        cover_file_id: string | null;
      }>;
      source: string;
      signals: Record<string, number>;
    };
    // 竞品兜底 4 张（d-canvas-agent.md:346 CpJ9@HXe），顺序照抄
    expect(fallbackDto.source).toBe("default");
    expect(fallbackDto.list.map((card) => card.recommend_id)).toEqual([
      "rec_video_oneshot",
      "rec_character_multiview",
      "rec_first_person_short",
      "rec_wuxia_short",
    ]);
    for (const card of fallbackDto.list) {
      expect(card.title.length).toBeGreaterThan(0);
      expect(card.preset_prompt.startsWith("/")).toBe(true);
      // tag ∈ 1..5（竞品枚举 jc={BATCH_IMAGE:1,...}）
      expect([1, 2, 3, 4, 5]).toContain(card.tag);
      expect(card.tag_label.length).toBeGreaterThan(0);
      expect(card.cover_file_id).toBeNull();
      // 推荐卡必须挂真实卡，点开即用（不能编 skid）
      expect(card.skills.length).toBeGreaterThan(0);
      const detail = await inject("GET", `/agent-skills/${card.skills[0]!.skill_id}`);
      expect(detail.code).toBe(0);
      expect((detail.data as { name_en: string }).name_en).toBe(card.skills[0]!.skill_name_en);
    }

    // A 的 space 有示例作品 → 推荐位应转向剧本/分镜，且 source 切到 signals
    const withSignal = await inject("GET", "/agent-recommend-cards");
    expect(withSignal.code).toBe(0);
    const signalDto = withSignal.data as {
      list: Array<{ recommend_id: string }>;
      source: string;
      signals: { recent_project_count: number };
    };
    expect(signalDto.source).toBe("signals");
    expect(signalDto.signals.recent_project_count).toBeGreaterThan(0);
    expect(signalDto.list.map((card) => card.recommend_id)).toContain("rec_novel_to_script");
    expect(signalDto.list.length).toBeGreaterThanOrEqual(3);
    expect(signalDto.list.length).toBeLessThanOrEqual(6);
  });

  // ── 6. 独立创作会话 ────────────────────────────────────
  it("独立会话：新建 → 发消息（带 skill_ids）→ 助手回复 → 已读 → 结束 → 不可再发", async () => {
    const created = await inject("POST", "/agent/sessions", { title: "E2E 独立会话" });
    expect(created.code).toBe(0);
    const session = (created.data as { session: { session_id: string; scope: number; canvas_id: string | null } }).session;
    expect(session.scope).toBe(1);
    expect(session.canvas_id).toBeNull();
    createdSessionIds.push(session.session_id);

    const list = await inject("GET", "/agent/sessions?page=1&page_size=20");
    expect(list.code).toBe(0);
    const listed = (list.data as { list: Array<{ session_id: string; scope: number }> }).list;
    expect(listed.some((item) => item.session_id === session.session_id)).toBe(true);
    // 独立会话列表只含 scope=1：画布会话不会串到这里
    expect(listed.every((item) => item.scope === 1)).toBe(true);

    const plaza = await inject("GET", "/agent-skills/plaza?page_size=1");
    const skillId = (plaza.data as { list: Array<{ skill_id: string; use_count: number }> }).list[0]!;
    const sent = await inject("POST", `/agent/sessions/${session.session_id}/messages`, {
      content: "/video-oneshot 帮我生成一张图：雨夜霓虹街道",
      skill_ids: [skillId.skill_id],
    });
    expect(sent.code).toBe(0);
    expect((sent.data as { message_id: string }).message_id).toBeTruthy();

    const messages = await waitForAssistant(session.session_id);
    const user = messages.find((item) => item.role === 1) as unknown as { payload: Record<string, unknown> };
    // skill_ids 留痕：可反查"这条发言用了哪张卡"
    expect(user.payload.skill_ids).toEqual([skillId.skill_id]);

    const after = await inject("GET", `/agent-skills/${skillId.skill_id}`);
    expect((after.data as { use_count: number }).use_count).toBe(skillId.use_count + 1);

    const read = await inject("POST", `/agent/sessions/${session.session_id}/read`, { last_read_seq: 9999 });
    expect(read.code).toBe(0);
    expect((read.data as { unread_count: number }).unread_count).toBe(0);

    // SSE 游标失效 → 746004（会话还在，只是增量起点没了）
    const expired = await inject("GET", `/agent/sessions/${session.session_id}/stream?last_stream_id=nope`);
    expect(expired.code).toBe(746004);

    // 跨空间读会话：一律 400102
    const foreign = await inject("GET", `/agent/sessions/${session.session_id}/messages`, undefined, tokenB);
    expect(foreign.code).toBe(400102);

    const ended = await inject("PATCH", `/agent/sessions/${session.session_id}`, { status: 2 });
    expect(ended.code).toBe(0);
    const rejected = await inject("POST", `/agent/sessions/${session.session_id}/messages`, { content: "还能发吗" });
    expect(rejected.code).toBe(400101);
  }, 90_000);

  it("独立会话端点不能读写画布会话（scope 隔离）", async () => {
    const canvas = await inject("POST", "/canvas/canvases", { title: "E2E scope 隔离画布" });
    expect(canvas.code).toBe(0);
    const canvasId = (canvas.data as { id: string }).id;
    const session = await inject("POST", `/canvas/canvases/${canvasId}/chat/sessions`, {});
    expect(session.code).toBe(0);
    const canvasSessionId = (session.data as { session: { session_id: string } }).session.session_id;

    // scope=2 的会话不能出现在独立会话列表，也不能被 /agent/sessions/* 读写
    const messages = await inject("GET", `/agent/sessions/${canvasSessionId}/messages`);
    expect(messages.code).toBe(400102);
    const stream = await inject("GET", `/agent/sessions/${canvasSessionId}/stream`);
    expect(stream.code).toBe(400102);

    await db.delete(agentMessages).where(inArray(agentMessages.sessionId, [BigInt(canvasSessionId)]));
    await db.delete(agentEvents).where(inArray(agentEvents.sessionId, [BigInt(canvasSessionId)]));
    await db.delete(agentSessions).where(inArray(agentSessions.id, [BigInt(canvasSessionId)]));
    await db.delete(canvases).where(inArray(canvases.id, [BigInt(canvasId)]));
  }, 60_000);

  /**
   * 第 64 批：按 `competitor_endpoints.tsv` 的 9 条竞品形状补齐后锁住的行为。
   *
   * 竞品证据链：
   * - `GET .../plaza` query = `["category","name","page","page_size","is_home_recommend"]`
   * - `GET .../mine` query = `["status","page","page_size"]`
   * - `GET .../details` query = `["skill_id","owner_type"]`
   * - `PUT /web/v1/df/canvas/agent-skills`（params/query 全空 ⇒ 目标卡只能从 body 带）
   * - `owner_type` 取值只有 1/2（`d.owner_type===1||d.owner_type===2`，平台卡引用固定写 1）
   * - `name_en` 是卡片一等字段，前端按它精确查重（`we.name_en?.trim()===t.trim()`）
   */
  it("更新卡片：仅创建人可改、name_en 查重、平台卡 403、他人不可见", async () => {
    const created = await inject("POST", "/agent-skills", {
      name: "E2E 待改卡",
      name_en: "e2e-edit-me",
      category: "script",
      prompt_template: "/e2e-edit-me 初版提示词",
    });
    expect(created.code).toBe(0);
    const card = created.data as { skill_id: string; name_en: string; owner_type: number };
    createdSkillIds.push(card.skill_id);
    // 团队卡 owner_type=2（平台卡才是 1）
    expect(card.owner_type).toBe(2);
    expect(card.name_en).toBe("e2e-edit-me");

    const updated = await inject("PUT", "/agent-skills", {
      skill_id: card.skill_id,
      name: "E2E 已改名",
      summary: "改过的摘要",
      name_en: "e2e-renamed",
      visibility: 2,
      prompt_template: "/e2e-renamed 新版提示词",
    });
    expect(updated.code).toBe(0);
    const after = updated.data as {
      name: string;
      name_en: string;
      summary: string;
      visibility: number;
      prompt_template: string;
      config: Record<string, unknown>;
    };
    expect(after.name).toBe("E2E 已改名");
    expect(after.name_en).toBe("e2e-renamed");
    expect(after.summary).toBe("改过的摘要");
    expect(after.visibility).toBe(2);
    // 列与 config 的三个派生态必须一起改：老前端读 config.slug，漏改会看到旧指令名
    expect(after.config.slug).toBe("e2e-renamed");
    expect(after.config.name_en).toBe("e2e-renamed");
    expect(after.config.slash).toBe("/e2e-renamed");

    // 同空间 name_en 查重（竞品按 name_en 精确查重，重名会让首词无法确定用哪张卡）
    const dup = await inject("POST", "/agent-skills", {
      name: "E2E 撞名卡",
      name_en: "e2e-renamed",
      category: "script",
    });
    expect(dup.code).toBe(400101);
    expect(dup.msg).toContain("name_en");

    // 平台卡不可改（运营资产）
    const plaza = await inject("GET", "/agent-skills/plaza?page_size=1");
    const platformId = (plaza.data as { list: Array<{ skill_id: string }> }).list[0]!.skill_id;
    const platformEdit = await inject("PUT", "/agent-skills", { skill_id: platformId, name: "改平台卡" });
    expect(platformEdit.code).toBe(403101);

    // 别人的空间卡：400102（不泄漏存在性）
    const foreign = await inject("PUT", "/agent-skills", { skill_id: card.skill_id, name: "别人改" }, tokenB);
    expect(foreign.code).toBe(400102);

    // 入参校验
    expect((await inject("PUT", "/agent-skills", {})).code).toBe(400101);
    expect((await inject("PUT", "/agent-skills", { skill_id: "not-a-number" })).code).toBe(400101);
    expect((await inject("PUT", "/agent-skills", { skill_id: "9999999999", name: "x" })).code).toBe(400102);
    expect((await inject("PUT", "/agent-skills", { skill_id: card.skill_id, name_en: "Bad Slug!" })).code).toBe(400101);
  });

  it("竞品形状：name / is_home_recommend / mine?status / details?owner_type 都能筛", async () => {
    // DTO 必须带 owner_type 与 is_home_recommend（前端按 owner_type 决定"能不能改删"）
    const plaza = await inject("GET", "/agent-skills/plaza?page_size=5");
    const first = (plaza.data as { list: Array<Record<string, unknown>> }).list[0] as {
      skill_id: string;
      name: string;
      name_en: string;
      owner_type: number;
      is_home_recommend: boolean;
    };
    expect(first.owner_type).toBe(1);
    expect(first.is_home_recommend).toBe(false);

    // 竞品 `name`：只按显示名/英文名收敛（不是全文）
    const byName = await inject("GET", `/agent-skills/plaza?name=${encodeURIComponent(first.name)}`);
    expect(byName.code).toBe(0);
    const namePage = byName.data as { list: Array<{ name: string; name_en: string }>; total: number };
    expect(namePage.total).toBeGreaterThan(0);
    expect(namePage.list.every((item) => item.name.includes(first.name) || item.name_en.includes(first.name))).toBe(
      true,
    );
    // name_en 也能命中
    const byEn = await inject("GET", `/agent-skills/plaza?name=${encodeURIComponent(first.name_en)}`);
    expect((byEn.data as { list: Array<{ skill_id: string }> }).list.map((item) => item.skill_id)).toContain(
      first.skill_id,
    );

    // 推荐位默认 0 张；标一张后 `is_home_recommend=1` 只回它（非法值 400101）
    const homeOn = await inject("GET", "/agent-skills/plaza?is_home_recommend=1&page_size=100");
    expect((homeOn.data as { total: number }).total).toBe(0);
    await db.update(agentSkills).set({ isHomeRecommend: true }).where(eq(agentSkills.id, BigInt(first.skill_id)));
    try {
      const after = await inject("GET", "/agent-skills/plaza?is_home_recommend=1&page_size=100");
      const homePage = after.data as { list: Array<{ skill_id: string; is_home_recommend: boolean }>; total: number };
      expect(homePage.total).toBe(1);
      expect(homePage.list[0]).toMatchObject({ skill_id: first.skill_id, is_home_recommend: true });
      // `is_home_recommend=0` 是"排除推荐位"，不是"全部"
      const off = await inject("GET", "/agent-skills/plaza?is_home_recommend=0&page_size=100");
      expect((off.data as { list: Array<{ skill_id: string }> }).list.map((item) => item.skill_id)).not.toContain(
        first.skill_id,
      );
    } finally {
      await db.update(agentSkills).set({ isHomeRecommend: false }).where(eq(agentSkills.id, BigInt(first.skill_id)));
    }

    // `details?owner_type`：平台卡配 2 → 400102；配 3 → 400101
    const detailsOk = await inject("GET", `/agent-skills/details?skill_id=${first.skill_id}&owner_type=1`);
    expect(detailsOk.code).toBe(0);
    expect((detailsOk.data as { skill_id: string }).skill_id).toBe(first.skill_id);
    expect((await inject("GET", `/agent-skills/details?skill_id=${first.skill_id}&owner_type=2`)).code).toBe(400102);
    expect((await inject("GET", `/agent-skills/details?skill_id=${first.skill_id}&owner_type=3`)).code).toBe(400101);

    // `mine?status`：下架（status=2）的卡默认不出现在"我的"，显式查 status=2 才出
    const created = await inject("POST", "/agent-skills", { name: "E2E 下架卡", category: "script" });
    expect(created.code).toBe(0);
    const cardId = (created.data as { skill_id: string }).skill_id;
    createdSkillIds.push(cardId);
    await db.update(agentSkills).set({ status: 2 }).where(eq(agentSkills.id, BigInt(cardId)));
    const mineDefault = await inject("GET", "/agent-skills/mine?page_size=100");
    expect((mineDefault.data as { list: Array<{ skill_id: string }> }).list.map((item) => item.skill_id)).not.toContain(
      cardId,
    );
    const mineDown = await inject("GET", "/agent-skills/mine?status=2&page_size=100");
    const downPage = mineDown.data as { list: Array<{ skill_id: string; status: number }> };
    expect(downPage.list.map((item) => item.skill_id)).toContain(cardId);
    expect(downPage.list.every((item) => item.status === 2)).toBe(true);
    expect((await inject("GET", "/agent-skills/mine?status=3")).code).toBe(400101);
  });
});
