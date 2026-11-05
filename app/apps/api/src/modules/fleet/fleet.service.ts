import { and, desc, eq, gte, sql } from "drizzle-orm";
import { gpuAccounts, gpuJobs, gpuNodes, gpuPools } from "@app/db";
import { AppError, ErrorCode, newId } from "@app/shared";
import { db } from "../../db/database";
import { env } from "../../config/env";
import { decryptSecret, encryptSecret, secretHint } from "../admin/provider-crypto";
import { checkBudget } from "./fleet-budget";
import { AutodlProvisioner } from "./providers/autodl.provisioner";

/**
 * 机队编排（BYOC）：账号 → 池 → 节点。
 *
 * 边界（docs/02-architecture/autodl-integration.md §2）：
 * 本服务只负责「让节点在位」——开卡、关机、对账、预算；
 * **不负责**推理调度与任务状态机，那是 h3-gateway 与 worker 的事。
 */

const PROVIDER = "autodl";

function fleetEnabled(): boolean {
  return env.FLEET_ENABLED !== "off";
}

function assertEnabled(): void {
  if (!fleetEnabled()) throw new AppError(ErrorCode.NOT_FOUND, "自带算力未开启");
}



/** 节点自注册命令模板：`{pool}` 由服务端替换，token 由网关签发后拼进来 */
function joinCommand(poolId: string, joinToken: string): string {
  const template = env.FLEET_JOIN_COMMAND;
  if (!template) return "";
  return template.replaceAll("{pool}", poolId).replaceAll("{token}", joinToken);
}

/** 应用实例的启动命令：应用 autostart + join（覆盖语义见 env 注释） */
function appStartCommand(join: string): string {
  const template = env.FLEET_APP_START_COMMAND;
  if (!template.includes("{join}")) return template || join;
  return template.replace("{join}", join);
}

function instanceNameFor(poolId: string): string {
  return `oneframe-p${poolId}-${Math.random().toString(36).slice(2, 8)}`;
}

export interface FleetSummary {
  enabled: boolean;
  bound: boolean;
  tokenHint?: string;
  pool?: {
    id: string;
    gpuSpec: string;
    gpuCount: number;
    lifecycle: string;
    idleMinutes: number;
    imageReady: boolean;
    imageSource: string;
    applicationUuid: string | null;
    state: string;
    budgetDailyCents: number;
    budgetMonthCents: number;
  };
  nodes: Array<{ id: string; state: string; gpuSpec: string; costCents: number; startedAt: string | null }>;
  todayCents: number;
  monthCents: number;
}

export class FleetService {
  private provisioner(token: string, mode: "image" | "app" = "image"): AutodlProvisioner {
    return new AutodlProvisioner(token, fetch, mode);
  }

  private tokenOf(account: { tokenCiphertext: string; userId: bigint; credentialVersion: number }): string {
    return decryptSecret(account.tokenCiphertext, `gpu:${String(account.userId)}:${PROVIDER}`);
  }

  async accountOf(userId: string) {
    const [row] = await db
      .select()
      .from(gpuAccounts)
      .where(and(eq(gpuAccounts.userId, BigInt(userId)), eq(gpuAccounts.provider, PROVIDER)))
      .limit(1);
    return row;
  }

  /** 绑定：先真实调用 `/list` 验 Token，再加密落库（验证失败不写半条数据） */
  async bind(userId: string, spaceId: string, token: string): Promise<{ tokenHint: string }> {
    assertEnabled();
    const trimmed = token.trim();
    if (trimmed.length < 16) throw new AppError(ErrorCode.INVALID_PARAM, "Token 格式不对", { field: "token" });

    await this.provisioner(trimmed).listInstances(1); // 失败会抛 FLEET_TOKEN_INVALID

    const ciphertext = encryptSecret(trimmed, `gpu:${userId}:${PROVIDER}`).ciphertext;
    const hint = secretHint(trimmed);

    const existing = await this.accountOf(userId);
    if (existing) {
      await db
        .update(gpuAccounts)
        .set({
          tokenCiphertext: ciphertext,
          tokenHint: hint,
          credentialVersion: existing.credentialVersion + 1,
          status: 1,
          lastCheckAt: new Date(),
          lastCheckStatus: "ok",
          updatedAt: new Date(),
        })
        .where(eq(gpuAccounts.id, existing.id));
      await this.ensurePool(userId, existing.id, spaceId);
      return { tokenHint: hint };
    }

    const [created] = await db
      .insert(gpuAccounts)
      .values({
        id: newId(),
        userId: BigInt(userId),
        spaceId: spaceId ? BigInt(spaceId) : null,
        provider: PROVIDER,
        tokenCiphertext: ciphertext,
        tokenHint: hint,
        lastCheckAt: new Date(),
        lastCheckStatus: "ok",
      })
      .returning({ id: gpuAccounts.id });

    await this.ensurePool(userId, created!.id, spaceId);
    return { tokenHint: hint };
  }

