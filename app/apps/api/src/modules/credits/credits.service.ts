import { Inject, Injectable } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { creditAccounts, creditFlows, modelPrices } from "@app/db";
import type { GenerationRequest } from "@app/shared";
import { AppError, ErrorCode } from "@app/shared";
import { env } from "../../config/env";
import { db } from "../../db/database";
import { RedisService } from "../../redis/redis.service";
import { ModelsService, type ModeConfig, type ModelRow } from "../models/models.service";

export interface PriceResult {
  model: ModelRow;
  mode: string;
  scene: string | null;
  credits: number;
  strikeCredits: number;
  /** 实际计费时长档（就近低档回写后可能与请求不同） */
  effectiveDurationS?: number | null;
  /**
   * 计费依据：`tier` = 命中真实时长档；`tier_lower` = 就近取低档（PRD F2）；
   * `seconds` = 超出最高档后按秒线性外推（`ceil(秒 × 每秒单价)`）。
   * 必须能说清"为什么收这个数"，否则用户对账时无从解释。
   */
  pricingBasis?: "tier" | "tier_lower" | "seconds";
  discount: number;
  pointsCode: string;
  balance: number;
  sufficient: boolean;
}

export interface PublicQuote {
  credits: number;
  strike_credits: number;
  discount: number;
  points_code: string;
  balance_after_estimate: number;
  sufficient: boolean;
  quote_id?: string;
  quote_expires_at?: string;
}

interface StoredQuote {
  spaceId: string;
  hash: string;
  credits: number;
  modelName: string;
  mode: string;
  scene: string | null;
  expiresAt: number;
}

@Injectable()
export class CreditsService {
  constructor(
    @Inject(ModelsService) private readonly models: ModelsService,
    @Inject(RedisService) private readonly redis: RedisService,
  ) {}

  static hashRequest(body: unknown): string {
    // quote_id 是提交时附加的引用，不参与报价内容指纹
    const normalized =
      body && typeof body === "object"
        ? Object.fromEntries(Object.entries(body as Record<string, unknown>).filter(([key]) => key !== "quote_id"))
        : body;
    return createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
  }

