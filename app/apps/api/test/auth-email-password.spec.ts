import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import cookie from "@fastify/cookie";
import { AllExceptionsFilter } from "../src/common/http/exception.filter";
import { EnvelopeInterceptor } from "../src/common/http/envelope.interceptor";
import { AppModule } from "../src/app.module";
import { pool } from "../src/db/database";
import { hashIdentifier, normalizeEmail } from "../src/modules/auth/crypto";

/**
 * 邮箱 + 密码登录（api-spec §33.6，第 130 批）。
 *
 * 为什么要有这条通道：现有登录**只有手机号 + 短信码**，而短信网关至今没有实现
 * （`sms.service.ts` 只写 Redis）。也就是说供应商一断、或者没接供应商，整个产品
 * 一个人都进不来。邮箱+密码是唯一不依赖第三方、也不依赖备案的兜底入口。
 *
 * 本 spec 锁住三组东西，都是"看起来能跑但其实是坑"的位置：
 * 1. **注册即登录**：返回体与 `/auth/login` 完全同形（前端两条路径共用一段收尾）；
 * 2. **建号副作用一个都不能少**：identity(provider=email) + user_credentials 同事务、
 *    新人礼包入账、`age_declared_at` 留痕、余额恒等式 `balance == Σdelta` 成立；
 * 3. **不泄露账号是否存在**：密码错与账号不存在的 code/msg **完全一致**，
 *    且手机号形态的标识符被显式拒绝（不静默落到短信路径，否则前端会以为密码登录成功）。
 */
