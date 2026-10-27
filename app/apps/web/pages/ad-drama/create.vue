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
useHead({ title: "广告剧 · 一帧" });

const api = useApi();
const toast = useToast();
const router = useRouter();

interface AssetDto {
  id: string;
  uri: string;
  name: string;
}

/** 竞品 `AD_RATIOS`（`ad.constants.ts:22`）：9:16 竖版 / 16:9 横版 */
const RATIOS = [
  { value: "9:16", label: "竖版 9:16（抖音/视频号）" },
  { value: "16:9", label: "横版 16:9（B 站/YouTube）" },
];

/** 风格：竞品 `style` 是"风格 ID"（值域未取证），我方给可读预置 + 自由输入 */
const STYLE_PRESETS = ["真人实拍", "动漫二次元", "3D 卡通", "赛博霓虹", "国风"];

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
    toast.error("请选择商品图片");
    return;
  }
  if (file.size > 8 * 1024 * 1024) {
    toast.error("图片不能超过 8MB");
    return;
  }
  uploading.value = true;
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
    form.materialImage = asset.uri;
    imagePreview.value = URL.createObjectURL(file);
    if (!form.materialName) {
      // 商品名默认取文件名（去掉扩展名）：运营少填一项是一个
      form.materialName = file.name.replace(/\.[^.]+$/, "").slice(0, 60);
    }
    toast.success("商品图已上传");
  } catch (err) {
    toast.error((err as Error).message || "上传失败");
  } finally {
    uploading.value = false;
  }
}

async function createProject(): Promise<void> {
  if (!form.materialName.trim()) {
    toast.error("请填写商品名称");
    return;
  }
  if (!form.materialHighlight.trim()) {
    toast.error("请填写商品亮点（卖点生成的输入）");
    return;
  }
  if (!form.materialImage) {
    toast.error("请上传商品图");
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
    toast.success("广告剧项目已创建，进入五段工作台");
    await router.push(`/ad-drama/workspace?id=${created.project.id}`);
  } catch (err) {
    toast.error((err as Error).message || "创建失败");
  } finally {
    creating.value = false;
  }
}
</script>

<template>
  <div class="ad-create">
    <header class="head">
      <div>
        <h1>广告剧</h1>
        <p class="muted">
          一张商品图 + 一句卖点，自动产出剧情方案、剧本、分镜与资产。对齐竞品 `/ad-drama/create` 五段流程。
        </p>
      </div>
      <NuxtLink to="/ad-drama/workspace" class="link">我的广告剧项目 →</NuxtLink>
    </header>

    <section class="card">
      <h2>① 商品素材</h2>
      <div class="material">
        <button type="button" class="uploader" :disabled="uploading" @click="fileInput?.click()">
          <img v-if="imagePreview" :src="imagePreview" alt="商品图预览" />
          <span v-else>{{ uploading ? "上传中…" : "上传商品图" }}</span>
        </button>
        <input ref="fileInput" type="file" accept="image/*" class="hidden" @change="pickImage" />
        <div class="material-fields">
          <label class="field">
            <span>商品名称 <b>*</b></span>
            <input v-model="form.materialName" maxlength="120" placeholder="例：便携榨汁杯" />
          </label>
          <label class="field">
            <span>商品亮点（一句卖点，生成多条卖点的输入）<b>*</b></span>
            <textarea
              v-model="form.materialHighlight"
              rows="3"
              maxlength="300"
              placeholder="例：30 秒出汁，充一次用一周，出差也能喝鲜榨"
            />
          </label>
        </div>
      </div>
    </section>

    <section class="card">
      <h2>② 生成设置</h2>
      <div class="grid">
        <label class="field">
          <span>画幅</span>
          <select v-model="form.ratio">
            <option v-for="item in RATIOS" :key="item.value" :value="item.value">{{ item.label }}</option>
          </select>
        </label>
        <label class="field">
          <span>风格</span>
          <select v-model="form.style">
            <option v-for="item in STYLE_PRESETS" :key="item" :value="item">{{ item }}</option>
          </select>
        </label>
        <label class="field">
          <span>主题（选填）</span>
          <input v-model="form.theme" maxlength="120" placeholder="例：夏日出行" />
        </label>
        <label class="field">
          <span>项目名称（选填，默认用商品名）</span>
          <input v-model="form.title" maxlength="120" placeholder="例：榨汁杯-夏日投放-A 版" />
        </label>
      </div>
    </section>

    <div class="actions">
      <button type="button" class="btn primary" :disabled="creating || uploading" @click="createProject">
        {{ creating ? "创建中…" : "创建项目并进入工作台" }}
      </button>
      <span class="muted small">
        创建后先「生成卖点」，再选剧情方案——竞品的顺序同样是先素材理解再创意选择。
      </span>
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