  async price(body: GenerationRequest, spaceId: string): Promise<PriceResult> {
    const model = await this.models.findByName(body.model);
    const modes = model.modes as Record<string, ModeConfig>;
    const modeCfg = modes[body.mode];
    if (!modeCfg) {
      throw new AppError(ErrorCode.INVALID_PARAM, `model ${model.name} does not support ${body.mode}`, {
        field: "mode",
      });
    }

    const scenes = (model.sceneModes ?? {}) as Record<string, unknown>;
    let sceneCfg: ModeConfig | undefined;
    if (body.scene) {
      if (!Object.prototype.hasOwnProperty.call(scenes, body.scene)) {
        throw new AppError(ErrorCode.INVALID_PARAM, `model ${model.name} does not support scene ${body.scene}`, {
          field: "scene",
        });
      }
      sceneCfg = scenes[body.scene] as ModeConfig;
    }

    const base = sceneCfg && Array.isArray(sceneCfg.durations) ? sceneCfg : modeCfg;
    this.validateOptions(body, modeCfg, base);

    const resolution = body.options.resolution;
    const duration = base.durations ? body.options.duration : null;

    const priceWhere = duration === null
      ? and(
          eq(modelPrices.modelId, model.id),
          eq(modelPrices.mode, body.mode),
          eq(modelPrices.resolution, resolution),
          isNull(modelPrices.durationS),
          eq(modelPrices.active, true),
        )
      : and(
          eq(modelPrices.modelId, model.id),
          eq(modelPrices.mode, body.mode),
          eq(modelPrices.resolution, resolution),
          eq(modelPrices.durationS, duration),
          eq(modelPrices.active, true),
        );

    const [exactPrice] = await db.select().from(modelPrices).where(priceWhere);
    let priceRow = exactPrice;
    let effectiveDurationS = duration;
    let pricingBasis: "tier" | "tier_lower" | "seconds" = "tier";
    if (!priceRow && duration !== null) {
      // PRD F2：模型/价格表只覆盖部分时长档 → 就近取低档（最大的 ≤ 请求时长）
      const tiers = await db
        .select({ durationS: modelPrices.durationS, credits: modelPrices.credits, strike: modelPrices.strikeCredits })
        .from(modelPrices)
        .where(
          and(
            eq(modelPrices.modelId, model.id),
            eq(modelPrices.mode, body.mode),
            eq(modelPrices.resolution, resolution),
            isNotNull(modelPrices.durationS),
            eq(modelPrices.active, true),
          ),
        )
        .orderBy(modelPrices.durationS);
      const lower = tiers.filter((t) => t.durationS !== null && t.durationS <= duration);
      const maxTier = tiers[tiers.length - 1];
      const picked = lower.length > 0 ? lower[lower.length - 1] : tiers[0];
      if (picked?.durationS != null) {
        effectiveDurationS = picked.durationS;
        // 超出最高档：按秒线性外推（向上取整）。不这么做的话"请求 30s 只收 5s 档的钱"= 直接赔钱；
        // 口径见进度文档 §5.4 #2（竞品无按秒计价证据，故为自定口径，已登记待确认）。
        const overMax =
          maxTier?.durationS != null &&
          maxTier.durationS > 0 &&
          duration > maxTier.durationS &&
          lower.length > 0;
        if (overMax) {
          const maxSeconds = maxTier.durationS as number;
          const perSecond = maxTier.credits / maxSeconds;
          const strikePerSecond = (maxTier.strike ?? maxTier.credits) / maxSeconds;
          pricingBasis = "seconds";
          priceRow = {
            id: 0n,
            modelId: model.id,
            mode: body.mode,
            resolution,
            // durationS 记录"实际请求秒数"，让对账能看到按几秒收的
            durationS: duration,
            credits: Math.max(1, Math.ceil(duration * perSecond)),
            strikeCredits: Math.max(1, Math.ceil(duration * strikePerSecond)),
            memberCredits: null,
            timeLimitedCredits: null,
            active: true,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
        } else {
        pricingBasis = lower.length > 0 ? "tier_lower" : "tier";
        priceRow = {
          id: 0n,
          modelId: model.id,
          mode: body.mode,
          resolution,
          durationS: picked.durationS,
          credits: picked.credits,
          strikeCredits: picked.strike ?? picked.credits,
          memberCredits: null,
          timeLimitedCredits: null,
          active: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        }
      }
    }
    if (!priceRow) {
      throw new AppError(ErrorCode.INVALID_PARAM, "no price for requested model/mode/options", {
        field: "model",
      });
    }

    const [account] = await db
      .select()
      .from(creditAccounts)
      .where(eq(creditAccounts.spaceId, BigInt(spaceId)));
    const balance = account?.balance ?? 0;
    const strike = priceRow.strikeCredits ?? priceRow.credits;

    return {
      model,
      mode: body.mode,
      scene: body.scene ?? null,
      credits: priceRow.credits,
      strikeCredits: strike,
      effectiveDurationS,
      pricingBasis,
      discount: strike > 0 ? Math.round((priceRow.credits / strike) * 100) / 100 : 1,
      pointsCode: `v_${body.mode}_${duration ?? 0}s_${resolution}`,
      balance,
      sufficient: balance >= priceRow.credits,
    };
  }

  async quote(body: GenerationRequest, spaceId: string): Promise<PublicQuote> {
    const priced = await this.price(body, spaceId);
    const quoteId = randomUUID();
    const stored: StoredQuote = {
      spaceId,
      hash: CreditsService.hashRequest(body),
      credits: priced.credits,
      modelName: priced.model.name,
      mode: priced.mode,
      scene: priced.scene,
      expiresAt: Date.now() + env.QUOTE_TTL_S * 1000,
    };
    await this.redis.set(`quote:${quoteId}`, JSON.stringify(stored), env.QUOTE_TTL_S);
    return {
      credits: priced.credits,
      strike_credits: priced.strikeCredits,
      discount: priced.discount,
      points_code: priced.pointsCode,
      balance_after_estimate: priced.balance - priced.credits,
      sufficient: priced.sufficient,
      quote_id: quoteId,
      quote_expires_at: new Date(stored.expiresAt).toISOString(),
    };
  }

  async quoteBatch(items: GenerationRequest[], spaceId: string) {
    const lineItems = [] as Array<{
      credits: number;
      strike_credits: number;
      points_code: string;
      sufficient: boolean;
    }>;
    let total = 0;
    let strikeTotal = 0;
    let balance = 0;
    for (const item of items) {
      const priced = await this.price(item, spaceId);
      total += priced.credits;
      strikeTotal += priced.strikeCredits;
      balance = priced.balance;
      lineItems.push({
        credits: priced.credits,
        strike_credits: priced.strikeCredits,
        points_code: priced.pointsCode,
        sufficient: priced.sufficient,
      });
    }
    return {
      total_credits: total,
      total_strike_credits: strikeTotal,
      balance_after_estimate: balance - total,
      sufficient: balance >= total,
      line_items: lineItems,
    };
  }

  /**
   * 流水列表。`kinds` 是第 85 批为 `GET /user/credits-log?event_type=` 与
   * `GET /user/credits-dashboard/flows?tab=` 加的筛选：竞品按"事件类型/页签"筛，
   * 我方的流水 `kind` 有 7 种，必须由调用方给映射（见 controller），service 只认集合。
   */
  async listFlows(spaceId: string, page = 1, pageSize = 20, taskId?: string, kinds?: string[]) {
    const p = Math.max(1, page);
    const ps = Math.min(100, Math.max(1, pageSize));
    const conditions = [eq(creditFlows.spaceId, BigInt(spaceId))];
    if (taskId) conditions.push(eq(creditFlows.refTaskId, BigInt(taskId)));
    if (kinds && kinds.length > 0) conditions.push(inArray(creditFlows.kind, kinds));
    const where = and(...conditions);
    const rows = await db
      .select()
      .from(creditFlows)
      .where(where)
      .orderBy(desc(creditFlows.createdAt))
      .limit(ps)
      .offset((p - 1) * ps);
    const [countRow] = await db.select({ count: sql<number>`count(*)::int` }).from(creditFlows).where(where);
    return {
      list: rows.map((row) => ({
        id: String(row.id),
        kind: row.kind,
        delta: row.delta,
        frozen_delta: row.frozenDelta,
        balance_after: row.balanceAfter,
        task_id: row.refTaskId ? String(row.refTaskId) : null,
        memo: row.memo,
        created_at: row.createdAt.toISOString(),
      })),
      total: countRow?.count ?? 0,
      page: p,
      page_size: ps,
    };
  }

  /**
   * 账户余额（第 85 批：竞品 `GET /web/v1/user/credits`）。
   *
   * 为什么"user 级"接口读的是 `credit_accounts`（space 级）：本产品的钱包挂在空间上
   * —— 个人空间的钱包就是本人的钱，团队空间的钱包是团队的；`GET /me` 也一直是这个口径。
   * 单独再建一套 user 级余额会立刻和计费链路对不上账。
   */
  async accountCredits(spaceId: string) {
    const [account] = await db
      .select()
      .from(creditAccounts)
      .where(eq(creditAccounts.spaceId, BigInt(spaceId)));
    const balance = account?.balance ?? 0;
    const frozen = account?.frozen ?? 0;
    return {
      /** 可用余额（扣掉冻结之外的钱；本产品的 frozen 是"预留"，balance 本身已可花） */
      balance,
      frozen,
      available: balance,
      /** 有没有欠费模型：false → 前端不展示"待补缴"入口（竞品 debt-list，第 85 批登记为豁免） */
      debt_supported: false,
    };
  }

  /**
   * 积分看板（第 85 批：竞品 `GET /web/v1/user/credits-dashboard`）。
   *
   * 与 `accountCredits` 的分工：那个只回余额，这个回答"钱花在哪了"——按流水 kind 聚合。
   * 不在这里编造"近 7 日/30 日消耗"之类的派生指标：竞品没有字段证据，
   * 编出来的数字一旦口径不同就是误导；按 kind 的原始聚合是唯一站得住的口径。
   */
  async creditsDashboard(spaceId: string) {
    const sid = BigInt(spaceId);
    const [account] = await db
      .select()
      .from(creditAccounts)
      .where(eq(creditAccounts.spaceId, sid));
    const byKind = await db
      .select({
        kind: creditFlows.kind,
        delta: sql<number>`coalesce(sum(${creditFlows.delta}), 0)::int`,
        flows: sql<number>`count(*)::int`,
      })
      .from(creditFlows)
      .where(eq(creditFlows.spaceId, sid))
      .groupBy(creditFlows.kind);
    const [last] = await db
      .select({ at: creditFlows.createdAt })
      .from(creditFlows)
      .where(eq(creditFlows.spaceId, sid))
      .orderBy(desc(creditFlows.createdAt))
      .limit(1);
    const settle = byKind.find((row) => row.kind === "settle")?.delta ?? 0;
    const recharged = byKind
      .filter((row) => row.kind === "recharge" || row.kind === "gift")
      .reduce((sum, row) => sum + (row.delta ?? 0), 0);
    return {
      balance: account?.balance ?? 0,
      frozen: account?.frozen ?? 0,
      available: account?.balance ?? 0,
      /** settle 的 delta 是负数（扣钱），展示时翻成正的"已消耗" */
      spent: settle < 0 ? -settle : 0,
      recharged: recharged > 0 ? recharged : 0,
      flow_count: byKind.reduce((sum, row) => sum + (row.flows ?? 0), 0),
      last_flow_at: last?.at ? last.at.toISOString() : null,
      by_kind: byKind.map((row) => ({
        kind: row.kind,
        delta: row.delta ?? 0,
        flows: row.flows ?? 0,
      })),
      debt_supported: false,
    };
  }

  /**
   * `event_type`（竞品 `user/credits-log`）与 `tab`（竞品 `credits-dashboard/flows`）
   * → 流水 kind 集合。两个参数在竞品里是两处不同的命名，但语义都是"按类型筛"，
   * 所以共用这一张映射表；返回 `undefined` 表示不过滤（全部）。
   * 未知值 400101 而不是静默返回全部 —— 静默会把"筛选没生效"伪装成"筛选结果为空"。
   */
  flowKinds(raw?: string): string[] | undefined {
    const value = (raw ?? "").trim().toLowerCase();
    if (!value || value === "all") return undefined;
    const map: Record<string, string[]> = {
      consume: ["settle"],
      consume_flow: ["settle"],
      spend: ["settle"],
      settle: ["settle"],
      recharge: ["recharge", "gift", "refund", "adjust"],
      recharge_flow: ["recharge", "gift", "refund", "adjust"],
      recharge_gift: ["recharge", "gift"],
      freeze: ["freeze", "unfreeze"],
      frozen: ["freeze", "unfreeze"],
      refund: ["refund"],
      gift: ["gift"],
      adjust: ["adjust"],
    };
    const kinds = map[value];
    if (!kinds) {
      throw new AppError(ErrorCode.INVALID_PARAM, "unsupported event_type", { field: "event_type" });
    }
    return kinds;
  }

  async readQuote(quoteId: string, spaceId: string, body: GenerationRequest): Promise<StoredQuote> {
    const raw = await this.redis.get(`quote:${quoteId}`);
    if (!raw) throw new AppError(ErrorCode.QUOTE_MISMATCH, "quote expired", { field: "quote_id" });
    const stored = JSON.parse(raw) as StoredQuote;
    if (stored.spaceId !== spaceId) {
      throw new AppError(ErrorCode.NOT_FOUND, "quote not found", { field: "quote_id" });
    }
    if (stored.hash !== CreditsService.hashRequest(body)) {
      throw new AppError(ErrorCode.QUOTE_MISMATCH, "quote does not match request", { field: "quote_id" });
    }
    return stored;
  }

  private validateOptions(body: GenerationRequest, modeCfg: ModeConfig, base: ModeConfig): void {
    const opts = body.options;
    const ratios = base.ratios ?? modeCfg.ratios;
    if (ratios && !ratios.includes(opts.ratio)) {
      throw new AppError(ErrorCode.INVALID_PARAM, `ratio ${opts.ratio} not supported`, { field: "options.ratio" });
    }
    const resolutions = base.resolution_options ?? modeCfg.resolution_options;
    if (resolutions && !resolutions.some((r) => r.value === opts.resolution)) {
      throw new AppError(ErrorCode.INVALID_PARAM, `resolution ${opts.resolution} not supported`, {
        field: "options.resolution",
      });
    }
    const durations = base.durations ?? modeCfg.durations;
    if (durations && !durations.includes(opts.duration)) {
      throw new AppError(
        ErrorCode.INVALID_PARAM,
        `duration ${opts.duration}s not supported (allowed: ${durations.join(",")})`,
        { field: "options.duration" },
      );
    }
    const counts = base.counts ?? modeCfg.counts;
    if (counts && !counts.includes(opts.count)) {
      throw new AppError(ErrorCode.INVALID_PARAM, `count ${opts.count} not supported`, { field: "options.count" });
    }

    const limits = base.media_limits ?? modeCfg.media_limits;
    const refs = body.input.reference_uris;
    if (body.mode === "universal_reference" && refs.length === 0) {
      throw new AppError(ErrorCode.INVALID_PARAM, "universal_reference requires reference_uris", {
        field: "input.reference_uris",
      });
    }
    if (limits && refs.length > (limits.image ?? 0)) {
      throw new AppError(ErrorCode.INVALID_PARAM, `too many reference images (max ${limits.image})`, {
        field: "input.reference_uris",
      });
    }
    if ((body.mode === "image2video" || body.mode === "first_frame") && !body.input.first_frame_uri) {
      throw new AppError(ErrorCode.INVALID_PARAM, `${body.mode} requires first_frame_uri`, {
        field: "input.first_frame_uri",
      });
    }
    if (body.mode === "first_last_frame" && (!body.input.first_frame_uri || !body.input.last_frame_uri)) {
      throw new AppError(ErrorCode.INVALID_PARAM, "first_last_frame requires both frames", {
        field: "input",
      });
    }
  }
}
