<script setup lang="ts">
import type { WatchPublicationDto, WatchViewResultDto } from "~/types/api";

/**
 * ReelFlow 公开播放页（`/watch/:token`）—— 发布链的最后一段。
 *
 * 为什么这一页能"闭合"发布链：上一轮 `timeline_publications` 已经会把切片转成
 * `u/<space>/publications/<id>.mp4` 并发 `share_token`，但拿到链接的人**没有页面可看**，
 * 发布等于没发生。本页只做三件事：按 token 读（公开、未登录可看）→ 播放 → 计数。
 *
 * 四种非正常态必须各有明确出口（**不白屏、不 404**）：
 * - `transcoding`（status 1/2，转码中）→ 说明 + 重试
 * - `off_shelf`（status 5，已下架）→ 说明 + 回首页
 * - `not_found`（token 无效/不存在）→ 说明 + 回首页
 * - `transcode_failed`（status 4，转码失败）→ 说明 + 重试
 * reason 由后端写在错误消息末尾的 `（token）` 里（全局信封只下发 code+msg），这里按固定格式解析。
 *
 * i18n：语言由全局插件按 `?lang=` → cookie → 浏览器 协商（`plugins/i18n.ts`），
 * 本页用 `useI18n().locale` 取当前语言，文案用**页面内词典**（zh-CN/en）兜底；
 * 不新造 i18n 结构（任务要求），既有 key（`common.loading`/`share.backHome`）照用。
 */

definePageMeta({ ssr: false });

type WatchState = "loading" | "ready" | "transcoding" | "off_shelf" | "not_found" | "failed" | "error";

const route = useRoute();
const api = useApi();
const { t, locale } = useI18n();

const state = ref<WatchState>("loading");
const data = ref<WatchPublicationDto | null>(null);
const errorMsg = ref("");
const copied = ref(false);
const viewCount = ref(0);

const token = computed(() => String(route.params.token ?? ""));

/** 页面内文案词典（不新造 i18n 结构；缺语言回落中文） */
type WatchTextKey =
  | "loading"
  | "transcoding"
  | "transcodingHint"
  | "offShelf"
  | "offShelfHint"
  | "notFound"
  | "notFoundHint"
  | "failed"
  | "failedHint"
  | "error"
  | "retry"
  | "backHome"
  | "share"
  | "copied"
  | "copyFailed"
  | "publishedAt"
  | "views"
  | "episode"
  | "brand";

const DICT: Record<string, Record<WatchTextKey, string>> = {
  "zh-CN": {
    loading: "加载中…",
    transcoding: "视频正在转码",
    transcodingHint: "刚发布的切片需要一点时间处理，稍等片刻再刷新本页。",
    offShelf: "该视频已下架",
    offShelfHint: "发布者已经下架了这个视频。如果你需要观看，请联系分享者重新发布。",
    notFound: "链接无效或已失效",
    notFoundHint: "请检查链接是否完整（token 一般 32 位），或向分享者索取新的链接。",
    failed: "视频暂不可播放",
    failedHint: "这条视频转码失败，发布者需要重新发布。",
    error: "加载失败",
    retry: "重试",
    backHome: "返回首页",
    share: "复制分享链接",
    copied: "链接已复制",
    copyFailed: "复制失败，请手动复制地址栏链接",
    publishedAt: "发布于",
    views: "次播放",
    episode: "第 {no} 集",
    brand: "由 一帧 AI 漫剧工作台 生成",
  },
  en: {
    loading: "Loading…",
    transcoding: "This video is still transcoding",
    transcodingHint: "A freshly published clip needs a moment to process. Please refresh shortly.",
    offShelf: "This video is no longer available",
    offShelfHint: "The publisher took it down. Ask the publisher for a new link if you still need it.",
    notFound: "Invalid or expired link",
    notFoundHint: "Check that the link is complete (token is usually 32 characters) or request a new one.",
    failed: "Video temporarily unavailable",
    failedHint: "Transcoding failed for this video; the publisher needs to publish it again.",
    error: "Failed to load",
    retry: "Retry",
    backHome: "Back to home",
    share: "Copy share link",
    copied: "Link copied",
    copyFailed: "Copy failed — please copy the address bar manually",
    publishedAt: "Published",
    views: "views",
    episode: "Episode {no}",
    brand: "Generated with OneFrame AI studio",
  },
};

const txt = computed(() => {
  const dict = DICT[String(locale.value ?? "zh-CN")] ?? DICT["zh-CN"]!;
  return (name: WatchTextKey, vars?: Record<string, string | number>): string => {
    let out: string = dict[name];
    if (vars) for (const [k, v] of Object.entries(vars)) out = out.replace(`{${k}}`, String(v));
    return out;
  };
});

