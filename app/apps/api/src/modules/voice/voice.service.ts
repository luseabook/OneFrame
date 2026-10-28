import { Inject, Injectable } from "@nestjs/common";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { tasks, voiceFavorites } from "@app/db";
import { AppError, ErrorCode, newId, TaskStatus } from "@app/shared";
import { TIMBRE_PRESETS, TTS_VOICES } from "@app/model-adapters";
import { db } from "../../db/database";
import { toBigId } from "../../common/bigid";
import { StorageService } from "../../storage/storage.service";
import { TasksService } from "../tasks/tasks.service";

/**
 * 「我的音色」与音色目录（竞品 `/web/v1/ai/voice-clone*` + `/ai/timbre*` 共 5 条形状）。
 *
 * 三个设计决定：
 *
 * 1. **克隆记录不建表，直接投影 `tasks`**（`capability='speech' AND mode='voice_clone'`）。
 *    一次声音克隆本来就是一个生成任务：它有输入（参考音频 + 文本）、有产物（音频）、
 *    有状态（排队/处理/成功/失败）、有归属（space）。再建一张 `voice_clones` 表存同一件事，
 *    就会出现「任务成功了但克隆表没写」或反之的漂移 —— 所以列表/详情就是任务的行。
 *    改名复用 `tasks.title`（与 `PUT /agent/task/:id` 同一列），删除复用 `tasks.deleted_at`
 *    软删（`DELETE /tasks/:id` 同语义，且被 `canvas_nodes.task_id` 等引用，不能物理删）。
 *
 * 2. **收藏要一张关系表**（`voice_favorites`）。收藏对象既有内置音色（`TTS_VOICES` /
 *    `TIMBRE_PRESETS`，库里没有行）也有克隆音色（task id），所以用 `timbre_key` 字符串
 *    统一标识：`builtin:<voice_id>` / `clone:<task_id>`。这一列**故意不加外键**，
 *    因为内置音色没有可指向的行；也不能拆成 `builtin_key` + `task_id` 两列
 *    （PG 默认 `NULLS DISTINCT` 会让唯一键在「一半为 NULL」时失效）。
 *    幂等靠 `uq_voice_favorites(space_id, user_id, timbre_key)`，并发双击只落一行。
 *
 * 3. **目录是「内置 + 我的克隆」的合成视图，不建目录表**：内置音色在代码里
 *    （`TTS_VOICES` / `TIMBRE_PRESETS`，与适配器校验用的是同一份常量，避免两处漂移），
 *    克隆音色来自任务投影，收藏标记来自 `voice_favorites`。竞品 `timbre-category/list`
 *    的分类因此是「内置分组 + 我的克隆」两组，而不是运营可编辑的分类表。
 */

/** 内置音色的中文名（与 `tool-catalog.ts` 里 tts / audio-timbre 两张卡的 select 选项同一份文案） */
const BUILTIN_TIMBRE_LABELS: Record<string, string> = {
  zh_female_shuangkuaisisi: "爽快思思（女）",
  zh_female_tianmeixiaoyuan: "甜美小媛（女）",
  zh_male_yuanboxiaoshu: "渊博小叔（男）",
  zh_male_jieshuoxingger: "解说小哥（男）",
  en_female_sarah: "Sarah（英）",
  warm_female: "温柔女声",
  warm_male: "沉稳男声",
  narrator: "旁白",
  child: "童声",
  robot: "机械声",
};

export interface BuiltinTimbre {
  timbre_key: string;
  name: string;
  category: string;
  lang: string;
  gender: string;
  /** 能直接用它的工具：`tts` = 文生语音的 voice 参数；`timbre_modify` = 音色改造的预设 */
  engine: "tts" | "timbre_modify";
}

/** 内置音色目录（代码即事实；与适配器校验用的是同一份常量） */
export const BUILTIN_TIMBRES: BuiltinTimbre[] = [
  ...TTS_VOICES.map(
    (voice): BuiltinTimbre => ({
      timbre_key: `builtin:${voice}`,
      name: BUILTIN_TIMBRE_LABELS[voice] ?? voice,
      category: voice.startsWith("en_") ? "english" : voice.includes("_female_") ? "female" : "male",
      lang: voice.startsWith("en_") ? "en" : "zh",
      gender: voice.includes("_female_") ? "female" : "male",
      engine: "tts",
    }),
  ),
  ...TIMBRE_PRESETS.map(
    (preset): BuiltinTimbre => ({
      timbre_key: `builtin:${preset}`,
      name: BUILTIN_TIMBRE_LABELS[preset] ?? preset,
      category: "preset",
      lang: "zh",
      gender: "unknown",
      engine: "timbre_modify",
    }),
  ),
];