  async unbind(userId: string): Promise<void> {
    const account = await this.accountOf(userId);
    if (!account) return;
    // 只吊销授权，不代删实例（用户资产可能还有别的用途）
    await db.update(gpuAccounts).set({ status: 0, updatedAt: new Date() }).where(eq(gpuAccounts.id, account.id));
  }

  async testToken(userId: string): Promise<{ ok: boolean; instances: number }> {
    const account = await this.accountOf(userId);
    if (!account || account.status !== 1) throw new AppError(ErrorCode.FLEET_TOKEN_REQUIRED, "尚未绑定 AutoDL 账号");
    const list = await this.provisioner(this.tokenOf(account)).listInstances(50);
    return { ok: true, instances: list.length };
  }

  private async ensurePool(userId: string, accountId: bigint, spaceId: string) {
    const [existing] = await db.select().from(gpuPools).where(eq(gpuPools.userId, BigInt(userId))).limit(1);
    if (existing) return existing;
    const [row] = await db
      .insert(gpuPools)
      .values({
        id: newId(),
        accountId,
        userId: BigInt(userId),
        name: "默认算力池",
        gpuSpec: env.FLEET_DEFAULT_GPU_SPEC,
        imageSource: env.FLEET_DEFAULT_IMAGE_SOURCE,
        applicationUuid: env.FLEET_DEFAULT_APPLICATION_UUID || null,
        applicationVersion: env.FLEET_DEFAULT_APPLICATION_VERSION,
        gpuCount: 1,
        // 实测：系统盘基线只有 30G（expand=0），而 H3 单变体权重 ≈67GB →
        // 默认扩 100G（总 130G）才装得下权重 + 环境 + 一次出片产物。
        systemDiskGb: env.FLEET_SYSTEM_DISK_GB,
        budgetDailyCents: env.FLEET_DEFAULT_DAILY_CENTS,
        budgetMonthCents: env.FLEET_DEFAULT_MONTH_CENTS,
      })
      .returning();
    void spaceId;
    return row!;
  }

  async summary(userId: string): Promise<FleetSummary> {
    const enabled = fleetEnabled();
    const account = await this.accountOf(userId);
    if (!enabled || !account) {
      return { enabled, bound: false, nodes: [], todayCents: 0, monthCents: 0 };
    }
    const pool = await this.ensurePool(userId, account.id, "");
    const nodes = await db.select().from(gpuNodes).where(eq(gpuNodes.poolId, pool.id));

    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const startOfMonth = new Date(startOfDay.getFullYear(), startOfDay.getMonth(), 1);

    const [today] = await db
      .select({ cents: sql<number>`coalesce(sum(${gpuJobs.costCents}), 0)::int` })
      .from(gpuJobs)
      .where(and(eq(gpuJobs.poolId, pool.id), gte(gpuJobs.createdAt, startOfDay)));
    const [month] = await db
      .select({ cents: sql<number>`coalesce(sum(${gpuJobs.costCents}), 0)::int` })
      .from(gpuJobs)
      .where(and(eq(gpuJobs.poolId, pool.id), gte(gpuJobs.createdAt, startOfMonth)));

    return {
      enabled,
      bound: true,
      tokenHint: account.tokenHint,
      pool: {
        id: String(pool.id),
        gpuSpec: pool.gpuSpec,
        gpuCount: pool.gpuCount,
        lifecycle: pool.lifecycle,
        idleMinutes: pool.idleMinutes,
        imageReady: Boolean(pool.applicationUuid || pool.imageUuid),
        imageSource: pool.imageSource,
        applicationUuid: pool.applicationUuid,
        state: pool.state,
        budgetDailyCents: pool.budgetDailyCents,
        budgetMonthCents: pool.budgetMonthCents,
      },
      nodes: nodes.map((n) => ({
        id: String(n.id),
        state: n.state,
        gpuSpec: n.gpuSpec,
        costCents: n.costAccruedCents,
        startedAt: n.startedAt ? n.startedAt.toISOString() : null,
      })),
      todayCents: today?.cents ?? 0,
      monthCents: month?.cents ?? 0,
    };
  }