/** 后端把 reason 写在 msg 末尾：`...（off_shelf）` */
function reasonOf(message: string): string {
  const matched = /（([a-z_]+)）\s*$/.exec(message ?? "");
  return matched?.[1] ?? "";
}

function fmtDuration(ms: number | null): string {
  if (!ms || ms <= 0) return "";
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m > 0 ? `${m}:${String(s).padStart(2, "0")}` : `0:${String(s).padStart(2, "0")}`;
}

function fmtTime(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString(undefined, { hour12: false });
}

async function load(): Promise<void> {
  state.value = "loading";
  errorMsg.value = "";
  try {
    const res = await api.get<WatchPublicationDto>(`/watch/${token.value}`);
    data.value = res;
    viewCount.value = Number(res.view_count ?? 0);
    state.value = "ready";
    void reportView();
  } catch (e) {
    const err = e as { code?: number; message?: string };
    const reason = reasonOf(err.message ?? "");
    const message = err.message || "";
    if (reason === "off_shelf" || message.includes("off_shelf")) {
      state.value = "off_shelf";
    } else if (reason === "transcoding" || message.includes("transcoding")) {
      state.value = "transcoding";
    } else if (reason === "transcode_failed" || message.includes("transcode_failed")) {
      state.value = "failed";
    } else if (reason === "not_found" || message.includes("not_found") || err.code === 400102) {
      state.value = "not_found";
    } else {
      state.value = "error";
      errorMsg.value = message || t("errors.load");
    }
  }
}

/** 播放计数：同 IP 5 分钟内只算一次；失败不影响播放（best-effort） */
async function reportView(): Promise<void> {
  try {
    const res = await api.post<WatchViewResultDto>(`/watch/${token.value}/view`, {});
    viewCount.value = Number(res.view_count ?? viewCount.value);
  } catch {
    // 计数失败静默：不能让"计数"影响"能不能看"
  }
}

async function copyLink(): Promise<void> {
  const url = import.meta.client ? window.location.href : "";
  try {
    await navigator.clipboard.writeText(url);
    copied.value = true;
    setTimeout(() => (copied.value = false), 2000);
  } catch {
    // 非 HTTPS / 无剪贴板权限时退化成手动复制（不静默失败）
    if (import.meta.client) window.prompt(txt.value("copyFailed"), url);
  }
}

onMounted(load);
useHead({ title: () => (data.value?.title ? `${data.value.title} · 一帧` : "播放 · 一帧") });
</script>

