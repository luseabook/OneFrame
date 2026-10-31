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
  users,
  waitlistEntries,
} from "@app/db";
import { AppError, ErrorCode, newId } from "@app/shared";
import { env } from "../../config/env";
import { db } from "../../db/database";
import { encryptPhone, hashPhone } from "./crypto";
import { SmsService } from "./sms.service";
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
      const created = await db.transaction(async (tx) => {
        const uid = newId();
        const sid = newId();
        // 合规留痕（compliance launch-checklist B3/C3）：建号即记录成年确认时间，
        // 用于举证「已确认年满 18 周岁」，而不只是靠请求参数临时校验。
        await tx.insert(users).values({
          id: uid,
          nickname: `用户${phone.slice(-4)}`,
          ageDeclaredAt: new Date(),
        });
        await tx.insert(spaces).values({ id: sid, ownerUserId: uid });
        await tx.insert(spaceMembers).values({ spaceId: sid, userId: uid, role: 1 });
        await tx.insert(creditAccounts).values({ spaceId: sid });
        await tx.insert(identities).values({
          id: newId(),
          userId: uid,
          provider: "phone",
          phoneHash: hash,
          phoneCipher: encryptPhone(phone),
        });

        if (env.GIFT_CREDITS > 0) {
          await creditIn(tx, {
            spaceId: sid,
            amount: env.GIFT_CREDITS,
            kind: "gift",
            memo: "signup gift",
          });
        }

        if (inviteCode) {
          const [invite] = await tx
            .select()
            .from(inviteCodes)
            .where(eq(inviteCodes.code, inviteCode))
            .for("update");
          const valid =
            invite &&
            invite.status === 1 &&
            invite.usedCount < invite.maxUses &&
            (!invite.expiresAt || invite.expiresAt.getTime() > Date.now());
          if (!valid) {
            throw new AppError(ErrorCode.INVALID_PARAM, "邀请码无效或已用尽", { field: "invite_code" });
          }
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
        } else if (env.AUTH_REQUIRE_INVITE) {
          throw new AppError(ErrorCode.INVALID_PARAM, "Alpha 期需要邀请码", { field: "invite_code" });
        }

        return { uid, sid };
      });
      userId = created.uid;
      spaceId = created.sid;

      // 新用户赠一个示例作品（PRD 增补 §3.2）：含大纲与角色，可直接体验投递
      if (env.SEED_SAMPLE_PROJECT) {
        await this.createSampleProject(spaceId).catch(() => undefined);
      }
    }

    const [user] = await db.select().from(users).where(eq(users.id, userId));
    if (!user) throw new AppError(ErrorCode.INTERNAL, "user missing");

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
    };
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
    keys?: string,
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

  /** `keys=a,b,c` 解析；空串/只逗号 → 不过滤（返回 null） */
  private settingsKeys(raw?: string): string[] | null {
    if (raw === undefined) return null;
    const keys = raw
      .split(",")
      .map((key) => key.trim())
      .filter((key) => key.length > 0);
    if (keys.length > 20) {
      throw new AppError(ErrorCode.INVALID_PARAM, "too many keys", { field: "keys" });
    }
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
