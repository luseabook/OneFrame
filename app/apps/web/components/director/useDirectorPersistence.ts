/**
 * 3D 导演台的持久化/协同逻辑（与 `Director3D.vue` 的渲染逻辑分开）。
 *
 * 为什么单独抽出来：
 * 1. `Director3D.vue` 已经是 1100+ 行的 three.js 渲染 + 交互组件，再塞持久化/心跳/冲突
 *    处理会让"改个按钮"都要通读整个 3D 初始化流程；
 * 2. 这里全部是**可单测的纯协议逻辑**（保存/乐观锁冲突/预设/心跳），与渲染无关；
 * 3. 组件状态 ↔ payload 的映射只允许出现在**一处**（`snapshot()` / `restore()` 回调），
 *    否则以后编辑器加一个字段会漏存（用户在导演台调好的位姿刷新就没了）。
 *
 * 协议（`/v1/director/*`）：
 *   GET    /director/scenes?project_id=  最近编辑优先 → 打开项目即载入最近场景
 *   POST   /director/scenes             保存新场景（version=1）
 *   PUT    /director/scenes/:id         乐观锁：version 不匹配 → 746002（msg 带 current=N）
 *   POST   /director/scenes/:id/duplicate
 *   POST   /director/pose-presets       1 个人 / 2 团队
 *   POST   /director/heartbeat          Redis TTL 60s，返回其他协作者
 */
import type { AssetDto, DirectorHeartbeatDto, DirectorPosePresetDto, DirectorSceneDto } from "~/types/api";
import { ApiError } from "~/composables/useApi";

/** 自动保存/心跳周期：30s 与设计稿一致；心跳 TTL 是 60s，允许丢一跳不误判离线 */
const SYNC_INTERVAL_MS = 30_000;
/** 乐观锁冲突码（与影视版同码） */
const VERSION_CONFLICT = 746002;

export interface DirectorPersistenceOptions {
  /** 当前项目（空 = 独立导演台，只走本地存档） */
  projectId: () => string | undefined;
  episodeId?: () => string | undefined;
  /** 组件当前状态 → payload（整份快照） */
  snapshot: () => Record<string, unknown>;
  /** payload → 组件状态（必须能容忍旧版本快照缺字段） */
  restore: (payload: Record<string, unknown>) => void;
  /** 应用姿态预设（组件决定怎么合并：预设是快照的子集） */
  applyPresetPayload?: (payload: Record<string, unknown>) => void;
  /** 顶部提示条（复用组件已有的 snapMsg） */
  notify?: (message: string) => void;
}

