import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import cookie from "@fastify/cookie";
import { eq, inArray, sql } from "drizzle-orm";
import { AllExceptionsFilter } from "../src/common/http/exception.filter";
import { EnvelopeInterceptor } from "../src/common/http/envelope.interceptor";
import { AppModule } from "../src/app.module";
import { db, pool } from "../src/db/database";
import {
  creditAccounts,
  creditIn,
  marketAgreements,
  marketCategories,
  marketReviewLogs,
  marketTags,
  marketWithdrawals,
  marketWorks,
  novelChapterOutlines,
  novelChapters,
  novelCharacters,
  novels,
  promoSlots,
} from "@app/db";
import { newId } from "@app/shared";

/**
 * 剧本集市（market）契约测试 —— 对照竞品 `df/novel_market` 29 端点（routes.txt:601-629）
 * + 集市 Admin 12 端点（routes.txt:100-111）。
 *
 * 这组用例刻意覆盖"错了会真的丢钱/越权"的五类：
 *
 * 1. **钱必须走账本**：购买/预售定金只允许 `creditOut`（流水 + 余额同进同退），
 *    余额不足必须是 745701 **且余额与协议表都不留痕**（"扣了一半"比"扣失败"更难救）。
 * 2. **收益口径**：`revenue_credits = 成交价 − 抽成`，取消预售要**同额减回**，
 *    否则 `Σrevenue` 与 `Σ(生效协议 − 抽成)` 永久对不上。
 * 3. **提现状态机不可跳步**：待审直接打款必须 400101（这是本批 DoD 点名要求）。
 * 4. **购买凭据才是内容闸门**：买家与作者不在同一 space，所以内容读取不能靠
 *    "同空间成员"判权——没买过一律 403。
 * 5. **运营后台与 C 端物理隔离**：普通用户 token 打 `/v1/ops/market/*` 必须 403。
 */
