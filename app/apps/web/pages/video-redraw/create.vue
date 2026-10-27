<script setup lang="ts">
definePageMeta({ ssr: false, requiresAuth: true, layout: "app" });

/**
 * 视频转绘 · 新建（对照竞品 `/video-redraw/create`，`rt:121`）
 *
 * 交互与竞品一致的三步：**源视频 → 风格与强度 → 建项目**。
 *
 * 源视频有两个入口（都是真的能用的路径，不是摆设）：
 *   ① 上传本地文件 → `POST /assets/upload`（base64，视频上限 32MB）→ 拿 `uri`；
 *   ② 从资产库里选已有视频 → `GET /assets` 过滤 `kind === "video"`。
 * 之所以必须落成"资产"再建项目：竞品的转绘项目引用的就是资源库里的资源
 * （重绘时把源视频作为 `reference_uris[0]` 送给能力位），不是临时文件。
 *
 * 三态齐全：加载（资产列表）/ 空（没有视频资产，提示上传）/ 错误（可重试）。
 */

import type { AssetDto, Paged, RedrawProjectDto } from "~/types/api";

const api = useApi();
const toast = useToast();
const router = useRouter();
const activeSpace = useActiveSpaceId();

const STYLES = [
  { value: "anime", label: "日系动漫" },
  { value: "ghibli", label: "吉卜力" },
  { value: "ink", label: "国风水墨" },
  { value: "comic", label: "美漫" },
  { value: "cyberpunk", label: "赛博朋克" },
];

const loading = ref(true);
const errorMsg = ref("");
const busy = ref("");

const assets = ref<AssetDto[]>([]);
const projects = ref<RedrawProjectDto[]>([]);

const form = reactive({
  title: "",
  style: "anime",
  strength: 70,
  ratio: "9:16",
  sourceUri: "",
  sourceAssetId: "",
  sourceName: "",
  durationS: 60,
});

const selectedAsset = computed(() => assets.value.find((a) => a.uri === form.sourceUri) ?? null);
const canCreate = computed(() => form.title.trim().length > 0 && form.sourceUri.trim().length > 0);

async function load() {
  loading.value = true;
  errorMsg.value = "";
  try {
    const [assetRes, projectRes] = await Promise.all([
      api.get<Paged<AssetDto> & { total: number }>("/assets?page_size=100"),
      api.get<Paged<RedrawProjectDto>>("/video-redraw/projects?page_size=10"),
    ]);
    assets.value = assetRes.list.filter((a) => a.kind === "video");
    projects.value = projectRes.list;
  } catch (e) {
    errorMsg.value = (e as Error).message || "加载失败";
  } finally {
    loading.value = false;
  }
}

function pickAsset(a: AssetDto) {
  form.sourceUri = a.uri;
  form.sourceAssetId = a.id;
  form.sourceName = a.name;
  if (!form.title) form.title = `${a.name} 转绘`;
}

/** 本地文件 → base64 → `POST /assets/upload`（与竞品"上传源视频"同路径） */
async function onFile(evt: Event) {
  const input = evt.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  if (!file.type.startsWith("video/")) {
    toast.error("请选择视频文件（mp4/mov/webm 等）");
    return;
  }
  if (file.size > 32 * 1024 * 1024) {
    toast.error("视频需小于 32MB（服务端上限）；大文件请先压缩或改用资产库地址");
    return;
  }
  busy.value = "upload";
  try {
    const base64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
      reader.onerror = () => reject(new Error("读取文件失败"));
      reader.readAsDataURL(file);
    });
    const asset = await api.post<AssetDto>("/assets/upload", {
      data_base64: base64,
      content_type: file.type,
      name: file.name,
    });
    assets.value = [asset, ...assets.value];
    pickAsset(asset);
    toast.success("源视频已上传");
  } catch (e) {
    toast.error((e as Error).message || "上传失败");
  } finally {
    busy.value = "";
    input.value = "";
  }
}

async function createProject() {
  if (!form.title.trim()) {
    toast.error("请填写项目名称");
    return;
  }
  if (!form.sourceUri.trim()) {
    toast.error("请先上传源视频或选择资产");
    return;
  }
  busy.value = "create";
  try {
    const p = await api.post<RedrawProjectDto>("/video-redraw/projects", {
      title: form.title.trim(),
      source_uri: form.sourceUri.trim(),
      source_kind: form.sourceAssetId ? "asset" : "upload",
      source_asset_id: form.sourceAssetId || null,
      style: form.style,
      redraw_strength: form.strength,
      ratio: form.ratio,
      source_duration_s: form.durationS,
    });
    toast.success("转绘项目已创建，进入工作台");
    await router.push(`/video-redraw/workspace?id=${p.id}`);
  } catch (e) {
    toast.error((e as Error).message || "创建失败");
  } finally {
    busy.value = "";
  }
}