export function useDirectorPersistence(options: DirectorPersistenceOptions) {
  const api = useApi();

  const sceneId = ref<string>("");
  const sceneName = ref<string>("未命名场景");
  const version = ref<number>(0);
  const loading = ref(false);
  const saving = ref(false);
  const error = ref("");
  const lastSavedAt = ref<Date | null>(null);
  const dirty = ref(false);
  /**
   * 冲突时服务端当前版本（非空即表示"有人比我先保存"）。
   * 存 version 而不是布尔，是因为提示语要显示"服务端已是 v3"，用户才敢点覆盖。
   */
  const conflictVersion = ref<number | null>(null);
  const collaborators = ref<DirectorHeartbeatDto["collaborators"]>([]);
  const presets = ref<DirectorPosePresetDto[]>([]);
  const presetSaving = ref(false);

  let timer: ReturnType<typeof setInterval> | undefined;

  function notify(message: string): void {
    options.notify?.(message);
  }

  function markDirty(): void {
    dirty.value = true;
  }

  const statusText = computed(() => {
    if (saving.value) return "保存中…";
    if (conflictVersion.value !== null) return `版本冲突（服务端 v${conflictVersion.value}）`;
    if (dirty.value) return "有未保存修改";
    if (lastSavedAt.value) return `已保存 v${version.value} · ${lastSavedAt.value.toLocaleTimeString("zh-CN")}`;
    if (sceneId.value) return `已载入 v${version.value}`;
    return "尚未保存";
  });

  /** 打开项目 → 载入最近编辑的场景；返回是否载到 */
  async function loadLatest(): Promise<boolean> {
    const projectId = options.projectId();
    if (!projectId) return false;
    loading.value = true;
    error.value = "";
    try {
      const page = await api.get<{ list: DirectorSceneDto[]; total: number }>(
        `/director/scenes?project_id=${encodeURIComponent(projectId)}&page=1&page_size=1`,
      );
      const latest = Array.isArray(page.list) ? page.list[0] : undefined;
      if (!latest) return false;
      const detail = await api.get<DirectorSceneDto>(`/director/scenes/${latest.id}`);
      applyScene(detail);
      // 让 restore 触发的组件 watcher 全部跑完再清脏标记（否则"刚载入就显示有未保存修改"）
      await nextTick();
      dirty.value = false;
      return true;
    } catch (e) {
      error.value = e instanceof Error ? e.message : "载入场景失败";
      return false;
    } finally {
      loading.value = false;
    }
  }

  function applyScene(scene: DirectorSceneDto): void {
    sceneId.value = scene.id;
    sceneName.value = scene.name;
    version.value = scene.version;
    conflictVersion.value = null;
    lastSavedAt.value = new Date(scene.updated_at);
    options.restore(scene.payload ?? {});
  }

  /**
   * 保存（自动保存与手动保存共用）。
   *
   * `thumbnailDataUrl` 只手动保存时传（定格截图 → `/assets/upload` → storage key 落库），
   * 自动保存不传：缩略图是"用户确认的一张图"，不该被中间状态的截图覆盖。
   */
  async function save(opts: { thumbnailDataUrl?: string; force?: boolean } = {}): Promise<boolean> {
    if (saving.value) return false;
    if (conflictVersion.value !== null && !opts.force) return false;
    const projectId = options.projectId();
    if (!sceneId.value && !projectId) {
      error.value = "没有项目上下文，无法保存到服务端";
      return false;
    }
    saving.value = true;
    error.value = "";
    try {
      let thumbnailUri: string | undefined;
      if (opts.thumbnailDataUrl) {
        thumbnailUri = await uploadThumbnail(opts.thumbnailDataUrl);
      }
      const payload = options.snapshot();
      if (!sceneId.value) {
        const created = await api.post<DirectorSceneDto>("/director/scenes", {
          project_id: projectId,
          episode_id: options.episodeId?.(),
          name: sceneName.value || "未命名场景",
          payload,
          ...(thumbnailUri ? { thumbnail_uri: thumbnailUri } : {}),
        });
        applyScene(created);
      } else {
        const updated = await api.put<DirectorSceneDto>(`/director/scenes/${sceneId.value}`, {
          version: version.value,
          name: sceneName.value,
          payload,
          ...(thumbnailUri ? { thumbnail_uri: thumbnailUri } : {}),
        });
        applyScene(updated);
      }
      // 同 loadLatest：restore 会让组件 watcher 把你刚存的内容算成"新改动"，等它跑完再清
      await nextTick();
      dirty.value = false;
      lastSavedAt.value = new Date();
      return true;
    } catch (e) {
      if (e instanceof ApiError && e.code === VERSION_CONFLICT) {
        const matched = /current=(\d+)/.exec(e.message);
        conflictVersion.value = matched ? Number(matched[1]) : (await fetchServerVersion()) ?? version.value + 1;
        notify(`已有更新版本（服务端 v${conflictVersion.value}），请选择覆盖或放弃`);
        return false;
      }
      error.value = e instanceof Error ? e.message : "保存失败";
      return false;
    } finally {
      saving.value = false;
    }
  }

  /** 冲突时取服务端当前版本（msg 里没带版本号时的兜底） */
  async function fetchServerVersion(): Promise<number | null> {
    if (!sceneId.value) return null;
    try {
      const detail = await api.get<DirectorSceneDto>(`/director/scenes/${sceneId.value}`);
      return detail.version;
    } catch {
      return null;
    }
  }

  /** 冲突处理 A：用服务端最新版本号覆盖（用户确认"我的改动更重要"） */
  async function overwriteConflict(): Promise<boolean> {
    if (!sceneId.value) return false;
    const current = await fetchServerVersion();
    if (current === null) {
      error.value = "场景已不存在，无法覆盖";
      return false;
    }
    version.value = current;
    conflictVersion.value = null;
    return save({ force: true });
  }

  /** 冲突处理 B：放弃本地改动，重新载入服务端最新快照 */
  async function discardLocal(): Promise<boolean> {
    conflictVersion.value = null;
    const ok = await loadLatest();
    if (ok) dirty.value = false;
    return ok;
  }

  async function duplicate(): Promise<DirectorSceneDto | null> {
    if (!sceneId.value) {
      error.value = "先保存一次再复制";
      return null;
    }
    try {
      const created = await api.post<DirectorSceneDto>(`/director/scenes/${sceneId.value}/duplicate`, {
        name: `${sceneName.value} 副本`,
      });
      applyScene(created);
      dirty.value = false;
      notify("已复制为新场景");
      return created;
    } catch (e) {
      error.value = e instanceof Error ? e.message : "复制失败";
      return null;
    }
  }

  /**
   * 删除当前场景（软删：服务端置 `deleted_at`，列表/读取/复制都会 404）。
   *
   * 为什么要 UI：端点早就有（`DELETE /director/scenes/:id`）且有 spec，但导演台里
   * 没有任何入口 —— 用户建错场景只能改名"废弃"，列表越攒越乱。删除是不可逆操作，
   * 调用方必须自己先确认（组件里用 `window.confirm`）。
   */
  async function removeScene(): Promise<boolean> {
    if (!sceneId.value) {
      error.value = "当前场景还没保存过";
      return false;
    }
    try {
      await api.delete(`/director/scenes/${sceneId.value}`);
      notify("场景已删除");
      // 清空本地态：避免"删完还能点保存"把场景又建回来
      sceneId.value = "";
      sceneName.value = "未命名场景";
      version.value = 0;
      dirty.value = false;
      conflictVersion.value = null;
      lastSavedAt.value = null;
      return true;
    } catch (e) {
      error.value = e instanceof Error ? e.message : "删除失败";
      return false;
    }
  }

  async function uploadThumbnail(dataUrl: string): Promise<string | undefined> {
    try {
      const asset = await api.post<AssetDto>("/assets/upload", {
        filename: `director-thumb-${Date.now()}.png`,
        content_type: "image/png",
        data_base64: dataUrl,
      });
      // 存 storage key（uri），不存签名 URL：签名会过期，存下来第二天缩略图就 403
      return asset.uri;
    } catch {
      return undefined;
    }
  }

  async function heartbeat(): Promise<void> {
    if (!sceneId.value) return;
    try {
      const data = await api.post<DirectorHeartbeatDto>("/director/heartbeat", { scene_id: sceneId.value });
      collaborators.value = Array.isArray(data.collaborators) ? data.collaborators : [];
    } catch {
      /* 心跳失败不影响编辑：下一跳会补上 */
    }
  }

  async function loadPresets(): Promise<void> {
    try {
      const data = await api.get<{ list: DirectorPosePresetDto[] }>("/director/pose-presets");
      presets.value = Array.isArray(data.list) ? data.list : [];
    } catch {
      /* 预设加载失败不阻塞导演台 */
    }
  }

  async function savePreset(name: string, scope = 1): Promise<boolean> {
    if (!name.trim()) {
      error.value = "预设名不能为空";
      return false;
    }
    presetSaving.value = true;
    try {
      const created = await api.post<DirectorPosePresetDto>("/director/pose-presets", {
        name: name.trim().slice(0, 60),
        payload: options.snapshot(),
        scope,
      });
      presets.value = [created, ...presets.value];
      notify(`已保存预设「${created.name}」`);
      return true;
    } catch (e) {
      error.value = e instanceof Error ? e.message : "预设保存失败";
      return false;
    } finally {
      presetSaving.value = false;
    }
  }

  function applyPreset(preset: DirectorPosePresetDto): void {
    options.applyPresetPayload?.(preset.payload ?? {});
    dirty.value = true;
    notify(`已应用预设「${preset.name}」`);
  }

  /** 30s：有改动就存，无论是否改动都发一跳心跳 */
  function start(syncIntervalMs = SYNC_INTERVAL_MS): void {
    stop();
    timer = setInterval(() => {
      void heartbeat();
      if (dirty.value && conflictVersion.value === null) void save();
    }, syncIntervalMs);
  }

  function stop(): void {
    if (timer) clearInterval(timer);
    timer = undefined;
  }

  function dispose(): void {
    stop();
    collaborators.value = [];
  }

  return {
    // state
    sceneId,
    sceneName,
    version,
    loading,
    saving,
    error,
    lastSavedAt,
    dirty,
    conflictVersion,
    collaborators,
    presets,
    presetSaving,
    statusText,
    // actions
    markDirty,
    loadLatest,
    save,
    overwriteConflict,
    discardLocal,
    duplicate,
    removeScene,
    heartbeat,
    loadPresets,
    savePreset,
    applyPreset,
    start,
    stop,
    dispose,
  };
}
