<script setup lang="ts">
/**
 * 广告剧创建页（模块 #13 · 竞品 `/ad-drama/create`，`rea-reelmate/routes.txt:11`）。
 *
 * 竞品的五段（`feature-map.md:267`）：商品图 + 卖点 → brief → 剧本 → 分镜 → 资产。
 * 本页只做**第 0 步**：把「商品素材 + 一句卖点」变成项目；后续五段在 workspace 里走。
 *
 * 三个实现判断：
 * 1. **商品图先上传成资产再建项目**：竞品 `ad save` 的 `material_image` 是 `file_id`
 *    （`commands/ad.md:61`），我方等价物是 `assets.uri`，所以先 `POST /assets/upload` 拿 uri，
 *    再把它作为 `material_image` 传给 `/ad-drama/projects`——不把 base64 塞进项目记录
 *    （否则每次读项目详情都要传一张图的 base64）。
 * 2. **卖点在这里只填「商品亮点」**：真正的多条卖点由 `selling-point/generate` 生成
 *    （竞品也是"先有素材再生成卖点"，`commands/ad.md:85`），本页不假装能编辑 AI 卖点。
 * 3. **必填项与竞品一致**（`material_name`/`material_highlight`/`material_image`/`style`/`ratio`），
 *    不自造同义词，方便与 CLI `ad save` 对照验收。
 */
definePageMeta({ ssr: false, requiresAuth: true, layout: "app" });
const { t } = useI18n();
useHead({ title: () => t("adDrama.create.metaTitle") });

const api = useApi();
const toast = useToast();
const router = useRouter();

interface AssetDto {
  id: string;
  uri: string;
  name: string;
}

/** 竞品 `AD_RATIOS`（`ad.constants.ts:22`）：9:16 竖版 / 16:9 横版 */
const RATIOS = computed(() => [
  { value: "9:16", label: t("adDrama.create.ratios.vertical") },
  { value: "16:9", label: t("adDrama.create.ratios.horizontal") },
]);

/** 风格：竞品 `style` 是"风格 ID"（值域未取证），我方给可读预置 + 自由输入 */
// 落库值是**稳定 ASCII key**（live/anime/...），不是中文标签：
// 用中文当业务值会让"切到英文再提交"的同一需求在库里存两种值（同类问题还有
// film_tables 预置名、novel 步骤提示，都登记在进度文档 §5「后端中文数据」）。
// 历史草稿里仍是中文值，所以 styleLabel 同时映射旧中文值 → 已有数据也能显示译文。
const STYLE_PRESETS = ["live", "anime", "cartoon3d", "cyber", "guofeng"];
const styleLabel = (value: string): string => {
  const map: Record<string, string> = {
    live: t("adDrama.create.styles.live"),
    anime: t("adDrama.create.styles.anime"),
    cartoon3d: t("adDrama.create.styles.cartoon3d"),
    cyber: t("adDrama.create.styles.cyber"),
    guofeng: t("adDrama.create.styles.guofeng"),
    // 兼容旧草稿（历史版本把中文标签当值提交）
    真人实拍: t("adDrama.create.styles.live"),
    动漫二次元: t("adDrama.create.styles.anime"),
    "3D 卡通": t("adDrama.create.styles.cartoon3d"),
    赛博霓虹: t("adDrama.create.styles.cyber"),
    国风: t("adDrama.create.styles.guofeng"),
  };
  return map[value] ?? value;
};

const form = reactive({
  materialName: "",
  materialHighlight: "",
  materialImage: "",
  style: STYLE_PRESETS[0]!,
  ratio: "9:16",
  theme: "",
  title: "",
});

const uploading = ref(false);
const creating = ref(false);
const fileInput = ref<HTMLInputElement | null>(null);
const imagePreview = ref("");

async function pickImage(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  if (!file.type.startsWith("image/")) {
    toast.error(t("adDrama.create.errImageOnly"));
    return;
  }
  if (file.size > 8 * 1024 * 1024) {
    toast.error(t("adDrama.create.errImageSize"));
    return;
  }
  uploading.value = true;
  try {
    const base64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
      reader.onerror = () => reject(new Error(t("adDrama.create.errReadFile")));
      reader.readAsDataURL(file);
    });
    // 契约要求 `filename`（不是 `name`）：`assetUploadSchema.filename` 必填，
    // 传错字段会 400 "filename Required"，而前端只看到 toast、预览永远不出现。
    const asset = await api.post<AssetDto>("/assets/upload", {
      data_base64: base64,
      content_type: file.type,
      filename: file.name,
    });
    form.materialImage = asset.uri;
    imagePreview.value = URL.createObjectURL(file);
    if (!form.materialName) {
      // 商品名默认取文件名（去掉扩展名）：运营少填一项是一个
      form.materialName = file.name.replace(/\.[^.]+$/, "").slice(0, 60);
    }
    toast.success(t("adDrama.create.uploaded"));
  } catch (err) {
    toast.error((err as Error).message || t("adDrama.create.uploadFailed"));
  } finally {
    uploading.value = false;
  }
}