  async updatePool(
    userId: string,
    patch: Partial<{
      lifecycle: string;
      idleMinutes: number;
      gpuSpec: string;
      dailyBudgetCents: number;
      monthBudgetCents: number;
      imageSource: string;
      imageUuid: string;
      applicationUuid: string;
      applicationVersion: string;
    }>,
  ): Promise<void> {
    const account = await this.accountOf(userId);
    if (!account) throw new AppError(ErrorCode.FLEET_TOKEN_REQUIRED, "尚未绑定 AutoDL 账号");
    const pool = await this.ensurePool(userId, account.id, "");
    await db
      .update(gpuPools)
      .set({
        ...(patch.lifecycle ? { lifecycle: patch.lifecycle } : {}),
        ...(patch.idleMinutes !== undefined ? { idleMinutes: Math.max(1, Math.min(240, patch.idleMinutes)) } : {}),
        ...(patch.gpuSpec ? { gpuSpec: patch.gpuSpec } : {}),
        ...(patch.imageSource ? { imageSource: patch.imageSource } : {}),
        ...(patch.imageUuid ? { imageUuid: patch.imageUuid } : {}),
        ...(patch.applicationUuid ? { applicationUuid: patch.applicationUuid } : {}),
        ...(patch.applicationVersion ? { applicationVersion: patch.applicationVersion } : {}),
        ...(patch.dailyBudgetCents !== undefined ? { budgetDailyCents: patch.dailyBudgetCents } : {}),
        ...(patch.monthBudgetCents !== undefined ? { budgetMonthCents: patch.monthBudgetCents } : {}),
        updatedAt: new Date(),
      })
      .where(eq(gpuPools.id, pool.id));
  }