const CATEGORY_LABELS: Record<string, string> = {
  female: "女声",
  male: "男声",
  english: "英文",
  preset: "改造预设",
  clone: "我的克隆",
};

export interface TimbreListItem {
  timbre_key: string;
  name: string;
  category: string;
  lang: string;
  source: "system" | "clone";
  /** 克隆音色才有：来源任务 id（详情/删除/改名都用它） */
  task_id: string | null;
  /** 已成功任务的试听地址（现签 1h） */
  preview_url: string | null;
  is_collected: boolean;
  created_at: string | null;
}

export interface VoiceListQuery {
  page?: number;
  page_size?: number;
  category?: string;
  only_collected?: boolean;
  lang?: string;
}

type ResultItem = { uri?: string };

@Injectable()
export class VoiceService {
  constructor(
    @Inject(TasksService) private readonly tasks: TasksService,
    @Inject(StorageService) private readonly storage: StorageService,
  ) {}

  private async favoritesOf(spaceId: string, userId: string): Promise<Set<string>> {
    const rows = await db
      .select({ key: voiceFavorites.timbreKey })
      .from(voiceFavorites)
      .where(
        and(eq(voiceFavorites.spaceId, toBigId(spaceId, "space_id")), eq(voiceFavorites.userId, toBigId(userId, "user_id"))),
      );
    return new Set(rows.map((row) => row.key));
  }

