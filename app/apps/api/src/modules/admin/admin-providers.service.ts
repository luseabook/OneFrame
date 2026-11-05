import { Injectable } from "@nestjs/common";
import http from "node:http";
import https from "node:https";
import { and, asc, eq, sql } from "drizzle-orm";
import { modelProviders, modelRoutes, models, providerModels as providerModelsTable } from "@app/db";
import { AppError, ErrorCode, newId } from "@app/shared";
import { env } from "../../config/env";
import { db } from "../../db/database";
import { decryptSecret, encryptSecret, providerAad, secretFingerprint, secretHint } from "./provider-crypto";

/**
 * 供应商协议族。
 *
 * `jianying` = 剪影生图网关（OpenAI 兼容外形，但**同步**出图、只有 image 能力、
 * 风格迁移效果 id 是私有词汇表），因此不复用 `openai-compatible`：后者在
 * `provider-runtime.ts` 里按 `GET /models` 发现 + 文本/视频两条分支，套上去会走错分支。
 * 见 docs/02-architecture/jianying-gateway-integration.md §3。
 */
export type ProviderProtocol = "openai-compatible" | "ark" | "http-video" | "jianying";

export interface ProviderInput {
  code: string;
  name: string;
  protocol: ProviderProtocol;
  baseUrl: string;
  apiKey: string;
  authType?: "bearer" | "header";
  authHeader?: string;
  options?: Record<string, unknown>;
}

export interface ProviderPatch {
  name?: string;
  baseUrl?: string;
  apiKey?: string;
  authType?: "bearer" | "header";
  authHeader?: string;
  options?: Record<string, unknown>;
  status?: 1 | 0;
}

export interface ProviderTestResult {
  ok: boolean;
  kind?: "auth" | "network" | "timeout" | "unsupported" | "invalid_config";
  message?: string;
  latency_ms?: number;
  checked_at?: string;
}

export interface DiscoveredModel {
  remote_model_id: string;
  display_name: string;
  raw: unknown;
}

const MAX_DISCOVERED = 1000;
const MAX_MANUAL_IDS = 500;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const REQUEST_TIMEOUT_MS = 10_000;

function parseId(id: string, field = "id"): bigint {
  try {
    return BigInt(id);
  } catch {
    throw new AppError(ErrorCode.INVALID_PARAM, `invalid ${field}`, { field });
  }
}

function toProviderDto(row: typeof modelProviders.$inferSelect, counts?: { modelCount?: number; routeCount?: number }) {
  return {
    id: String(row.id),
    code: row.code,
    name: row.name,
    protocol: row.protocol,
    base_url: row.baseUrl,
    auth_type: row.authType,
    auth_header: row.authHeader,
    key_hint: row.keyHint,
    key_fingerprint: row.keyFingerprint,
    key_configured: row.credentialsCiphertext.length > 0,
    options: row.options,
    status: row.status,
    last_check_at: row.lastCheckAt ? row.lastCheckAt.toISOString() : null,
    last_check_status: row.lastCheckStatus,
    last_check_message: row.lastCheckMessage,
    model_count: counts?.modelCount ?? 0,
    route_count: counts?.routeCount ?? 0,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}

function toProviderModelDto(row: typeof providerModelsTable.$inferSelect) {
  return {
    id: String(row.id),
    provider_id: String(row.providerId),
    remote_model_id: row.remoteModelId,
    display_name: row.displayName,
    capability_hint: row.capabilityHint,
    raw: row.raw,
    status: row.status,
    first_seen_at: row.firstSeenAt.toISOString(),
    last_seen_at: row.lastSeenAt.toISOString(),
  };
}

function toRouteDto(row: {
  id: bigint;
  modelId: bigint;
  providerId: bigint;
  remoteModelId: string;
  priority: number;
  weight: number;
  active: boolean;
  options: unknown;
  updatedAt: Date;
  modelName?: string;
  providerName?: string;
}) {
  return {
    id: String(row.id),
    model_id: String(row.modelId),
    model_name: row.modelName ?? "",
    provider_id: String(row.providerId),
    provider_name: row.providerName ?? "",
    remote_model_id: row.remoteModelId,
    priority: row.priority,
    weight: row.weight,
    active: row.active,
    options: row.options,
    updated_at: row.updatedAt.toISOString(),
  };
}

function normalizeBaseUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, "");
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new AppError(ErrorCode.INVALID_PARAM, "base_url must be a valid URL", { field: "base_url" });
  }
  if (url.protocol !== "https:" && !(env.NODE_ENV !== "production" && url.protocol === "http:")) {
    throw new AppError(ErrorCode.INVALID_PARAM, "base_url must use https", { field: "base_url" });
  }
  if (url.username || url.password) {
    throw new AppError(ErrorCode.INVALID_PARAM, "base_url must not contain credentials", { field: "base_url" });
  }
  return trimmed;
}