async function openWorkspace(id: string) {
  await router.push(`/video-redraw/workspace?id=${id}`);
}

onMounted(load);
</script>

<template>
  <div class="vr">
    <header class="vr-head">
      <div>
        <h1 class="vr-title">视频转绘</h1>
        <p class="vr-sub">已有视频 → 重绘成动漫：切集 → 分镜 → 重绘 → 绑定，四段流水线</p>
      </div>
      <button type="button" class="vr-btn" :disabled="loading" @click="load">刷新</button>
    </header>

    <p v-if="errorMsg" class="vr-alert">
      {{ errorMsg }}
      <button type="button" class="vr-link" @click="load">重试</button>
    </p>

    <div v-if="loading" class="vr-skeleton">加载中…</div>

    <div v-else class="vr-grid">
      <!-- ① 源视频 -->
      <section class="vr-card">
        <h2 class="vr-card-title">① 源视频</h2>
        <p class="vr-hint">上传本地视频（≤32MB），或从资产库挑一个已有视频。源视频会作为重绘的参考输入。</p>

        <label class="vr-upload">
          <input type="file" accept="video/*" hidden @change="onFile" />
          <span>{{ busy === "upload" ? "上传中…" : "选择本地视频上传" }}</span>
        </label>

        <div v-if="assets.length === 0" class="vr-empty">
          资产库里还没有视频。上面上传一个即可（上传后会自动选中）。
        </div>
        <ul v-else class="vr-assets">
          <li
            v-for="a in assets"
            :key="a.id"
            class="vr-asset"
            :class="{ active: a.uri === form.sourceUri }"
            @click="pickAsset(a)"
          >
            <span class="vr-asset-name">{{ a.name }}</span>
            <span class="vr-muted">{{ new Date(a.created_at).toLocaleDateString("zh-CN") }}</span>
          </li>
        </ul>

        <p v-if="form.sourceUri" class="vr-ok">
          已选源视频：{{ form.sourceName || form.sourceUri }}
        </p>
      </section>

      <!-- ② 风格与强度 -->
      <section class="vr-card">
        <h2 class="vr-card-title">② 风格与强度</h2>

        <label class="vr-field">
          <span>项目名称</span>
          <input v-model="form.title" class="vr-input" maxlength="120" placeholder="例如：预告片转绘" />
        </label>

        <label class="vr-field">
          <span>重绘风格</span>
          <div class="vr-styles">
            <button
              v-for="s in STYLES"
              :key="s.value"
              type="button"
              class="vr-chip"
              :class="{ active: form.style === s.value }"
              @click="form.style = s.value"
            >
              {{ s.label }}
            </button>
          </div>
        </label>

        <label class="vr-field">
          <span>重绘强度：{{ form.strength }}（0 保留构图 / 100 完全风格化）</span>
          <input v-model.number="form.strength" type="range" min="0" max="100" step="5" class="vr-range" />
        </label>

        <div class="vr-row">
          <label class="vr-field">
            <span>画面比例</span>
            <select v-model="form.ratio" class="vr-input">
              <option value="9:16">9:16 竖屏</option>
              <option value="16:9">16:9 横屏</option>
              <option value="1:1">1:1 方形</option>
            </select>
          </label>
          <label class="vr-field">
            <span>源视频时长（秒，用于切集/切镜估算）</span>
            <input v-model.number="form.durationS" type="number" min="1" max="36000" class="vr-input" />
          </label>
        </div>

        <button
          type="button"
          class="vr-btn primary"
          :disabled="busy === 'create' || !canCreate"
          :title="canCreate ? '' : '需要项目名称 + 源视频'"
          @click="createProject"
        >
          {{ busy === "create" ? "创建中…" : "③ 创建转绘项目" }}
        </button>
      </section>

      <!-- 最近项目 -->
      <section class="vr-card vr-card-wide">
        <h2 class="vr-card-title">最近的转绘项目</h2>
        <p v-if="projects.length === 0" class="vr-empty">还没有转绘项目。上面建一个就会出现在这里。</p>
        <ul v-else class="vr-projects">
          <li v-for="p in projects" :key="p.id" class="vr-project">
            <span class="vr-project-title">{{ p.title }}</span>
            <span class="vr-muted">
              风格 {{ p.mode_meta?.style || "—" }} · 强度 {{ p.mode_meta?.redraw_strength ?? "—" }}
            </span>
            <button type="button" class="vr-btn sm" @click="openWorkspace(p.id)">进入工作台</button>
          </li>
        </ul>
      </section>
    </div>
  </div>