<template>
  <div class="watch">
    <p v-if="state === 'loading'" class="w-state">{{ t("common.loading") }}</p>

    <!-- 可播放 -->
    <template v-else-if="state === 'ready' && data">
      <div class="w-stage">
        <video
          class="w-player"
          :src="data.file_url"
          controls
          playsinline
          preload="metadata"
          controlslist="nodownload"
        />
      </div>
      <section class="w-meta">
        <h1 class="w-title">{{ data.title }}</h1>
        <p class="w-sub">
          <span v-if="data.episode_no">{{ txt("episode", { no: data.episode_no }) }}</span>
          <span v-if="data.duration_ms" class="w-dot">·</span>
          <span v-if="data.duration_ms">{{ fmtDuration(data.duration_ms) }}</span>
          <span v-if="data.published_at" class="w-dot">·</span>
          <span v-if="data.published_at">{{ txt("publishedAt") }} {{ fmtTime(data.published_at) }}</span>
          <span class="w-dot">·</span>
          <span>{{ viewCount }} {{ txt("views") }}</span>
        </p>
        <div class="w-actions">
          <button type="button" class="w-btn w-btn-primary" @click="copyLink">
            {{ copied ? txt("copied") : txt("share") }}
          </button>
          <a class="w-btn" href="/">{{ txt("backHome") }}</a>
        </div>
        <p class="w-brand">{{ txt("brand") }}</p>
      </section>
    </template>

    <!-- 转码中 -->
    <section v-else-if="state === 'transcoding'" class="w-panel">
      <div class="w-badge w-badge-wait">●</div>
      <h1 class="w-panel-title">{{ txt("transcoding") }}</h1>
      <p class="w-panel-text">{{ txt("transcodingHint") }}</p>
      <div class="w-actions">
        <button type="button" class="w-btn w-btn-primary" @click="load">{{ txt("retry") }}</button>
        <a class="w-btn" href="/">{{ txt("backHome") }}</a>
      </div>
    </section>

    <!-- 已下架 -->
    <section v-else-if="state === 'off_shelf'" class="w-panel">
      <div class="w-badge w-badge-off">⊘</div>
      <h1 class="w-panel-title">{{ txt("offShelf") }}</h1>
      <p class="w-panel-text">{{ txt("offShelfHint") }}</p>
      <div class="w-actions">
        <a class="w-btn w-btn-primary" href="/">{{ txt("backHome") }}</a>
      </div>
    </section>

    <!-- 转码失败 -->
    <section v-else-if="state === 'failed'" class="w-panel">
      <div class="w-badge w-badge-off">!</div>
      <h1 class="w-panel-title">{{ txt("failed") }}</h1>
      <p class="w-panel-text">{{ txt("failedHint") }}</p>
      <div class="w-actions">
        <button type="button" class="w-btn w-btn-primary" @click="load">{{ txt("retry") }}</button>
        <a class="w-btn" href="/">{{ txt("backHome") }}</a>
      </div>
    </section>

    <!-- 不存在 / 加载失败 -->
    <section v-else-if="state === 'not_found'" class="w-panel">
      <div class="w-badge w-badge-none">?</div>
      <h1 class="w-panel-title">{{ txt("notFound") }}</h1>
      <p class="w-panel-text">{{ txt("notFoundHint") }}</p>
      <div class="w-actions">
        <a class="w-btn w-btn-primary" href="/">{{ txt("backHome") }}</a>
      </div>
    </section>

    <section v-else class="w-panel">
      <div class="w-badge w-badge-none">!</div>
      <h1 class="w-panel-title">{{ txt("error") }}</h1>
      <p class="w-panel-text">{{ errorMsg }}</p>
      <div class="w-actions">
        <button type="button" class="w-btn w-btn-primary" @click="load">{{ txt("retry") }}</button>
        <a class="w-btn" href="/">{{ txt("backHome") }}</a>
      </div>
    </section>
  </div>
</template>

<style scoped>
.watch {
  max-width: 1000px;
  margin: 0 auto;
  padding: 24px 20px 56px;
  color: var(--text-1, #e7e9f2);
}
.w-state {
  padding: 64px 0;
  text-align: center;
  color: var(--text-3, #8a90a6);
  font-size: 14px;
}
.w-stage {
  position: relative;
  border-radius: 14px;
  overflow: hidden;
  background: #000;
  box-shadow: 0 18px 48px rgba(0, 0, 0, 0.45);
}
.w-player {
  display: block;
  width: 100%;
  max-height: 72vh;
  background: #000;
}
.w-meta {
  margin-top: 18px;
}
.w-title {
  margin: 0 0 8px;
  font-size: 20px;
  line-height: 1.35;
  color: var(--text-1, #e7e9f2);
}
.w-sub {
  margin: 0 0 16px;
  font-size: 13px;
  color: var(--text-3, #8a90a6);
}
.w-dot {
  margin: 0 6px;
}
.w-actions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}
.w-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid rgba(255, 255, 255, 0.16);
  background: rgba(255, 255, 255, 0.06);
  color: var(--text-1, #e7e9f2);
  border-radius: 10px;
  padding: 9px 18px;
  font-size: 14px;
  text-decoration: none;
  cursor: pointer;
}
.w-btn:hover {
  background: rgba(255, 255, 255, 0.12);
}
.w-btn-primary {
  background: #2f5bd7;
  border-color: #2f5bd7;
  color: #fff;
}
.w-btn-primary:hover {
  background: #2a51c2;
}
.w-brand {
  margin: 18px 0 0;
  font-size: 12px;
  color: var(--text-3, #8a90a6);
}
.w-panel {
  margin: 56px auto 0;
  max-width: 560px;
  text-align: center;
  padding: 40px 28px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.03);
}
.w-badge {
  width: 52px;
  height: 52px;
  margin: 0 auto 16px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 22px;
}
.w-badge-wait {
  background: rgba(246, 173, 85, 0.16);
  color: #f0c48a;
}
.w-badge-off {
  background: rgba(255, 138, 138, 0.14);
  color: #ff8a8a;
}
.w-badge-none {
  background: rgba(255, 255, 255, 0.08);
  color: #8a90a6;
}
.w-panel-title {
  margin: 0 0 10px;
  font-size: 18px;
}
.w-panel-text {
  margin: 0 0 22px;
  font-size: 13px;
  line-height: 1.7;
  color: var(--text-2, #b6bcce);
}
.w-panel .w-actions {
  justify-content: center;
}
</style>