  /**
   * 取产物试听地址：只给**成功**任务签，且只签第一个产物。
   *
   * 为什么不复用 `tasks.detail`：列表一次会有几十行，逐行调 detail 就是 N 次额外查询 +
   * N 次 task_events 读；这里只需要「第一段音频的现签地址」，直接从 DTO 的 results 签更省。
   */
  private async previewOf(status: number, results: unknown): Promise<string | null> {
    if (status !== TaskStatus.SUCCEEDED) return null;
    const items = Array.isArray(results) ? (results as ResultItem[]) : [];
    const uri = items[0]?.uri;
    if (!uri) return null;
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(uri)) return uri;
    try {
      return await this.storage.signDownload(uri, 3600);
    } catch {
      return null;
    }
  }

  /** 归属校验 + 类型校验：拿到的一定是**本 space 的克隆任务** */
  private async cloneDetail(spaceId: string, taskId: string) {
    const detail = await this.tasks.detail(spaceId, taskId);
    if (detail.mode !== "voice_clone") {
      // 不是克隆任务：报「没找到」而不是「类型不对」，避免拿 id 探测别人的任务是否存在
      throw new AppError(ErrorCode.NOT_FOUND, "voice not found");
    }
    return detail;
  }

  /** 我的音色列表（竞品 `GET /ai/voice-clone-list`） */
  async listClones(
    spaceId: string,
    userId: string,
    query: { page?: number; page_size?: number; status?: number },
  ) {
    const paged = await this.tasks.list(spaceId, {
      page: query.page,
      page_size: query.page_size,
      status: query.status,
      capability: "speech",
      mode: "voice_clone",
    });
    const favorites = await this.favoritesOf(spaceId, userId);
    const list = await Promise.all(
      paged.list.map(async (task) => ({
        task_id: task.task_id,
        name: task.title ?? "我的音色",
        status: task.status,
        preview_url: await this.previewOf(task.status, task.results),
        created_at: task.created_at,
        finished_at: task.finished_at,
        is_collected: favorites.has(`clone:${task.task_id}`),
      })),
    );
    return { list, total: paged.total, page: paged.page, page_size: paged.page_size };
  }

  /** 单个音色详情（竞品 `GET /ai/voice-clone/:task_id`） */
  async getClone(spaceId: string, userId: string, taskId: string) {
    const detail = await this.cloneDetail(spaceId, taskId);
    const favorites = await this.favoritesOf(spaceId, userId);
    const results = Array.isArray(detail.results) ? (detail.results as ResultItem[]) : [];
    const input = (detail.input ?? {}) as { reference_uris?: unknown };
    const reference = Array.isArray(input.reference_uris) ? (input.reference_uris[0] ?? null) : null;
    return {
      task_id: detail.task_id,
      name: detail.title ?? "我的音色",
      status: detail.status,
      preview_url: await this.previewOf(detail.status, detail.results),
      reference_uri: reference,
      result_count: results.length,
      created_at: detail.created_at,
      finished_at: detail.finished_at,
      is_collected: favorites.has(`clone:${detail.task_id}`),
    };
  }

  /** 改名（竞品 `POST /ai/voice-clone/rename`，body 传 task_id） */
  async rename(spaceId: string, taskId: string, name: string) {
    const detail = await this.cloneDetail(spaceId, taskId);
    const trimmed = name.trim();
    if (!trimmed) throw new AppError(ErrorCode.INVALID_PARAM, "name must not be empty", { field: "name" });
    const updated = await this.tasks.updateMeta(spaceId, detail.task_id, { title: trimmed.slice(0, 40) });
    return { task_id: updated.task_id, name: updated.title ?? "我的音色" };
  }

  /** 删除（竞品 `DELETE /ai/voice-clone/:task_id`）：软删，与 `DELETE /tasks/:id` 同语义 */
  async removeClone(spaceId: string, taskId: string) {
    const detail = await this.cloneDetail(spaceId, taskId);
    const result = await this.tasks.remove(spaceId, detail.task_id);
    return { task_id: detail.task_id, deleted: result.deleted, status: result.status };
  }

  /**
   * 收藏 / 取消收藏（竞品 `POST /ai/timbre/collect`）。
   *
   * `collect` 省略 = 取反（兼容「点一下切换」的 UI）；显式传 `true|false` 时幂等 ——
   * 双击不会让同一行变成两条，收藏数也不靠 `+1/-1` 累加，而是每次重算 `count(*)`
   * （累加在「取消后重新收藏」的并发下会漂移，重算永远等于真实行数）。
   */
  async collect(spaceId: string, userId: string, input: { timbre_key: string; collect?: boolean }) {
    const key = input.timbre_key.trim();
    if (!key) throw new AppError(ErrorCode.INVALID_PARAM, "timbre_key is required", { field: "timbre_key" });
    await this.assertTimbreKey(spaceId, key);
    const spaceBig = toBigId(spaceId, "space_id");
    const userBig = toBigId(userId, "user_id");

    const existing = await db
      .select({ id: voiceFavorites.id })
      .from(voiceFavorites)
      .where(
        and(
          eq(voiceFavorites.spaceId, spaceBig),
          eq(voiceFavorites.userId, userBig),
          eq(voiceFavorites.timbreKey, key),
        ),
      )
      .limit(1);

    const want: boolean = input.collect ?? existing.length === 0;
    if (want && existing.length === 0) {
      // `onConflictDoNothing` + 唯一索引：并发双击只会落一行，不会抛 23505
      await db
        .insert(voiceFavorites)
        .values({ id: newId(), spaceId: spaceBig, userId: userBig, timbreKey: key })
        .onConflictDoNothing();
    } else if (!want && existing.length > 0) {
      await db.delete(voiceFavorites).where(eq(voiceFavorites.id, existing[0]!.id));
    }

    const [countRow] = await db
      .select({ total: sql<number>`count(*)::int` })
      .from(voiceFavorites)
      .where(eq(voiceFavorites.timbreKey, key));
    return { timbre_key: key, collected: want, collect_count: countRow?.total ?? 0 };
  }

  /**
   * 校验 `timbre_key` 的形状：`builtin:<voice_id>` 或 `clone:<task_id>`。
   *
   * 为什么要拦：收藏是一张「用户不主动取消就一直在」的关系表。放任任意字符串写进来，
   * 表里会长出一堆拼错的键 —— 它们既匹配不回任何音色，也查不出是谁写错的；
   * `clone:` 分支还要额外校验该任务确实**是本 space 的克隆任务**（否则可以收藏别人的音色）。
   */
  private async assertTimbreKey(spaceId: string, key: string): Promise<void> {
    if (key.startsWith("builtin:")) {
      if (BUILTIN_TIMBRES.some((item) => item.timbre_key === key)) return;
      throw new AppError(ErrorCode.INVALID_PARAM, `unknown builtin timbre: ${key.slice("builtin:".length)}`, {
        field: "timbre_key",
      });
    }
    if (key.startsWith("clone:")) {
      const id = key.slice("clone:".length);
      if (!/^\d{1,20}$/.test(id)) {
        throw new AppError(ErrorCode.INVALID_PARAM, "invalid clone timbre key", { field: "timbre_key" });
      }
      await this.cloneDetail(spaceId, id);
      return;
    }
    throw new AppError(ErrorCode.INVALID_PARAM, "timbre_key must be builtin:<id> or clone:<task_id>", {
      field: "timbre_key",
    });
  }

  /** 音色分类（竞品 `GET /ai/timbre-category/list`） */
  async categories(spaceId: string, userId: string) {
    const favorites = await this.favoritesOf(spaceId, userId);
    const cloneCount = await this.countClones(spaceId);
    const counts = new Map<string, number>();
    for (const item of BUILTIN_TIMBRES) {
      counts.set(item.category, (counts.get(item.category) ?? 0) + 1);
    }
    if (cloneCount > 0) counts.set("clone", cloneCount);
    const list = [...counts.entries()].map(([category, count]) => ({
      category,
      label: CATEGORY_LABELS[category] ?? category,
      count,
    }));
    return { list, total: list.length, collected_count: favorites.size };
  }

  private async countClones(spaceId: string): Promise<number> {
    const [row] = await db
      .select({ total: sql<number>`count(*)::int` })
      .from(tasks)
      .where(
        and(
          eq(tasks.spaceId, toBigId(spaceId, "space_id")),
          eq(tasks.mode, "voice_clone"),
          isNull(tasks.deletedAt),
        ),
      );
    return row?.total ?? 0;
  }

  /**
   * 音色目录（竞品 `GET /ai/timbre/list`，query `page,page_size,category,only_collected,lang`）。
   *
   * 分页作用在**合并后的全集**上，而不是两块分别分页再拼 —— 后者 total 会对不上，
   * 且「第 2 页」可能只包含克隆音色，前端翻页体验会跳。克隆音色一次全量取
   * （一个人的克隆数量级是几十，不是几万），再在内存里合并过滤。
   */
  async listTimbres(spaceId: string, userId: string, query: VoiceListQuery) {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, query.page_size ?? 20));
    const favorites = await this.favoritesOf(spaceId, userId);

    const cloneRows = await db
      .select({
        id: tasks.id,
        title: tasks.title,
        status: tasks.status,
        results: tasks.results,
        createdAt: tasks.createdAt,
      })
      .from(tasks)
      .where(
        and(
          eq(tasks.spaceId, toBigId(spaceId, "space_id")),
          eq(tasks.mode, "voice_clone"),
          isNull(tasks.deletedAt),
        ),
      )
      .orderBy(desc(tasks.createdAt));

    const system: TimbreListItem[] = BUILTIN_TIMBRES.map((item) => ({
      timbre_key: item.timbre_key,
      name: item.name,
      category: item.category,
      lang: item.lang,
      source: "system",
      task_id: null,
      preview_url: null,
      is_collected: favorites.has(item.timbre_key),
      created_at: null,
    }));

    const clones: TimbreListItem[] = await Promise.all(
      cloneRows.map(async (row) => ({
        timbre_key: `clone:${row.id}`,
        name: row.title ?? "我的音色",
        category: "clone",
        lang: "zh",
        source: "clone" as const,
        task_id: String(row.id),
        preview_url: await this.previewOf(row.status, row.results),
        is_collected: favorites.has(`clone:${row.id}`),
        created_at: row.createdAt.toISOString(),
      })),
    );

    let all = [...system, ...clones];
    if (query.category) all = all.filter((item) => item.category === query.category);
    if (query.lang) all = all.filter((item) => item.lang === query.lang);
    if (query.only_collected) all = all.filter((item) => item.is_collected);

    const total = all.length;
    const list = all.slice((page - 1) * pageSize, page * pageSize);
    return { list, total, page, page_size: pageSize };
  }

  /**
   * 文生语音的音色清单（竞品 `GET /ai/text-to-speech/voice/list`，query `lang_code,platform_id`）。
   *
   * 与 `timbre/list` 的区别：这条只给「能直接填进 `mode=tts` 的 `voice` 参数」的值，
   * 所以只出 `engine==="tts"` 的内置音色 —— 不含改造预设，也不含克隆音色
   * （克隆音色要配参考音频走 `voice_clone`，塞进 tts 的 `voice` 会被供应商拒掉）。
   */
  async ttsVoices(query: { lang_code?: string }) {
    const list = BUILTIN_TIMBRES.filter((item) => item.engine === "tts")
      .filter((item) => !query.lang_code || item.lang === query.lang_code)
      .map((item) => ({
        voice_id: item.timbre_key.slice("builtin:".length),
        name: item.name,
        lang: item.lang,
        gender: item.gender,
        is_default: item.timbre_key === `builtin:${TTS_VOICES[0]}`,
      }));
    return { list, total: list.length, default_voice: TTS_VOICES[0] };
  }
}
