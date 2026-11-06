import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from "@nestjs/common";
import { createHash } from "node:crypto";
import { from, type Observable, of, switchMap, throwError, catchError } from "rxjs";
import { and, eq } from "drizzle-orm";
import { idempotencyRecords } from "@app/db";
import { AppError, ErrorCode, isAppError, newId } from "@app/shared";
import { db } from "../../db/database";

/**
 * 写操作幂等账本（`Idempotency-Key` 头）—— 对照竞品 CLI 的 `ledger` 三态
 * （applied / pending / in_doubt，见 `_acceptance/_gap/cli-skill/.../manual/error-handling.md`）
 * 与 `manual/workflow/_stage-machine.md:99-104`「写操作即使网络超时也不要盲目重放」。
 *
 * ## 为什么必须有服务端这一层
 * 客户端账本只能证明"我没收到响应"，不能证明"服务端没执行"。没有服务端记录时：
 * 超时重放 → 可能重复下单/重复扣费；不重放 → 可能服务端根本没执行。两端都无法自证。
 *
 * ## 三态与处置
 * | 状态 | 含义 | 重放请求得到什么 |
 * |---|---|---|
 * | 1 处理中 | 已在执行 | `746001` 稍后重试（**不重复执行**） |
 * | 2 已完成 | 已出结果 | 原样重放（成功返回缓存 data；确定性失败重放同一错误） |
 * | 3 状态不明 | 崩溃/超时，未知是否已生效 | `746001` + 提示 `x-force-replay: 1`（人工确认后重放） |
 *
 * ## 边界（有意为之）
 * - 只对**登录态**的 POST/PUT/PATCH/DELETE 生效：登录/支付回调/公开写没有 space 归属，
 *   套幂等键会把"同一回调重试"变成"同一 key 冲突"，反而破坏渠道重试语义；
 * - 只缓存 5 分钟：超过窗口的重复提交视为新请求（竞品同口径）；
 * - 缓存的是**handler 返回值**（信封前），重放时仍走 EnvelopeInterceptor，信封形状一致。
 */
const TTL_MS = 5 * 60_000;
const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

interface IdemRequest {
  method: string;
  url: string;
  body?: unknown;
  headers: Record<string, string | string[] | undefined>;
  auth?: { spaceId?: string; userId?: string };
}

