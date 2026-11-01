import { randomInt } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { and, asc, desc, eq, ilike, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { identities, inviteCodes, inviteRedemptions, spaces, users, waitlistEntries } from "@app/db";
import { AppError, ErrorCode, newId } from "@app/shared";
import { db } from "../../db/database";
import { decryptPhone, hashPhone } from "../auth/crypto";

// ── 通用小工具 ─────────────────────────────────────────────

function pageArgs(page?: number, pageSize?: number) {
  const p = Math.max(1, page ?? 1);
  const ps = Math.min(100, Math.max(1, pageSize ?? 20));
  return { page: p, pageSize: ps };
}

/** 分页信封：全部端点统一 `{list,total,page,page_size}`（前端分页组件的唯一输入） */
function pageEnvelope<T>(list: T[], total: number, page: number, pageSize: number) {
  return { list, total, page, page_size: pageSize };
}

/**
 * 路径参数里的 id 来自 URL，一定先 `BigInt()` 再落库查询：
 * 直接传字符串在 drizzle 下会抛类型错，最终变成 500——而它其实是调用方参数错。
 *
 * 额外限制 1..19 位纯数字：`users.id`/`invite_codes.id` 是 int8，
 * 超过 19 位会在 PG 侧以 22003（out of range）报错并冒成 500。
 * 这种值一定不是合法 id，按参数错误返回更快也更准确。
 */
function parseId(id: string, field: string): bigint {
  if (!/^\d{1,19}$/.test(id)) {
    throw new AppError(ErrorCode.INVALID_PARAM, `invalid ${field}`, { field });
  }
  return BigInt(id);
}

/** Postgres 外键冲突：删除邀请码时核销记录若已先行提交，按"已核销"拒绝而不是冒成 500 */
const PG_FOREIGN_KEY_VIOLATION = "23503";

/** 从驱动/drizzle 包装过的错误里取 SQLSTATE（与 audit 重试同一形状：code 或 cause.code） */
function isForeignKeyViolation(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  if ((err as { code?: unknown }).code === PG_FOREIGN_KEY_VIOLATION) return true;
  const cause = (err as { cause?: unknown }).cause;
  return !!cause && typeof cause === "object" && (cause as { code?: unknown }).code === PG_FOREIGN_KEY_VIOLATION;
}

/** 审计/归属里存的是 admin_users.id，可能为 null（历史数据/系统生成） */
function adminIdOrNull(adminId?: string): bigint | null {
  if (!adminId) return null;
  try {
    return BigInt(adminId);
  } catch {
    return null;
  }
}

const PHONE_MASK_HEAD = 3;
const PHONE_MASK_TAIL = 4;

/**
 * 手机号打码：`13812341234` → `138****1234`。
 *
 * 后台只能看到打码值（契约 §2.1）：客服排查用不到完整号码，而一份完整的手机号清单
 * 一旦被导出就是一次个人信息泄露。太短的异常值整串打码——`1****2345` 这种
 * "打码后长度还等于原值"的输出没有任何屏蔽意义。
 */
export function maskPhone(phone: string): string | null {
  const value = phone.trim();
  if (!value) return null;
  if (value.length <= PHONE_MASK_HEAD + PHONE_MASK_TAIL) return "*".repeat(value.length);
  const hidden = "*".repeat(value.length - PHONE_MASK_HEAD - PHONE_MASK_TAIL);
  return `${value.slice(0, PHONE_MASK_HEAD)}${hidden}${value.slice(-PHONE_MASK_TAIL)}`;
}

// ── DTO ───────────────────────────────────────────────────

export interface AdminUserDto {
  id: string;
  nickname: string;
  avatar_uri: string | null;
  status: number;
  deleted_at: string | null;
  last_login_at: string | null;
  created_at: string;
  /** 打码手机号（`138****1234`）；没有绑定手机号或密文解不开时 null */
  phone_masked: string | null;
  /** 个人空间 id（`spaces.owner_user_id = users.id`）；没有空间时 null */
  space_id: string | null;
}

export interface AdminWaitlistDto {
  id: string;
  /** 手机号 HMAC 前 10 位 + `…`；平台没有明文手机号，不能伪造出"手机号"这个字段 */
  phone_hash_prefix: string;
  source: string;
  invited_at: string | null;
  created_at: string;
}

export interface InviteCodeDto {
  id: string;
  code: string;
  credits: number;
  max_uses: number;
  used_count: number;
  expires_at: string | null;
  status: number;
  created_by: string | null;
  created_at: string;
}

// ── 邀请码纯函数 ───────────────────────────────────────────

/**
 * 运营发码用的字母表：去掉 `0/O/1/I/L` 等易混字符。
 *
 * 邀请码的实际使用场景是"运营念给/截图发给用户，用户手输"，
 * 一个 `0` 与 `O` 的歧义就会变成一次"码不存在"的客诉。32 个字符 × 8 位 = 40 bit 熵，
 * 配合唯一索引与重试，碰撞概率可以忽略。
 */
export const INVITE_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const INVITE_CODE_LENGTH = 8;
/** 撞码重试次数：40bit 空间下连续 5 次撞值几乎只可能发生在"唯一索引已被打满"的异常态 */
export const INVITE_CODE_MAX_ATTEMPTS = 5;

/**
 * 生成一个邀请码（**纯函数**，无 DB / 无 IO，供无库单测）。
 *
 * `pick` 可注入是为了让单测能确定性断言（恒取 0 → `AAAAAAAA`）；
 * 生产默认 `crypto.randomInt`：不能用 `Math.random()`——码可预测等于码可被盗用。
 */
export function generateInviteCode(pick: (maxExclusive: number) => number = randomInt): string {
  let code = "";
  for (let index = 0; index < INVITE_CODE_LENGTH; index += 1) {
    code += INVITE_CODE_ALPHABET[pick(INVITE_CODE_ALPHABET.length)];
  }
  return code;
}

/**
 * 邀请码的对外状态：1 有效 / 2 停用 / 3 耗尽。
 *
 * 为什么"耗尽"是派生而不是写库：`used_count` 才是事实，`status=3` 只是它的投影。
 * 若把 3 写进库，就必须在每次核销时同步维护，漏一处就会出现"库里有效、实际用不了"。
 * 这里只在**呈现**时把"已用满的有效码"报成 3，运营看到的状态与能不能发出去永远一致。
 */
function inviteCodeStatus(row: typeof inviteCodes.$inferSelect): number {
  if (row.status === 1 && row.maxUses > 0 && row.usedCount >= row.maxUses) return 3;
  return row.status;
}

function toInviteCodeDto(row: typeof inviteCodes.$inferSelect): InviteCodeDto {
  return {
    id: String(row.id),
    code: row.code,
    credits: row.credits,
    max_uses: row.maxUses,
    used_count: row.usedCount,
    expires_at: row.expiresAt ? row.expiresAt.toISOString() : null,
    status: inviteCodeStatus(row),
    created_by: row.createdBy === null ? null : String(row.createdBy),
    created_at: row.createdAt.toISOString(),
  };
}

/**
 * P2 运营后台的"人"与"码"：用户管理 / 等待名单 / 邀请码（契约 §2.1–§2.3）。
 *
 * 与 `AdminOpsController`（管理员账号/审计/配置）拆开的原因是**数据域不同**：
 * 这里全部围绕 `users/spaces/waitlist_entries/invite_codes` 这几张用户侧表，
 * 后台对它们是"只读为主 + 少量运营动作"；而运维面（配置/审计）只动平台自己的数据。
 * 两者风险模型不同，物理分文件也让并行施工互不覆盖。
 */
@Injectable()
export class AdminCommunityService {
  // ── 用户 ──────────────────────────────────────────────────

  /**
   * 用户列表。
   *
   * `q` 三态（契约 §2.1）：11 位手机号 → HMAC 等值查 `identities`；纯数字 → 用户 id；
   * 其它 → 昵称模糊。为什么不写成"手机 or id or 昵称"的大 OR：`identities.phone_hash`
   * 是 HMAC，只能等值命中，混进 OR 只会白白拖慢昵称查询；而运营输手机号时
   * 想的就是"精确定位这个人"。
   */
  async listUsers(opts: { q?: string; status?: number; deleted?: number; page?: number; pageSize?: number } = {}) {
    const { page, pageSize } = pageArgs(opts.page, opts.pageSize);
    const conds = [];
    if (opts.status !== undefined) conds.push(eq(users.status, opts.status));
    // deleted 不传 = 全部；0 = 未注销，1 = 已注销（注销是软删，两批人都要看）
    if (opts.deleted === 0) conds.push(isNull(users.deletedAt));
    else if (opts.deleted === 1) conds.push(isNotNull(users.deletedAt));

    const q = opts.q?.trim() ?? "";
    if (q) {
      if (/^1\d{10}$/.test(q)) {
        const matched = await db
          .select({ userId: identities.userId })
          .from(identities)
          .where(and(eq(identities.provider, "phone"), eq(identities.phoneHash, hashPhone(q))));
        // 手机号没注册过：直接空页，不要退化成"按 id/昵称搜"再返回一串无关用户
        if (matched.length === 0) return pageEnvelope<AdminUserDto>([], 0, page, pageSize);
        conds.push(inArray(users.id, matched.map((row) => row.userId)));
      } else if (/^\d+$/.test(q)) {
        // 超过 19 位一定不是 int8 id：直接空页，避免 PG 侧 22003 冒成 500
        if (q.length > 19) return pageEnvelope<AdminUserDto>([], 0, page, pageSize);
        conds.push(eq(users.id, parseId(q, "q")));
      } else {
        conds.push(ilike(users.nickname, `%${q}%`));
      }
    }

    const where = conds.length > 0 ? and(...conds) : undefined;
    const [agg] = await db.select({ count: sql<number>`count(*)::int` }).from(users).where(where);
    const total = agg?.count ?? 0;
    if (total === 0) return pageEnvelope<AdminUserDto>([], 0, page, pageSize);

    // 越界页归一到最后一页：前端直接拿返回值渲染分页器，不归一就会出现"第 99 页永远空"
    const effectivePage = Math.min(page, Math.max(1, Math.ceil(total / pageSize)));
    const rows = await db
      .select()
      .from(users)
      .where(where)
      .orderBy(desc(users.createdAt), desc(users.id))
      .limit(pageSize)
      .offset((effectivePage - 1) * pageSize);

    return pageEnvelope(await this.enrichUsers(rows), total, effectivePage, pageSize);
  }

  /**
   * 把手机号密文与空间 id 补到行 DTO 上（**批量**查，不在 map 里逐条查库）。
   *
   * 手机号解密失败必须是单条 `null` 而不是整页 500：历史密文可能来自另一把
   * `PHONE_ENC_KEY`（换过密钥的环境），一条解不开不该让运营连用户列表都打不开。
   */
  private async enrichUsers(rows: Array<typeof users.$inferSelect>): Promise<AdminUserDto[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((row) => row.id);
    const [phoneRows, ownedSpaces] = await Promise.all([
      db
        .select({ userId: identities.userId, phoneCipher: identities.phoneCipher })
        .from(identities)
        .where(and(inArray(identities.userId, ids), eq(identities.provider, "phone"))),
      db
        .select({ id: spaces.id, ownerUserId: spaces.ownerUserId, type: spaces.type })
        .from(spaces)
        .where(inArray(spaces.ownerUserId, ids))
        .orderBy(asc(spaces.id)),
    ]);

    const phoneMasked = new Map<string, string | null>();
    for (const row of phoneRows) {
      if (!row.phoneCipher) continue;
      try {
        phoneMasked.set(String(row.userId), maskPhone(decryptPhone(row.phoneCipher)));
      } catch {
        // 单条解密失败 → 该行 phone_masked 为 null（前端显示"不可用"），不影响整页
        phoneMasked.set(String(row.userId), null);
      }
    }

    /**
     * 一个用户可能同时拥有个人空间与团队空间。后台要的是"这个人的主空间"，
     * 所以优先取 `type=1`（个人空间），没有再退回任意归属空间；全部按 id 升序，
     * 保证同一份数据每次展示结果稳定（否则运营会以为空间"变了"）。
     */
    const personalSpace = new Map<string, string>();
    const anySpace = new Map<string, string>();
    for (const row of ownedSpaces) {
      const key = String(row.ownerUserId);
      if (!anySpace.has(key)) anySpace.set(key, String(row.id));
      if (row.type === 1 && !personalSpace.has(key)) personalSpace.set(key, String(row.id));
    }

    return rows.map((row) => {
      const key = String(row.id);
      return {
        id: key,
        nickname: row.nickname,
        avatar_uri: row.avatarUri,
        status: row.status,
        deleted_at: row.deletedAt ? row.deletedAt.toISOString() : null,
        last_login_at: row.lastLoginAt ? row.lastLoginAt.toISOString() : null,
        created_at: row.createdAt.toISOString(),
        phone_masked: phoneMasked.get(key) ?? null,
        space_id: personalSpace.get(key) ?? anySpace.get(key) ?? null,
      };
    });
  }

  /** 单用户读取（写操作回包用；与列表同一 DTO，前端不必写两套渲染） */
  private async userDto(row: typeof users.$inferSelect): Promise<AdminUserDto> {
    const [dto] = await this.enrichUsers([row]);
    if (!dto) throw new AppError(ErrorCode.NOT_FOUND, "user not found");
    return dto;
  }

  private async loadUser(id: string) {
    const userId = parseId(id, "id");
    const [row] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!row) throw new AppError(ErrorCode.NOT_FOUND, "user not found");
    return row;
  }

  /**
   * 封禁 / 解封（`PATCH /ops/admin/users/:id`）。
   *
   * 为什么不需要手动吊销 token：用户域 `AuthGuard` 每次请求都校验 `users.status/deleted_at`，
   * 改完状态后该用户的下一次请求就是 401——所以这里只改一列就够。
   * 已注销用户不许改状态：注销是"用户自己关掉账号"，运营直接解封等于复活一个
   * 用户明确要求删除的账号；正确动作是 `restore`（带审计语义的入口）。
   */
  async updateUserStatus(id: string, status: number): Promise<AdminUserDto> {
    const row = await this.loadUser(id);
    if (row.deletedAt) {
      throw new AppError(ErrorCode.INVALID_PARAM, "user is deleted, restore it first", { field: "id" });
    }
    const [updated] = await db
      .update(users)
      .set({ status, updatedAt: new Date() })
      .where(eq(users.id, row.id))
      .returning();
    if (!updated) throw new AppError(ErrorCode.NOT_FOUND, "user not found");
    return this.userDto(updated);
  }

  /**
   * 注销恢复（`POST /ops/admin/users/:id/restore`）。
   *
   * 注销时昵称/头像已被匿名化（`已注销用户`/null），原值在库中不存在、不可恢复；
   * 所以 `nickname` 传了才覆盖，运营想给用户一个可辨认的名字只能在这里重填。
   * 空串按"没传"处理：把昵称写成空串会让该用户在所有列表里都无法辨认，比保持匿名更糟。
   */
  async restoreUser(id: string, input: { nickname?: string } = {}): Promise<AdminUserDto> {
    const row = await this.loadUser(id);
    if (!row.deletedAt) {
      throw new AppError(ErrorCode.INVALID_PARAM, "user is not deleted", { field: "id" });
    }
    const patch: Partial<typeof users.$inferInsert> = {
      status: 1,
      deletedAt: null,
      updatedAt: new Date(),
    };
    const nickname = input.nickname?.trim();
    if (nickname) patch.nickname = nickname;

    const [updated] = await db.update(users).set(patch).where(eq(users.id, row.id)).returning();
    if (!updated) throw new AppError(ErrorCode.NOT_FOUND, "user not found");
    return this.userDto(updated);
  }

  // ── 等待名单（契约 §2.2）──────────────────────────────────

  /**
   * 等待名单列表。
   *
   * 表里只有手机号的 HMAC（`phone_hash`），平台侧没有明文也没有解密路径，
   * 因此对外只给 `phone_hash_prefix`（前 10 位 + …）：它足以让运营在多次查看间
   * 认出"是同一条记录"，又不构成可反查的凭据。
   */
  async listWaitlist(opts: { invited?: number; page?: number; pageSize?: number } = {}) {
    const { page, pageSize } = pageArgs(opts.page, opts.pageSize);
    const conds = [];
    if (opts.invited === 1) conds.push(isNotNull(waitlistEntries.invitedAt));
    else if (opts.invited === 0) conds.push(isNull(waitlistEntries.invitedAt));
    const where = conds.length > 0 ? and(...conds) : undefined;

    const [agg] = await db.select({ count: sql<number>`count(*)::int` }).from(waitlistEntries).where(where);
    const total = agg?.count ?? 0;
    if (total === 0) return pageEnvelope<AdminWaitlistDto>([], 0, page, pageSize);

    const effectivePage = Math.min(page, Math.max(1, Math.ceil(total / pageSize)));
    const rows = await db
      .select()
      .from(waitlistEntries)
      .where(where)
      .orderBy(desc(waitlistEntries.createdAt), desc(waitlistEntries.id))
      .limit(pageSize)
      .offset((effectivePage - 1) * pageSize);

    return pageEnvelope(
      rows.map((row) => ({
        id: String(row.id),
        phone_hash_prefix: `${row.phoneHash.slice(0, 10)}…`,
        source: row.source,
        invited_at: row.invitedAt ? row.invitedAt.toISOString() : null,
        created_at: row.createdAt.toISOString(),
      })),
      total,
      effectivePage,
      pageSize,
    );
  }

  /**
   * 标记"已邀请"（`POST /ops/admin/waitlist/:id/invite`）。
   *
   * 只写 `invited_at`：该动作代表运营**在线下或其它渠道已经邀请过**，
   * 系统并不会发出任何消息（名单里没有明文手机号，发不了短信）。
   *
   * 幂等：重复点返回**原时间**并置 `idempotent:true`。若每次覆盖成 now()，
   * "什么时候邀请的"就被最后一次误点抹掉，后续转化分析全部失真。
   */
  async inviteWaitlistEntry(id: string): Promise<{ id: string; invited_at: string | null; idempotent: boolean }> {
    const entryId = parseId(id, "id");
    const [row] = await db.select().from(waitlistEntries).where(eq(waitlistEntries.id, entryId)).limit(1);
    if (!row) throw new AppError(ErrorCode.NOT_FOUND, "waitlist entry not found");
    if (row.invitedAt) {
      return { id: String(row.id), invited_at: row.invitedAt.toISOString(), idempotent: true };
    }
    const [updated] = await db
      .update(waitlistEntries)
      .set({ invitedAt: new Date() })
      .where(eq(waitlistEntries.id, row.id))
      .returning();
    if (!updated) throw new AppError(ErrorCode.NOT_FOUND, "waitlist entry not found");
    return {
      id: String(updated.id),
      invited_at: updated.invitedAt ? updated.invitedAt.toISOString() : null,
      idempotent: false,
    };
  }

  // ── 邀请码（契约 §2.3）────────────────────────────────────

  /**
   * 邀请码列表。
   *
   * 过滤口径必须与 DTO 呈现的 `status` **完全一致**（`inviteCodeStatus`）：
   * 若 `status=3` 只匹配库里 `status=3` 的行，那些"有效但已用满"的码就会既不在
   * "有效"也不在"耗尽"里——运营按状态筛选时以为它们消失了。所以这里把
   * 三态直接翻译成对 `status/used_count/max_uses` 的组合条件。
   */
  async listInviteCodes(opts: { status?: number; page?: number; pageSize?: number } = {}) {
    const { page, pageSize } = pageArgs(opts.page, opts.pageSize);
    const conds = [];
    if (opts.status === 1) {
      // 有效 = 未停用且未用满（maxUses=0 是"不限次"，永远不算用满）
      conds.push(
        sql`${inviteCodes.status} = 1 and not (${inviteCodes.maxUses} > 0 and ${inviteCodes.usedCount} >= ${inviteCodes.maxUses})`,
      );
    } else if (opts.status === 2) {
      conds.push(eq(inviteCodes.status, 2));
    } else if (opts.status === 3) {
      conds.push(
        sql`${inviteCodes.status} = 1 and ${inviteCodes.maxUses} > 0 and ${inviteCodes.usedCount} >= ${inviteCodes.maxUses}`,
      );
    }
    const where = conds.length > 0 ? and(...conds) : undefined;

    const [agg] = await db.select({ count: sql<number>`count(*)::int` }).from(inviteCodes).where(where);
    const total = agg?.count ?? 0;
    if (total === 0) return pageEnvelope<InviteCodeDto>([], 0, page, pageSize);

    const effectivePage = Math.min(page, Math.max(1, Math.ceil(total / pageSize)));
    const rows = await db
      .select()
      .from(inviteCodes)
      .where(where)
      .orderBy(desc(inviteCodes.createdAt), desc(inviteCodes.id))
      .limit(pageSize)
      .offset((effectivePage - 1) * pageSize);

    return pageEnvelope(rows.map(toInviteCodeDto), total, effectivePage, pageSize);
  }

  /**
   * 批量发码。
   *
   * 为什么一条条插而不是一次 `values([...])`：撞码重试必须**逐码**做。
   * 一次批量插入里任意一条冲突会让整批 `onConflictDoNothing` 静默少插几条，
   * 运营以为发了 20 个实际只有 19 个。逐条插最多 50 次往返，代价可接受。
   */
  async createInviteCodes(input: {
    credits: number;
    maxUses: number;
    expiresAt?: Date | null;
    count: number;
    adminId?: string;
  }): Promise<{ codes: InviteCodeDto[] }> {
    const createdBy = adminIdOrNull(input.adminId);
    const codes: InviteCodeDto[] = [];
    for (let index = 0; index < input.count; index += 1) {
      let inserted: typeof inviteCodes.$inferSelect | undefined;
      for (let attempt = 0; attempt < INVITE_CODE_MAX_ATTEMPTS && !inserted; attempt += 1) {
        const [row] = await db
          .insert(inviteCodes)
          .values({
            id: newId(),
            code: generateInviteCode(),
            credits: input.credits,
            maxUses: input.maxUses,
            usedCount: 0,
            expiresAt: input.expiresAt ?? null,
            status: 1,
            // 运营码没有归属用户（owner_user_id 留空），该列只用于用户自助分销码
            createdBy,
          })
          // 唯一索引 `invite_codes.code`：撞码时静默跳过，外层换一个码继续
          .onConflictDoNothing({ target: inviteCodes.code })
          .returning();
        inserted = row ?? undefined;
      }
      if (!inserted) throw new AppError(ErrorCode.INTERNAL, "invite code generation failed");
      codes.push(toInviteCodeDto(inserted));
    }
    return { codes };
  }

  /**
   * 停用 / 启用。
   *
   * 已用满的码不能重新启用：`used_count >= max_uses` 时即使置回 status=1，
   * 核销侧（`OpService.verifyInviteCode`）也会立刻以"已用尽"拒绝，等于给运营
   * 发一个"看起来有效但一定失败"的码。所以直接 400101 并要求换新码。
   */
  async updateInviteCodeStatus(id: string, status: number): Promise<InviteCodeDto> {
    const codeId = parseId(id, "id");
    const [row] = await db.select().from(inviteCodes).where(eq(inviteCodes.id, codeId)).limit(1);
    if (!row) throw new AppError(ErrorCode.NOT_FOUND, "invite code not found");
    // maxUses=0 是历史/用户码的"不限次"语义（`OpService` 同口径），不参与耗尽判定
    const exhausted = row.maxUses > 0 && row.usedCount >= row.maxUses;
    if (status === 1 && exhausted) {
      throw new AppError(ErrorCode.INVALID_PARAM, "invite code is exhausted, create a new one", { field: "status" });
    }
    const [updated] = await db
      .update(inviteCodes)
      .set({ status, updatedAt: new Date() })
      .where(eq(inviteCodes.id, row.id))
      .returning();
    if (!updated) throw new AppError(ErrorCode.NOT_FOUND, "invite code not found");
    return toInviteCodeDto(updated);
  }

  /**
   * 删除邀请码（第 109 批，契约 §2.3）。
   *
   * 只允许删除**从未被核销**的码。`invite_redemptions.code_id` 是指向本表的外键：
   * 删掉一个已核销的码，要么被 FK 拒绝（23503 冒成 500），要么必须连带删掉核销与积分流水，
   * 后者会毁掉"谁用什么码拿了多少积分"的账实证据。已核销的码有唯一正确的处置——停用：
   * 行保留、历史可追溯、用户侧立即失效（`OpService.verifyInviteCode` 拒绝 status≠1）。
   *
   * 判定同时看两个来源：`used_count`（核销时同事务自增）与核销表本身。
   * 只看快照会漏掉历史不一致的数据（used_count 是 0 但核销行存在），
   * 而那种码一旦删除就再也解释不了对应的积分来源。
   *
   * 删除用条件 `WHERE used_count = 0`：检查与删除之间若刚好有人在核销，
   * 对方的 `SELECT … FOR UPDATE` 会先占行锁，本语句随后重新求值条件、删 0 行，
   * 不会出现"检查时没用过、删掉的却是已用码"。零行删除按"已核销"拒绝。
   */
  async deleteInviteCode(id: string): Promise<{ id: string; code: string; deleted: true }> {
    const codeId = parseId(id, "id");
    const [row] = await db.select().from(inviteCodes).where(eq(inviteCodes.id, codeId)).limit(1);
    if (!row) throw new AppError(ErrorCode.NOT_FOUND, "invite code not found");

    const redeemed = new AppError(
      ErrorCode.INVALID_PARAM,
      "invite code has been redeemed, disable it instead of deleting",
      { field: "id" },
    );
    if (row.usedCount > 0) throw redeemed;
    const [redemption] = await db
      .select({ id: inviteRedemptions.id })
      .from(inviteRedemptions)
      .where(eq(inviteRedemptions.codeId, codeId))
      .limit(1);
    if (redemption) throw redeemed;

    let deleted: { id: bigint; code: string }[];
    try {
      deleted = await db
        .delete(inviteCodes)
        .where(and(eq(inviteCodes.id, codeId), eq(inviteCodes.usedCount, 0)))
        .returning({ id: inviteCodes.id, code: inviteCodes.code });
    } catch (err) {
      // 核销记录在"查核销表"与"删码"之间提交：FK 是最后一道闸，翻译成同一句业务错误
      if (isForeignKeyViolation(err)) throw redeemed;
      throw err;
    }
    const gone = deleted[0];
    if (!gone) throw redeemed;
    return { id: String(gone.id), code: gone.code, deleted: true };
  }
}