</template>

<style scoped>
.vr { display: flex; flex-direction: column; gap: var(--space-4); }
.vr-head { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--space-4); }
.vr-title { font-size: 24px; font-weight: 700; margin: 0; }
.vr-sub { color: var(--text-2); margin: var(--space-1) 0 0; font-size: 13px; }
.vr-alert { margin: 0; padding: var(--space-3); border-radius: var(--radius-2); font-size: 13px; background: color-mix(in srgb, var(--danger-1, #e03131) 12%, transparent); color: var(--danger-1, #e03131); }
.vr-skeleton { padding: var(--space-6); text-align: center; color: var(--text-3); font-size: 13px; }
.vr-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: var(--space-3); }
.vr-card { padding: var(--space-4); background: var(--surface-1); border: 1px solid var(--border-1); border-radius: var(--radius-3); display: flex; flex-direction: column; gap: var(--space-3); }
.vr-card-wide { grid-column: 1 / -1; }
.vr-card-title { font-size: 15px; font-weight: 600; margin: 0; }
.vr-hint { color: var(--text-3); font-size: 12px; margin: 0; line-height: 1.6; }
.vr-empty { padding: var(--space-4); text-align: center; color: var(--text-3); font-size: 13px; }
.vr-upload { display: flex; align-items: center; justify-content: center; padding: var(--space-4); border: 1px dashed var(--border-1); border-radius: var(--radius-2); cursor: pointer; color: var(--brand-1, #7e70ff); font-size: 13px; }
.vr-assets { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; max-height: 220px; overflow: auto; }
.vr-asset { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); padding: 8px 10px; border: 1px solid var(--border-1); border-radius: var(--radius-2); cursor: pointer; font-size: 13px; }
.vr-asset.active { border-color: var(--brand-1, #7e70ff); background: color-mix(in srgb, var(--brand-1, #7e70ff) 8%, transparent); }
.vr-asset-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.vr-field { display: flex; flex-direction: column; gap: 6px; font-size: 12px; color: var(--text-3); }
.vr-input { padding: 8px 10px; font-size: 13px; border: 1px solid var(--border-1); border-radius: var(--radius-2); background: var(--surface-1); color: var(--text-1); }
.vr-range { width: 100%; }
.vr-row { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-3); }
.vr-styles { display: flex; flex-wrap: wrap; gap: 6px; }
.vr-chip { border: 1px solid var(--border-1); background: var(--surface-1); color: var(--text-2); font-size: 12px; padding: 5px 12px; border-radius: 999px; cursor: pointer; }
.vr-chip.active { border-color: var(--brand-1, #7e70ff); color: var(--brand-1, #7e70ff); }
.vr-btn { border: 1px solid var(--border-1); background: var(--surface-1); color: var(--text-1); font-size: 13px; padding: 8px 14px; border-radius: var(--radius-2); cursor: pointer; width: fit-content; }
.vr-btn.sm { padding: 5px 10px; font-size: 12px; }
.vr-btn.primary { background: var(--brand-1, #7e70ff); border-color: transparent; color: #fff; }
.vr-btn:disabled { opacity: 0.45; cursor: not-allowed; }
.vr-link { border: 0; background: transparent; color: var(--brand-1, #7e70ff); cursor: pointer; font-size: 13px; }
.vr-ok { margin: 0; color: var(--success-1, #2f9e44); font-size: 13px; }
.vr-muted { color: var(--text-3); font-size: 12px; }
.vr-projects { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.vr-project { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); padding: 8px 10px; border: 1px solid var(--border-1); border-radius: var(--radius-2); font-size: 13px; }
.vr-project-title { font-weight: 600; }

@media (max-width: 1080px) {
  .vr-grid { grid-template-columns: 1fr; }
  .vr-row { grid-template-columns: 1fr; }
}
</style>
