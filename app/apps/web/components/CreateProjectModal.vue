<script setup lang="ts">
// 新建项目弹窗（对齐参照产品「短剧工作流 → 新建项目」）
// 左侧上传剧本 / 粘贴文本；右侧项目名称、剧目类型、画面比例；底部「立即创作」
import type { ProjectDto } from "~/types/api";

// initialTitle：从「剧本创作」页的灵感输入框带过来的初值（截到 50 字，与 title 上限一致）
const props = defineProps<{ open: boolean; initialTitle?: string; initialDramaType?: number }>();
const emit = defineEmits<{
  (e: "update:open", value: boolean): void;
  (e: "created", project: ProjectDto): void;
}>();

const api = useApi();
const toast = useToast();
// 五语言：弹窗内所有文案（含校验/失败提示）都走语言包，组件里不再留中文常量
const { t } = useI18n();

const title = ref("");
const dramaType = ref(1);
const ratio = ref<"9:16" | "16:9">("9:16");
const fileText = ref("");
const fileName = ref("");
const fileFormat = ref("");
const warnings = ref<string[]>([]);
const parsing = ref(false);
const pasteMode = ref(false);
const pasteText = ref("");
const submitting = ref(false);
const error = ref("");
const dragging = ref(false);
const fileInput = ref<HTMLInputElement | null>(null);

const dramaOptions = computed(() => [
  { value: 1, label: t("projectModal.drama.domestic"), img: "/images/drama/domestic-live.jpg" },
  { value: 2, label: t("projectModal.drama.overseas"), img: "/images/drama/overseas-live.jpg" },
  { value: 3, label: t("projectModal.drama.anime"), img: "/images/drama/anime-2d3d.jpg" },
]);
const ratioOptions = [
  { value: "9:16" as const, label: "9:16", kind: "phone" },
  { value: "16:9" as const, label: "16:9", kind: "monitor" },
];
const accept = ".txt,.md,.csv,.docx,.xlsx,.doc";

const scriptText = computed(() => (pasteMode.value ? pasteText.value : fileText.value));
const scriptChars = computed(() => scriptText.value.trim().length);
const titleChars = computed(() => title.value.length);
const canSubmit = computed(() => titleChars.value > 0 && titleChars.value <= 50 && !submitting.value);

function reset(): void {
  // 带初值时预填标题：用户在剧本创作页已经写过一句话，不该再让他重打一遍
  title.value = (props.initialTitle ?? "").trim().slice(0, 50);
  // 剧本创作页的「题材」下拉决定剧目类型初值（国内 / 海外 / 动漫）
  dramaType.value = props.initialDramaType ?? 1;
  ratio.value = "9:16";
  fileText.value = "";
  fileName.value = "";
  fileFormat.value = "";
  warnings.value = [];
  pasteMode.value = false;
  pasteText.value = "";
  error.value = "";
  parsing.value = false;
  submitting.value = false;
  dragging.value = false;
}

watch(
  () => props.open,
  (open) => {
    if (open) reset();
  },
);

function close(): void {
  if (submitting.value) return;
  emit("update:open", false);
}

function pickFile(): void {
  if (!parsing.value) fileInput.value?.click();
}

async function parseFile(file: File): Promise<void> {
  error.value = "";
  warnings.value = [];
  if (!/\.(txt|md|csv|docx|xlsx|doc)$/i.test(file.name)) {
    error.value = t("projectModal.fileFormat");
    return;
  }
  if (file.size > 8 * 1024 * 1024) {
    error.value = t("projectModal.fileTooLarge");
    return;
  }
  parsing.value = true;
  pasteMode.value = false;
  fileText.value = "";
  fileName.value = file.name;
  fileFormat.value = "";
  try {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ""));
      reader.onerror = () => reject(new Error(t("projectModal.readFailed")));
      reader.readAsDataURL(file);
    });
    const parsed = await api.post<{ text: string; format: string; chars: number; warnings: string[] }>(
      "/projects/parse-script",
      { file_name: file.name, file_base64: dataUrl },
    );
    fileText.value = parsed.text;
    fileFormat.value = parsed.format;
    warnings.value = parsed.warnings ?? [];
    if (!fileText.value.trim()) {
      error.value = t("projectModal.emptyText");
      fileName.value = "";
    }
  } catch (e) {
    fileName.value = "";
    error.value = e instanceof Error ? e.message : t("projectModal.parseFailed");
  } finally {
    parsing.value = false;
  }
}

function onFileChange(event: Event): void {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (file) void parseFile(file);
}

