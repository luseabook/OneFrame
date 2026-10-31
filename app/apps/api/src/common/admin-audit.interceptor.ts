import { type CallHandler, type ExecutionContext, Inject, Injectable, type NestInterceptor } from "@nestjs/common";
import { type Observable, tap } from "rxjs";
import { AdminAuditService } from "../modules/admin/admin-audit.service";
import type { AdminAuth } from "../modules/admin/admin-auth.service";

/**
 * 审计范围：只记录运营后台的**写操作**。
 *
 * 为什么用 `/v1/ops/` 硬前缀而不是"是否带 adminAuth"：`adminAuth` 只说明"调用者有管理员身份"，
 * 而 `/v1/ops/` 才是"这是运营动作"的边界。两者同时满足才记，读请求（GET）一律不记——
 * 后台列表页每刷一次就写一条日志，会把真正有价值的写操作淹没（`admin_audit_logs` 的
 * 索引与保留策略都是按"低量、高价值"设计的）。
 */
const OPS_PATH_PREFIX = "/v1/ops/";
/** 无副作用的方法：不进入审计（HEAD/OPTIONS 是预检/探活，记为审计只有噪音） */
const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
/** 单条 payload 上限（8KB）：审计要能看清"改了什么"，但不该变成第二个对象存储 */
const MAX_PAYLOAD_BYTES = 8 * 1024;
/** 键名命中即脱敏：宁可多遮，也不能把密码/令牌落进长期保留的审计表 */
const SENSITIVE_KEY_RE = /password|passwd|token|secret|authorization|credential|cookie|api[_-]?key|private[_-]?key/i;
/** 深度/长度上限：防止畸形大对象把一条日志撑爆（payload 本身还有 8KB 总闸） */
const MAX_DEPTH = 6;
const MAX_ARRAY_ITEMS = 50;
const MAX_STRING_CHARS = 500;

interface AuditableRequest {
  method: string;
  url: string;
  /** Node 原生请求（Nest+Fastify 下与 fastify request 共享入站 URL，作兜底） */
  raw?: { url?: string };
  body?: unknown;
  ip?: string;
  id?: string;
  adminAuth?: AdminAuth;
  /** fastify 5：命中路由的模板（如 `/v1/ops/admin/config/:key`） */
  routeOptions?: { url?: string };
  /** fastify 4 的等价字段，保留兼容读取 */
  routerPath?: string;
}

function sanitize(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return "[depth-limit]";
  if (Array.isArray(value)) {
    return value.slice(0, MAX_ARRAY_ITEMS).map((item) => sanitize(item, depth + 1));
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEY_RE.test(k) ? "***" : sanitize(v, depth + 1);
    }
    return out;
  }
  if (typeof value === "string" && value.length > MAX_STRING_CHARS) {
    return `${value.slice(0, MAX_STRING_CHARS)}…`;
  }
  return value;
}

/** 脱敏 + 截断；导出仅为便于单测（生产只经拦截器调用） */
export function buildAuditPayload(body: unknown): unknown {
  if (body === undefined || body === null) return null;
  let serialized: string;
  try {
    serialized = JSON.stringify(sanitize(body));
  } catch {
    // 循环引用等：审计不能因此失败，退化成"无法序列化"标记
    return { _unserializable: true };
  }
  if (serialized === undefined) return null;
  if (Buffer.byteLength(serialized, "utf8") <= MAX_PAYLOAD_BYTES) {
    return JSON.parse(serialized) as unknown;
  }
  // 超限：保留前 2000 字符便于肉眼定位，其余丢弃（绝不落整段大 JSON）
  return {
    _truncated: true,
    size_bytes: Buffer.byteLength(serialized, "utf8"),
    preview: serialized.slice(0, 2000),
  };
}

/**
 * 管理端操作审计拦截器（契约 §3.4，全局 `APP_INTERCEPTOR`）。
 *
 * 三条不可协商的约束：
 * 1. **只记录成功**：`tap` 只在成功分支触发；失败请求由异常过滤器回错误，业务错误不是
 *    "运营改了什么"的证据，而失败原因已由请求日志/错误码承载；
 * 2. **绝不能影响业务**：写库是 fire-and-forget，`AdminAuditService.record` 内部再吞一次异常，
 *    这里也不 await —— 审计库抖动时运营操作必须照常返回；
 * 3. **不落敏感值**：入参按键名脱敏（密码/令牌/密钥），URL 只存**去掉查询串**的路径，
 *    避免把 `?token=` 之类写进长期保留的审计表。
 */
@Injectable()
export class AdminAuditInterceptor implements NestInterceptor {
  /**
   * 为什么显式 `@Inject(AdminAuditService)` 而不是只靠构造参数类型：
   * vitest 用 esbuild 转译，**不产出 `design:paramtypes` 元数据**，Nest 会把这个依赖当成 0 个参数
   * 直接 `new AdminAuditInterceptor()` —— `this.audit` 变成 undefined，于是 `tap` 里的
   * `setImmediate` 每次都抛 `Cannot read properties of undefined (reading 'record')`。
   * 这种错发生在响应之后，不会让任何一条断言变红，只是把整个 `pnpm test` 的退出码拖成 1；
   * 换成显式 token 后，tsc 构建与 esbuild 测试两条路径都能注入。
   */
  constructor(@Inject(AdminAuditService) private readonly audit: AdminAuditService) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = ctx.switchToHttp().getRequest<AuditableRequest>();
    const admin = req.adminAuth;
    const method = (req.method ?? "").toUpperCase();
    // 只存**去掉查询串**的路径：查询串里可能带 token/关键参数，审计表是长期保留的
    const rawPath = `${req.url || req.raw?.url || ""}`.split("?")[0] ?? "";
    // 只审计"已通过 AdminGuard 的运营写操作"；其余请求原样透传（零开销分支）
    if (!admin || READ_METHODS.has(method) || !rawPath.startsWith(OPS_PATH_PREFIX)) {
      return next.handle();
    }

    const res = ctx.switchToHttp().getResponse<{ statusCode?: number }>();
    const action = `${method} ${req.routeOptions?.url ?? req.routerPath ?? rawPath}`;
    const payload = buildAuditPayload(req.body);

    return next.handle().pipe(
      tap(() => {
        /**
         * 状态码要延后一拍再读：Nest 在拦截器 tap 之后才把 handler 的默认状态
         * （如 POST 的 201）写到 reply 上，立刻读会把 201 记成 200。
         * 用 setImmediate 而不是 await：审计写入不得进入本次响应的关键路径。
         */
        setImmediate(() => {
          const statusCode = typeof res.statusCode === "number" ? res.statusCode : 200;
          void this.audit.record({
            adminId: admin.adminId,
            adminUsername: admin.username,
            method,
            path: rawPath,
            action,
            statusCode,
            ok: statusCode < 400,
            ip: req.ip ?? null,
            requestId: req.id ?? null,
            payload,
          });
        });
      }),
    );
  }
}