async function createProject(): Promise<void> {
  if (!form.materialName.trim()) {
    toast.error(t("adDrama.create.errName"));
    return;
  }
  if (!form.materialHighlight.trim()) {
    toast.error(t("adDrama.create.errHighlight"));
    return;
  }
  if (!form.materialImage) {
    toast.error(t("adDrama.create.errImage"));
    return;
  }
  creating.value = true;
  try {
    const created = await api.post<{ project: { id: string } }>("/ad-drama/projects", {
      title: form.title.trim() || undefined,
      material_name: form.materialName.trim(),
      material_highlight: form.materialHighlight.trim(),
      material_image: form.materialImage,
      style: form.style,
      ratio: form.ratio,
      theme: form.theme.trim() || undefined,
    });
    toast.success(t("adDrama.create.created"));
    await router.push(`/ad-drama/workspace?id=${created.project.id}`);
  } catch (err) {
    toast.error((err as Error).message || t("adDrama.create.createFailed"));
  } finally {
    creating.value = false;
  }
}
</script>

<template>
  <div class="ad-create">
    <header class="head">
      <div>
        <h1>{{ t("adDrama.create.title") }}</h1>
        <p class="muted">{{ t("adDrama.create.sub") }}</p>
      </div>
      <NuxtLink to="/ad-drama/workspace" class="link">{{ t("adDrama.create.myProjects") }}</NuxtLink>
    </header>

    <section class="card">
      <h2>{{ t("adDrama.create.stepMaterial") }}</h2>
      <div class="material">
        <button type="button" class="uploader" :disabled="uploading" @click="fileInput?.click()">
          <img v-if="imagePreview" :src="imagePreview" :alt="t('adDrama.create.previewAlt')" />
          <span v-else>{{ uploading ? t("adDrama.create.uploading") : t("adDrama.create.uploadHint") }}</span>
        </button>
        <input ref="fileInput" type="file" accept="image/*" class="hidden" @change="pickImage" />
        <div class="material-fields">
          <label class="field">
            <span>{{ t("adDrama.create.nameLabel") }} <b>*</b></span>
            <input v-model="form.materialName" maxlength="120" :placeholder="t('adDrama.create.namePlaceholder')" />
          </label>
          <label class="field">
            <span>{{ t("adDrama.create.highlightLabel") }} <b>*</b></span>
            <textarea
              v-model="form.materialHighlight"
              rows="3"
              maxlength="300"
              :placeholder="t('adDrama.create.highlightPlaceholder')"
            />
          </label>
        </div>
      </div>
    </section>

    <section class="card">
      <h2>{{ t("adDrama.create.stepSettings") }}</h2>
      <div class="grid">
        <label class="field">
          <span>{{ t("adDrama.create.ratioLabel") }}</span>
          <select v-model="form.ratio">
            <option v-for="item in RATIOS" :key="item.value" :value="item.value">{{ item.label }}</option>
          </select>
        </label>
        <label class="field">
          <span>{{ t("adDrama.create.styleLabel") }}</span>
          <select v-model="form.style">
            <option v-for="item in STYLE_PRESETS" :key="item" :value="item">{{ styleLabel(item) }}</option>
          </select>
        </label>
        <label class="field">
          <span>{{ t("adDrama.create.themeLabel") }}</span>
          <input v-model="form.theme" maxlength="120" :placeholder="t('adDrama.create.themePlaceholder')" />
        </label>
        <label class="field">
          <span>{{ t("adDrama.create.projectNameLabel") }}</span>
          <input v-model="form.title" maxlength="120" :placeholder="t('adDrama.create.projectNamePlaceholder')" />
        </label>
      </div>
    </section>

    <div class="actions">
      <button type="button" class="btn primary" :disabled="creating || uploading" @click="createProject">
        {{ creating ? t("adDrama.create.creating") : t("adDrama.create.createProject") }}
      </button>
      <span class="muted small">{{ t("adDrama.create.orderHint") }}</span>
    </div>
  </div>
</template>

<style scoped>
.ad-create {
  max-width: 980px;
  margin: 0 auto;
  padding: var(--space-6);
}
.head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-4);
  margin-bottom: var(--space-5);
}
.head h1 {
  margin: 0 0 var(--space-2);
  font-size: var(--text-xl);
}
.link {
  color: var(--brand-1);
  font-size: var(--text-sm);
  white-space: nowrap;
}
.card {
  background: var(--bg-sunken);
  border: 1px solid var(--border-1);
  border-radius: var(--radius-lg);
  padding: var(--space-5);
  margin-bottom: var(--space-4);
}
.card h2 {
  margin: 0 0 var(--space-4);
  font-size: var(--text-md);
}
.material {
  display: flex;
  gap: var(--space-5);
  align-items: flex-start;
  flex-wrap: wrap;
}
.uploader {
  width: 180px;
  height: 180px;
  border: 1px dashed var(--border-2);
  border-radius: var(--radius-md);
  background: var(--bg-app);
  color: var(--text-3);
  cursor: pointer;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
}
.uploader img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.material-fields {
  flex: 1;
  min-width: 260px;
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: var(--space-4);
}
.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: var(--text-sm);
}
.field b {
  color: var(--danger-1, #ff6b6b);
}
.field input,
.field select,
.field textarea {
  width: 100%;
  padding: 8px 10px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-1);
  background: var(--bg-app);
  color: var(--text-1);
  font: inherit;
}
.hidden {
  display: none;
}
.actions {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  flex-wrap: wrap;
}
.btn {
  padding: 10px 18px;
  border-radius: var(--radius-md);
  border: 1px solid var(--border-1);
  background: transparent;
  color: var(--text-1);
  cursor: pointer;
  font: inherit;
}
.btn.primary {
  background: var(--brand-1);
  border-color: transparent;
  color: #fff;
}
.btn:disabled {
  opacity: 0.6;
  cursor: default;
}
.muted {
  color: var(--text-3);
}
.small {
  font-size: var(--text-xs);
}
</style>