function isPrivateIp(ip: string): boolean {
  if (ip.includes(":")) {
    const lower = ip.toLowerCase();
    return lower === "::1" || lower.startsWith("fc") || lower.startsWith("fd") || lower.startsWith("fe80:");
  }
  const parts = ip.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) return true;
  const [a, b] = parts;
  return (
    a === 10 ||
    a === 127 ||
    a === 0 ||
    (a === 169 && b === 254) ||
    (a === 172 && b! >= 16 && b! <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b! >= 64 && b! <= 127)
  );
}

/**
 * 生产环境的出站地址校验。非生产允许 127.0.0.1 是为了让 E2E 能用本地假供应商；
 * 生产禁止私网/回环，避免管理员把后台变成 SSRF 跳板。
 */
interface SafeTarget {
  url: URL;
  address?: { address: string; family: number };
}

async function assertSafeOutboundUrl(raw: string): Promise<SafeTarget> {
  const url = new URL(raw);
  if (env.NODE_ENV !== "production") return { url };
  if (url.protocol !== "https:") {
    throw new AppError(ErrorCode.INVALID_PARAM, "provider base_url must use https in production");
  }
  const host = url.hostname;
  const dns = await import("node:dns/promises");
  const addresses = await dns.lookup(host, { all: true }).catch(() => []);
  if (addresses.length === 0) {
    throw new AppError(ErrorCode.INVALID_PARAM, "provider host cannot be resolved");
  }
  if (addresses.some((entry) => isPrivateIp(entry.address))) {
    throw new AppError(ErrorCode.INVALID_PARAM, "provider host resolves to a private address");
  }
  return { url, address: addresses[0] };
}

function modelsUrl(provider: typeof modelProviders.$inferSelect): string {
  const options = provider.options as Record<string, unknown>;
  const explicitPath = typeof options.models_path === "string" ? options.models_path.trim() : "";
  if (explicitPath) {
    const target = new URL(explicitPath, `${provider.baseUrl}/`);
    if (target.origin !== new URL(provider.baseUrl).origin) {
      throw new AppError(ErrorCode.INVALID_PARAM, "models_path must stay on the provider origin");
    }
    return target.toString();
  }
  const base = provider.baseUrl.replace(/\/+$/, "");
  try {
    const path = new URL(base).pathname.replace(/\/+$/, "");
    if (path.endsWith("/v1")) return `${base}/models`;
  } catch {
    // normalizeBaseUrl 已校验过，这里只是防御
  }
  return `${base}/v1/models`;
}

function authHeaders(provider: typeof modelProviders.$inferSelect): Record<string, string> {
  const secret = decryptSecret(
    provider.credentialsCiphertext,
    providerAad(String(provider.id), provider.credentialVersion),
  );
  if (provider.authType === "header") {
    return { [provider.authHeader || "Authorization"]: secret };
  }
  return { Authorization: `Bearer ${secret}` };
}