describe("邮箱 + 密码登录", () => {
  let app: NestFastifyApplication;
  const createdEmails: string[] = [];
  /**
   * 共用邀请码（第 131 批起邮箱注册**服务端强制**邀请码）。
   *
   * `credits: 0` 是刻意的：它让"新人礼包"成为唯一入账来源，
   * 这样 `balance == Σdelta == 80` 的断言才不会被邀请礼包搅浑；
   * `maxUses` 给足，避免用例之间互相消耗。
   */
  const SHARED_INVITE = `test-inv-shared-${Date.now()}`;
  const createdInvites: string[] = [SHARED_INVITE];

  const inject = async (
    method: "GET" | "POST",
    url: string,
    payload?: unknown,
    token?: string,
  ): Promise<{ code: number; msg?: string; data?: unknown; headers: Record<string, unknown> }> => {
    const res = await app.inject({
      method,
      url: `/v1${url}`,
      ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });
    const body = res.json() as { code: number; msg?: string; data?: unknown };
    return { ...body, headers: res.headers as Record<string, unknown> };
  };

  /** 每次用完即换：随机邮箱，避免复跑撞唯一索引 */
  const freshEmail = (label: string): string => {
    const email = `${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
    createdEmails.push(normalizeEmail(email));
    return email;
  };

  const PASSWORD = "Str0ng-Pass-2026";

  beforeAll(async () => {
    app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), {
      logger: false,
    });
    await app.register(cookie as never);
    app.setGlobalPrefix("v1");
    app.useGlobalInterceptors(new EnvelopeInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    // 服务端强制邀请码：准备一枚 credits=0、maxUses 充足的共用码
    await pool.query(
      `insert into invite_codes (id, code, credits, max_uses, used_count, status)
       values ($1, $2, 0, 500, 0, 1) on conflict (code) do nothing`,
      [String(Date.now()) + "0", SHARED_INVITE],
    );
  }, 60_000);

  afterAll(async () => {
    // 邀请码核销记录必须**最先**删：它同时 FK 指向 `invite_codes` 与 `spaces`，
    // 若留到删完 spaces 之后，删 spaces 会先被它挡住（本轮就踩了这条，表现为整文件失败）。
    for (const code of createdInvites) {
      await pool.query(
        `delete from invite_redemptions where code_id in (select id from invite_codes where code = $1)`,
        [code],
      );
    }
    // 按邮箱哈希清理（identity 是根，其余按 user 级联手删，保持测试库干净可复跑）
    for (const email of createdEmails) {
      const hash = hashIdentifier(email);
      const rows = await pool.query<{ user_id: string }>(
        `select user_id from identities where provider = 'email' and phone_hash = $1`,
        [hash],
      );
      for (const { user_id } of rows.rows) {
        const space = await pool.query<{ id: string }>(`select id from spaces where owner_user_id = $1`, [user_id]);
        for (const { id: spaceId } of space.rows) {
          // 顺序不能反：`SEED_SAMPLE_PROJECT` 会给新空间建一个 script_projects，
          // 而 episodes/storyboards/project_assets/tasks 都挂在它下面。
          // 直接 delete spaces 会撞 `script_projects_space_id_spaces_id_fk`（本人踩过）。
          await pool.query(
            `delete from storyboards where episode_id in (
               select e.id from episodes e join script_projects p on p.id = e.project_id where p.space_id = $1)`,
            [spaceId],
          );
          await pool.query(
            `delete from episodes where project_id in (select id from script_projects where space_id = $1)`,
            [spaceId],
          );
          await pool.query(
            `delete from project_assets where project_id in (select id from script_projects where space_id = $1)`,
            [spaceId],
          );
          await pool.query(`delete from tasks where space_id = $1`, [spaceId]);
          await pool.query(`delete from script_projects where space_id = $1`, [spaceId]);
          await pool.query(`delete from credit_flows where space_id = $1`, [spaceId]);
          await pool.query(`delete from credit_accounts where space_id = $1`, [spaceId]);
          await pool.query(`delete from space_members where space_id = $1`, [spaceId]);
        }
        await pool.query(`delete from user_credentials where user_id = $1`, [user_id]);
        await pool.query(`delete from identities where user_id = $1`, [user_id]);
        await pool.query(`delete from spaces where owner_user_id = $1`, [user_id]);
        await pool.query(`delete from users where id = $1`, [user_id]);
      }
    }
    // 码本身最后删（核销记录已在开头清掉）
    for (const code of createdInvites) {
      await pool.query(`delete from invite_codes where code = $1`, [code]);
    }
    await app.close();
    await pool.end();
  }, 60_000);

  it("注册即登录：返回体与短信登录同形，且 refresh 走 httpOnly Cookie", async () => {
    const email = freshEmail("reg");
    const res = await inject("POST", "/auth/email/register", {
      email,
      password: PASSWORD,
      age_confirmed: true,
      invite_code: SHARED_INVITE,
    });
    expect(res.code, `msg=${res.msg} data=${JSON.stringify(res.data)}`).toBe(0);
    const data = res.data as {
      access_token: string;
      expires_in: number;
      user: { id: string; nickname: string };
      space_id: string;
      master_token: string;
    };
    // 与 /auth/login 的字段集一致：前端"登录成功后"的那段逻辑可以直接复用
    expect(typeof data.access_token).toBe("string");
    expect(data.access_token.length).toBeGreaterThan(20);
    expect(data.user.id).toMatch(/^\d+$/);
    expect(data.space_id).toMatch(/^\d+$/);
    expect(typeof data.master_token).toBe("string");

    // refresh_token 只能在 Cookie 里，绝不出现在响应体（XSS 拿不到 httpOnly）
    expect(JSON.stringify(res.data)).not.toContain("refresh_token");
    const setCookie = String(res.headers["set-cookie"] ?? "");
    expect(setCookie).toContain("refresh_token=");
    expect(setCookie).toContain("HttpOnly");

    // 建号副作用 1：identity(provider=email) 与 user_credentials **都存在**
    const hash = hashIdentifier(normalizeEmail(email));
    const identity = await pool.query<{ user_id: string }>(
      `select user_id from identities where provider = 'email' and phone_hash = $1`,
      [hash],
    );
    expect(identity.rowCount).toBe(1);
    const userId = identity.rows[0]!.user_id;
    const credential = await pool.query<{ password_hash: string; algo: string }>(
      `select password_hash, algo from user_credentials where user_id = $1`,
      [userId],
    );
    expect(credential.rowCount).toBe(1);
    // 密码必须是 scrypt 哈希（含参数与盐），绝不是明文
    expect(credential.rows[0]!.algo).toBe("scrypt");
    expect(credential.rows[0]!.password_hash).toMatch(/^scrypt\$\d+\$\d+\$\d+\$/);
    expect(credential.rows[0]!.password_hash).not.toContain(PASSWORD);

    // 建号副作用 2：合规留痕（age_declared_at），不是只靠请求参数临时校验
    const userRow = await pool.query<{ age_declared_at: Date | null }>(
      `select age_declared_at from users where id = $1`,
      [userId],
    );
    expect(userRow.rows[0]!.age_declared_at).not.toBeNull();

    // 建号副作用 3：新人礼包入账 + 资金恒等式
    const flows = await pool.query<{ delta: string; balance_after: string }>(
      `select sum(delta)::text as delta, max(balance_after)::text as balance_after
         from credit_flows where space_id = $1`,
      [data.space_id],
    );
    const accounts = await pool.query<{ balance: string }>(
      `select balance::text from credit_accounts where space_id = $1`,
      [data.space_id],
    );
    expect(Number(flows.rows[0]!.delta)).toBe(80);
    expect(Number(accounts.rows[0]!.balance)).toBe(Number(flows.rows[0]!.delta));
  }, 60_000);

  it("登录成功：密码正确 → 发 token，且 /me 能读到同一个用户", async () => {
    const email = freshEmail("login");
    await inject("POST", "/auth/email/register", { email, password: PASSWORD, age_confirmed: true, invite_code: SHARED_INVITE });

    const login = await inject("POST", "/auth/login/password", { identifier: email, password: PASSWORD });
    expect(login.code).toBe(0);
    const token = (login.data as { access_token: string }).access_token;

    const me = await inject("GET", "/me", undefined, token);
    expect(me.code).toBe(0);
    const data = me.data as { user: { id: string }; credits: { balance: number }; llm_mode?: string };
    expect(data.user.id).toMatch(/^\d+$/);
    expect(data.credits.balance).toBe(80);
    // 登录不改变 LLM 形态来源（进程级字段仍由 /me 透出）
    expect(["mock", "real"]).toContain(data.llm_mode);
  }, 60_000);

  it("邮箱大小写与首尾空白归一化：注册 A@B.com 能用 a@b.com 登录", async () => {
    const email = freshEmail("norm");
    const noisy = `  ${email.toUpperCase()}  `;
    await inject("POST", "/auth/email/register", { email: noisy, password: PASSWORD, age_confirmed: true, invite_code: SHARED_INVITE });

    const login = await inject("POST", "/auth/login/password", {
      identifier: ` ${email.toUpperCase()} `,
      password: PASSWORD,
    });
    expect(login.code).toBe(0);
  }, 60_000);

  it("不泄露账号是否存在：密码错与账号不存在返回完全相同的 code/msg", async () => {
    const email = freshEmail("enum");
    await inject("POST", "/auth/email/register", { email, password: PASSWORD, age_confirmed: true, invite_code: SHARED_INVITE });

    const wrongPassword = await inject("POST", "/auth/login/password", { identifier: email, password: "Wr0ng-Pass-2026" });
    const noSuchUser = await inject("POST", "/auth/login/password", {
      identifier: freshEmail("ghost"),
      password: PASSWORD,
    });

    expect(wrongPassword.code).toBe(noSuchUser.code);
    expect(wrongPassword.msg).toBe(noSuchUser.msg);
    expect(wrongPassword.code).not.toBe(0);
    expect(wrongPassword.data).toBeNull();
  }, 60_000);

  it("注册校验：重复邮箱 / 弱口令 / 缺成年确认 各自给到具体字段", async () => {
    const email = freshEmail("dup");
    const first = await inject("POST", "/auth/email/register", { email, password: PASSWORD, age_confirmed: true, invite_code: SHARED_INVITE });
    expect(first.code).toBe(0);

    const dup = await inject("POST", "/auth/email/register", { email, password: PASSWORD, age_confirmed: true, invite_code: SHARED_INVITE });
    expect(dup.code).not.toBe(0);
    expect((dup.data as { field?: string } | null)?.field ?? dup.msg).toContain("邮箱");

    const weak = await inject("POST", "/auth/email/register", {
      email: freshEmail("weak"),
      password: "admin12345",
      age_confirmed: true,
    });
    expect(weak.code).not.toBe(0);
    // 弱口令走的是"用户能看懂的中文原因"，不是字段名——别把断言绑在英文 key 上
    expect(String(weak.msg ?? "")).toContain("密码");

    const noAge = await inject("POST", "/auth/email/register", {
      email: freshEmail("noage"),
      password: PASSWORD,
      // 必须带上有效邀请码，否则会先撞「请填写邀请码」——那会让这条用例测的不是年龄闸门
      invite_code: SHARED_INVITE,
    });
    expect(noAge.code).not.toBe(0);
    // 说明：`AppError` 的 `details`（含 `field`）当前**不透出到响应信封**，
    // 客户端只能拿到 `msg`。所以断言按面向用户的文案来写，别绑在字段名上。
    expect(String(noAge.msg ?? "")).toContain("18 周岁");
  }, 60_000);

  it("keep_login 语义落在 Cookie 存活期：false 不发 maxAge（会话 Cookie），缺省 14 天", async () => {
    const email = freshEmail("keep");
    await inject("POST", "/auth/email/register", { email, password: PASSWORD, age_confirmed: true, invite_code: SHARED_INVITE });

    // 缺省：持久 Cookie（带 Max-Age/Expires），关浏览器仍保留
    const persisted = await inject("POST", "/auth/login/password", { identifier: email, password: PASSWORD });
    const persistedCookie = String(persisted.headers["set-cookie"] ?? "");
    expect(persistedCookie).toMatch(/Max-Age=/i);

    // keep_login:false：会话 Cookie（无 Max-Age/Expires）——这才是勾选框该有的行为
    const session = await inject("POST", "/auth/login/password", {
      identifier: email,
      password: PASSWORD,
      keep_login: false,
    });
    const sessionCookie = String(session.headers["set-cookie"] ?? "");
    expect(sessionCookie).toContain("refresh_token=");
    expect(sessionCookie).not.toMatch(/Max-Age=/i);
    expect(sessionCookie).not.toMatch(/Expires=/i);
  }, 60_000);

  it("SEC-04 失败限流：同一标识符连错达到阈值后被拒（429100），成功登录会清零", async () => {
    const email = freshEmail("throttle");
    await inject("POST", "/auth/email/register", { email, password: PASSWORD, age_confirmed: true, invite_code: SHARED_INVITE });

    // 先确认成功一次会清零计数（否则下面"被拒"可能来自前面测试的残留）
    const okFirst = await inject("POST", "/auth/login/password", { identifier: email, password: PASSWORD });
    expect(okFirst.code).toBe(0);

    let lastCode = 0;
    for (let i = 0; i < 10; i += 1) {
      const res = await inject("POST", "/auth/login/password", { identifier: email, password: "Wr0ng-Pass-2026" });
      lastCode = res.code;
      expect(res.code).not.toBe(0);
    }
    // 第 10 次仍是"密码错"（401101）；第 11 次开始进入限流（429100）
    expect(lastCode).toBe(401101);
    const throttled = await inject("POST", "/auth/login/password", { identifier: email, password: PASSWORD });
    expect(throttled.code).toBe(429100);
    expect(String(throttled.msg ?? "")).toContain("失败次数过多");

    // 直接清掉计数（等价于窗口过期），验证"正确密码本身没坏"。
    // 注意 key 里的 IP 来自 `clientIp()`：`app.inject` 没有 X-Forwarded-For，拿到的是 127.0.0.1；
    // 只删 `:unknown` 会删不掉（我第一次就删错了 key，用例因此假红）。
    const { default: Redis } = await import("ioredis");
    const redis = new Redis(process.env.REDIS_URL ?? "redis://127.0.0.1:6380");
    const base = `auth:login:fail:${hashIdentifier(normalizeEmail(email))}`;
    await redis.del(`${base}:127.0.0.1`, `${base}:unknown`, `${base}:::1`);
    await redis.quit();
    const afterReset = await inject("POST", "/auth/login/password", { identifier: email, password: PASSWORD });
    expect(afterReset.code).toBe(0);
  }, 60_000);

  /**
   * 第 131 批：邮箱注册**服务端强制**邀请码。
   *
   * 为什么必须服务端拦：注册端点公开、每账号发 80 分，前端"必填"只能防误操作，
   * 脚本一条 curl 就绕过。下面三条判据是 Chief 点名要的，第四条补的是"失败不消费码"。
   */
  describe("服务端强制邀请码", () => {
    const newInvite = async (maxUses: number): Promise<string> => {
      const code = `test-inv-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
      createdInvites.push(code);
      await pool.query(
        `insert into invite_codes (id, code, credits, max_uses, used_count, status)
         values ($1, $2, 0, $3, 0, 1)`,
        [String(Date.now()) + String(Math.floor(Math.random() * 1000)), code, maxUses],
      );
      return code;
    };

    it("不带 invite_code → 400101「请填写邀请码」（与「无效」必须是不同 msg）", async () => {
      const res = await inject("POST", "/auth/email/register", {
        email: freshEmail("noinvite"),
        password: PASSWORD,
        age_confirmed: true,
      });
      expect(res.code).toBe(400101);
      expect(String(res.msg)).toContain("请填写邀请码");
    }, 60_000);

    it("无效 invite_code → 400101「邀请码无效或已用尽」", async () => {
      const res = await inject("POST", "/auth/email/register", {
        email: freshEmail("badinvite"),
        password: PASSWORD,
        age_confirmed: true,
        invite_code: "BOGUS-CODE-123",
      });
      expect(res.code).toBe(400101);
      expect(String(res.msg)).toContain("邀请码无效或已用尽");
    }, 60_000);

    it("有效 invite_code → 201，balance=80 且 Σdelta=80（礼包只在核销后发放）", async () => {
      const code = await newInvite(1);
      const email = freshEmail("goodinvite");
      const res = await inject("POST", "/auth/email/register", {
        email,
        password: PASSWORD,
        age_confirmed: true,
        invite_code: code,
      });
      expect(res.code).toBe(0);
      const spaceId = (res.data as { space_id: string }).space_id;

      const accounts = await pool.query<{ balance: string }>(
        `select balance::text from credit_accounts where space_id = $1`,
        [spaceId],
      );
      const flows = await pool.query<{ delta: string }>(
        `select coalesce(sum(delta),0)::text as delta from credit_flows where space_id = $1`,
        [spaceId],
      );
      expect(Number(accounts.rows[0]!.balance)).toBe(80);
      expect(Number(flows.rows[0]!.delta)).toBe(80);

      // 码被消费一次（max_uses=1 → status 置为耗尽 3）
      const invite = await pool.query<{ used_count: number; status: number }>(
        `select used_count, status from invite_codes where code = $1`,
        [code],
      );
      expect(invite.rows[0]!.used_count).toBe(1);
      expect(invite.rows[0]!.status).toBe(3);
    }, 60_000);

    it("同一枚 max_uses=1 的码第二次使用 → 400101，且不产生第二个账号", async () => {
      const code = await newInvite(1);
      const first = await inject("POST", "/auth/email/register", {
        email: freshEmail("once-a"),
        password: PASSWORD,
        age_confirmed: true,
        invite_code: code,
      });
      expect(first.code).toBe(0);

      const second = await inject("POST", "/auth/email/register", {
        email: freshEmail("once-b"),
        password: PASSWORD,
        age_confirmed: true,
        invite_code: code,
      });
      expect(second.code).toBe(400101);
      expect(String(second.msg)).toContain("邀请码无效或已用尽");
    }, 60_000);

    it("失败路径不消费邀请码：缺成年确认时 used_count 保持不变、也没有账号落库", async () => {
      const code = await newInvite(5);
      const email = freshEmail("rollback");
      const res = await inject("POST", "/auth/email/register", {
        email,
        password: PASSWORD,
        invite_code: code,
        // 故意不传 age_confirmed
      });
      expect(res.code).toBe(400101);

      const invite = await pool.query<{ used_count: number }>(
        `select used_count from invite_codes where code = $1`,
        [code],
      );
      expect(invite.rows[0]!.used_count).toBe(0);

      const identity = await pool.query(
        `select 1 from identities where provider = 'email' and phone_hash = $1`,
        [hashIdentifier(normalizeEmail(email))],
      );
      expect(identity.rowCount).toBe(0);
    }, 60_000);
  });

  it("手机号形态的标识符被显式拒绝（不静默落到短信路径）", async () => {
    const res = await inject("POST", "/auth/login/password", { identifier: "13900000009", password: PASSWORD });
    expect(res.code).not.toBe(0);
    expect(String(res.msg ?? "")).toContain("邮箱");
  }, 60_000);
});
