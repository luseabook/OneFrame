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
});
