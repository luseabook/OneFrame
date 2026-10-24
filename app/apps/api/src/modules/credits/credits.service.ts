import { Inject, Injectable } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";
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
      const picked = lower.length > 0 ? lower[lower.length - 1] : tiers[0];
      if (picked?.durationS != null) {
        effectiveDurationS = picked.durationS;
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

  async listFlows(spaceId: string, page = 1, pageSize = 20, taskId?: string) {
    const p = Math.max(1, page);
    const ps = Math.min(100, Math.max(1, pageSize));
    const conditions = [eq(creditFlows.spaceId, BigInt(spaceId))];
    if (taskId) conditions.push(eq(creditFlows.refTaskId, BigInt(taskId)));
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