async function requestJson(
  url: string,
  headers: Record<string, string>,
  pinned?: { address: string; family: number },
): Promise<{ status: number; body: unknown }> {
  const target = new URL(url);
  const transport = target.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const req = transport.request(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port || undefined,
        path: `${target.pathname}${target.search}`,
        method: "GET",
        headers: { Accept: "application/json", Host: target.host, ...headers },
        // 固定校验时的 DNS 结果，防 DNS rebinding；SNI/Host 仍是原域名。
        ...(pinned
          ? {
              lookup: (_hostname: string, _options: unknown, callback: (err: Error | null, address: string, family: number) => void) =>
                callback(null, pinned.address, pinned.family),
            }
          : {}),
      },
      (response) => {
        const status = response.statusCode ?? 0;
        if (status >= 300 && status < 400) {
          response.resume();
          reject(new Error("provider redirect is not allowed"));
          return;
        }
        const chunks: Buffer[] = [];
        let total = 0;
        response.on("data", (chunk: Buffer) => {
          total += chunk.length;
          if (total > MAX_RESPONSE_BYTES) {
            response.destroy(new Error("provider response too large"));
            return;
          }
          chunks.push(chunk);
        });
        response.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          try {
            resolve({ status, body: JSON.parse(text) as unknown });
          } catch {
            reject(new Error("provider response is not JSON"));
          }
        });
        response.on("error", reject);
      },
    );
    req.setTimeout(REQUEST_TIMEOUT_MS, () => req.destroy(new Error("provider request timeout")));
    req.on("error", reject);
    req.end();
  });
}

function normalizeDiscovered(body: unknown): DiscoveredModel[] {
  const rawList = Array.isArray(body)
    ? body
    : body && typeof body === "object" && Array.isArray((body as { data?: unknown }).data)
      ? (body as { data: unknown[] }).data
      : [];
  const out: DiscoveredModel[] = [];
  const seen = new Set<string>();
  for (const item of rawList) {
    if (out.length >= MAX_DISCOVERED) break;
    const record = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
    const id = typeof record.id === "string" ? record.id.trim() : "";
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({ remote_model_id: id, display_name: id, raw: item });
  }
  return out;
}

@Injectable()
export class AdminProvidersService {
  private readonly outboundHits = new Map<string, number[]>();

  /** test/discover 会主动出站，独立限流；按管理员计，避免一个运营把供应商配额打满。 */
  assertOutboundRate(adminId: string, action: "test" | "discover"): void {
    const now = Date.now();
    const key = `${adminId}:${action}`;
    const recent = (this.outboundHits.get(key) ?? []).filter((at) => now - at < 60_000);
    if (recent.length >= 10) {
      throw new AppError(ErrorCode.INVALID_PARAM, `provider ${action} rate limit exceeded (10/min)`);
    }
    recent.push(now);
    this.outboundHits.set(key, recent);
  }

  async listProviders() {
    const rows = await db
      .select({
        row: modelProviders,
        modelCount: sql<number>`(select count(*)::int from provider_models pm where pm.provider_id = model_providers.id)`,
        routeCount: sql<number>`(select count(*)::int from model_routes mr where mr.provider_id = model_providers.id and mr.active)`,
      })
      .from(modelProviders)
      .orderBy(asc(modelProviders.createdAt), asc(modelProviders.id));
    return { list: rows.map((entry) => toProviderDto(entry.row, entry)) };
  }

  async createProvider(input: ProviderInput, createdBy: string) {
    const baseUrl = normalizeBaseUrl(input.baseUrl);
    const [existing] = await db
      .select({ id: modelProviders.id })
      .from(modelProviders)
      .where(eq(modelProviders.code, input.code.trim()))
      .limit(1);
    if (existing) {
      throw new AppError(ErrorCode.INVALID_PARAM, "provider code already exists", { field: "code" });
    }

    const id = newId();
    const credentialVersion = 1;
    const encrypted = encryptSecret(input.apiKey.trim(), providerAad(String(id), credentialVersion));
    let row: typeof modelProviders.$inferSelect | undefined;
    try {
      [row] = await db
        .insert(modelProviders)
        .values({
          id,
          code: input.code.trim(),
          name: input.name.trim(),
          protocol: input.protocol,
          baseUrl,
          authType: input.authType ?? "bearer",
          authHeader: input.authHeader?.trim() || "Authorization",
          credentialsCiphertext: encrypted.ciphertext,
          encryptionKeyId: encrypted.keyId,
          credentialVersion,
          keyHint: secretHint(input.apiKey),
          keyFingerprint: secretFingerprint(input.apiKey),
          options: input.options ?? {},
          createdBy: BigInt(createdBy),
        })
        .returning();
    } catch (err) {
      if ((err as { code?: string }).code === "23505") {
        throw new AppError(ErrorCode.INVALID_PARAM, "provider code already exists", { field: "code" });
      }
      throw err;
    }
    if (!row) throw new AppError(ErrorCode.INTERNAL, "provider create failed");
    return toProviderDto(row);
  }

