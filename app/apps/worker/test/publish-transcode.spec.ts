import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  createDb,
  episodes,
  scriptProjects,
  spaces,
  timelineExports,
  timelinePublications,
  users,
} from "@app/db";
import { LocalStorage } from "@app/storage";
import {
  ErrorCode,
  PUB_STATUS_FAILED,
  PUB_STATUS_QUEUED,
  PUB_STATUS_READY,
  publicationObjectKey,
} from "@app/shared";
import { runPublishTranscodeJob, resolvePublicationSourceKey } from "../src/publish-transcode";

/**
 * `publish.transcode` 队列消费者（第 57 批）。
 *
 * 这一组测的是**真 DB + 真 storage** 下的持久化副作用，不是状态机本身
 * （四条不变量已在 `packages/shared/src/publish-transcode.spec.ts` 用注入 deps 覆盖）。
 * 这里只关心三件在 worker 侧才成立的事：
 *   ① 源缺失 → 记录落 status=4 且 error 里带原因（**不抛异常**，否则 BullMQ 会无谓重投）；
 *   ② 已 READY 的记录被重投 → skipped，且**字段一个字都不改**（终态不可覆盖）；
 *   ③ 正常路径 → 产物写到 `u/<space>/publications/<id>.mp4`、status=3、share_token 落库。
 *
 * 刻意不跑真 ffmpeg：`trim` 不在 worker 侧注入点里（它由 shared 默认值走 trimVideoBuffer），
 * 本机的 clip 源是占位字节，真 ffmpeg 会失败并降级成 copy——那属于 shared 单测的职责。
 * 因此这里两条"成功路径"只断言存储与状态，不断言 transcode_mode 的具体取值。
 */