  /**
   * 开一台节点（手动或由"任务到达"触发）。
   * 幂等：先按 `oneframe-p{poolId}-` 前缀查平台实例，已有 running/pending 的直接复用。
   */
  async startNode(
    userId: string,
  ): Promise<{ mode: "provisioned" | "guided"; nodeId: string | null; poolId: string; command?: string; note?: string }> {
    assertEnabled();
    const account = await this.accountOf(userId);
    if (!account || account.status !== 1) throw new AppError(ErrorCode.FLEET_TOKEN_REQUIRED, "尚未绑定 AutoDL 账号");
    const pool = await this.ensurePool(userId, account.id, "");

    // 社区镜像路线（v1）：用户自己开机器 → 粘 join 命令 → 节点自注册。
    // 这时我们没有 image_uuid 也不该报错：返回"引导模式"载荷，让前端展示命令。
    const appUuid = pool.applicationUuid ?? env.FLEET_DEFAULT_APPLICATION_UUID;
    const ready = pool.imageSource === "app" ? Boolean(appUuid) : Boolean(pool.imageUuid);
    if (!ready) {
      if (pool.imageSource !== "community") {
        throw new AppError(ErrorCode.FLEET_IMAGE_NOT_READY, "运行环境尚未配置（缺少 application_uuid / image_uuid）");
      }
      return {
        mode: "guided" as const,
        nodeId: null,
        poolId: String(pool.id),
        command: joinCommand(String(pool.id), env.FLEET_JOIN_TOKEN),
        note: "在你自己的 AutoDL 实例（H3 社区镜像）里执行这条命令，节点会自动注册",
      };
    }

    const [today] = await db
      .select({ cents: sql<number>`coalesce(sum(${gpuJobs.costCents}), 0)::int` })
      .from(gpuJobs)
      .where(and(eq(gpuJobs.poolId, pool.id), gte(gpuJobs.createdAt, new Date(new Date().setHours(0, 0, 0, 0)))));
    const budget = checkBudget({
      spentTodayCents: today?.cents ?? 0,
      spentMonthCents: 0,
      dailyBudgetCents: pool.budgetDailyCents,
      monthlyBudgetCents: pool.budgetMonthCents,
      estimateCents: pool.idleMinutes * 5,
    });
    if (!budget.allowed) throw new AppError(ErrorCode.FLEET_BUDGET_EXCEEDED, "已达预算上限", { reason: budget.reason });

    const provisioner = this.provisioner(this.tokenOf(account));
    const prefix = `oneframe-p${String(pool.id)}-`;
    const existing = (await provisioner.listInstances(50)).find(
      (i) => i.name.startsWith(prefix) && ["running", "starting", "pending"].includes(i.status),
    );
    if (existing) {
      const [row] = await db.select().from(gpuNodes).where(eq(gpuNodes.providerInstanceId, existing.uuid)).limit(1);
      if (row) return { mode: "provisioned", nodeId: String(row.id), poolId: String(pool.id) };
    }

    const joinToken = env.FLEET_JOIN_TOKEN;
    const base = {
      gpuSpec: pool.gpuSpec,
      gpuCount: pool.gpuCount,
      systemDiskGb: pool.systemDiskGb,
      instanceName: instanceNameFor(String(pool.id)),
      startCommand:
        pool.imageSource === "app"
          ? appStartCommand(joinCommand(String(pool.id), joinToken))
          : joinCommand(String(pool.id), joinToken) || undefined,
    };
    const uuid =
      pool.imageSource === "app" && appUuid
        ? await this.provisioner(this.tokenOf(account), "app").createApplication({
            ...base,
            applicationUuid: appUuid,
            applicationVersion: pool.applicationVersion || env.FLEET_DEFAULT_APPLICATION_VERSION,
          })
        : await this.provisioner(this.tokenOf(account)).create({
            ...base,
            imageUuid: pool.imageUuid ?? "",
          });

    const [node] = await db
      .insert(gpuNodes)
      .values({
        id: newId(),
        poolId: pool.id,
        providerInstanceId: uuid,
        instanceName: instanceNameFor(String(pool.id)),
        gpuSpec: pool.gpuSpec,
        vramGb: pool.gpuSpec.includes("48") ? 48 : 24,
        state: "provisioning",
        startedAt: new Date(),
      })
      .returning({ id: gpuNodes.id });
    await db.update(gpuPools).set({ state: "provisioning", updatedAt: new Date() }).where(eq(gpuPools.id, pool.id));
    return { mode: "provisioned", nodeId: String(node!.id), poolId: String(pool.id) };
  }

  async stopNode(userId: string, nodeId: string): Promise<void> {
    const account = await this.accountOf(userId);
    if (!account) throw new AppError(ErrorCode.FLEET_TOKEN_REQUIRED, "尚未绑定 AutoDL 账号");
    const [node] = await db.select().from(gpuNodes).where(eq(gpuNodes.id, BigInt(nodeId))).limit(1);
    if (!node) throw new AppError(ErrorCode.NOT_FOUND, "节点不存在");
    const [pool] = await db.select().from(gpuPools).where(eq(gpuPools.id, node.poolId)).limit(1);
    if (!pool || pool.userId !== BigInt(userId)) throw new AppError(ErrorCode.FORBIDDEN, "无权操作该节点");

    await this.provisioner(this.tokenOf(account)).powerOff(node.providerInstanceId);
    await db
      .update(gpuNodes)
      .set({ state: "stopped", stoppedAt: new Date(), updatedAt: new Date() })
      .where(eq(gpuNodes.id, node.id));
  }

  async bills(userId: string, limit = 20) {
    const account = await this.accountOf(userId);
    if (!account) return { list: [] };
    const [pool] = await db.select().from(gpuPools).where(eq(gpuPools.userId, BigInt(userId))).limit(1);
    if (!pool) return { list: [] };
    const rows = await db
      .select()
      .from(gpuJobs)
      .where(eq(gpuJobs.poolId, pool.id))
      .orderBy(desc(gpuJobs.createdAt))
      .limit(Math.max(1, Math.min(100, limit)));
    return {
      list: rows.map((r) => ({
        taskId: String(r.taskId),
        gpuSeconds: r.gpuSeconds,
        costCents: r.costCents,
        status: r.status,
        createdAt: r.createdAt.toISOString(),
      })),
    };
  }
}