import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { z } from "zod";
import { AppError, ErrorCode } from "@app/shared";
import { Public } from "../../common/public.decorator";
import { parseOrThrow } from "../../common/zod";
import type { AdminAuth } from "./admin-auth.service";
import { AdminGuard } from "./admin.guard";
import { AdminProvidersService } from "./admin-providers.service";

type AdminRequest = FastifyRequest & { adminAuth?: AdminAuth };

const emptyToUndefined = (value: unknown) => (value === "" || value === null ? undefined : value);
const numericId = z.string().trim().regex(/^\d+$/, "must be numeric id");

/**
 * 可接入的供应商协议族。必须与 `apps/worker/src/provider-runtime.ts` 的
 * `adapterOptionsFromSnapshot` 分支**一一对应**：那边认四种协议（ark / h3 / jianying /
 * openai-compatible / http-video），这边少一个 `h3` 的后果是「后台建不出 H3 供应商，
 * 但代码明明支持」——运营只能绕去改库，是最典型的配置面缺口。
 */
const providerProtocolSchema = z.enum(["openai-compatible", "ark", "http-video", "h3", "jianying"]);

const providerCreateSchema = z.object({
  code: z.string().trim().min(1).max(64).regex(/^[a-z0-9][a-z0-9-]*$/, "code must be lowercase slug"),
  name: z.string().trim().min(1).max(120),
  protocol: providerProtocolSchema,
  base_url: z.string().trim().url().max(500),
  api_key: z.string().trim().min(8).max(4096),
  auth_type: z.enum(["bearer", "header"]).optional(),
  auth_header: z.string().trim().min(1).max(64).optional(),
  options: z.record(z.unknown()).optional(),
});

const providerPatchSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  base_url: z.string().trim().url().max(500).optional(),
  api_key: z.string().trim().min(8).max(4096).optional(),
  auth_type: z.enum(["bearer", "header"]).optional(),
  auth_header: z.string().trim().min(1).max(64).optional(),
  options: z.record(z.unknown()).optional(),
  status: z.union([z.literal(1), z.literal(0)]).optional(),
});

const providerIdQuerySchema = z.object({
  provider_id: z.preprocess(emptyToUndefined, numericId.optional()),
});

const importModelsSchema = z.object({
  remote_model_ids: z.array(z.string().trim().min(1).max(200)).min(1).max(500),
});

const routeCreateSchema = z.object({
  model_id: numericId,
  provider_id: numericId,
  remote_model_id: z.string().trim().min(1).max(200),
  priority: z.number().int().min(0).max(10000).optional(),
  weight: z.number().int().min(0).max(1000).optional(),
  active: z.boolean().optional(),
  options: z.record(z.unknown()).optional(),
});

const routePatchSchema = z.object({
  remote_model_id: z.string().trim().min(1).max(200).optional(),
  priority: z.number().int().min(0).max(10000).optional(),
  weight: z.number().int().min(0).max(1000).optional(),
  active: z.boolean().optional(),
  options: z.record(z.unknown()).optional(),
});

const routeQuerySchema = z.object({
  model_id: z.preprocess(emptyToUndefined, numericId.optional()),
});

const modelCreateSchema = z.object({
  name: z.string().trim().min(1).max(80).regex(/^[a-z0-9][a-z0-9._:-]*$/, "name must be a protocol id"),
  display_name: z.string().trim().min(1).max(120),
  capability: z.string().trim().min(1).max(32),
  adapter_code: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500).optional(),
  modes: z.record(z.unknown()).optional(),
});

/** 供应商/路由是平台级配置：写操作只允许 super；测试/发现/导入允许 ops（guard 已挡 viewer） */
function requireSuper(req: AdminRequest): AdminAuth {
  const admin = req.adminAuth;
  if (!admin) throw new AppError(ErrorCode.UNAUTHORIZED, "admin auth required");
  if (admin.role !== "super") throw new AppError(ErrorCode.FORBIDDEN, "super admin only");
  return admin;
}

