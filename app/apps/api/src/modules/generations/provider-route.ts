import { and, asc, desc, eq } from "drizzle-orm";
import { modelProviders, modelRoutes } from "@app/db";
import { AppError, ErrorCode } from "@app/shared";
import { env } from "../../config/env";
import { db } from "../../db/database";

export interface ProviderRouteSnapshot {
  route_id: string;
  provider_id: string;
  protocol: string;
  base_url: string;
  remote_model_id: string;
  auth_type: string;
  auth_header: string;
  provider_options: Record<string, unknown>;
  route_options: Record<string, unknown>;
}

export interface SelectedProviderRoute {
  routeId: bigint;
  snapshot: ProviderRouteSnapshot;
}

export type ProviderRouteCandidate = {
  routeId: bigint;
  providerId: bigint;
  protocol: string;
  baseUrl: string;
  remoteModelId: string;
  authType: string;
  authHeader: string;
  priority: number;
  weight: number;
  providerOptions: Record<string, unknown>;
  routeOptions: Record<string, unknown>;
};

/** 同一 priority 内按 weight 选一条；weight 非法时按 1 处理，仍保证确定性可测。 */
export function pickWeightedRoute(
  candidates: ProviderRouteCandidate[],
  random: () => number = Math.random,
): ProviderRouteCandidate | undefined {
  if (candidates.length === 0) return undefined;
  const topPriority = candidates[0]!.priority;
  const samePriority = candidates.filter((candidate) => candidate.priority === topPriority);
  const weights = samePriority.map((candidate) => (Number.isFinite(candidate.weight) && candidate.weight > 0 ? candidate.weight : 1));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let ticket = Math.min(Math.max(random(), 0), 0.999999999) * total;
  for (let index = 0; index < samePriority.length; index += 1) {
    ticket -= weights[index]!;
    if (ticket < 0) return samePriority[index];
  }
  return samePriority[samePriority.length - 1];
}

function toSnapshot(candidate: ProviderRouteCandidate): ProviderRouteSnapshot {
  return {
    route_id: String(candidate.routeId),
    provider_id: String(candidate.providerId),
    protocol: candidate.protocol,
    base_url: candidate.baseUrl,
    remote_model_id: candidate.remoteModelId,
    auth_type: candidate.authType,
    auth_header: candidate.authHeader,
    provider_options: candidate.providerOptions,
    route_options: candidate.routeOptions,
  };
}

/**
 * 提交任务时冻结路由。快照不含 Key；worker 轮询时按 provider_id 读取最新凭据，
 * 但 base_url / remote_model_id 只认快照，避免运营改配置后查错供应商任务。
 */
export async function selectProviderRoute(modelId: bigint): Promise<SelectedProviderRoute | null> {
  if (env.PROVIDER_DB_RESOLVE === "off") return null;

  const rows = await db
    .select({
      routeId: modelRoutes.id,
      providerId: modelProviders.id,
      protocol: modelProviders.protocol,
      baseUrl: modelProviders.baseUrl,
      remoteModelId: modelRoutes.remoteModelId,
      authType: modelProviders.authType,
      authHeader: modelProviders.authHeader,
      priority: modelRoutes.priority,
      weight: modelRoutes.weight,
      providerOptions: modelProviders.options,
      routeOptions: modelRoutes.options,
    })
    .from(modelRoutes)
    .innerJoin(modelProviders, eq(modelRoutes.providerId, modelProviders.id))
    .where(and(eq(modelRoutes.modelId, modelId), eq(modelRoutes.active, true), eq(modelProviders.status, 1)))
    .orderBy(asc(modelRoutes.priority), desc(modelRoutes.weight), asc(modelRoutes.id));

  const picked = pickWeightedRoute(
    rows.map((row) => ({
      ...row,
      providerOptions: (row.providerOptions ?? {}) as Record<string, unknown>,
      routeOptions: (row.routeOptions ?? {}) as Record<string, unknown>,
    })),
  );
  if (!picked) {
    if (env.PROVIDER_DB_RESOLVE === "on") {
      throw new AppError(ErrorCode.INVALID_PARAM, "invalid provider config: no active model route", {
        field: "model",
      });
    }
    return null;
  }
  return { routeId: picked.routeId, snapshot: toSnapshot(picked) };
}
