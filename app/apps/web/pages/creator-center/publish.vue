<script setup lang="ts">
/**
 * 发布作品页（模块 #10 · 竞品 `/creator-center/publish`，`rea-reelmate/routes.txt:47`）。
 *
 * 发布 = 把「本子」上架到集市（`market_works`）。三个必须遵守的后端契约：
 * 1. `POST /market/creator/works`：`submit=true` 可直接提审；`/works/save` 强制留草稿。
 * 2. `submit` 前置条件由后端校验（价格 > 0；关联本子必须已定稿），缺什么后端一次说清，
 *    前端**原样展示** `missing[]`，不猜不吞。
 * 3. `POST /market/creator/works/parse`：选一个本子 → 拿建议标题/简介（不覆盖用户已填内容）。
 */
definePageMeta({ ssr: false, requiresAuth: true, layout: "app" });
const { t } = useI18n();
useHead({ title: () => t("publish.metaTitle") });

const api = useApi();
const toast = useToast();
const router = useRouter();

interface ProjectRow {
  id: string;
  title: string;
  status?: number;
}

const form = reactive({
  novelId: "",
  title: "",
  summary: "",
  kind: 1,
  price: 0,
  preorder: 0,
  categoryId: "",
});
const projects = ref<ProjectRow[]>([]);
const categories = ref<Array<{ id: string; name: string }>>([]);
const saving = ref(false);
const parsing = ref(false);
const error = ref("");
const missing = ref<string[]>([]);

const KIND_OPTIONS = computed(() => [
  { value: 1, label: t("publish.kinds.novel") },
  { value: 2, label: t("publish.kinds.script") },
  { value: 3, label: t("publish.kinds.storyboard") },
]);

async function loadOptions(): Promise<void> {
  try {
    const page = await api.get<{ list: ProjectRow[] }>("/projects?page_size=50");
    projects.value = page.list ?? [];
  } catch {
    projects.value = [];
  }
  try {
    const config = await api.get<{ categories?: Array<{ id: string; name: string }> }>("/market/scripts/config");
    categories.value = config.categories ?? [];
  } catch {
    categories.value = [];
  }
}

/** 选本子后拉建议值（parse 失败不阻塞，只是少个便利） */
async function parseFromNovel(): Promise<void> {
  if (!form.novelId) return;
  parsing.value = true;
  try {
    const suggestion = await api.post<{ title?: string; summary?: string; kind?: number }>(
      "/market/creator/works/parse",
      { novel_id: form.novelId },
    );
    if (suggestion.title && !form.title.trim()) form.title = suggestion.title;
    if (suggestion.summary && !form.summary.trim()) form.summary = suggestion.summary;
    if (suggestion.kind) form.kind = suggestion.kind;
    toast.success(t("publish.parseOk"));
  } catch (err) {
    toast.info((err as Error).message || t("publish.parseFailed"));
  } finally {
    parsing.value = false;
  }
}

async function submit(asDraft: boolean): Promise<void> {
  error.value = "";
  missing.value = [];
  if (!form.title.trim()) {
    error.value = t("publish.titleRequired");
    return;
  }
  if (!asDraft && form.price <= 0) {
    error.value = t("publish.priceRequired");
    return;
  }
  saving.value = true;
  try {
    const body = {
      novel_id: form.novelId || null,
      title: form.title.trim(),
      summary: form.summary.trim(),
      kind: form.kind,
      price_credits: Math.floor(form.price),
      preorder_price_credits: form.preorder > 0 ? Math.floor(form.preorder) : null,
      category_id: form.categoryId || null,
      submit: !asDraft,
    };
    const created = asDraft
      ? await api.post<{ id?: string }>("/market/creator/works/save", body)
      : await api.post<{ id?: string }>("/market/creator/works", body);
    toast.success(asDraft ? t("publish.draftSaved") : t("publish.submitted"));
    const id = created?.id;
    if (id) await router.push(`/creator-center/${id}`);
    else await router.push("/creator-center");
  } catch (err) {
    const message = (err as Error).message || t("publish.submitFailed");
    error.value = message;
    // 后端把"上架前置条件缺什么"放在 missing[]：原样展示，不猜
    // 业务错误信封只下发 {code,msg}（见 api-spec §16.0），结构化原因不保证存在；
    // 有 `details.missing[]` 就展示，没有就只显示 msg。
    const detail = (err as { details?: { missing?: string[] } }).details;
    if (detail?.missing) missing.value = detail.missing;
  } finally {
    saving.value = false;
  }
}

onMounted(loadOptions);
</script>

