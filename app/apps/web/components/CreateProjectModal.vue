<script setup lang="ts">
// 新建项目弹窗（对齐参照产品「短剧工作流 → 新建项目」）
// 左侧上传剧本 / 粘贴文本；右侧项目名称、剧目类型、画面比例；底部「立即创作」
import type { ProjectDto } from "~/types/api";

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{
  (e: "update:open", value: boolean): void;
  (e: "created", project: ProjectDto): void;
}>();

const api = useApi();
const toast = useToast();

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

const dramaOptions = [
  { value: 1, label: "国内仿真人剧", img: "/images/drama/domestic-live.jpg" },
  { value: 2, label: "海外仿真人剧", img: "/images/drama/overseas-live.jpg" },
  { value: 3, label: "2D/3D动漫", img: "/images/drama/anime-2d3d.jpg" },
];
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
  title.value = "";
  dramaType.value = 1;
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
    error.value = "仅支持 xlsx/xls/csv/doc/docx/txt/md 格式";
    return;
  }
  if (file.size > 8 * 1024 * 1024) {
    error.value = "文件超过 8MB，请拆分后上传或粘贴文本";
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
      reader.onerror = () => reject(new Error("读取文件失败"));
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
      error.value = "未能从文件中提取到文本，请检查文件内容或改用粘贴文本";
      fileName.value = "";
    }
  } catch (e) {
    fileName.value = "";
    error.value = e instanceof Error ? e.message : "文件解析失败";
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
    error.value = "请填写项目名称";
    return;
  }
  if (titleChars.value > 50) {
    error.value = "项目名称不能超过 50 字";
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
    toast.success("项目已创建，开始创作吧");
    emit("created", project);
    emit("update:open", false);
  } catch (e) {
    error.value = e instanceof Error ? e.message : "创建失败";
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <Teleport to="body">
    <Transition name="modal-fade">
      <div v-if="open" class="mask" @click.self="close">
        <section class="dialog" role="dialog" aria-modal="true" aria-label="新建项目">
          <header class="head">
            <div>
              <h2>新建项目</h2>
              <p class="sub">项目设置将决定后续所有剧集的创作风格与画面比例，请谨慎选择。</p>
            </div>
            <button class="close" type="button" aria-label="关闭" @click="close">✕</button>
          </header>

          <div class="body">
            <!-- 左：上传剧本 -->
            <div class="col left">
              <label class="label">上传剧本</label>
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
                  <p class="drop-title">请上传剧本或分镜单，也可以从剧本库选择或粘贴文本</p>
                  <p class="drop-hint">支持 xlsx/xls/csv/doc/docx/txt/md 格式</p>
                </template>

                <template v-else>
                  <div class="file-row">
                    <span class="file-icon" aria-hidden="true">📄</span>
                    <div class="file-meta">
                      <p class="file-name" :title="fileName">{{ fileName }}</p>
                      <p class="file-sub">
                        <template v-if="parsing">解析中…</template>
                        <template v-else>
                          {{ fileFormat ? fileFormat.toUpperCase() : "文件" }} · {{ scriptChars }} 字
                        </template>
                      </p>
                    </div>
                    <button class="file-remove" type="button" :disabled="parsing" @click.stop="removeFile">移除</button>
                  </div>
                  <p v-if="warnings.length" class="warn">{{ warnings.join("；") }}</p>
                </template>
              </div>

              <button class="link" type="button" @click.stop="togglePaste">
                {{ pasteMode ? "改用上传文件" : "没有文件？直接粘贴文本" }}
              </button>

              <textarea
                v-if="pasteMode"
                v-model="pasteText"
                class="paste"
                placeholder="粘贴小说/剧本内容（最多 5 万字）"
                maxlength="50000"
              />
              <p v-if="pasteMode" class="paste-count">{{ pasteText.length }}/50000</p>
            </div>

            <!-- 右：项目设置 -->
            <div class="col right">
              <label class="label">项目名称</label>
              <div class="title-wrap">
                <input
                  v-model="title"
                  class="input"
                  maxlength="50"
                  placeholder="请输入项目名称"
                  @keyup.enter="submit"
                />
                <span class="counter" :class="{ full: titleChars >= 50 }">{{ titleChars }}/50</span>
              </div>

              <label class="label type-label">
                剧目类型
                <span class="info" title="影响后续角色风格与出片模型">?</span>
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
                画面比例
                <span class="info" title="竖屏 9:16 适合短视频；横屏 16:9 适合长视频">?</span>
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
              {{ submitting ? "创建中…" : "立即创作" }}
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
