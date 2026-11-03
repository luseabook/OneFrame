import { Inject, Injectable } from "@nestjs/common";
import { and, eq, gt, sql } from "drizzle-orm";
import {
  creditAccounts,
  creditIn,
  episodes,
  identities,
  inviteCodes,
  inviteRedemptions,
  projectAssets,
  releaseFrozen,
  scriptProjects,
  spaceMembers,
  spaces,
  tasks,
  userCredentials,
  users,
  waitlistEntries,
} from "@app/db";
import { AppError, ErrorCode, newId } from "@app/shared";
import { MAX_TAG_ITEMS, parseListParam } from "../../common/list-param";
import { env } from "../../config/env";
import { db } from "../../db/database";
import {
  EMAIL_SHAPE,
  decryptPhone,
  encryptPhone,
  encryptSecret,
  hashIdentifier,
  hashPassword,
  hashPhone,
  maskPhone,
  normalizeEmail,
  passwordProblem,
  verifyPassword,
} from "./crypto";
import { SmsService } from "./sms.service";
import { RedisService } from "../../redis/redis.service";
import { COUNTER_RATE_LIMIT_UNAVAILABLE, bumpCounter } from "../../health/runtime-counters";

/**
 * 密码登录失败限流（SEC-04）：10 次 / 300 秒，口径与 `admin-auth` 的
 * `ADMIN_LOGIN_MAX_FAILURES` / `ADMIN_LOGIN_FAIL_TTL_S` 完全一致。
 * 这两个数是"人手误输不会触发、脚本撞库很快触发"的交点：正常用户 5 分钟内连错 10 次
 * 已经不正常；而 300s 窗口让攻击者的有效速率掉到 2 次/分钟级。
 */
const LOGIN_MAX_FAILURES = 10;
const LOGIN_FAIL_TTL_S = 300;
import { TokenService } from "./token.service";

/**
 * 鉴权上下文（请求级 `req.auth` 的形状）在本模块**再导出**一次。
 *
 * 为什么重复导出：其它域（market / creator / director …）调 service 时习惯
 * `import type { AuthContext } from "../auth/auth.service"`（它们的文件不归本批管，
 * 但模块边界上"auth 提供鉴权上下文类型"是合理直觉）。权威定义仍在
 * `common/auth.types.ts`，这里只是转发，避免出现两个同名不同类型。
 */
export type { AuthContext } from "../../common/auth.types";

export interface LoginResult {
  access_token: string;
  expires_in: number;
  user: { id: string; nickname: string; avatar: string | null };
  space_id: string;
  refresh_token: string;
  /** 双 token 的第二枚：长有效期，**只能**用于 `POST /auth/renew` 换 access */
  master_token: string;
  master_expires_in: number;
}

