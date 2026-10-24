import { Inject, Injectable } from "@nestjs/common";
import { and, eq, sql } from "drizzle-orm";
import {
  creditAccounts,
  creditIn,
  episodes,
  identities,
  inviteCodes,
  inviteRedemptions,
  projectAssets,
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

export interface LoginResult {
  access_token: string;
  expires_in: number;
  user: { id: string; nickname: string; avatar: string | null };
  space_id: string;
  refresh_token: string;
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
   */
  private async createSampleProject(spaceId: bigint): Promise<void> {
    const projectId = newId();
    await db.insert(scriptProjects).values({
      id: projectId,
      spaceId,
      title: "示例：雨夜来信",
      genre: "悬疑",
      dramaType: 2,
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
      await db.insert(episodes).values({
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
      await db.insert(projectAssets).values({
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
        await tx.insert(users).values({ id: uid, nickname: `用户${phone.slice(-4)}` });
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
    return {
      access_token: access.accessToken,
      expires_in: access.expiresIn,
      user: { id: String(user.id), nickname: user.nickname, avatar: user.avatarUri ?? null },
      space_id: String(spaceId),
      refresh_token: refreshToken,
    };
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
      user: { id: String(user.id), nickname: user.nickname, avatar_uri: user.avatarUri ?? null },
      space: { id: String(space.id), name: space.name },
      credits: { balance: account.balance, frozen: account.frozen },
      vip: null,
      /** 新手引导是否已关闭（PRD 增补 §3）：false 时工作台展示引导条 */
      onboarded: user.onboardedAt !== null,
    };
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
    const [user] = await db.select().from(users).where(eq(users.id, BigInt(payload.sub)));
    return {
      access_token: access.accessToken,
      expires_in: access.expiresIn,
      user: user
        ? { id: String(user.id), nickname: user.nickname, avatar: user.avatarUri ?? null }
        : { id: payload.sub, nickname: "", avatar: null },
      space_id: payload.sid,
      refresh_token: nextRefresh,
    };
  }

  async logout(userId: string, jti: string): Promise<void> {
    await this.tokens.blacklistAccess(jti);
    await this.tokens.revokeRefresh(userId);
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
