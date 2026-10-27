import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { createDb, timelinePublications, scriptProjects, episodes } from "@app/db";
import { reviveStuckPublications } from "./maintenance";

/**
 * 发布转码看门狗（`reviveStuckPublications`）。
 *
 * 为什么需要它：`PublishService.publish()` 用 `void this.transcode(...)` 做**进程内**异步转码，
 * 好处是 API 不依赖 worker 也能跑通；代价是 API 在转码中途重启/崩溃时，记录永久停在
 * status=2（转码中）——用户看到"转码中"永不结束，也没有任务可重试。
 *
 * 本 spec 锁四件事：
 * 1. 超时的 2（转码中）/1（排队中）→ 4（失败）+ 可读原因；
 * 2. **未超时的**不被动（不能把正在跑的转码误杀）；
 * 3. 已终态（3 可播放 / 4 失败 / 5 已下架）不被改写；
 * 4. `scopeSpaceId` 只影响指定空间。
 */
const DSN = process.env.DATABASE_URL || "postgres://app:app@127.0.0.1:55432/app";

const silentLog = { info: () => {}, warn: () => {}, error: () => {} };

describe("worker: reviveStuckPublications", () => {
  const db = createDb(DSN).db;
  const stamp = String(Date.now()).slice(-9);
  let spaceId = "";
  let projectId = "";
  let episodeId = "";
  let userId = "";

  const mk = async (title: string, status: number, ageMinutes: number): Promise<string> => {
    const id = `${stamp}${Math.floor(Math.random() * 9000 + 1000)}`;
    const updatedAt = new Date(Date.now() - ageMinutes * 60_000);
    await db.insert(timelinePublications).values({
      id: BigInt(id),
      spaceId: BigInt(spaceId),
      projectId: BigInt(projectId),
      episodeId: BigInt(episodeId),
      title,
      slice: [],
      status,
      viewCount: 0,
      createdAt: updatedAt,
      updatedAt,
    });
    return id;
  };

  const statusOf = async (id: string): Promise<{ status: number; error: unknown }> => {
    const [row] = await db
      .select({ status: timelinePublications.status, error: timelinePublications.error })
      .from(timelinePublications)
      .where(sql`${timelinePublications.id} = ${BigInt(id)}`);
    return { status: Number(row?.status ?? 0), error: row?.error ?? null };
  };

  beforeAll(async () => {
    userId = String(
      (await db.execute<{ id: string }>(sql`insert into users (id, nickname) values (${BigInt(`${stamp}1`)}, 'wd') returning id`)).rows[0]?.id,
    );
    const sp = await db.execute<{ id: string }>(
      sql`insert into spaces (id, name, type, owner_user_id) values (${BigInt(`${stamp}2`)}, 'wd-space', 1, ${BigInt(userId)}) returning id`,
    );
    spaceId = String(sp.rows[0]?.id);
    const pj = await db
      .insert(scriptProjects)
      .values({ id: BigInt(`${stamp}3`), spaceId: BigInt(spaceId), title: `wd-${stamp}` })
      .returning({ id: scriptProjects.id });
    projectId = String(pj[0]?.id);
    const ep = await db
      .insert(episodes)
      .values({ id: BigInt(`${stamp}4`), projectId: BigInt(projectId), epNo: 1, title: "ep" })
      .returning({ id: episodes.id });
    episodeId = String(ep[0]?.id);
  }, 60_000);

  afterAll(async () => {
    await db.execute(sql`delete from timeline_publications where space_id = ${BigInt(spaceId)}`);
    await db.execute(sql`delete from episodes where project_id = ${BigInt(projectId)}`);
    await db.execute(sql`delete from script_projects where id = ${BigInt(projectId)}`);
    await db.execute(sql`delete from spaces where id = ${BigInt(spaceId)}`);
    await db.execute(sql`delete from users where id = ${BigInt(userId)}`);
  });

  it("超时的转码中/排队中 → 失败 + 可读原因", async () => {
    const stuckTranscoding = await mk(`wd-stuck-2-${stamp}`, 2, 30);
    const stuckQueued = await mk(`wd-stuck-1-${stamp}`, 1, 30);

    const revived = await reviveStuckPublications(db, silentLog, 15, BigInt(spaceId));
    expect(revived).toBeGreaterThanOrEqual(2);

    for (const id of [stuckTranscoding, stuckQueued]) {
      const after = await statusOf(id);
      expect(after.status).toBe(4);
      expect(JSON.stringify(after.error ?? {})).toContain("transcode_stalled");
    }
  });

  it("未超时的不被动（不能误杀正在转码的）", async () => {
    const fresh = await mk(`wd-fresh-${stamp}`, 2, 1);
    await reviveStuckPublications(db, silentLog, 15, BigInt(spaceId));
    expect((await statusOf(fresh)).status).toBe(2);
  });

  it("终态不被改写（3 可播放 / 4 失败 / 5 已下架）", async () => {
    const ready = await mk(`wd-ready-${stamp}`, 3, 120);
    const failed = await mk(`wd-failed-${stamp}`, 4, 120);
    const removed = await mk(`wd-removed-${stamp}`, 5, 120);
    await reviveStuckPublications(db, silentLog, 15, BigInt(spaceId));
    expect((await statusOf(ready)).status).toBe(3);
    expect((await statusOf(failed)).status).toBe(4);
    expect((await statusOf(removed)).status).toBe(5);
  });

  it("幂等：再跑一次不会重复计数", async () => {
    const again = await reviveStuckPublications(db, silentLog, 15, BigInt(spaceId));
    expect(again).toBe(0);
  });

  // ── 第 58 批：看门狗与 publish.transcode 队列协同 ──────────────────────
  //
  // 这几例锁的是第 57 批下沉后暴露出来的真实链路：worker 停机 20min 期间发布任务正常
  // 积压在 Redis 里，重启时 `runOnStart=true` 让看门狗先跑，旧口径"超时即失败"把
  // 这些任务全判成 4，随后队列把 job 投出来也只会被终态检查 skipped ——
  // 下沉换来的"重启可重投"被全额抵消。判定必须区分"在队列"与"真没人管"。

  it("仍在队列里（waiting/delayed/active）→ 跳过，不判失败", async () => {
    const queued = await mk(`wd-inqueue-${stamp}`, 1, 30);
    const revived = await reviveStuckPublications(db, silentLog, 15, BigInt(spaceId), {
      pendingInQueue: async () => new Set([queued]),
      requeue: async () => {
        throw new Error("不该走到重投：在队列里就不该重投");
      },
    });

    // 此刻本空间里唯一超时的记录就是 queued（前面的例都已推进到终态），
    // 所以"没有把任何一条判失败"是确定性断言，不是范围判断。
    expect(revived).toBe(0);
    expect((await statusOf(queued)).status).toBe(1);
  });

  it("不在队列且源可反查 → 重投而非判失败，并把 updated_at 推到当前", async () => {
    const orphan = await mk(`wd-orphan-${stamp}`, 2, 30);
    const requeuedIds: string[] = [];
    const before = Date.now();

    await reviveStuckPublications(db, silentLog, 15, BigInt(spaceId), {
      pendingInQueue: async () => new Set<string>(),
      requeue: async ({ publicationId }) => {
        requeuedIds.push(publicationId);
        return publicationId === orphan;
      },
    });

    expect(requeuedIds).toContain(orphan);
    const after = await statusOf(orphan);
    expect(after.status).toBe(2); // 没被判失败
    expect(after.error).toBeNull();
    // updated_at 被推到当前：否则下一轮它仍然"超时"，排查时看不出"已经被救过一次"
    const [row] = await db
      .select({ updatedAt: timelinePublications.updatedAt })
      .from(timelinePublications)
      .where(sql`${timelinePublications.id} = ${BigInt(orphan)}`);
    expect(new Date(row!.updatedAt).getTime()).toBeGreaterThanOrEqual(before - 1000);
  });

  it("不在队列且源不可反查（requeue 返回 false）→ 才判失败，文案说清救不了", async () => {
    const hopeless = await mk(`wd-hopeless-${stamp}`, 1, 30);
    await reviveStuckPublications(db, silentLog, 15, BigInt(spaceId), {
      pendingInQueue: async () => new Set<string>(),
      requeue: async () => false,
    });

    const after = await statusOf(hopeless);
    expect(after.status).toBe(4);
    expect(JSON.stringify(after.error ?? {})).toContain("transcode_stalled");
    // 与旧文案的区别：不是让用户"重新发布"，而是明确指出源成片可能已被清理
    expect(JSON.stringify(after.error ?? {})).toContain("无法自动重试");
  });

  it("队列探针抛错 → 整轮放弃判定，不误杀", async () => {
    const probeFail = await mk(`wd-probefail-${stamp}`, 2, 30);
    const revived = await reviveStuckPublications(db, silentLog, 15, BigInt(spaceId), {
      pendingInQueue: async () => {
        throw new Error("redis down");
      },
      requeue: async () => true,
    });

    // Redis 挂了意味着"不知道有没有执行者"，此时判失败会误杀正在跑的任务；
    // 宁可整轮放弃（下一轮探针恢复后自然会处理）。
    expect(revived).toBe(0);
    expect((await statusOf(probeFail)).status).toBe(2);
  });
});