@Public()
@UseGuards(AdminGuard)
@Controller("ops/admin")
export class AdminProvidersController {
  constructor(@Inject(AdminProvidersService) private readonly providers: AdminProvidersService) {}

  @Get("providers")
  listProviders() {
    return this.providers.listProviders();
  }

  @Post("providers")
  createProvider(@Body() body: unknown, @Req() req: AdminRequest) {
    const admin = requireSuper(req);
    const input = parseOrThrow(providerCreateSchema, body ?? {});
    return this.providers.createProvider(
      {
        code: input.code,
        name: input.name,
        protocol: input.protocol,
        baseUrl: input.base_url,
        apiKey: input.api_key,
        authType: input.auth_type,
        authHeader: input.auth_header,
        options: input.options,
      },
      admin.adminId,
    );
  }

  @Patch("providers/:id")
  updateProvider(@Param("id") id: string, @Body() body: unknown, @Req() req: AdminRequest) {
    requireSuper(req);
    const input = parseOrThrow(providerPatchSchema, body ?? {});
    return this.providers.updateProvider(id, {
      name: input.name,
      baseUrl: input.base_url,
      apiKey: input.api_key,
      authType: input.auth_type,
      authHeader: input.auth_header,
      options: input.options,
      status: input.status,
    });
  }

  @Delete("providers/:id")
  disableProvider(@Param("id") id: string, @Req() req: AdminRequest) {
    requireSuper(req);
    return this.providers.disableProvider(id);
  }

  @Post("providers/:id/test")
  testProvider(@Param("id") id: string, @Req() req: AdminRequest) {
    const admin = req.adminAuth;
    if (!admin) throw new AppError(ErrorCode.UNAUTHORIZED, "admin auth required");
    this.providers.assertOutboundRate(admin.adminId, "test");
    return this.providers.testProvider(id);
  }

  @Post("providers/:id/discover")
  discoverModels(@Param("id") id: string, @Req() req: AdminRequest) {
    const admin = req.adminAuth;
    if (!admin) throw new AppError(ErrorCode.UNAUTHORIZED, "admin auth required");
    this.providers.assertOutboundRate(admin.adminId, "discover");
    return this.providers.discoverModels(id);
  }

  @Get("provider-models")
  listProviderModels(@Query() query: unknown) {
    const q = parseOrThrow(providerIdQuerySchema, query ?? {});
    if (!q.provider_id) throw new AppError(ErrorCode.INVALID_PARAM, "provider_id is required");
    return this.providers.listProviderModels(q.provider_id);
  }

  @Post("providers/:id/provider-models")
  importProviderModels(@Param("id") id: string, @Body() body: unknown) {
    const input = parseOrThrow(importModelsSchema, body ?? {});
    return this.providers.importProviderModels(id, input.remote_model_ids);
  }

  @Get("model-routes")
  listRoutes(@Query() query: unknown) {
    const q = parseOrThrow(routeQuerySchema, query ?? {});
    return this.providers.listRoutes(q.model_id);
  }

  @Post("model-routes")
  createRoute(@Body() body: unknown) {
    const input = parseOrThrow(routeCreateSchema, body ?? {});
    return this.providers.createRoute({
      modelId: input.model_id,
      providerId: input.provider_id,
      remoteModelId: input.remote_model_id,
      priority: input.priority,
      weight: input.weight,
      active: input.active,
      options: input.options,
    });
  }

  @Patch("model-routes/:id")
  updateRoute(@Param("id") id: string, @Body() body: unknown) {
    const input = parseOrThrow(routePatchSchema, body ?? {});
    return this.providers.updateRoute(id, {
      remoteModelId: input.remote_model_id,
      priority: input.priority,
      weight: input.weight,
      active: input.active,
      options: input.options,
    });
  }

  @Post("models")
  createModel(@Body() body: unknown) {
    const input = parseOrThrow(modelCreateSchema, body ?? {});
    return this.providers.createModel({
      name: input.name,
      displayName: input.display_name,
      capability: input.capability,
      adapterCode: input.adapter_code,
      description: input.description,
      modes: input.modes,
    });
  }
}
