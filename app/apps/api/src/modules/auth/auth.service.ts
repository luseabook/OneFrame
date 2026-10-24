import { Inject, Injectable } from "@nestjs/common";
import { and, eq, sql } from "drizzle-orm";
import {
  creditAccounts,
  creditIn,
  identities,
  inviteCodes,
  inviteRedemptions,
  spaceMembers,
  spaces,
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

  sendCode(phone: string): Promise<{ debug_code?: string }> {
    return this.sms.send(phone);
  }

  async login(phone: string, code: string, inviteCode?: string): Promise<LoginResult> {
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
    };
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