describe("publish.transcode worker consumer", () => {
  const handle = createDb(process.env.DATABASE_URL ?? "postgres://app@127.0.0.1:55432/app");
  const db = handle.db;
  let storageDir = "";
  let storage: LocalStorage;
  let spaceId: bigint;
  let userId: bigint;
  let projectId: bigint;
  let episodeId: bigint;
  const logs: Array<{ msg: string; obj: Record<string, unknown> }> = [];
  const log = (obj: Record<string, unknown>, msg: string) => {
    logs.push({ msg, obj });
  };

  beforeAll(async () => {
    storageDir = await mkdtemp(join(tmpdir(), "publish-transcode-"));
    storage = new LocalStorage({
      rootDir: storageDir,
      publicBaseUrl: "http://127.0.0.1:3002/v1",
      signSecret: "test-secret",
    });

    const tag = String(Date.now()).slice(-9);
    userId = BigInt(`9${tag}`);
    spaceId = BigInt(`8${tag}`);
    await db.insert(users).values({ id: userId, nickname: `pub-${tag}` });
    await db.insert(spaces).values({ id: spaceId, ownerUserId: userId });
    projectId = BigInt(`7${tag}`);
    await db.insert(scriptProjects).values({
      id: projectId,
      spaceId,
      title: "publish transcode 测试",
      ratio: "9:16",
    });
    episodeId = BigInt(`6${tag}`);
    await db.insert(episodes).values({ id: episodeId, projectId, epNo: 1, title: "第1集" });
  });

  afterAll(async () => {
    await db.delete(timelinePublications).where(eq(timelinePublications.spaceId, spaceId));
    await db.delete(timelineExports).where(eq(timelineExports.spaceId, spaceId));
    await db.delete(episodes).where(eq(episodes.projectId, projectId));
    await db.delete(scriptProjects).where(eq(scriptProjects.id, projectId));
    await db.delete(spaces).where(eq(spaces.id, spaceId));
    await db.delete(users).where(eq(users.id, userId));
    await handle.pool.end();
    await rm(storageDir, { recursive: true, force: true });
  });

  /** 造一条发布记录（id 无 default，必须自己给 bigint） */
  async function createPublication(opts: {
    status?: number;
    fileUri?: string | null;
    shareToken?: string | null;
  }): Promise<bigint> {
    const id = BigInt(`${Date.now()}${Math.floor(Math.random() * 1000)}`);
    await db.insert(timelinePublications).values({
      id,
      spaceId,
      projectId,
      episodeId,
      title: "测试切片",
      slice: { start_ms: 0, end_ms: 1000 },
      status: opts.status ?? PUB_STATUS_QUEUED,
      fileUri: opts.fileUri ?? null,
      shareToken: opts.shareToken ?? null,
    });
    return id;
  }

  async function readRow(id: bigint) {
    const [row] = await db
      .select()
      .from(timelinePublications)
      .where(eq(timelinePublications.id, id));
    return row!;
  }

  it("源缺失 → status=4 且 error 写入原因，且不抛异常", async () => {
    const id = await createPublication({});

    const outcome = await runPublishTranscodeJob(
      { db, storage, log },
      { publicationId: String(id), spaceId: String(spaceId), sourceKey: `u/${spaceId}/missing.mp4` },
    );

    expect(outcome.result).toBe("failed");
    expect(outcome.reason).toBeTruthy();

    const row = await readRow(id);
    expect(row.status).toBe(PUB_STATUS_FAILED);
    const err = row.error as { code?: number; message?: string } | null;
    expect(err?.code).toBe(ErrorCode.VENDOR_ERROR);
    expect(err?.message).toContain("publication transcode failed");

    // 失败也得进日志（运维要靠它定位是哪条 job 挂了）
    const last = logs[logs.length - 1]!;
    expect(last.msg).toBe("publish transcode finished");
    expect(last.obj.result).toBe("failed");
    expect(last.obj.publication_id).toBe(String(id));
  });

  it("已 READY 的记录被重投 → skipped，且不改写任何字段", async () => {
    const id = await createPublication({
      status: PUB_STATUS_READY,
      fileUri: `u/${spaceId}/publications/${"x"}.mp4`,
      shareToken: "already-published-token",
    });
    const before = await readRow(id);

    const outcome = await runPublishTranscodeJob(
      { db, storage, log },
      { publicationId: String(id), spaceId: String(spaceId), sourceKey: `u/${spaceId}/whatever.mp4` },
    );

    expect(outcome.result).toBe("skipped");
    expect(outcome.reason).toContain("terminal");

    const after = await readRow(id);
    expect(after.status).toBe(before.status);
    expect(after.fileUri).toBe(before.fileUri);
    expect(after.shareToken).toBe(before.shareToken);
    expect(after.publishedAt).toEqual(before.publishedAt);
  });

  it("记录不存在 → skipped（不新建、不抛）", async () => {
    const outcome = await runPublishTranscodeJob(
      { db, storage, log },
      { publicationId: "123456789012345678", spaceId: String(spaceId), sourceKey: "u/x/y.mp4" },
    );
    expect(outcome.result).toBe("skipped");
    expect(outcome.reason).toContain("not found");
  });

  it("正常路径 → 产物落 publications/<id>.mp4、status=3、share_token 落库", async () => {
    const id = await createPublication({});
    const sourceKey = `u/${spaceId}/exports/src-${String(id)}.mp4`;
    // 占位字节：真 trimVideoBuffer 会失败 → 降级 copy，正好覆盖"降级也要出片"这条真实路径
    await storage.put(sourceKey, Buffer.from("not-a-real-video-but-non-empty"), "video/mp4");

    const outcome = await runPublishTranscodeJob(
      { db, storage, log },
      { publicationId: String(id), spaceId: String(spaceId), sourceKey },
    );

    expect(outcome.result).toBe("ready");

    const row = await readRow(id);
    expect(row.status).toBe(PUB_STATUS_READY);
    expect(row.fileUri).toBe(publicationObjectKey(String(spaceId), String(id)));
    expect(row.shareToken).toBeTruthy();
    expect(row.publishedAt).toBeInstanceOf(Date);
    expect(row.error).toBeNull();

    // 产物真的写进了 storage（不是只改了库）
    const stored = await storage.read(row.fileUri!);
    expect(stored.byteLength).toBeGreaterThan(0);
  });

  // ── 第 58 批：抢占式进入转码中 ────────────────────────────────────────
  //
  // 背景：入队 + 内联兜底 + worker 重投三者并存时，同一条发布会**同时有两个执行者**。
  // 旧的 markTranscoding 是无条件 `.set({status:2})`，两边都会"开始"，后果有两个：
  // ① 同一个片源被转两遍（白烧 CPU/IO）；② 后写者会用新的 share_token 覆盖先写者的，
  // 用户手里那条分享链接中途失效。以下三例锁住"只有一个人能干活"。

  it("抢占：两条并发任务只有一个真转码，另一个 skipped 且不覆盖 share_token", async () => {
    const id = await createPublication({});
    const sourceKey = `u/${spaceId}/exports/race-${String(id)}.mp4`;
    await storage.put(sourceKey, Buffer.from("race-source-bytes"), "video/mp4");

    /**
     * 竞态必须**被控制**，不能靠调度运气。
     *
     * 直接 `Promise.all` 两条 job 时，慢机器上 A 可能连转码带落库全部跑完，
     * B 的 `loadPublication` 直接看到终态 3 → skipped 原因写的是 "terminal"，
     * 于是断言 `toContain("claimed")` 偶发失败（本机全量并发跑时实际发生过一次）。
     * 那并不是代码回归，而是**测试没锁住它想测的窗口**。
     *
     * 这里把 A 卡在「已抢占、刚进 readSource」这一瞬间：等到 B 走完自己的
     * markTranscoding（必然抢不到）再放行 A。这样测到的就一定是抢占路径。
     */
    let releaseRead = () => {};
    const readGate = new Promise<void>((resolve) => {
      releaseRead = resolve;
    });
    let markClaimed = () => {};
    const claimed = new Promise<void>((resolve) => {
      markClaimed = resolve;
    });
    const gatedStorage = new Proxy(storage, {
      get(target, prop, receiver) {
        if (prop === "read") {
          return async (key: string) => {
            markClaimed();
            await readGate;
            return target.read(key);
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    });

    const aPromise = runPublishTranscodeJob(
      { db, storage: gatedStorage, log },
      { publicationId: String(id), spaceId: String(spaceId), sourceKey },
    );
    // A 已把 status 抢成 2（否则 readSource 不会被调用），此刻才起 B
    await claimed;
    const b = await runPublishTranscodeJob(
      { db, storage, log },
      { publicationId: String(id), spaceId: String(spaceId), sourceKey },
    );
    releaseRead();
    const a = await aPromise;

    const results = [a.result, b.result].sort();
    expect(results).toEqual(["ready", "skipped"]);

    // 落库结果必须是"恰好一次"的证据：只有一条 ready 路径写过的痕迹
    const row = await readRow(id);
    expect(row.status).toBe(PUB_STATUS_READY);
    expect(row.shareToken).toBeTruthy();
    const skippedOne = a.result === "skipped" ? a : b;
    expect(skippedOne.reason).toContain("claimed");
  });

  it("接管：停在 2（转码中）但 updated_at 已过期的孤儿记录 → 仍能被重投的任务救回", async () => {
    const id = await createPublication({ status: 2 });
    // 把 updated_at 推到很久以前，模拟"执行者崩在转码中途、没人再碰它"
    await db
      .update(timelinePublications)
      .set({ updatedAt: new Date(Date.now() - 60 * 60_000) })
      .where(eq(timelinePublications.id, id));
    const sourceKey = `u/${spaceId}/exports/orphan-${String(id)}.mp4`;
    await storage.put(sourceKey, Buffer.from("orphan-source-bytes"), "video/mp4");

    const outcome = await runPublishTranscodeJob(
      { db, storage, log },
      { publicationId: String(id), spaceId: String(spaceId), sourceKey },
    );

    // 如果只认 status=1，这里会变成 skipped，孤儿记录永远没人管 —— 那比改造前更差
    expect(outcome.result).toBe("ready");
    expect((await readRow(id)).status).toBe(PUB_STATUS_READY);
  });

  it("不接管：停在 2 但 updated_at 很新（另一个执行者正在跑）→ skipped，不抢", async () => {
    const id = await createPublication({ status: 2 });
    const sourceKey = `u/${spaceId}/exports/busy-${String(id)}.mp4`;
    await storage.put(sourceKey, Buffer.from("busy-source-bytes"), "video/mp4");

    const outcome = await runPublishTranscodeJob(
      { db, storage, log },
      { publicationId: String(id), spaceId: String(spaceId), sourceKey },
    );

    expect(outcome.result).toBe("skipped");
    expect(outcome.reason).toContain("claimed");
    expect((await readRow(id)).status).toBe(2); // 保持"转码中"，让原执行者继续
  });

  // ── 第 58 批：看门狗重投的源 key 反查 ──────────────────────────────────
  //
  // 看门狗的"先救再判死"依赖能从发布记录找回源成片 key。这个 key 没有单独列，
  // 发布时被塞进了 slice.source_export_id（publish.service.ts 落库处），
  // 所以只能顺这条线查 timeline_exports.file_uri。返回 null = 救不了 → 才允许判失败。

  async function createExport(fileUri: string | null): Promise<bigint> {
    const id = BigInt(`${Date.now()}${Math.floor(Math.random() * 1000)}`);
    await db.insert(timelineExports).values({
      id,
      spaceId,
      projectId,
      episodeId,
      status: 3,
      fileUri,
      clipCount: 1,
      durationS: 3,
    });
    return id;
  }

  it("反查源 key：slice.source_export_id → timeline_exports.file_uri", async () => {
    const expectedKey = `u/${spaceId}/exports/source-${Date.now()}.mp4`;
    const exportId = await createExport(expectedKey);
    const id = await createPublication({});
    await db
      .update(timelinePublications)
      .set({ slice: { start_ms: 0, end_ms: 1000, source_export_id: String(exportId) } })
      .where(eq(timelinePublications.id, id));

    expect(await resolvePublicationSourceKey(db, String(id))).toBe(expectedKey);
  });

  it("反查源 key：slice 里没有 source_export_id → null（早期记录/手工插入，救不了）", async () => {
    const id = await createPublication({}); // slice 只有 start_ms/end_ms
    expect(await resolvePublicationSourceKey(db, String(id))).toBeNull();
  });

  it("反查源 key：导出记录的 file_uri 为空 → null（导出失败残留，救不了）", async () => {
    const exportId = await createExport(null);
    const id = await createPublication({});
    await db
      .update(timelinePublications)
      .set({ slice: { source_export_id: String(exportId) } })
      .where(eq(timelinePublications.id, id));
    expect(await resolvePublicationSourceKey(db, String(id))).toBeNull();
  });

  it("反查源 key：记录不存在 / id 非法 → null（不抛）", async () => {
    expect(await resolvePublicationSourceKey(db, "123456789012345678")).toBeNull();
    expect(await resolvePublicationSourceKey(db, "not-a-number")).toBeNull();
  });
});