type BeginResult =
  | { mode: "proceed"; recordId: bigint }
  | { mode: "replay"; data: unknown }
  | { mode: "replay_error"; code: number; message: string };

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = ctx.switchToHttp().getRequest<IdemRequest>();
    const rawKey = req.headers["idempotency-key"];
    const key = Array.isArray(rawKey) ? rawKey[0] : rawKey;
    if (!key || !MUTATING.has(req.method)) return next.handle();
    const spaceId = req.auth?.spaceId;
    // 未登录的写（登录、支付回调、公开上报）不参与：见类注释的边界说明
    if (!spaceId) return next.handle();

    const requestHash = createHash("sha256")
      .update(`${req.method}:${req.url}:${JSON.stringify(req.body ?? null)}`)
      .digest("hex");
    const forceReplay = (req.headers["x-force-replay"] as string | undefined) === "1";

    return from(this.begin(key, spaceId, requestHash, forceReplay)).pipe(
      switchMap((result) => {
        if (result.mode === "replay") return of(result.data);
        if (result.mode === "replay_error") {
          return throwError(() => new AppError(result.code as never, result.message));
        }
        const recordId = result.recordId;
        return next.handle().pipe(
          // 成功：落缓存供重放
          switchMap(async (data) => {
            await this.finish(recordId, 2, data, null);
            return data;
          }),
          catchError((err: unknown) =>
            from(this.resolveFailure(recordId, err)).pipe(
              switchMap(() => throwError(() => err)),
            ),
          ),
        );
      }),
    );
  }

  private async begin(
    key: string,
    spaceId: string,
    requestHash: string,
    forceReplay: boolean,
  ): Promise<BeginResult> {
    const expireAt = new Date(Date.now() + TTL_MS);
    const recordId = newId();
    const inserted = await db
      .insert(idempotencyRecords)
      .values({
        id: recordId,
        key,
        spaceId: BigInt(spaceId),
        requestHash,
        expireAt,
        status: 1,
      })
      .onConflictDoNothing({ target: [idempotencyRecords.key, idempotencyRecords.spaceId] })
      .returning({ id: idempotencyRecords.id });
    if (inserted.length > 0) return { mode: "proceed", recordId: inserted[0]!.id };

    /**
     * 已存在 → 在**行锁**内判定（H: 并发重放竞态）。
     *
     * 旧实现在"已过期 / x-force-replay"分支无条件把状态重置为 1 并继续执行：
     * 两个并发重放都会看到"已过期"，于是同一请求被执行两次 —— 幂等键恰好在最需要它的
     * 场景（客户端超时后重试）失效。`FOR UPDATE` 把同 key 的判定串行化：
     * 后到者会等前者落定，再按最新状态走 replay / in-progress。
     */
    const claim = await db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(idempotencyRecords)
        .where(
          and(eq(idempotencyRecords.key, key), eq(idempotencyRecords.spaceId, BigInt(spaceId))),
        )
        .limit(1)
        .for("update");
      if (!row) return { mode: "proceed" as const, recordId }; // 极端竞态：被并发删掉了，按新请求走

      // 同一 key 换了请求体：这是**用错**而不是重放，必须拒绝（否则可能把 A 的结果返给 B）
      if (row.requestHash !== requestHash) {
        throw new AppError(
          ErrorCode.INVALID_PARAM,
          "idempotency key reused with a different request payload",
          { field: "Idempotency-Key" },
        );
      }

      const expired = row.expireAt.getTime() <= Date.now();
      if (expired || forceReplay) {
        await tx
          .update(idempotencyRecords)
          .set({
            status: 1,
            responseBody: null,
            errorBody: null,
            expireAt,
            updatedAt: new Date(),
          })
          .where(eq(idempotencyRecords.id, row.id));
        return { mode: "proceed" as const, recordId: row.id };
      }

      if (row.status === 2) {
        if (row.errorBody) {
          const err = row.errorBody as { code?: number; message?: string };
          return {
            mode: "replay_error" as const,
            code: Number(err.code ?? ErrorCode.BAD_REQUEST),
            message: String(err.message ?? "request previously failed"),
          };
        }
        return { mode: "replay" as const, data: row.responseBody };
      }
      if (row.status === 3) {
        throw new AppError(
          ErrorCode.IDEMPOTENT_REPLAY,
          "previous attempt state is unknown; re-run with x-force-replay: 1 after verifying the result",
          { record_id: String(row.id) },
        );
      }
      throw new AppError(ErrorCode.IDEMPOTENT_REPLAY, "same request is still in progress", {
        record_id: String(row.id),
      });
    });
    return claim as BeginResult;
  }

  /**
   * 失败落账：**确定性失败**（AppError 业务错误）记为已完成并缓存错误，重放返回同一错误；
   * 其余（未捕获异常/超时/进程级不确定）记为 in_doubt —— 因为它可能已经部分生效。
   */
  private async resolveFailure(recordId: bigint, err: unknown): Promise<void> {
    try {
      if (isAppError(err)) {
        await this.finish(recordId, 2, null, { code: err.code, message: err.message });
        return;
      }
      await this.finish(recordId, 3, null, null);
    } catch {
      // 落账失败不能影响原始错误向客户端传播
    }
  }

  private async finish(
    recordId: bigint,
    status: 1 | 2 | 3,
    data: unknown,
    errorBody: { code: number; message: string } | null,
  ): Promise<void> {
    await db
      .update(idempotencyRecords)
      .set({
        status,
        responseBody: (data ?? null) as never,
        errorBody: (errorBody ?? null) as never,
        updatedAt: new Date(),
      })
      .where(eq(idempotencyRecords.id, recordId));
  }
}