describe("market e2e", () => {
  let app: NestFastifyApplication;
  let adminToken = "";
  /** 本次测试造的数据，afterAll 精确清理（不用 truncate，避免影响并行跑的其他 spec） */
  const createdWorkIds: bigint[] = [];
  const createdNovelIds: bigint[] = [];
  const createdPromotionIds: bigint[] = [];
  /** 分类/标签是平台级（name 全局唯一），必须硬删，否则第二次运行就撞唯一键 */
  const createdCategoryIds: bigint[] = [];
  const createdTagIds: bigint[] = [];

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
      method: method as "GET" | "POST" | "PATCH" | "DELETE",
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
      raw: res.body,
      data: (body as { data?: unknown }).data,
    };
  };

  async function loginNewUser(prefix: string) {
    // 手机号必须满足 `/^1\d{10}$/`（auth.controller.ts:19）：1 + 6 位时间戳 + 2 位随机 + 2 位前缀标记 = 11 位
    const tail = String(Date.now()).slice(-6);
    const tag = String(prefix).replace(/\D/g, "").slice(-2).padStart(2, "0");
    const rnd = String(Math.floor(Math.random() * 90 + 10));
    const phone = `1${tail}${rnd}${tag}`;
    const sms = await inject("POST", "/auth/sms-code", { phone });
    const code = (sms.data as { debug_code?: string } | undefined)?.debug_code;
    const login = await inject("POST", "/auth/login", { phone, code, age_confirmed: true });
    const data = login.data as { access_token?: string; space_id?: string; user?: { id?: string } } | undefined;
    if (!data?.access_token) throw new Error(`login failed: ${JSON.stringify(login.body)}`);
    return { token: data.access_token, spaceId: String(data.space_id ?? ""), userId: String(data.user?.id ?? "") };
  }

  async function adminLogin() {
    const res = await inject("POST", "/ops/admin/login", { username: "admin", password: "admin12345" });
    expect(res.code).toBe(0);
    return (res.data as { token: string }).token;
  }

  /**
   * 充值并返回**充值后余额**。
   *
   * 为什么不写死绝对数：新用户注册时有 `GIFT_CREDITS` 赠送分（auth.service.ts:159-165，
   * 由环境变量决定，测试环境不一定为 0）。断言写成"相对起点"才不受该配置影响。
   */
  async function topUp(spaceId: string, amount: number): Promise<number> {
    await db.transaction(async (tx) => {
      await creditIn(tx, { spaceId: BigInt(spaceId), amount, kind: "recharge", memo: "market spec topup" });
    });
    return balanceOf(spaceId);
  }

  async function balanceOf(spaceId: string): Promise<number> {
    const [row] = await db
      .select({ balance: creditAccounts.balance })
      .from(creditAccounts)
      .where(eq(creditAccounts.spaceId, BigInt(spaceId)));
    return row?.balance ?? 0;
  }

  /** 造一本"已定稿"的本子（status=16 是竞品"可被引用"判据，见 schema.ts:1300-1305） */
  async function seedNovel(spaceId: string, opts: { status?: number; withContent?: boolean } = {}) {
    const novelId = newId();
    createdNovelIds.push(novelId);
    await db.insert(novels).values({
      id: novelId,
      spaceId: BigInt(spaceId),
      title: `集市测试本子-${String(novelId).slice(-6)}`,
      status: opts.status ?? 16,
    });
    if (opts.withContent !== false) {
      await db.insert(novelChapters).values([
        { id: newId(), novelId, chapterNo: 1, title: "第一章 起", content: "正文一", wordCount: 3 },
        { id: newId(), novelId, chapterNo: 2, title: "第二章 承", content: "正文二", wordCount: 3 },
      ]);
      await db.insert(novelCharacters).values({
        id: newId(),
        novelId,
        name: "主角甲",
        roleType: 1,
        description: "主角",
      });
      await db.insert(novelChapterOutlines).values({
        id: newId(),
        novelId,
        chapterNo: 1,
        title: "第一章大纲",
        synopsis: "起",
      });
    }
    return String(novelId);
  }

  /** 建作品（走 save = 存草稿，强制 status=1） */
  async function saveDraft(
    owner: { token: string; spaceId: string },
    input: { title: string; price_credits?: number; preorder_price_credits?: number | null; novel_id?: string },
  ) {
    const res = await inject("POST", "/market/creator/works/save", input, owner.token, owner.spaceId);
    if (res.code !== 0) throw new Error(`saveDraft failed: ${JSON.stringify(res.body)}`);
    const work = (res.data as { work: { id: string; status: number } }).work;
    createdWorkIds.push(BigInt(work.id));
    return work;
  }

  /** 上架全链：存草稿 → 提交 → admin 通过（返回 work id，状态落 3 在售 / 6 预售中） */
  async function publishWork(
    owner: { token: string; spaceId: string },
    input: { title: string; price_credits: number; preorder_price_credits?: number | null; novel_id?: string },
  ): Promise<{ id: string; status: number }> {
    const work = await saveDraft(owner, input);
    const submitted = await inject("POST", `/market/creator/works/${work.id}/submit`, undefined, owner.token, owner.spaceId);
    expect(submitted.code).toBe(0);
    const approved = await inject(
      "POST",
      `/ops/market/scripts/${work.id}/review-result`,
      { result: "approved", audit_note: "内容合规" },
      adminToken,
    );
    expect(approved.code).toBe(0);
    const reviewed = (approved.data as { work: { id: string; status: number } }).work;
    return { id: reviewed.id, status: reviewed.status };
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
    adminToken = await adminLogin();
  }, 90_000);

  afterAll(async () => {
    /**
     * 精确清理自己造的行。顺序由外键决定（先子后父）：
     * 提现（`work_id` FK）/ 审核留痕（`work_id` FK）/ 协议（`work_id` FK）都要先于作品；
     * 作品又要先于分类（`category_id` 引用）与标签。
     * 提现申请由 API 创建（id 不在手上），用测试标记 `account_info.spec` 精确清理。
     */
    await db.delete(marketWithdrawals).where(sql`${marketWithdrawals.accountInfo}->>'spec' = 'market-spec'`);
    if (createdWorkIds.length > 0) {
      await db.delete(marketReviewLogs).where(inArray(marketReviewLogs.workId, createdWorkIds));
      await db.delete(marketAgreements).where(inArray(marketAgreements.workId, createdWorkIds));
      await db.delete(marketWorks).where(inArray(marketWorks.id, createdWorkIds));
    }
    if (createdPromotionIds.length > 0) {
      await db.delete(promoSlots).where(inArray(promoSlots.id, createdPromotionIds));
    }
    if (createdNovelIds.length > 0) {
      await db.delete(novelChapters).where(inArray(novelChapters.novelId, createdNovelIds));
      await db.delete(novelCharacters).where(inArray(novelCharacters.novelId, createdNovelIds));
      await db.delete(novelChapterOutlines).where(inArray(novelChapterOutlines.novelId, createdNovelIds));
      await db.delete(novels).where(inArray(novels.id, createdNovelIds));
    }
    /**
     * 分类/标签是**平台级**（`name` 全局唯一，不分 space）：漏清理会让下一次运行
     * "admin 建分类"直接撞唯一键 → 400101，看起来像接口坏了，实际是测试脏数据。
     * 所以必须按 id 硬删（停用的分类也占着唯一名）。
     */
    if (createdTagIds.length > 0) {
      await db.delete(marketTags).where(inArray(marketTags.id, createdTagIds));
    }
    if (createdCategoryIds.length > 0) {
      await db.delete(marketCategories).where(inArray(marketCategories.id, createdCategoryIds));
    }
    await app.close();
    await pool.end().catch(() => {});
  });

  // ══════════════════════════════════════════════════════════
  // 一、上架与审核状态机
  // ══════════════════════════════════════════════════════════

  it("上架全链：草稿→提交→admin 通过→在售；集市列表能查到且状态名正确", async () => {
    const owner = await loginNewUser("11");
    const novelId = await seedNovel(owner.spaceId);
    const work = await saveDraft(owner, { novel_id: novelId, title: "上架全链作品", price_credits: 1000 });
    // save 是"存草稿"语义：即使传了 submit 也不应提审（避免"点保存就进审核队列"）
    expect(work.status).toBe(1);

    const submitted = await inject("POST", `/market/creator/works/${work.id}/submit`, undefined, owner.token, owner.spaceId);
    expect(submitted.code).toBe(0);
    expect((submitted.data as { work: { status: number } }).work.status).toBe(2);

    const approved = await inject(
      "POST",
      `/ops/market/scripts/${work.id}/review-result`,
      { result: "approved", audit_note: "内容合规" },
      adminToken,
    );
    expect(approved.code).toBe(0);
    const after = (approved.data as { work: { status: number; status_name: string; published_at: string | null } }).work;
    expect(after.status).toBe(3);
    expect(after.status_name).toBe("在售");
    // 通过即上架时间：集市排序依赖 published_at desc，空值会让新作品沉底
    expect(after.published_at).not.toBeNull();

    const list = await inject("GET", "/market/scripts?page_size=50", undefined, owner.token, owner.spaceId);
    expect(list.code).toBe(0);
    const ids = (list.data as { list: Array<{ id: string }> }).list.map((w) => w.id);
    expect(ids).toContain(work.id);

    // 审核轨迹（迁移 0030 `market_review_logs`）：提交 + 通过各一条，运营 id 有值、作者 id 无
    const adminDetail = await inject("GET", `/ops/market/scripts/${work.id}`, undefined, adminToken);
    expect(adminDetail.code).toBe(0);
    const logs = (adminDetail.data as { review_logs: Array<{ action: number; operator_admin_id: string | null; operator_user_id: string | null; note: string | null }> }).review_logs;
    expect(logs.map((l) => l.action).sort()).toEqual([1, 2]); // 1 提交 / 2 通过
    const submitLog = logs.find((l) => l.action === 1)!;
    const approveLog = logs.find((l) => l.action === 2)!;
    // 提交是作者点的 → 记 operator_user_id；通过是运营点的 → 记 operator_admin_id
    expect(submitLog.operator_user_id).toBe(owner.userId);
    expect(submitLog.operator_admin_id).toBeNull();
    expect(approveLog.operator_admin_id).not.toBeNull();
    expect(approveLog.operator_user_id).toBeNull();
    expect(approveLog.note).toBe("内容合规");
  });

  it("提交前置与驳回留痕：price=0 拒绝提交；驳回必须带 audit_note；驳回后可重新提交成新待审", async () => {
    const owner = await loginNewUser("12");
    const noPrice = await saveDraft(owner, { title: "没定价的作品", price_credits: 0 });
    const rejectedSubmit = await inject(
      "POST",
      `/market/creator/works/${noPrice.id}/submit`,
      undefined,
      owner.token,
      owner.spaceId,
    );
    // 价格 0 的作品上架后无法成交（也躲不过结算），必须在提审前拦住
    expect(rejectedSubmit.code).toBe(400101);

    const work = await saveDraft(owner, { title: "会被驳回的作品", price_credits: 500 });
    await inject("POST", `/market/creator/works/${work.id}/submit`, undefined, owner.token, owner.spaceId);

    const noNote = await inject(
      "POST",
      `/ops/market/scripts/${work.id}/review-result`,
      { result: "rejected" },
      adminToken,
    );
    expect(noNote.code).toBe(400101);
    expect(noNote.msg).toContain("audit_note");

    const rejected = await inject(
      "POST",
      `/ops/market/scripts/${work.id}/review-result`,
      { result: "rejected", audit_note: "封面不合规" },
      adminToken,
    );
    expect(rejected.code).toBe(0);
    const rejectedWork = (rejected.data as { work: { status: number; audit_note: string } }).work;
    expect(rejectedWork.status).toBe(4);
    expect(rejectedWork.audit_note).toBe("封面不合规");

    // 驳回后可重新提交成"新的待审"（历史行不改：协议/提现不动，审核意见保留到下次覆盖）
    const resubmit = await inject("POST", `/market/creator/works/${work.id}/submit`, undefined, owner.token, owner.spaceId);
    expect(resubmit.code).toBe(0);
    expect((resubmit.data as { work: { status: number } }).work.status).toBe(2);
  });

  it("审核不可逆：已通过的作品再审 400101；在售作品不能回退提交审核", async () => {
    const owner = await loginNewUser("13");
    const work = await publishWork(owner, { title: "不可逆作品", price_credits: 300 });
    expect(work.status).toBe(3);

    const reviewAgain = await inject(
      "POST",
      `/ops/market/scripts/${work.id}/review-result`,
      { result: "rejected", audit_note: "想反悔" },
      adminToken,
    );
    // 不可逆：上架后只能 offline，不能靠"再驳回"把它变下架（否则已购协议会失去凭据）
    expect(reviewAgain.code).toBe(400101);
    expect(reviewAgain.msg).toContain("not pending review");

    const submitAgain = await inject(
      "POST",
      `/market/creator/works/${work.id}/submit`,
      undefined,
      owner.token,
      owner.spaceId,
    );
    expect(submitAgain.code).toBe(400101);
    expect(submitAgain.msg).toContain("offline it first");
  });

  // ══════════════════════════════════════════════════════════
  // 二、购买（钱走账本）
  // ══════════════════════════════════════════════════════════

  it("购买：事务内 creditOut 扣分、协议生效、收益按 80% 累计（抽成 20% 初值）", async () => {
    const owner = await loginNewUser("21");
    const buyer = await loginNewUser("22");
    const novelId = await seedNovel(owner.spaceId);
    const work = await publishWork(owner, { novel_id: novelId, title: "可购买作品", price_credits: 1000 });

    const start = await topUp(buyer.spaceId, 1500);

    const bought = await inject("POST", `/market/scripts/${work.id}/buy`, undefined, buyer.token, buyer.spaceId);
    expect(bought.code).toBe(0);
    const data = bought.data as {
      agreement: { id: string; price_credits: number; status: number; revenue_credits: number; commission_credits: number };
      idempotent: boolean;
      balance_after: number;
    };
    expect(data.idempotent).toBe(false);
    expect(data.agreement.price_credits).toBe(1000);
    expect(data.agreement.status).toBe(2); // 已生效
    // 抽成 2000bps = 20%：1000 → 抽 200 / 作者得 800（常量改了这一条会立刻红）
    expect(data.agreement.commission_credits).toBe(200);
    expect(data.agreement.revenue_credits).toBe(800);
    expect(data.balance_after).toBe(start - 1000);
    expect(await balanceOf(buyer.spaceId)).toBe(start - 1000);

    const [workRow] = await db.select().from(marketWorks).where(eq(marketWorks.id, BigInt(work.id)));
    expect(workRow?.salesCount).toBe(1);
    expect(workRow?.revenueCredits).toBe(800);
  });

  it("购买幂等：重复购买返回同一协议、不再扣分（并发双击由作品行锁串行化）", async () => {
    const owner = await loginNewUser("23");
    const buyer = await loginNewUser("24");
    const work = await publishWork(owner, { title: "幂等作品", price_credits: 400 });
    const start = await topUp(buyer.spaceId, 1000);

    const first = await inject("POST", `/market/scripts/${work.id}/buy`, undefined, buyer.token, buyer.spaceId);
    expect(first.code).toBe(0);
    const firstId = (first.data as { agreement: { id: string } }).agreement.id;

    const second = await inject("POST", `/market/scripts/${work.id}/buy`, undefined, buyer.token, buyer.spaceId);
    expect(second.code).toBe(0);
    const again = second.data as { agreement: { id: string }; idempotent: boolean; balance_after: number | null };
    expect(again.idempotent).toBe(true);
    expect(again.agreement.id).toBe(firstId);
    expect(again.balance_after).toBeNull();
    // 只扣一次：1000 - 400
    expect(await balanceOf(buyer.spaceId)).toBe(start - 400);

    const rows = await db.select().from(marketAgreements).where(eq(marketAgreements.workId, BigInt(work.id)));
    expect(rows.length).toBe(1);
  });

  it("余额不足返回 745701，且不产生协议、余额不变（不允许扣一半）", async () => {
    const owner = await loginNewUser("25");
    const buyer = await loginNewUser("26");
    const work = await publishWork(owner, { title: "买不起的作品", price_credits: 900 });
    const start = await topUp(buyer.spaceId, 100);

    const failed = await inject("POST", `/market/scripts/${work.id}/buy`, undefined, buyer.token, buyer.spaceId);
    expect(failed.code).toBe(745701);
    expect(await balanceOf(buyer.spaceId)).toBe(start);

    const rows = await db.select().from(marketAgreements).where(eq(marketAgreements.workId, BigInt(work.id)));
    expect(rows.length).toBe(0);
    const [workRow] = await db.select().from(marketWorks).where(eq(marketWorks.id, BigInt(work.id)));
    expect(workRow?.salesCount).toBe(0);
    expect(workRow?.revenueCredits).toBe(0);
  });

  it("不能购买自己的作品 / 未上架作品不可购买", async () => {
    const owner = await loginNewUser("27");
    const work = await publishWork(owner, { title: "自己的作品", price_credits: 100 });
    await topUp(owner.spaceId, 1000);
    const self = await inject("POST", `/market/scripts/${work.id}/buy`, undefined, owner.token, owner.spaceId);
    expect(self.code).toBe(400101);
    expect(self.msg).toContain("your own work");

    const draft = await saveDraft(owner, { title: "草稿作品", price_credits: 100 });
    const notOnSale = await inject("POST", `/market/scripts/${draft.id}/buy`, undefined, owner.token, owner.spaceId);
    expect(notOnSale.code).toBe(400101);
    expect(notOnSale.msg).toContain("not on sale");
  });

  it("内容闸门：未购买读内容 403；作者与买家可读（content-tree / characters / download）", async () => {
    const owner = await loginNewUser("28");
    const buyer = await loginNewUser("29");
    const outsider = await loginNewUser("30");
    const novelId = await seedNovel(owner.spaceId);
    const work = await publishWork(owner, { novel_id: novelId, title: "内容闸门作品", price_credits: 200 });
    await topUp(buyer.spaceId, 500);

    // 未购买：403 且带 reason=not_purchased（前端据此弹"去购买"而不是报错）
    const denied = await inject("GET", `/market/scripts/${work.id}/content-tree`, undefined, outsider.token, outsider.spaceId);
    expect(denied.code).toBe(403101);
    expect(denied.msg).toContain("purchase required");

    // 作者本人不需要凭据
    const ownerView = await inject("GET", `/market/scripts/${work.id}/content-tree`, undefined, owner.token, owner.spaceId);
    expect(ownerView.code).toBe(0);
    expect((ownerView.data as { chapter_count: number }).chapter_count).toBe(2);

    await inject("POST", `/market/scripts/${work.id}/buy`, undefined, buyer.token, buyer.spaceId);

    const buyerTree = await inject("GET", `/market/scripts/${work.id}/content-tree`, undefined, buyer.token, buyer.spaceId);
    expect(buyerTree.code).toBe(0);
    const tree = buyerTree.data as { chapter_count: number; total_word_count: number; content_included: boolean };
    expect(tree.chapter_count).toBe(2);
    expect(tree.total_word_count).toBe(6);
    // 结构树不返回正文（正文归 download，便于审计与限流）
    expect(tree.content_included).toBe(false);

    const chars = await inject("GET", `/market/scripts/${work.id}/characters`, undefined, buyer.token, buyer.spaceId);
    expect(chars.code).toBe(0);
    expect((chars.data as { count: number }).count).toBe(1);

    // download 是 text 直出（不包信封），前端点一下就能存盘
    const download = await app.inject({
      method: "GET",
      url: `/v1/market/scripts/${work.id}/download`,
      headers: { authorization: `Bearer ${buyer.token}`, "x-space-id": buyer.spaceId },
    });
    expect(download.statusCode).toBe(200);
    expect(download.headers["content-type"]).toContain("text/markdown");
    expect(download.body).toContain("第一章");
  });

  // ══════════════════════════════════════════════════════════
  // 三、预售与退款
  // ══════════════════════════════════════════════════════════

  it("预售：设定金的作品通过审核后落「预售中」；预售期不可直接买断；定金走账本", async () => {
    const owner = await loginNewUser("31");
    const buyer = await loginNewUser("32");
    const work = await publishWork(owner, {
      title: "预售作品",
      price_credits: 1000,
      preorder_price_credits: 200,
    });
    // 有定金价 → 通过后进"预售中"（不是"在售"），两种状态的可用动作不同
    expect(work.status).toBe(6);

    const start = await topUp(buyer.spaceId, 500);
    const buyInPreorder = await inject("POST", `/market/scripts/${work.id}/buy`, undefined, buyer.token, buyer.spaceId);
    expect(buyInPreorder.code).toBe(400101);
    expect(buyInPreorder.msg).toContain("preorder");

    const preorder = await inject("POST", `/market/scripts/${work.id}/preorder`, undefined, buyer.token, buyer.spaceId);
    expect(preorder.code).toBe(0);
    const data = preorder.data as { agreement: { kind: number; price_credits: number; revenue_credits: number }; balance_after: number };
    expect(data.agreement.kind).toBe(2); // 预售
    expect(data.agreement.price_credits).toBe(200);
    expect(data.agreement.revenue_credits).toBe(160); // 200 - 40(20%)
    expect(data.balance_after).toBe(start - 200);
    expect(await balanceOf(buyer.spaceId)).toBe(start - 200);
  });

  it("取消预售订单退回定金并减回收益；买断订单不可取消", async () => {
    const owner = await loginNewUser("33");
    const buyer = await loginNewUser("34");
    const work = await publishWork(owner, { title: "可退定金作品", price_credits: 1000, preorder_price_credits: 200 });
    const start = await topUp(buyer.spaceId, 500);
    await inject("POST", `/market/scripts/${work.id}/preorder`, undefined, buyer.token, buyer.spaceId);
    expect(await balanceOf(buyer.spaceId)).toBe(start - 200);

    const cancelled = await inject("POST", `/market/scripts/${work.id}/cancelorder`, undefined, buyer.token, buyer.spaceId);
    expect(cancelled.code).toBe(0);
    const data = cancelled.data as { refund_credits: number; refund: { kind: number }; agreement: { status: number } };
    expect(data.refund_credits).toBe(200);
    expect(data.agreement.status).toBe(3); // 原协议 → 已退款
    expect(data.refund.kind).toBe(4); // 反向记录
    // 定金全额退回：余额回到充值后的起点
    expect(await balanceOf(buyer.spaceId)).toBe(start);

    // 收益必须同额减回，否则 Σrevenue 与 Σ(生效协议−抽成) 永久失衡
    const [workRow] = await db.select().from(marketWorks).where(eq(marketWorks.id, BigInt(work.id)));
    expect(workRow?.revenueCredits).toBe(0);
    expect(workRow?.salesCount).toBe(0);

    // 第二次取消：没有可取消的预售 → 404
    const again = await inject("POST", `/market/scripts/${work.id}/cancelorder`, undefined, buyer.token, buyer.spaceId);
    expect(again.code).toBe(400102);

    // 买断订单不能取消（内容已可下载，退款等于白拿）
    const buyWork = await publishWork(owner, { title: "买断不可退", price_credits: 100 });
    await topUp(buyer.spaceId, 200);
    await inject("POST", `/market/scripts/${buyWork.id}/buy`, undefined, buyer.token, buyer.spaceId);
    const buyCancel = await inject("POST", `/market/scripts/${buyWork.id}/cancelorder`, undefined, buyer.token, buyer.spaceId);
    expect(buyCancel.code).toBe(400102);
  });

  // ══════════════════════════════════════════════════════════
  // 四、收益与提现状态机
  // ══════════════════════════════════════════════════════════

  it("收益总览：可提现 = 累计收益 − 已申请；低于最低额与超额都拒绝", async () => {
    const owner = await loginNewUser("41");
    const buyer = await loginNewUser("42");
    const work = await publishWork(owner, { title: "收益作品", price_credits: 1000 });
    const start = await topUp(buyer.spaceId, 1000);
    await inject("POST", `/market/scripts/${work.id}/buy`, undefined, buyer.token, buyer.spaceId);

    const overview = await inject(
      "GET",
      "/market/creator/revenues/overview",
      undefined,
      owner.token,
      owner.spaceId,
    );
    expect(overview.code).toBe(0);
    const o = overview.data as { revenue_credits: number; available_credits: number; min_withdraw_credits: number };
    expect(o.revenue_credits).toBe(800);
    expect(o.available_credits).toBe(800);
    expect(o.min_withdraw_credits).toBe(100);

    const tooSmall = await inject(
      "POST",
      "/market/creator/withdraw",
      { amount_credits: 50 },
      owner.token,
      owner.spaceId,
    );
    expect(tooSmall.code).toBe(400101);
    expect(tooSmall.msg).toContain("at least 100");

    const tooMuch = await inject(
      "POST",
      "/market/creator/withdraw",
      { amount_credits: 900 },
      owner.token,
      owner.spaceId,
    );
    expect(tooMuch.code).toBe(400101);
    expect(tooMuch.msg).toContain("available");
  });

  it("同一用户同时只能有 1 笔待审提现；状态机跳步（待审直接打款）必须拒绝", async () => {
    const owner = await loginNewUser("43");
    const buyer = await loginNewUser("44");
    const work = await publishWork(owner, { title: "提现作品", price_credits: 1000 });
    const start = await topUp(buyer.spaceId, 1000);
    await inject("POST", `/market/scripts/${work.id}/buy`, undefined, buyer.token, buyer.spaceId);

    const first = await inject(
      "POST",
      `/market/creator/works/${work.id}/withdraw`,
      { amount_credits: 300, channel: "alipay", account_info: { account: "13800000000", spec: "market-spec" } },
      owner.token,
      owner.spaceId,
    );
    expect(first.code).toBe(0);
    const withdrawal = (
      first.data as { withdrawal: { id: string; status: number; status_name: string; work_id: string | null } }
    ).withdrawal;
    expect(withdrawal.status).toBe(1);
    expect(withdrawal.status_name).toBe("待审核");
    // 按作品发起的提现必须把归属落进真列 `work_id`（迁移 0030），
    // 不能只塞 account_info 字符串——那样无法索引、无法与作品对账
    expect(withdrawal.work_id).toBe(work.id);

    // 第二笔在同一笔待审未终结前必须拒绝（否则同一笔收益能被申请两次）
    const second = await inject(
      "POST",
      "/market/creator/withdraw",
      { amount_credits: 100 },
      owner.token,
      owner.spaceId,
    );
    expect(second.code).toBe(400101);
    expect(second.msg).toContain("already pending");

    // 跳步：1 待审 → 3 已打款 必须拒绝（本批 DoD 点名场景）
    const skip = await inject(
      "POST",
      `/ops/market/withdrawals/${withdrawal.id}/payout`,
      { channel_refund_no: "skip-step" },
      adminToken,
    );
    expect(skip.code).toBe(400101);
    expect(skip.msg).toContain("must be approved before payout");

    // 正序：待审 → 通过 → 打款
    const approve = await inject(
      "POST",
      `/ops/market/withdrawals/${withdrawal.id}/review`,
      { result: "approved", review_note: "market-spec-approved" },
      adminToken,
    );
    expect(approve.code).toBe(0);
    expect((approve.data as { withdrawal: { status: number } }).withdrawal.status).toBe(2);

    const payout = await inject(
      "POST",
      `/ops/market/withdrawals/${withdrawal.id}/payout`,
      { channel_refund_no: "ali-2026-0001", review_note: "market-spec-paid" },
      adminToken,
    );
    expect(payout.code).toBe(0);
    const paid = (payout.data as { withdrawal: { status: number; status_name: string; paid_at: string | null } })
      .withdrawal;
    expect(paid.status).toBe(3);
    expect(paid.status_name).toBe("已打款");
    expect(paid.paid_at).not.toBeNull();

    // 终态后再审 → 400101（不可逆）
    const reviewAfterPaid = await inject(
      "POST",
      `/ops/market/withdrawals/${withdrawal.id}/review`,
      { result: "rejected", review_note: "太晚了" },
      adminToken,
    );
    expect(reviewAfterPaid.code).toBe(400101);
  });

  it("撤销提现：待审可撤销；已通过不可撤销（可能已在打款流程）", async () => {
    const owner = await loginNewUser("45");
    const buyer = await loginNewUser("46");
    const work = await publishWork(owner, { title: "撤销提现作品", price_credits: 1000 });
    const start = await topUp(buyer.spaceId, 1000);
    await inject("POST", `/market/scripts/${work.id}/buy`, undefined, buyer.token, buyer.spaceId);

    const created = await inject(
      "POST",
      "/market/creator/withdraw",
      { amount_credits: 200, account_info: { spec: "market-spec" } },
      owner.token,
      owner.spaceId,
    );
    expect(created.code).toBe(0);
    const id = (created.data as { withdrawal: { id: string } }).withdrawal.id;

    const cancelled = await inject(
      "POST",
      `/market/creator/withdrawals/${id}/cancel`,
      undefined,
      owner.token,
      owner.spaceId,
    );
    expect(cancelled.code).toBe(0);
    expect((cancelled.data as { withdrawal: { status: number } }).withdrawal.status).toBe(5);

    // 撤销后额度释放，可以重新申请
    const again = await inject(
      "POST",
      "/market/creator/withdraw",
      { amount_credits: 200 },
      owner.token,
      owner.spaceId,
    );
    expect(again.code).toBe(0);
    const newId2 = (again.data as { withdrawal: { id: string } }).withdrawal.id;
    await inject(
      "POST",
      `/ops/market/withdrawals/${newId2}/review`,
      { result: "approved", review_note: "market-spec-approved-2" },
      adminToken,
    );
    const cancelApproved = await inject(
      "POST",
      `/market/creator/withdrawals/${newId2}/cancel`,
      undefined,
      owner.token,
      owner.spaceId,
    );
    expect(cancelApproved.code).toBe(400101);
    expect(cancelApproved.msg).toContain("only pending");
  });

  // ══════════════════════════════════════════════════════════
  // 五、分类 / 标签 / 推广位 / 鉴权
  // ══════════════════════════════════════════════════════════

  it("分类与标签：admin 建 → C 端 config 可见 → 按分类筛选命中 → 未知标签被拒", async () => {
    const owner = await loginNewUser("51");
    // 分类/标签是平台级（name 全局唯一）：用随机后缀，避免与其它运行/其它 spec 撞唯一键
    const suffix = String(Date.now()).slice(-8);
    const category = await inject(
      "POST",
      "/ops/market/categories",
      { name: `悬疑推理-${suffix}`, sort: 1 },
      adminToken,
    );
    expect(category.code).toBe(0);
    const categoryId = (category.data as { category: { id: string } }).category.id;
    createdCategoryIds.push(BigInt(categoryId));

    const tag = await inject("POST", "/ops/market/tags", { name: `短剧-${suffix}` }, adminToken);
    expect(tag.code).toBe(0);
    const tagId = (tag.data as { tag: { id: string } }).tag.id;
    createdTagIds.push(BigInt(tagId));

    const config = await inject("GET", "/market/scripts/config", undefined, owner.token, owner.spaceId);
    expect(config.code).toBe(0);
    const cfg = config.data as {
      categories: Array<{ id: string }>;
      tags: Array<{ id: string }>;
      commission_bps: number;
      min_withdraw_credits: number;
    };
    expect(cfg.categories.map((c) => c.id)).toContain(categoryId);
    expect(cfg.tags.map((t) => t.id)).toContain(tagId);
    // 抽成比例必须由后端下发（前端不许写死 20%），改常量前端自动跟随
    expect(cfg.commission_bps).toBe(2000);
    expect(cfg.min_withdraw_credits).toBe(100);

    const work = await publishWork(owner, { title: "分类作品", price_credits: 100 });
    const assigned = await inject(
      "PATCH",
      `/market/creator/works/${work.id}`,
      { category_id: categoryId, tag_ids: [tagId] },
      owner.token,
      owner.spaceId,
    );
    expect(assigned.code).toBe(0);

    const filtered = await inject(
      "GET",
      `/market/scripts?category_id=${categoryId}&page_size=50`,
      undefined,
      owner.token,
      owner.spaceId,
    );
    expect(filtered.code).toBe(0);
    const list = (filtered.data as { list: Array<{ id: string; tag_ids: string[] }>; taxonomy_filtered: boolean }).list;
    expect(list.map((w) => w.id)).toContain(work.id);
    // 只留下带该分类的作品——别的测试作品不该串进来
    expect(list.every((w) => w.id === work.id)).toBe(true);
    // 分类/标签落在 `market_works` 的真列上（迁移 0030），不再回查配置表
    expect(list[0]!.tag_ids).toEqual([tagId]);

    // 标签是「且」语义：多选两个只命中同时带两个的
    const filteredByTag = await inject(
      "GET",
      `/market/scripts?tag_ids=${tagId}&page_size=50`,
      undefined,
      owner.token,
      owner.spaceId,
    );
    expect((filteredByTag.data as { list: Array<{ id: string }> }).list.map((w) => w.id)).toEqual([work.id]);

    // 格式合法但不存在的 id → unknown tag_id（证明无外键的数组列也拦住了悬空引用）
    const unknownTag = await inject(
      "PATCH",
      `/market/creator/works/${work.id}`,
      { tag_ids: ["999999999999"] },
      owner.token,
      owner.spaceId,
    );
    expect(unknownTag.code).toBe(400101);
    expect(unknownTag.msg).toContain("unknown tag_id");

    // 非法 id 形态 → 同样是 400101（不是 500）
    const badTag = await inject(
      "PATCH",
      `/market/creator/works/${work.id}`,
      { tag_ids: ["tag_does_not_exist"] },
      owner.token,
      owner.spaceId,
    );
    expect(badTag.code).toBe(400101);

    // 删标签 = 物理删 + 从所有作品 tag_ids 摘除（否则列表筛选会命中不存在的 id）
    const delTag = await inject("DELETE", `/ops/market/tags/${tagId}`, undefined, adminToken);
    expect(delTag.code).toBe(0);
    expect((delTag.data as { affected_works: number }).affected_works).toBe(1);
    const afterDel = await inject("GET", `/market/creator/works/${work.id}`, undefined, owner.token, owner.spaceId);
    expect((afterDel.data as { tag_ids: string[] }).tag_ids).toEqual([]);

    // 删分类 = **停用**（不物理删）：作品仍挂着该分类，但 config 不再下发
    const delCategory = await inject("DELETE", `/ops/market/categories/${categoryId}`, undefined, adminToken);
    expect(delCategory.code).toBe(0);
    expect((delCategory.data as { disabled: boolean; status: number }).disabled).toBe(true);
    expect((delCategory.data as { status: number }).status).toBe(2);
    const cfgAfter = await inject("GET", "/market/scripts/config", undefined, owner.token, owner.spaceId);
    expect((cfgAfter.data as { categories: Array<{ id: string }> }).categories.map((c) => c.id)).not.toContain(categoryId);
    const workAfter = await inject("GET", `/market/creator/works/${work.id}`, undefined, owner.token, owner.spaceId);
    expect((workAfter.data as { category_id: string | null }).category_id).toBe(categoryId);
  });

  it("推广位：admin 建 → C 端可见 → 停用后不可见", async () => {
    const user = await loginNewUser("52");
    const created = await inject(
      "POST",
      "/ops/market/promotions",
      { title: "暑期剧本节", image_uri: "https://cdn.example.com/p.png", link_uri: "/novel-market", sort: 1 },
      adminToken,
    );
    expect(created.code).toBe(0);
    const promoId = (created.data as { promotion: { id: string } }).promotion.id;
    createdPromotionIds.push(BigInt(promoId));

    const visible = await inject("GET", "/market/scripts/promotions", undefined, user.token, user.spaceId);
    expect(visible.code).toBe(0);
    expect((visible.data as { list: Array<{ id: string }> }).list.map((p) => p.id)).toContain(promoId);

    const disabled = await inject("DELETE", `/ops/market/promotions/${promoId}`, undefined, adminToken);
    expect(disabled.code).toBe(0);
    const afterDisable = await inject("GET", "/market/scripts/promotions", undefined, user.token, user.spaceId);
    expect((afterDisable.data as { list: Array<{ id: string }> }).list.map((p) => p.id)).not.toContain(promoId);
  });

  it("运营后台鉴权：普通用户 token 打 /ops/market/* 403101；无凭证 401101", async () => {
    const user = await loginNewUser("53");
    const asUser = await inject("GET", "/ops/market/scripts/list", undefined, user.token, user.spaceId);
    expect(asUser.code).toBe(403101);

    const anonymous = await inject("GET", "/ops/market/scripts/list");
    expect(anonymous.code).toBe(401101);

    // 管理员凭证可以正常读（对照组，证明上面失败是鉴权而非路由不存在）
    const asAdmin = await inject("GET", "/ops/market/scripts/list", undefined, adminToken);
    expect(asAdmin.code).toBe(0);
  });

  it("跨 space 越权：X-Space-Id 指向非成员空间 403；他人不可编辑/下架我的作品", async () => {
    const owner = await loginNewUser("54");
    const outsider = await loginNewUser("55");
    const work = await publishWork(owner, { title: "别人的作品", price_credits: 100 });

    const crossSpace = await inject("GET", "/market/creator/works", undefined, outsider.token, owner.spaceId);
    expect(crossSpace.code).toBe(403101);

    const patch = await inject(
      "PATCH",
      `/market/creator/works/${work.id}`,
      { title: "偷改标题" },
      outsider.token,
      outsider.spaceId,
    );
    expect(patch.code).toBe(403101);

    const offline = await inject(
      "POST",
      `/market/creator/works/${work.id}/offline`,
      undefined,
      outsider.token,
      outsider.spaceId,
    );
    expect(offline.code).toBe(403101);
  });

  it("协议三类 + 附件下载：买前可看，价格/抽成与作品一致", async () => {
    const owner = await loginNewUser("56");
    const visitor = await loginNewUser("57");
    const work = await publishWork(owner, { title: "协议作品", price_credits: 500, preorder_price_credits: 100 });

    const purchase = await inject(
      "GET",
      `/market/scripts/${work.id}/agreement?kind=1`,
      undefined,
      visitor.token,
      visitor.spaceId,
    );
    expect(purchase.code).toBe(0);
    const body = (purchase.data as { body: string; kind: number }).body;
    expect(body).toContain("500 积分");
    expect(body).toContain("20%"); // 抽成比例写进条文，避免"页面说 20%、实际扣 30%"
    expect(body).toContain("作者实收 400 积分");

    const preorder = await inject(
      "GET",
      `/market/scripts/${work.id}/agreement?kind=2`,
      undefined,
      visitor.token,
      visitor.spaceId,
    );
    expect(preorder.code).toBe(0);
    expect((preorder.data as { body: string }).body).toContain("100 积分");

    const file = await app.inject({
      method: "GET",
      url: `/v1/market/scripts/${work.id}/agreement-file?kind=1`,
      headers: { authorization: `Bearer ${visitor.token}`, "x-space-id": visitor.spaceId },
    });
    expect(file.statusCode).toBe(200);
    expect(file.headers["content-type"]).toContain("text/plain");
    expect(file.body).toContain("作品购买协议");
  });
});