/** OAuth 登录结果：多一个 `created` 让前端能区分"注册"与"登录"（引导页/埋点用） */
export interface OauthLoginResult extends LoginResult {
  created: boolean;
  provider: string;
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(SmsService) private readonly sms: SmsService,
    @Inject(TokenService) private readonly tokens: TokenService,
    @Inject(RedisService) private readonly redis: RedisService,
  ) {}

  sendCode(phone: string, ip?: string): Promise<{ debug_code?: string }> {
    return this.sms.send(phone, ip);
  }

  /**
   * 新用户示例作品（PRD 增补 §3.2）：带 2 集大纲与 2 个角色，无分镜，
   * 用户可直接体验「生成分镜 → 投递」而不必先写提示词。
   *
   * 抽出 `...InTx` 版本：OAuth 建号在事务内完成，示例作品必须**同事务**写，
   * 否则事务回滚后会留下孤儿示例项目（手机号注册可以先建号再补，因为它不在事务里）。
   */
  private async createSampleProject(spaceId: bigint): Promise<void> {
    await this.createSampleProjectInTx(db, spaceId);
  }

  private async createSampleProjectInTx(tx: Pick<typeof db, "insert">, spaceId: bigint): Promise<void> {
    const projectId = newId();
    await tx.insert(scriptProjects).values({
      id: projectId,
      spaceId,
      title: "示例：雨夜来信",
      genre: "悬疑",
      dramaType: 3,
      ratio: "9:16",
      sourceType: 2,
      sourceText: "林晚在雨夜收到一封来自失踪父亲的匿名信，循着地址走进老城区。",
      status: 1,
      isSample: 1,
    });
    const samples = [
      { epNo: 1, title: "第1集 来信", synopsis: "雨夜，林晚在门缝里发现一封没有署名的信，字迹是父亲的。" },
      { epNo: 2, title: "第2集 老城区", synopsis: "她按信中地址走进老城区，遇到守夜老人，得知父亲最后出现的时间。" },
    ];
    for (const s of samples) {
      await tx.insert(episodes).values({
        id: newId(),
        projectId,
        epNo: s.epNo,
        title: s.title,
        synopsis: s.synopsis,
        status: 2,
      });
    }
    const chars = [
      { name: "林晚", desc: "25 岁，短发，深色风衣，眼神倔强" },
      { name: "守夜老人", desc: "60 岁，灰白胡须，旧棉袄，手持电筒" },
    ];
    for (const c of chars) {
      await tx.insert(projectAssets).values({
        id: newId(),
        projectId,
        kind: "character",
        name: c.name,
        description: c.desc,
        status: 1,
      });
    }
  }

  async login(phone: string, code: string, inviteCode?: string, ageConfirmed?: boolean): Promise<LoginResult> {
    await this.sms.verify(phone, code);

    const hash = hashPhone(phone);
    const existing = await db
      .select()
      .from(identities)
      .where(and(eq(identities.provider, "phone"), eq(identities.phoneHash, hash)));

    let userId: bigint;
    let spaceId: bigint;
    if (existing[0]) {
      userId = existing[0].userId;
      const [space] = await db.select().from(spaces).where(eq(spaces.ownerUserId, userId));
      if (!space) throw new AppError(ErrorCode.INTERNAL, "user space missing");
      spaceId = space.id;
    } else {
      if (ageConfirmed !== true) {
        throw new AppError(ErrorCode.INVALID_PARAM, "请确认已满 18 周岁", { field: "age_confirmed" });
      }
      const created = await this.provisionAccount({
        provider: "phone",
        identifierHash: hash,
        identifierCipher: encryptPhone(phone),
        nickname: `用户${phone.slice(-4)}`,
        inviteCode,
      });
      userId = created.uid;
      spaceId = created.sid;

      // 新用户赠一个示例作品（PRD 增补 §3.2）：含大纲与角色，可直接体验投递
      if (env.SEED_SAMPLE_PROJECT) {
        await this.createSampleProject(spaceId).catch(() => undefined);
      }
    }

    return this.issueSession(userId, spaceId);
  }

  /**
   * 建号骨架（**唯一一处**）：users → spaces → space_members → credit_accounts → identities
   * （+ 可选 user_credentials）→ 新人礼包 → 邀请码核销。
   *
   * 为什么抽出来（第 130 批）：手机号登录与邮箱注册都必须走这同一串副作用。
   * 复制一份的后果不是"代码丑"，而是**三样东西迟早分叉**：邀请码核销、新人礼包、
   * `age_declared_at` 合规留痕。任何一样在新路径上漏掉，类型检查与 e2e 都不会报错，
   * 只会在上线后表现为"邮箱注册的用户没有年龄留痕"这类合规缺口。
   */
  private async provisionAccount(input: {
    provider: string;
    identifierHash: string;
    identifierCipher: string;
    nickname: string;
    inviteCode?: string;
    /** 有值则同事务写 `user_credentials`（密码类登录用） */
    passwordHash?: string;
  }): Promise<{ uid: bigint; sid: bigint }> {
    return db.transaction(async (tx) => {
      const uid = newId();
      const sid = newId();

      /**
       * 邀请码**先校验、再落任何数据**（第 131 批，2026-11-03）。
       *
       * 为什么顺序要这么严：
       * 1. 回滚只能保证"失败不落库"，表达不了「礼包只在核销成功后发放」这条**业务顺序**。
       *    一旦将来把发礼包挪出事务（异步发券、消息队列），回滚就不存在了，顺序是唯一保障。
       * 2. `for("update")` 同时是并发闸：两个请求用同一枚邀请码时，后者会等前者提交后
       *    重读 `used_count`，从而看到"已用尽"——否则 `maxUses=1` 的码能被同时用两次。
       */
      let invite: typeof inviteCodes.$inferSelect | undefined;
      if (input.inviteCode) {
        const [row] = await tx
          .select()
          .from(inviteCodes)
          .where(eq(inviteCodes.code, input.inviteCode))
          .for("update");
        const valid =
          row &&
          row.status === 1 &&
          row.usedCount < row.maxUses &&
          (!row.expiresAt || row.expiresAt.getTime() > Date.now());
        if (!valid) {
          throw new AppError(ErrorCode.INVALID_PARAM, "邀请码无效或已用尽", { field: "invite_code" });
        }
        invite = row;
      } else if (env.AUTH_REQUIRE_INVITE) {
        throw new AppError(ErrorCode.INVALID_PARAM, "Alpha 期需要邀请码", { field: "invite_code" });
      }
      // 合规留痕（compliance launch-checklist B3/C3）：建号即记录成年确认时间，
      // 用于举证「已确认年满 18 周岁」，而不只是靠请求参数临时校验。
      await tx.insert(users).values({
        id: uid,
        nickname: input.nickname,
        ageDeclaredAt: new Date(),
      });
      await tx.insert(spaces).values({ id: sid, ownerUserId: uid });
      await tx.insert(spaceMembers).values({ spaceId: sid, userId: uid, role: 1 });
      await tx.insert(creditAccounts).values({ spaceId: sid });
      await tx.insert(identities).values({
        id: newId(),
        userId: uid,
        provider: input.provider,
        phoneHash: input.identifierHash,
        phoneCipher: input.identifierCipher,
      });
      if (input.passwordHash) {
        await tx.insert(userCredentials).values({
          id: newId(),
          userId: uid,
          passwordHash: input.passwordHash,
        });
      }

      if (env.GIFT_CREDITS > 0) {
        await creditIn(tx, {
          spaceId: sid,
          amount: env.GIFT_CREDITS,
          kind: "gift",
          memo: "signup gift",
        });
      }

      if (invite) {
        const usedCount = invite.usedCount + 1;
        await tx
          .update(inviteCodes)
          .set({ usedCount, status: usedCount >= invite.maxUses ? 3 : 1 })
          .where(eq(inviteCodes.id, invite.id));
        await tx.insert(inviteRedemptions).values({
          id: newId(),
          codeId: invite.id,
          spaceId: sid,
        });
        if (invite.credits > 0) {
          await creditIn(tx, {
            spaceId: sid,
            amount: invite.credits,
            kind: "gift",
            codeId: invite.id,
            memo: "invite gift",
          });
        }
      }

      return { uid, sid };
    });
  }

  /** 签发会话（access + refresh + master）。所有登录方式共用，保证返回形状一致 */
  private async issueSession(userId: bigint, spaceId: bigint): Promise<LoginResult> {
    const [user] = await db.select().from(users).where(eq(users.id, userId));
    if (!user) throw new AppError(ErrorCode.INTERNAL, "user missing");
    if (user.status !== 1) throw new AppError(ErrorCode.FORBIDDEN, "账号已被停用");

    const access = this.tokens.issueAccess(String(userId), String(spaceId));
    const refreshToken = await this.tokens.issueRefresh(String(userId), String(spaceId));
    const master = await this.tokens.issueMaster(String(userId), String(spaceId));
    return {
      access_token: access.accessToken,
      expires_in: access.expiresIn,
      user: { id: String(user.id), nickname: user.nickname, avatar: user.avatarUri ?? null },
      space_id: String(spaceId),
      refresh_token: refreshToken,
      master_token: master.masterToken,
      master_expires_in: master.expiresIn,
    };
  }

  /**
   * 邮箱 + 密码注册（api-spec §33.6，第 130 批）：注册即登录。
   *
   * 为什么"注册即登录"而不是先发验证邮件：邮件通道同样依赖外部服务（且未接），
   * 若把首登卡在验证上，等于又造一条"上线即无人能登"的路。先落 `identities(provider=email)`
   * + `user_credentials`，邮件验证作为**后补**（AAL 提升时再做），不阻塞可用性。
   */
  async registerWithPassword(input: {
    email: string;
    password: string;
    inviteCode?: string;
    ageConfirmed?: boolean;
  }): Promise<LoginResult> {
    const email = normalizeEmail(input.email);
    if (!EMAIL_SHAPE.test(email)) {
      throw new AppError(ErrorCode.INVALID_PARAM, "邮箱格式不正确", { field: "email" });
    }
    const weak = passwordProblem(input.password, email);
    if (weak) throw new AppError(ErrorCode.INVALID_PARAM, weak, { field: "password" });

    /**
     * 服务端强制邀请码（第 131 批，2026-11-03）。
     *
     * 为什么是**服务端**而不是"前端必填"：注册端点是公开的，脚本一条 curl 就能绕过任何 UI 校验；
     * 而每个新账号会发 80 分新人礼包 —— 公网开放等于给刷分留了个免费口子。
     * 两种错误必须是**不同 msg**：用户要能分清"我没填"和"我填错了"，
     * 混成一句话会让"邀请码输错"看起来像"系统没让我填"。
     *
     * 开关：`AUTH_EMAIL_REQUIRE_INVITE`（默认 true）。等风控/额度策略就绪后可以只改 env 放开，
     * 不需要再动代码——这是刻意留的，避免"临时收紧"变成"永久硬编码"。
     */
    const inviteCode = (input.inviteCode ?? "").trim();
    if (env.AUTH_EMAIL_REQUIRE_INVITE && inviteCode === "") {
      throw new AppError(ErrorCode.INVALID_PARAM, "请填写邀请码", { field: "invite_code" });
    }

    if (input.ageConfirmed !== true) {
      throw new AppError(ErrorCode.INVALID_PARAM, "请确认已满 18 周岁", { field: "age_confirmed" });
    }

    const hash = hashIdentifier(email);
    const [existing] = await db
      .select()
      .from(identities)
      .where(and(eq(identities.provider, "email"), eq(identities.phoneHash, hash)));
    if (existing) {
      throw new AppError(ErrorCode.INVALID_PARAM, "该邮箱已注册，请直接登录", { field: "email" });
    }

    const created = await this.provisionAccount({
      provider: "email",
      identifierHash: hash,
      // 邮箱密文走**域分离**的通用密文：不复用 `encryptPhone` 的派生 key，
      // 否则"这份密文一定是手机号"这条不变量就不成立了。
      identifierCipher: encryptSecret(email),
      nickname: email.split("@")[0]!.slice(0, 20) || "用户",
      inviteCode: input.inviteCode,
      passwordHash: hashPassword(input.password),
    });

    if (env.SEED_SAMPLE_PROJECT) {
      await this.createSampleProject(created.sid).catch(() => undefined);
    }

    await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, created.uid));
    return this.issueSession(created.uid, created.sid);
  }

  /**
   * 密码登录（api-spec §33.6）：`identifier` 现在接受**邮箱**；手机号密码登录需先在
   * `user_credentials` 上有行（本期未开放，见 §9 排期），传入手机号会得到"账号或密码不正确"
   * ——**失败信息统一**是刻意的：区分"没这个账号"和"密码错"等于把注册过的邮箱交给攻击者枚举。
   */
  async loginWithPassword(input: { identifier: string; password: string; ip?: string }): Promise<LoginResult> {
    const raw = input.identifier.trim();
    if (raw === "") {
      throw new AppError(ErrorCode.INVALID_PARAM, "请输入邮箱", { field: "identifier" });
    }
    if (!raw.includes("@")) {
      // 手机号密码登录尚未开放：明确拒绝而不是静默落到短信路径（那会让前端以为密码登录成功）
      throw new AppError(ErrorCode.INVALID_PARAM, "手机号密码登录暂未开放，请用邮箱或验证码登录", {
        field: "identifier",
      });
    }
    const email = normalizeEmail(raw);
    const hash = hashIdentifier(email);

    /**
     * 失败限流（SEC-04，2026-11-03）：`<namespace>:login:fail:<identifier 哈希>:<ip>`。
     *
     * 为什么必须有：`POST /v1/auth/login/password` 是**唯一无验证码、无短信成本**的凭据入口，
     * 露天放着等于给撞库留一个"随便试"的口子；短信路径有 Redis 计数，这条此前没有。
     * 两个维度拼（账号哈希 + IP）与 admin 登录同口径：只按账号能被用来锁死他人，
     * 只按 IP 能被僵尸网络绕过。
     * key 里用**标识符哈希**而不是邮箱明文：Redis 常被 dump/排查，不该顺手带走账号清单。
     *
     * 计数是旁路：Redis 抖动时退化为不限流，**绝不**因为计数失败而拒绝一次正确的密码。
     */
    const failKey = `auth:login:fail:${hashIdentifier(email)}:${input.ip && input.ip !== "" ? input.ip : "unknown"}`;
    let failures = 0;
    try {
      failures = Number(await this.redis.get(failKey)) || 0;
    } catch {
      // fail-open：计数读不到就不限流（可用性优先），但**必须留下可观测痕迹**——
      // 否则"Redis 挂着、防护静默消失"这件事没有任何指标能看出来（Ops 的 P2）。
      bumpCounter(COUNTER_RATE_LIMIT_UNAVAILABLE);
      failures = 0;
    }
    if (failures >= LOGIN_MAX_FAILURES) {
      throw new AppError(ErrorCode.RATE_LIMITED, "登录失败次数过多，请稍后再试");
    }
    const recordFailure = async (): Promise<void> => {
      try {
        await this.redis.incrWithTtl(failKey, LOGIN_FAIL_TTL_S);
      } catch {
        // 同上：写不进计数也要让"防护没生效"可见
        bumpCounter(COUNTER_RATE_LIMIT_UNAVAILABLE);
        // 计数写失败不影响"这次登录失败"的判定
      }
    };

    const [identity] = await db
      .select()
      .from(identities)
      .where(and(eq(identities.provider, "email"), eq(identities.phoneHash, hash)));

    const badCredentials = new AppError(ErrorCode.UNAUTHORIZED, "账号或密码不正确");
    if (!identity) {
      // 与"密码错"同一条错误、同一条路径：不做提前返回，避免时序差异被用来枚举账号
      verifyPassword(input.password, hashPassword("timing-equalizer"));
      await recordFailure();
      throw badCredentials;
    }
    const [credential] = await db
      .select()
      .from(userCredentials)
      .where(eq(userCredentials.userId, identity.userId));
    if (!credential || !verifyPassword(input.password, credential.passwordHash)) {
      await recordFailure();
      throw badCredentials;
    }

    const [space] = await db.select().from(spaces).where(eq(spaces.ownerUserId, identity.userId));
    if (!space) throw new AppError(ErrorCode.INTERNAL, "user space missing");
    // 成功即清零：避免"输错几次后正确登录，计数仍挂在那里"把账号拖进冷却
    try {
      await this.redis.del(failKey);
    } catch {
      // 忽略：清计数失败只会多保留一次失败窗口
    }
    await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, identity.userId));
    return this.issueSession(identity.userId, space.id);
  }

  /**
   * 第三方登录：按 `(provider, external_id)` 绑定既有 identities，没有则建号。
   *
   * 与手机号登录共用同一套"建号骨架"（users → spaces → space_members → credit_accounts →
   * identities + 新人礼包），差别只有两点，都是照竞品行为来的：
   * 1. 没有邀请码/成年确认参数（第三方渠道拿不到这些，竞品也是首登后再补）；
   * 2. `provider`/`external_id` 落 identities，同一外部账号二次登录必须命中**同一个**用户
   *    （否则用户会发现自己"每次登录都是新号"——这是 SSO 最常见的线上事故）。
   */
  async loginWithOAuth(
    provider: string,
    profile: { external_id: string; nickname: string; avatar: string | null },
  ): Promise<OauthLoginResult> {
    const findIdentity = async () =>
      (
        await db
          .select()
          .from(identities)
          .where(and(eq(identities.provider, provider), eq(identities.externalId, profile.external_id)))
      )[0];

    let identity = await findIdentity();
    let created = false;
    if (!identity) {
      try {
        identity = await db.transaction(async (tx) => {
          const uid = newId();
          const sid = newId();
          await tx.insert(users).values({
            id: uid,
            nickname: profile.nickname.slice(0, 40),
            avatarUri: profile.avatar,
          });
          await tx.insert(spaces).values({ id: sid, ownerUserId: uid });
          await tx.insert(spaceMembers).values({ spaceId: sid, userId: uid, role: 1 });
          await tx.insert(creditAccounts).values({ spaceId: sid });
          const [inserted] = await tx
            .insert(identities)
            .values({
              id: newId(),
              userId: uid,
              provider,
              externalId: profile.external_id,
            })
            .returning();
          if (env.GIFT_CREDITS > 0) {
            await creditIn(tx, { spaceId: sid, amount: env.GIFT_CREDITS, kind: "gift", memo: "signup gift" });
          }
          if (env.SEED_SAMPLE_PROJECT) {
            // 与手机号注册一致：新号给示例作品；失败不影响登录
            await this.createSampleProjectInTx(tx, sid).catch(() => undefined);
          }
          return inserted;
        });
        created = true;
      } catch (error) {
        // 并发回调：两个请求同时建号时唯一键会冲突，失败方回读既有的那条（幂等登录）
        const again = await findIdentity();
        if (!again) throw error;
        identity = again;
        created = false;
      }
    }

    const userId = identity.userId;
    const [user] = await db.select().from(users).where(eq(users.id, userId));
    if (!user) throw new AppError(ErrorCode.INTERNAL, "user missing");
    if (user.status !== 1 || user.deletedAt) {
      throw new AppError(ErrorCode.UNAUTHORIZED, "account disabled");
    }
    const [space] = await db.select().from(spaces).where(eq(spaces.ownerUserId, userId));
    if (!space) throw new AppError(ErrorCode.INTERNAL, "user space missing");

    const access = this.tokens.issueAccess(String(userId), String(space.id));
    const refreshToken = await this.tokens.issueRefresh(String(userId), String(space.id));
    const master = await this.tokens.issueMaster(String(userId), String(space.id));
    return {
      access_token: access.accessToken,
      expires_in: access.expiresIn,
      user: { id: String(user.id), nickname: user.nickname, avatar: user.avatarUri ?? null },
      space_id: String(space.id),
      refresh_token: refreshToken,
      master_token: master.masterToken,
      master_expires_in: master.expiresIn,
      created,
      provider,
    };
  }

  /**
   * 静默续期（`POST /auth/renew`）：**只**用 master token 换一枚新 access。
   *
   * 与 `/auth/refresh` 的分工（两条都要存在，竞品也是双通道）：
   * - `/auth/refresh`：Cookie 里的 refresh token，**轮换**（一次性），能改会话；
   * - `/auth/renew`：Body 里的 master token，**不轮换**，只续 access。
   *
   * 为什么续期要"轻量"：SPA 打开新标签页/定时器续命时，每 10 分钟轮换 refresh 会让
   * 并发请求互相把对方的 refresh 作废（经典竞态）。续 access 不动会话就没有这个问题。
   * master 不能直接用于业务端点：`AuthGuard` 只认 `typ=access`，master 会被 401。
   */
  async renew(masterToken: string | undefined, refreshCookie?: string): Promise<{ access_token: string; expires_in: number }> {
    if (masterToken) {
      const payload = this.tokens.verifyMaster(masterToken);
      await this.tokens.assertMasterActive(payload.sub, payload.jti);
      const [user] = await db.select().from(users).where(eq(users.id, BigInt(payload.sub)));
      if (!user || user.status !== 1 || user.deletedAt) {
        throw new AppError(ErrorCode.UNAUTHORIZED, "account disabled");
      }
      const access = this.tokens.issueAccess(payload.sub, payload.sid);
      return { access_token: access.accessToken, expires_in: access.expiresIn };
    }
    if (refreshCookie) {
      // 降级通道：老客户端只有 Cookie 时也能续（不消费、不轮换 refresh）。
      //
      // P1-8：这条通道**必须**同样校验撤销状态。此前只 `verifyRefresh` 就发 access，
      // 等于「登出/改密后，被窃的 refresh cookie 仍可在 14 天有效期内无限续 access」——
      // 不可撤销的长期凭据。校验用 `assertRefreshActive`（只读不消费：续期不能互相作废）。
      const payload = this.tokens.verifyRefresh(refreshCookie);
      await this.tokens.assertRefreshActive(payload.sub, payload.jti);
      const [user] = await db.select().from(users).where(eq(users.id, BigInt(payload.sub)));
      if (!user || user.status !== 1 || user.deletedAt) {
        throw new AppError(ErrorCode.UNAUTHORIZED, "account disabled");
      }
      const access = this.tokens.issueAccess(payload.sub, payload.sid);
      return { access_token: access.accessToken, expires_in: access.expiresIn };
    }
    throw new AppError(ErrorCode.UNAUTHORIZED, "missing master token");
  }


  // 账号注销（PRD F1）：立即停用登录、任务记录脱敏、30 天后物理清理
  async deleteAccount(userId: string, spaceId: string): Promise<{ ok: true; purge_after: string }> {
    const deletedAt = new Date();
    const purgeAfter = new Date(deletedAt.getTime() + 30 * 86_400_000);
    await db.transaction(async (tx) => {
      // 身份解绑（允许同手机号重新注册）
      await tx
        .update(identities)
        .set({ phoneHash: null, phoneCipher: null, externalId: null, updatedAt: deletedAt })
        .where(eq(identities.userId, BigInt(userId)));
      // 账号停用
      await tx
        .update(users)
        .set({ status: 2, nickname: "已注销用户", avatarUri: null, deletedAt, updatedAt: deletedAt })
        .where(eq(users.id, BigInt(userId)));
      // 任务记录脱敏前先释放冻结（PR-06）。
      //
      // 顺序不能反：先按流水 unfreeze、再置 status=5，流水与账户才同向变动。
      // 只加一句 `creditsFrozen: 0` 会把「这笔钱还悬着」这个事实抹掉，流水与字段永久对不上，
      // 而 auditLedger 的不平判据（`a.frozen <> Σ f.frozen_delta`）两边仍相等 → 全库对账永远查不出来。
      const holding = await tx
        .select({ id: tasks.id, spaceId: tasks.spaceId })
        .from(tasks)
        .where(and(eq(tasks.userId, BigInt(userId)), gt(tasks.creditsFrozen, 0)));
      for (const t of holding) {
        await releaseFrozen(tx, {
          spaceId: t.spaceId,
          taskId: t.id,
          disposition: "unfreeze",
          memo: "account deleted unfreeze",
        });
      }
      // 任务记录脱敏：清空输入与结果，保留计数用于对账
      await tx
        .update(tasks)
        .set({ input: { redacted: true }, results: [], status: 5, finishedAt: deletedAt, updatedAt: deletedAt })
        .where(eq(tasks.userId, BigInt(userId)));
      // 空间成员关系解除
      await tx.delete(spaceMembers).where(eq(spaceMembers.spaceId, BigInt(spaceId)));
      await tx.delete(spaceMembers).where(eq(spaceMembers.userId, BigInt(userId)));
    });
    return { ok: true, purge_after: purgeAfter.toISOString() };
  }

  async me(userId: string, spaceId: string) {
    const [user] = await db.select().from(users).where(eq(users.id, BigInt(userId)));
    const [space] = await db.select().from(spaces).where(eq(spaces.id, BigInt(spaceId)));
    const [account] = await db
      .select()
      .from(creditAccounts)
      .where(eq(creditAccounts.spaceId, BigInt(spaceId)));
    if (!user || !space || !account) throw new AppError(ErrorCode.NOT_FOUND, "account not found");
    const bindings = await this.bindingsOf(userId);
    return {
      user: {
        id: String(user.id),
        nickname: user.nickname,
        avatar_uri: user.avatarUri ?? null,
        /** 账号级语言偏好；空串=未设置（前端按 cookie/浏览器兜底） */
        preferred_locale: user.preferredLocale ?? "",
      },
      space: { id: String(space.id), name: space.name },
      credits: { balance: account.balance, frozen: account.frozen },
      vip: null,
      /** 新手引导是否已关闭（PRD 增补 §3）：false 时工作台展示引导条 */
      onboarded: user.onboardedAt !== null,
      bindings,
    };
  }

  private async bindingsOf(userId: string) {
    const rows = await db
      .select({ provider: identities.provider, phoneCipher: identities.phoneCipher, externalId: identities.externalId })
      .from(identities)
      .where(eq(identities.userId, BigInt(userId)));
    const phone = rows.find((row) => row.provider === "phone" && row.phoneCipher);
    const external = rows
      .filter((row) => row.provider !== "phone" && row.externalId)
      .map((row) => row.provider)
      .sort();
    return {
      phone: phone ? maskPhone(decryptPhone(phone.phoneCipher!)) : null,
      providers: external,
    };
  }

  /**
   * 已登录账号绑定手机号。只做"绑到当前账号"，不自动合并两个既有账号——
   * 无法证明两个账号属于同一人时自动合并会成为账号劫持入口。
   */
  async bindPhone(userId: string, phone: string, code: string) {
    await this.sms.verify(phone, code);
    const hash = hashPhone(phone);
    await db.transaction(async (tx) => {
      const rows = await tx
        .select()
        .from(identities)
        .where(and(eq(identities.provider, "phone"), eq(identities.phoneHash, hash)))
        .for("update");
      const existing = rows[0];
      if (existing && String(existing.userId) !== userId) {
        throw new AppError(ErrorCode.INVALID_PARAM, "该手机号已绑定其他账号，不能自动合并", {
          reason: "identity_already_bound",
          field: "phone",
        });
      }
      const own = await tx
        .select()
        .from(identities)
        .where(and(eq(identities.userId, BigInt(userId)), eq(identities.provider, "phone")))
        .for("update");
      if (!existing && own[0]) {
        throw new AppError(ErrorCode.INVALID_PARAM, "当前账号已绑定其他手机号", {
          reason: "phone_already_bound",
          field: "phone",
        });
      }
      if (!existing) {
        await tx.insert(identities).values({
          id: newId(),
          userId: BigInt(userId),
          provider: "phone",
          phoneHash: hash,
          phoneCipher: encryptPhone(phone),
        });
      }
    });
    return { bound: true, phone: maskPhone(phone), bindings: await this.bindingsOf(userId) };
  }

  /** 已登录账号绑定第三方渠道；同一渠道只允许绑定一个外部账号。 */
  async bindOAuth(
    userId: string,
    provider: string,
    profile: { external_id: string; nickname: string; avatar: string | null },
  ) {
    await db.transaction(async (tx) => {
      const rows = await tx
        .select()
        .from(identities)
        .where(and(eq(identities.provider, provider), eq(identities.externalId, profile.external_id)))
        .for("update");
      const existing = rows[0];
      if (existing && String(existing.userId) !== userId) {
        throw new AppError(ErrorCode.INVALID_PARAM, "该渠道账号已绑定其他账号，不能自动合并", {
          reason: "identity_already_bound",
          field: "provider",
        });
      }
      const own = await tx
        .select()
        .from(identities)
        .where(and(eq(identities.userId, BigInt(userId)), eq(identities.provider, provider)))
        .for("update");
      if (!existing && own[0]) {
        throw new AppError(ErrorCode.INVALID_PARAM, "当前账号已绑定该渠道的其他账号", {
          reason: "provider_already_bound",
          field: "provider",
        });
      }
      if (!existing) {
        await tx.insert(identities).values({
          id: newId(),
          userId: BigInt(userId),
          provider,
          externalId: profile.external_id,
        });
      }
    });
    return { bound: true, provider, bindings: await this.bindingsOf(userId) };
  }

  /**
   * 保存账号级语言偏好（跨设备跟随账号）。
   * 只接受受支持的 5 语言；传空串表示清除（回到"跟随设备"）。
   * 与 cookie 的关系：本接口只写库，cookie 仍由前端即时写入，二者不互相覆盖。
   */
  async setPreferredLocale(userId: string, locale: string): Promise<{ preferred_locale: string }> {
    const allowed = ["", "zh-CN", "en", "ja", "pt-BR", "es"];
    if (!allowed.includes(locale)) throw new AppError(ErrorCode.INVALID_PARAM, "unsupported locale");
    await db
      .update(users)
      .set({ preferredLocale: locale, updatedAt: new Date() })
      .where(eq(users.id, BigInt(userId)));
    return { preferred_locale: locale };
  }

  /**
   * 更新账号资料（第 85 批：竞品 `POST /web/v1/user-info`）。
   *
   * 只认 nickname / avatar_uri 两个字段，且都是"给了才改"（PATCH 语义）：
   * 竞品这条虽然是 POST，但两个 schema 都是 `{}`，没有字段证据，
   * 所以按最常见的"改资料"语义实现，未知字段由 zod 静默剥掉（不 500、也不假装支持）。
   * avatar_uri 传 null 或空串都表示清空头像。
   */
  async updateProfile(
    userId: string,
    input: { nickname?: string; avatar_uri?: string | null },
  ): Promise<{
    user: { id: string; nickname: string; avatar_uri: string | null; preferred_locale: string };
  }> {
    const patch: { nickname?: string; avatarUri?: string | null; updatedAt: Date } = {
      updatedAt: new Date(),
    };
    if (input.nickname !== undefined) {
      const nickname = input.nickname.trim();
      if (!nickname) {
        throw new AppError(ErrorCode.INVALID_PARAM, "nickname is required", { field: "nickname" });
      }
      if (nickname.length > 40) {
        throw new AppError(ErrorCode.INVALID_PARAM, "nickname is too long", { field: "nickname" });
      }
      patch.nickname = nickname;
    }
    if (input.avatar_uri !== undefined) {
      const uri = input.avatar_uri === null ? null : input.avatar_uri.trim();
      if (uri !== null && uri.length > 512) {
        throw new AppError(ErrorCode.INVALID_PARAM, "avatar_uri is too long", { field: "avatar_uri" });
      }
      patch.avatarUri = uri ? uri : null;
    }
    if (patch.nickname === undefined && patch.avatarUri === undefined) {
      throw new AppError(ErrorCode.INVALID_PARAM, "nothing to update", { field: "body" });
    }
    const [row] = await db
      .update(users)
      .set(patch)
      .where(eq(users.id, BigInt(userId)))
      .returning();
    if (!row) throw new AppError(ErrorCode.NOT_FOUND, "account not found");
    return {
      user: {
        id: String(row.id),
        nickname: row.nickname,
        avatar_uri: row.avatarUri ?? null,
        preferred_locale: row.preferredLocale ?? "",
      },
    };
  }

  /**
   * 读取账号设置（第 85 批：竞品 `GET /web/v1/user-settings?scope_type=&keys=`）。
   *
   * 存储形状 `{ [scope_type]: { [key]: value } }`（见 `packages/db` 里 users.settings 的注释）。
   * `keys` 是逗号分隔的键清单（竞品 query 名就是这个）：给了就只回这些键，
   * 上限 20 个 —— 这个接口是客户端启动时取少量配置用的，不是批量导出。
   */
  async readSettings(
    userId: string,
    scopeType?: string,
    keys?: string | string[],
  ): Promise<{ scope_type: string; settings: Record<string, unknown> }> {
    const scope = this.settingsScope(scopeType);
    const bag = await this.settingsBagOf(userId);
    const all = bag[scope] ?? {};
    const wanted = this.settingsKeys(keys);
    const settings: Record<string, unknown> = {};
    if (wanted) {
      for (const key of wanted) if (key in all) settings[key] = all[key];
    } else {
      Object.assign(settings, all);
    }
    return { scope_type: scope, settings };
  }

  /**
   * 合并写入账号设置（第 85 批：竞品 `PUT /web/v1/user-settings`）。
   *
   * 语义是**按键合并**而不是整体替换：不同页面各写各的键（引导条、通知、播放偏好…），
   * 整体替换会让后写的页面把别的页面刚写的设置抹掉。
   * 返回 `updated` 让客户端知道哪些键真的落库了（而不是"我发了一堆，鬼知道存了几个"）。
   */
  async mergeSettings(
    userId: string,
    scopeType: string | undefined,
    patch: Record<string, unknown>,
  ): Promise<{
    scope_type: string;
    updated: string[];
    settings: Record<string, unknown>;
  }> {
    const scope = this.settingsScope(scopeType);
    const keys = Object.keys(patch);
    if (keys.length === 0) {
      throw new AppError(ErrorCode.INVALID_PARAM, "settings patch is empty", { field: "settings" });
    }
    if (keys.length > 40) {
      throw new AppError(ErrorCode.INVALID_PARAM, "too many settings in one call", {
        field: "settings",
      });
    }
    for (const key of keys) {
      if (key.length === 0 || key.length > 60) {
        throw new AppError(ErrorCode.INVALID_PARAM, "invalid setting key", { field: "settings" });
      }
      if (JSON.stringify(patch[key] ?? null).length > 4096) {
        throw new AppError(ErrorCode.INVALID_PARAM, `setting "${key}" is too large`, {
          field: "settings",
        });
      }
    }
    const bag = await this.settingsBagOf(userId);
    const next = { ...(bag[scope] ?? {}), ...patch };
    await db
      .update(users)
      .set({ settings: { ...bag, [scope]: next }, updatedAt: new Date() })
      .where(eq(users.id, BigInt(userId)));
    return { scope_type: scope, updated: keys, settings: next };
  }

  /** scope_type 归一：缺省 `default`；只接受 `[a-z][a-z0-9_:-]{0,31}`（它会被写进 jsonb 的键） */
  private settingsScope(raw?: string): string {
    const scope = (raw ?? "").trim() || "default";
    if (!/^[a-z][a-z0-9_:-]{0,31}$/.test(scope)) {
      throw new AppError(ErrorCode.INVALID_PARAM, "invalid scope_type", { field: "scope_type" });
    }
    return scope;
  }

  /** `keys=a,b,c` 解析；空串/只逗号 → 不过滤（返回 null）。上限 20 项（第 120 批与正文列表同一口径） */
  private settingsKeys(raw?: string | string[]): string[] | null {
    if (raw === undefined) return null;
    const keys = parseListParam(raw, "keys", MAX_TAG_ITEMS) ?? [];
    return keys.length > 0 ? keys : null;
  }

  /**
   * 读出 `users.settings` 并规整成 `{ [scope]: { [key]: value } }`。
   * 库里可能被历史数据写成非对象（jsonb 不校验形状），这里一律当空处理而不是抛错 ——
   * 设置项坏掉不该让人登不进来。
   */
  private async settingsBagOf(userId: string): Promise<Record<string, Record<string, unknown>>> {
    const [row] = await db
      .select({ settings: users.settings })
      .from(users)
      .where(eq(users.id, BigInt(userId)));
    if (!row) throw new AppError(ErrorCode.NOT_FOUND, "account not found");
    const raw = row.settings;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    const bag: Record<string, Record<string, unknown>> = {};
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      if (value && typeof value === "object" && !Array.isArray(value)) {
        bag[key] = { ...(value as Record<string, unknown>) };
      }
    }
    return bag;
  }

  /** 标记新手引导已读（关闭引导条时调用，幂等） */
  async markOnboarded(userId: string): Promise<{ onboarded: boolean }> {
    await db
      .update(users)
      .set({ onboardedAt: new Date(), updatedAt: new Date() })
      .where(eq(users.id, BigInt(userId)));
    return { onboarded: true };
  }

  async refresh(refreshToken: string | undefined): Promise<Omit<LoginResult, "refresh_token"> & { refresh_token: string }> {
    if (!refreshToken) throw new AppError(ErrorCode.UNAUTHORIZED, "missing refresh token");
    const payload = this.tokens.verifyRefresh(refreshToken);
    const ok = await this.tokens.consumeRefresh(payload.sub, payload.jti);
    if (!ok) throw new AppError(ErrorCode.UNAUTHORIZED, "refresh token reused or revoked");

    const access = this.tokens.issueAccess(payload.sub, payload.sid);
    const nextRefresh = await this.tokens.issueRefresh(payload.sub, payload.sid);
    // 会话轮换时同步轮换 master（每人单枚 master 的语义：新会话生效，旧会话的 master 失效）
    const master = await this.tokens.issueMaster(payload.sub, payload.sid);
    const [user] = await db.select().from(users).where(eq(users.id, BigInt(payload.sub)));
    return {
      access_token: access.accessToken,
      expires_in: access.expiresIn,
      user: user
        ? { id: String(user.id), nickname: user.nickname, avatar: user.avatarUri ?? null }
        : { id: payload.sub, nickname: "", avatar: null },
      space_id: payload.sid,
      refresh_token: nextRefresh,
      master_token: master.masterToken,
      master_expires_in: master.expiresIn,
    };
  }

  async logout(userId: string, jti: string): Promise<void> {
    await this.tokens.blacklistAccess(jti);
    await this.tokens.revokeRefresh(userId);
    await this.tokens.revokeMaster(userId);
  }

  async waitlist(phone: string, source: string): Promise<{ position: number }> {
    const hash = hashPhone(phone);
    await db
      .insert(waitlistEntries)
      .values({ id: newId(), phoneHash: hash, source })
      .onConflictDoNothing({ target: waitlistEntries.phoneHash });
    const [row] = await db.select({ count: sql<number>`count(*)::int` }).from(waitlistEntries);
    return { position: row?.count ?? 0 };
  }
}