  async updateProvider(idRaw: string, input: ProviderPatch) {
    const id = parseId(idRaw);
    const [row] = await db.select().from(modelProviders).where(eq(modelProviders.id, id)).limit(1);
    if (!row) throw new AppError(ErrorCode.NOT_FOUND, "provider not found");
    const baseUrl = input.baseUrl === undefined ? row.baseUrl : normalizeBaseUrl(input.baseUrl);
    const nextVersion = input.apiKey === undefined ? row.credentialVersion : row.credentialVersion + 1;
    const patch: Partial<typeof modelProviders.$inferInsert> = {
      name: input.name?.trim() ?? row.name,
      baseUrl,
      authType: input.authType ?? row.authType,
      authHeader: input.authHeader?.trim() || row.authHeader,
      options: input.options ?? row.options,
      status: input.status ?? row.status,
      updatedAt: new Date(),
    };
    if (input.apiKey !== undefined) {
      const encrypted = encryptSecret(input.apiKey.trim(), providerAad(String(id), nextVersion));
      patch.credentialsCiphertext = encrypted.ciphertext;
      patch.encryptionKeyId = encrypted.keyId;
      patch.credentialVersion = nextVersion;
      patch.keyHint = secretHint(input.apiKey);
      patch.keyFingerprint = secretFingerprint(input.apiKey);
    }
    const [updated] = await db
      .update(modelProviders)
      .set(patch)
      .where(eq(modelProviders.id, id))
      .returning();
    if (!updated) throw new AppError(ErrorCode.NOT_FOUND, "provider not found");
    return toProviderDto(updated);
  }

  async disableProvider(idRaw: string) {
    const id = parseId(idRaw);
    const [activeRoutes] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(modelRoutes)
      .where(and(eq(modelRoutes.providerId, id), eq(modelRoutes.active, true)));
    if ((activeRoutes?.count ?? 0) > 0) {
      throw new AppError(ErrorCode.INVALID_PARAM, "provider has active model routes");
    }
    const [row] = await db
      .update(modelProviders)
      .set({ status: 0, updatedAt: new Date() })
      .where(eq(modelProviders.id, id))
      .returning();
    if (!row) throw new AppError(ErrorCode.NOT_FOUND, "provider not found");
    return toProviderDto(row);
  }

  private async markCheck(id: bigint, result: ProviderTestResult) {
    await db
      .update(modelProviders)
      .set({
        lastCheckAt: new Date(),
        lastCheckStatus: result.ok ? "ok" : (result.kind ?? "network"),
        lastCheckMessage: (result.message ?? "").slice(0, 500),
        updatedAt: new Date(),
      })
      .where(eq(modelProviders.id, id));
  }