function onDrop(event: DragEvent): void {
  dragging.value = false;
  const file = event.dataTransfer?.files?.[0];
  if (file) void parseFile(file);
}

function removeFile(): void {
  fileText.value = "";
  fileName.value = "";
  fileFormat.value = "";
  warnings.value = [];
  error.value = "";
}

function togglePaste(): void {
  pasteMode.value = !pasteMode.value;
  if (pasteMode.value) {
    fileText.value = "";
    fileName.value = "";
    fileFormat.value = "";
    warnings.value = [];
  } else {
    pasteText.value = "";
  }
}

async function submit(): Promise<void> {
  error.value = "";
  if (!title.value.trim()) {
    error.value = t("projectModal.nameRequired");
    return;
  }
  if (titleChars.value > 50) {
    error.value = t("projectModal.nameTooLong");
    return;
  }
  submitting.value = true;
  try {
    const text = scriptText.value.trim().slice(0, 50000);
    const project = await api.post<ProjectDto>("/projects", {
      title: title.value.trim(),
      drama_type: dramaType.value,
      ratio: ratio.value,
      source_type: text ? 3 : 2,
      source_text: text,
      ...(fileName.value ? { source_file_name: fileName.value } : {}),
    });
    toast.success(t("projectModal.created"));
    emit("created", project);
    emit("update:open", false);
  } catch (e) {
    error.value = e instanceof Error ? e.message : t("projectModal.failed");
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <Teleport to="body">
    <Transition name="modal-fade">
      <div v-if="open" class="mask" @click.self="close">
        <section class="dialog" role="dialog" aria-modal="true" :aria-label="t('projectModal.aria')">
          <header class="head">
            <div>
              <h2>{{ t("projectModal.title") }}</h2>
              <p class="sub">{{ t("projectModal.subtitle") }}</p>
            </div>
            <button class="close" type="button" :aria-label="t('projectModal.close')" @click="close">✕</button>
          </header>

          <div class="body">
            <!-- 左：上传剧本 -->
            <div class="col left">
              <label class="label">{{ t("projectModal.uploadLabel") }}</label>
              <div
                class="dropzone"
                :class="{ dragging, filled: !!fileName }"
                role="button"
                tabindex="0"
                @click="pickFile"
                @keydown.enter="pickFile"
                @dragover.prevent="dragging = true"
                @dragleave.prevent="dragging = false"
                @drop.prevent="onDrop"
              >
                <input ref="fileInput" type="file" :accept="accept" class="file-input" @change="onFileChange" />

                <template v-if="!fileName">
                  <span class="upload-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M12 16V4m0 0 4 4m-4-4L8 8" />
                      <path d="M4 15v3.5A2.5 2.5 0 0 0 6.5 21h11a2.5 2.5 0 0 0 2.5-2.5V15" />
                    </svg>
                  </span>
                  <p class="drop-title">{{ t("projectModal.uploadTitle") }}</p>
                  <p class="drop-hint">{{ t("projectModal.uploadHint") }}</p>
                </template>

                <template v-else>
                  <div class="file-row">
                    <span class="file-icon" aria-hidden="true">📄</span>
                    <div class="file-meta">
                      <p class="file-name" :title="fileName">{{ fileName }}</p>
                      <p class="file-sub">
                        <template v-if="parsing">{{ t("projectModal.parsing") }}</template>
                        <template v-else>
                          {{ fileFormat ? fileFormat.toUpperCase() : t("projectModal.fileFallback") }} ·
                          {{ t("projectModal.chars", { count: scriptChars }) }}
                        </template>
                      </p>
                    </div>
                    <button class="file-remove" type="button" :disabled="parsing" @click.stop="removeFile">
                      {{ t("projectModal.remove") }}
                    </button>
                  </div>
                  <p v-if="warnings.length" class="warn">{{ warnings.join("；") }}</p>
                </template>
              </div>

              <button class="link" type="button" @click.stop="togglePaste">
                {{ pasteMode ? t("projectModal.toUpload") : t("projectModal.toPaste") }}
              </button>

              <textarea
                v-if="pasteMode"
                v-model="pasteText"
                class="paste"
                :placeholder="t('projectModal.pastePlaceholder')"
                maxlength="50000"
              />
              <p v-if="pasteMode" class="paste-count">{{ pasteText.length }}/50000</p>
            </div>

            <!-- 右：项目设置 -->
            <div class="col right">
              <label class="label">{{ t("projectModal.nameLabel") }}</label>
              <div class="title-wrap">
                <input
                  v-model="title"
                  class="input"
                  maxlength="50"
                  :placeholder="t('projectModal.namePlaceholder')"
                  @keyup.enter="submit"
                />
                <span class="counter" :class="{ full: titleChars >= 50 }">{{ titleChars }}/50</span>
              </div>

              <label class="label type-label">
                {{ t("projectModal.dramaLabel") }}
                <span class="info" :title="t('projectModal.dramaHint')">?</span>
              </label>
              <div class="types">
                <button
                  v-for="opt in dramaOptions"
                  :key="opt.value"
                  type="button"
                  class="type-card"
                  :class="{ active: dramaType === opt.value }"
                  @click="dramaType = opt.value"
                >
                  <img :src="opt.img" :alt="opt.label" class="type-img" />
                  <span class="type-name">{{ opt.label }}</span>
                </button>
              </div>

              <label class="label type-label">
                {{ t("projectModal.ratioLabel") }}
                <span class="info" :title="t('projectModal.ratioHint')">?</span>
              </label>
              <div class="ratios">
                <button
                  v-for="opt in ratioOptions"
                  :key="opt.value"
                  type="button"
                  class="ratio-card"
                  :class="{ active: ratio === opt.value }"
                  @click="ratio = opt.value"
                >
                  <span class="ratio-icon" aria-hidden="true">
                    <svg v-if="opt.kind === 'phone'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6">
                      <rect x="8" y="3" width="8" height="18" rx="2" />
                      <path d="M11 18h2" />
                    </svg>
                    <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6">
                      <rect x="3" y="5" width="18" height="12" rx="2" />
                      <path d="M8 20h8M12 17v3" />
                    </svg>
                  </span>
                  <span>{{ opt.label }}</span>
                </button>
              </div>
            </div>
          </div>

          <p v-if="error" class="error">{{ error }}</p>

          <footer class="foot">
            <button class="submit" type="button" :disabled="!canSubmit" @click="submit">
              {{ submitting ? t("projectModal.submitting") : t("projectModal.submit") }}
            </button>
          </footer>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.mask {
  position: fixed;
  inset: 0;
  z-index: 80;
  display: grid;
  place-items: center;
  padding: 24px;
  background: #000000b8;
  backdrop-filter: blur(2px);
}

.dialog {
  width: min(860px, 96vw);
  max-height: 92vh;
  overflow-y: auto;
  border-radius: 16px;
  border: 1px solid #ffffff1a;
  background: var(--bg-surface, #141414);
  box-shadow: 0 30px 90px #00000099;
  padding: 22px 24px 20px;
  box-sizing: border-box;
}

.head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 18px;
}

h2 {
  margin: 0;
  font-size: 18px;
  font-weight: 700;
}

.sub {
  margin: 6px 0 0;
  color: var(--text-3);
  font-size: 12px;
}

.close {
  border: 0;
  background: transparent;
  color: var(--text-3);
  font-size: 16px;
  line-height: 1;
  padding: 6px;
  cursor: pointer;
  border-radius: 8px;
}

.close:hover {
  background: var(--bg-hover);
  color: var(--text-1);
}

.body {
  display: grid;
  grid-template-columns: 300px 1fr;
  gap: 24px;
}

.col {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}

.label {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-2);
}

.type-label {
  margin-top: 14px;
  display: flex;
  align-items: center;
  gap: 6px;
}

.info {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  border: 1px solid var(--text-4);
  color: var(--text-4);
  font-size: 10px;
  line-height: 12px;
  text-align: center;
  cursor: help;
}

.dropzone {
  position: relative;
  min-height: 186px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 18px 16px;
  border-radius: 12px;
  border: 1px dashed #ffffff26;
  background: var(--bg-raised, #1f1f1f);
  text-align: center;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
}

.dropzone:hover,
.dropzone.dragging {
  border-color: var(--brand-500);
  background: #ffffff0a;
}

.dropzone.filled {
  align-items: stretch;
  justify-content: center;
  border-style: solid;
  border-color: #ffffff1f;
}

.file-input {
  display: none;
}

.upload-icon {
  width: 34px;
  height: 34px;
  color: var(--text-2);
}

.upload-icon svg {
  width: 100%;
  height: 100%;
}

.drop-title {
  margin: 4px 0 0;
  font-size: 12px;
  color: var(--text-2);
  line-height: 1.6;
  max-width: 220px;
}

.drop-hint {
  margin: 0;
  font-size: 11px;
  color: var(--text-4);
}

.file-row {
  display: flex;
  align-items: center;
  gap: 10px;
  text-align: left;
}

.file-icon {
  font-size: 20px;
}

.file-meta {
  min-width: 0;
  flex: 1;
}

.file-name {
  margin: 0;
  font-size: 12px;
  color: var(--text-1);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.file-sub {
  margin: 2px 0 0;
  font-size: 11px;
  color: var(--text-4);
}

.file-remove {
  border: 1px solid #ffffff24;
  background: transparent;
  color: var(--text-3);
  font-size: 11px;
  padding: 4px 8px;
  border-radius: 6px;
  cursor: pointer;
}

.file-remove:hover {
  color: var(--danger);
  border-color: var(--danger);
}

.warn {
  margin: 8px 0 0;
  font-size: 11px;
  color: var(--warning, #f5b544);
  text-align: left;
}

.link {
  align-self: flex-start;
  border: 0;
  background: transparent;
  color: var(--brand-300, #b8afff);
  font-size: 12px;
  padding: 2px 0;
  cursor: pointer;
}

.paste {
  min-height: 150px;
  resize: vertical;
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid #ffffff1f;
  background: var(--bg-raised, #1f1f1f);
  color: var(--text-1);
  font-size: 12px;
  line-height: 1.6;
  outline: none;
  font-family: inherit;
}

.paste:focus {
  border-color: var(--brand-500);
}

.paste-count {
  margin: 0;
  align-self: flex-end;
  font-size: 11px;
  color: var(--text-4);
}

.title-wrap {
  position: relative;
}

.input {
  width: 100%;
  height: 38px;
  padding: 0 60px 0 12px;
  border-radius: 8px;
  border: 1px solid #ffffff1f;
  background: var(--bg-raised, #1f1f1f);
  color: var(--text-1);
  font-size: 13px;
  outline: none;
  box-sizing: border-box;
}

.input:focus {
  border-color: var(--brand-500);
}

.counter {
  position: absolute;
  right: 12px;
  top: 50%;
  transform: translateY(-50%);
  font-size: 11px;
  color: var(--text-4);
}

.counter.full {
  color: var(--warning, #f5b544);
}

.types {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}

.type-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 6px;
  border-radius: 10px;
  border: 1px solid #ffffff1f;
  background: var(--bg-raised, #1f1f1f);
  color: var(--text-2);
  cursor: pointer;
  text-align: left;
}

.type-card:hover {
  border-color: #ffffff3d;
}

.type-card.active {
  border-color: var(--brand-500);
  box-shadow: 0 0 0 1px var(--brand-500) inset;
  color: var(--text-1);
}

.type-img {
  width: 100%;
  height: 58px;
  object-fit: cover;
  border-radius: 7px;
  display: block;
}

.type-name {
  font-size: 12px;
  padding: 0 2px 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ratios {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.ratio-card {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 46px;
  padding: 0 14px;
  border-radius: 10px;
  border: 1px solid #ffffff1f;
  background: var(--bg-raised, #1f1f1f);
  color: var(--text-2);
  font-size: 13px;
  cursor: pointer;
}

.ratio-card:hover {
  border-color: #ffffff3d;
}

.ratio-card.active {
  border-color: var(--brand-500);
  box-shadow: 0 0 0 1px var(--brand-500) inset;
  color: var(--text-1);
}

.ratio-icon {
  width: 20px;
  height: 20px;
  color: currentColor;
}

.ratio-icon svg {
  width: 100%;
  height: 100%;
}

.error {
  margin: 14px 0 0;
  padding: 8px 10px;
  border-radius: 8px;
  background: var(--danger-bg, #2e1414);
  color: var(--danger, #f56767);
  font-size: 12px;
}

.foot {
  display: flex;
  justify-content: flex-end;
  margin-top: 18px;
  padding-top: 14px;
  border-top: 1px solid #ffffff12;
}

.submit {
  min-width: 132px;
  height: 38px;
  padding: 0 22px;
  border: 0;
  border-radius: 999px;
  background: linear-gradient(90deg, #6b5cff, #a06bff);
  color: #fff;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
}

.submit:disabled {
  background: #4a3f8f;
  color: #ffffffa0;
  cursor: default;
}

.modal-fade-enter-active,
.modal-fade-leave-active {
  transition: opacity 0.18s ease;
}

.modal-fade-enter-from,
.modal-fade-leave-to {
  opacity: 0;
}

@media (max-width: 760px) {
  .body {
    grid-template-columns: 1fr;
  }
  .types {
    grid-template-columns: 1fr;
  }
  .type-card {
    flex-direction: row;
    align-items: center;
  }
  .type-img {
    width: 72px;
    height: 44px;
    flex: 0 0 72px;
  }
}
</style>