<template>
  <div class="publish">
    <header class="head">
      <div>
        <h1>{{ t("publish.title") }}</h1>
        <p class="muted">{{ t("publish.sub") }}</p>
      </div>
      <NuxtLink to="/creator-center" class="link">{{ t("publish.backToCenter") }}</NuxtLink>
    </header>

    <section class="panel">
      <h2>{{ t("publish.stepPick") }}</h2>
      <div class="row">
        <select v-model="form.novelId" class="input">
          <option value="">{{ t("publish.noNovel") }}</option>
          <option v-for="item in projects" :key="item.id" :value="item.id">{{ item.title }}</option>
        </select>
        <button type="button" class="btn" :disabled="!form.novelId || parsing" @click="parseFromNovel">
          {{ parsing ? t("publish.parsing") : t("publish.parseSuggestion") }}
        </button>
      </div>
    </section>

    <section class="panel">
      <h2>{{ t("publish.stepBasic") }}</h2>
      <div class="grid">
        <label class="field">
          <span>{{ t("publish.titleLabel") }} <b>*</b></span>
          <input v-model="form.title" maxlength="120" :placeholder="t('publish.titlePlaceholder')" />
        </label>
        <label class="field">
          <span>{{ t("publish.kindLabel") }}</span>
          <select v-model.number="form.kind">
            <option v-for="item in KIND_OPTIONS" :key="item.value" :value="item.value">{{ item.label }}</option>
          </select>
        </label>
        <label class="field wide">
          <span>{{ t("publish.summaryLabel") }}</span>
          <textarea v-model="form.summary" rows="4" maxlength="2000" :placeholder="t('publish.summaryPlaceholder')" />
        </label>
        <label class="field">
          <span>{{ t("publish.categoryLabel") }}</span>
          <select v-model="form.categoryId">
            <option value="">{{ t("publish.noCategory") }}</option>
            <option v-for="item in categories" :key="item.id" :value="item.id">{{ item.name }}</option>
          </select>
        </label>
      </div>
    </section>

    <section class="panel">
      <h2>{{ t("publish.stepPrice") }}</h2>
      <div class="grid">
        <label class="field">
          <span>{{ t("publish.priceLabel") }} <b>*</b></span>
          <input v-model.number="form.price" type="number" min="0" step="1" />
        </label>
        <label class="field">
          <span>{{ t("publish.preorderLabel") }}</span>
          <input v-model.number="form.preorder" type="number" min="0" step="1" />
        </label>
      </div>
      <p class="muted small">{{ t("publish.priceHint") }}</p>
    </section>

    <p v-if="error" class="err">{{ error }}</p>
    <ul v-if="missing.length" class="missing">
      <li v-for="item in missing" :key="item">{{ t("publish.missing", { item }) }}</li>
    </ul>

    <div class="actions">
      <button type="button" class="btn" :disabled="saving" @click="submit(true)">
        {{ saving ? t("publish.processing") : t("publish.saveDraft") }}
      </button>
      <button type="button" class="btn primary" :disabled="saving" @click="submit(false)">
        {{ saving ? t("publish.processing") : t("publish.submitReview") }}
      </button>
      <NuxtLink to="/creator-center" class="link">{{ t("publish.later") }}</NuxtLink>
    </div>
  </div>
</template>

<style scoped>
.publish {
  max-width: 880px;
  margin: 0 auto;
  padding: var(--space-6);
}
.head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: var(--space-4);
  margin-bottom: var(--space-4);
}
.head h1 {
  margin: 0 0 var(--space-2);
  font-size: var(--text-xl);
}
.head p {
  margin: 0;
  max-width: 560px;
  line-height: 1.6;
  font-size: var(--text-sm);
}
.link {
  color: var(--brand-1);
  font-size: var(--text-sm);
  white-space: nowrap;
}
.panel {
  border: 1px solid var(--border-1);
  border-radius: var(--radius-lg);
  background: var(--bg-sunken);
  padding: var(--space-5);
  margin-bottom: var(--space-4);
}
.panel h2 {
  margin: 0 0 var(--space-4);
  font-size: var(--text-md);
}
.row {
  display: flex;
  gap: var(--space-3);
  align-items: center;
  flex-wrap: wrap;
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
.field.wide {
  grid-column: 1 / -1;
}
.field b {
  color: #ff6b6b;
}
.input,
.field input,
.field select,
.field textarea {
  padding: 8px 10px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-1);
  background: var(--bg-app);
  color: var(--text-1);
  font: inherit;
}
.actions {
  display: flex;
  gap: var(--space-3);
  align-items: center;
  flex-wrap: wrap;
}
.btn {
  padding: 9px 16px;
  border-radius: var(--radius-sm);
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
  opacity: 0.55;
  cursor: default;
}
.err {
  color: #ff6b6b;
  font-size: var(--text-sm);
}
.missing {
  margin: 0 0 var(--space-3);
  padding-left: 20px;
  color: #f0a020;
  font-size: var(--text-sm);
}
.muted {
  color: var(--text-3);
}
.small {
  font-size: var(--text-xs);
}
</style>