  async testProvider(idRaw: string): Promise<ProviderTestResult> {
    const id = parseId(idRaw);
    const [provider] = await db.select().from(modelProviders).where(eq(modelProviders.id, id)).limit(1);
    if (!provider) throw new AppError(ErrorCode.NOT_FOUND, "provider not found");
    if (provider.protocol !== "openai-compatible") {
      const result: ProviderTestResult = {
        ok: false,
        kind: "unsupported",
        message: `protocol ${provider.protocol} has no safe model-list probe; save endpoint IDs manually`,
      };
      await this.markCheck(id, result);
      return result;
    }
    const started = Date.now();
    let result: ProviderTestResult;
    try {
      const target = modelsUrl(provider);
      const safe = await assertSafeOutboundUrl(target);
      const response = await requestJson(target, authHeaders(provider), safe.address);
      if (response.status === 401 || response.status === 403) {
        result = { ok: false, kind: "auth", message: `provider returned HTTP ${response.status}` };
      } else if (response.status >= 400) {
        result = { ok: false, kind: "network", message: `provider returned HTTP ${response.status}` };
      } else {
        result = {
          ok: true,
          latency_ms: Date.now() - started,
          checked_at: new Date().toISOString(),
        };
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "provider request failed";
      const kind = /timeout|aborted/i.test(message) ? "timeout" : "network";
      result = { ok: false, kind, message: message.slice(0, 300) };
    }
    await this.markCheck(id, result);
    return result;
  }

  async discoverModels(idRaw: string) {
    const id = parseId(idRaw);
    const [provider] = await db.select().from(modelProviders).where(eq(modelProviders.id, id)).limit(1);
    if (!provider) throw new AppError(ErrorCode.NOT_FOUND, "provider not found");
    if (provider.protocol !== "openai-compatible") {
      return {
        supported: false,
        reason: "manual_import_required",
        message: "该协议不提供模型列表接口，请粘贴 endpoint ID",
      };
    }
    const started = Date.now();
    let discovered: DiscoveredModel[];
    try {
      const target = modelsUrl(provider);
      const safe = await assertSafeOutboundUrl(target);
      const response = await requestJson(target, authHeaders(provider), safe.address);
      if (response.status === 401 || response.status === 403) {
        return { supported: false, reason: "auth", message: `provider returned HTTP ${response.status}` };
      }
      if (response.status >= 400) {
        return { supported: false, reason: "network", message: `provider returned HTTP ${response.status}` };
      }
      discovered = normalizeDiscovered(response.body);
    } catch (err) {
      const message = err instanceof Error ? err.message : "provider request failed";
      const kind = /timeout|aborted/i.test(message) ? "timeout" : "network";
      return { supported: false, reason: kind, message: message.slice(0, 300) };
    }

    if (discovered.length > 0) {
      await db
        .insert(providerModelsTable)
        .values(
          discovered.map((model) => ({
            id: newId(),
            providerId: id,
            remoteModelId: model.remote_model_id,
            displayName: model.display_name,
            raw: model.raw as Record<string, unknown>,
          })),
        )
        .onConflictDoUpdate({
          target: [providerModelsTable.providerId, providerModelsTable.remoteModelId],
          set: {
            displayName: sql`excluded.display_name`,
            raw: sql`excluded.raw`,
            status: 1,
            lastSeenAt: new Date(),
          },
        });
    }
    const rows = await db
      .select()
      .from(providerModelsTable)
      .where(eq(providerModelsTable.providerId, id))
      .orderBy(asc(providerModelsTable.remoteModelId));
    return {
      supported: true,
      models: rows.map(toProviderModelDto),
      fetched_at: new Date().toISOString(),
      latency_ms: Date.now() - started,
    };
  }

  async listProviderModels(providerIdRaw: string) {
    const providerId = parseId(providerIdRaw, "provider_id");
    const rows = await db
      .select()
      .from(providerModelsTable)
      .where(eq(providerModelsTable.providerId, providerId))
      .orderBy(asc(providerModelsTable.remoteModelId));
    return { list: rows.map(toProviderModelDto) };
  }

  async importProviderModels(providerIdRaw: string, remoteIds: string[]) {
    const providerId = parseId(providerIdRaw, "provider_id");
    const [provider] = await db
      .select({ id: modelProviders.id })
      .from(modelProviders)
      .where(eq(modelProviders.id, providerId))
      .limit(1);
    if (!provider) throw new AppError(ErrorCode.NOT_FOUND, "provider not found");
    const unique = Array.from(new Set(remoteIds.map((id) => id.trim()).filter(Boolean))).slice(0, MAX_MANUAL_IDS);
    if (unique.length === 0) {
      throw new AppError(ErrorCode.INVALID_PARAM, "at least one remote model id is required");
    }
    await db
      .insert(providerModelsTable)
      .values(
        unique.map((remoteModelId) => ({
          id: newId(),
          providerId,
          remoteModelId,
          displayName: remoteModelId,
        })),
      )
      .onConflictDoUpdate({
        target: [providerModelsTable.providerId, providerModelsTable.remoteModelId],
        set: { status: 1, lastSeenAt: new Date() },
      });
    return this.listProviderModels(providerIdRaw);
  }

  async listRoutes(modelIdRaw?: string) {
    const modelId = modelIdRaw ? parseId(modelIdRaw, "model_id") : undefined;
    const rows = await db
      .select({
        id: modelRoutes.id,
        modelId: modelRoutes.modelId,
        providerId: modelRoutes.providerId,
        remoteModelId: modelRoutes.remoteModelId,
        priority: modelRoutes.priority,
        weight: modelRoutes.weight,
        active: modelRoutes.active,
        options: modelRoutes.options,
        updatedAt: modelRoutes.updatedAt,
        modelName: models.name,
        providerName: modelProviders.name,
      })
      .from(modelRoutes)
      .innerJoin(models, eq(modelRoutes.modelId, models.id))
      .innerJoin(modelProviders, eq(modelRoutes.providerId, modelProviders.id))
      .where(modelId ? eq(modelRoutes.modelId, modelId) : undefined)
      .orderBy(asc(modelRoutes.modelId), asc(modelRoutes.priority), asc(modelRoutes.id));
    return { list: rows.map(toRouteDto) };
  }

  async createRoute(input: {
    modelId: string;
    providerId: string;
    remoteModelId: string;
    priority?: number;
    weight?: number;
    active?: boolean;
    options?: Record<string, unknown>;
  }) {
    const modelId = parseId(input.modelId, "model_id");
    const providerId = parseId(input.providerId, "provider_id");
    const [model] = await db.select({ id: models.id }).from(models).where(eq(models.id, modelId)).limit(1);
    if (!model) throw new AppError(ErrorCode.NOT_FOUND, "model not found");
    const [provider] = await db
      .select({ id: modelProviders.id, status: modelProviders.status })
      .from(modelProviders)
      .where(eq(modelProviders.id, providerId))
      .limit(1);
    if (!provider) throw new AppError(ErrorCode.NOT_FOUND, "provider not found");
    if (provider.status !== 1) throw new AppError(ErrorCode.INVALID_PARAM, "provider is disabled");
    let row: typeof modelRoutes.$inferSelect | undefined;
    try {
      [row] = await db
        .insert(modelRoutes)
        .values({
          id: newId(),
          modelId,
          providerId,
          remoteModelId: input.remoteModelId.trim(),
          priority: input.priority ?? 100,
          weight: input.weight ?? 100,
          active: input.active ?? true,
          options: input.options ?? {},
        })
        .returning();
    } catch (err) {
      if ((err as { code?: string }).code === "23505") {
        throw new AppError(ErrorCode.INVALID_PARAM, "route already exists");
      }
      throw err;
    }
    if (!row) throw new AppError(ErrorCode.INTERNAL, "route create failed");
    return toRouteDto({ ...row, modelName: "", providerName: "" });
  }

  async updateRoute(
    idRaw: string,
    input: { remoteModelId?: string; priority?: number; weight?: number; active?: boolean; options?: Record<string, unknown> },
  ) {
    const id = parseId(idRaw);
    const [row] = await db.update(modelRoutes).set({
      remoteModelId: input.remoteModelId?.trim(),
      priority: input.priority,
      weight: input.weight,
      active: input.active,
      options: input.options,
      updatedAt: new Date(),
    }).where(eq(modelRoutes.id, id)).returning();
    if (!row) throw new AppError(ErrorCode.NOT_FOUND, "route not found");
    return toRouteDto({ ...row, modelName: "", providerName: "" });
  }

  async createModel(input: {
    name: string;
    displayName: string;
    capability: string;
    adapterCode: string;
    description?: string;
    modes?: Record<string, unknown>;
  }) {
    let row: typeof models.$inferSelect | undefined;
    try {
      [row] = await db
        .insert(models)
        .values({
          id: newId(),
          vendor: "self",
          name: input.name.trim(),
          displayName: input.displayName.trim(),
          description: input.description?.trim() ?? "",
          capability: input.capability.trim(),
          adapterCode: input.adapterCode.trim(),
          visible: false,
          sort: 900,
          modes: input.modes ?? {},
        })
        .returning();
    } catch (err) {
      if ((err as { code?: string }).code === "23505") {
        throw new AppError(ErrorCode.INVALID_PARAM, "model name already exists", { field: "name" });
      }
      throw err;
    }
    if (!row) throw new AppError(ErrorCode.INTERNAL, "model create failed");
    return {
      id: String(row.id),
      name: row.name,
      display_name: row.displayName,
      capability: row.capability,
      adapter_code: row.adapterCode,
      visible: row.visible,
    };
  }
}
