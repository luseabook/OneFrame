<script setup lang="ts">
/**
 * 3 步新手引导（coach-mark，U6）。
 *
 * 证据：`docs/03-frontend/evidence/ui-compare/ref-coachmark-2026-10-25.png`
 * —— 竞品第 1 步是「紫色浮层 + 目标高亮 + 跳过 / 下一步 (1/3)」，浮层锚在被讲元素旁边。
 * 第 2/3 步**没有竞品同状态证据**，按同一体系设计（报告里已标注"属我方设计"）。
 *
 * 行为：
 * 1. 首次访问（localStorage 没有 `of_guide_v1=done`）自动出现；
 * 2. 跳过 / 完成都会写标记，不再自动打扰；
 * 3. 重看入口：壳层头像菜单「新手引导」或首页标题旁「重看引导」→ 调本组件 `start()`；
 * 4. 目标元素用 `data-guide-target` 定位（步骤 1/2/3 分别指双入口卡、工具矩阵、最近项目）。
 *
 * 只用 document.querySelector 量目标，不碰目标组件内部，页面可以自由重排。
 */
const { t } = useI18n();
const router = useRouter();
const route = useRoute();

const STORAGE_KEY = "of_guide_v1";

type Step = { target: string; title: string; desc: string };
const steps = computed<Step[]>(() => [
  { target: "workflow", title: t("guide.step1.title"), desc: t("guide.step1.desc") },
  { target: "tools", title: t("guide.step2.title"), desc: t("guide.step2.desc") },
  { target: "recent", title: t("guide.step3.title"), desc: t("guide.step3.desc") },
]);

const open = ref(false);
const index = ref(0);
const current = computed<Step>(() => steps.value[index.value] ?? steps.value[0]!);
const hole = ref<{ top: number; left: number; width: number; height: number } | null>(null);
const pop = ref<{ top: number; left: number }>({ top: 24, left: 24 });
const popRef = ref<HTMLElement | null>(null);
const nextRef = ref<HTMLButtonElement | null>(null);

const POP_W = 360;
const GAP = 14;
/** 浮层高度估算，首帧用来决定"放下方还是上方"，随后用真实高度校正 */
const POP_H_EST = 196;

const holeStyle = computed(() =>
  hole.value
    ? {
        top: `${hole.value.top}px`,
        left: `${hole.value.left}px`,
        width: `${hole.value.width}px`,
        height: `${hole.value.height}px`,
      }
    : { display: "none" },
);
const popStyle = computed(() => ({ top: `${pop.value.top}px`, left: `${pop.value.left}px`, width: `${POP_W}px` }));

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

function measure(): void {
  if (!import.meta.client || !open.value) return;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const el = document.querySelector<HTMLElement>(`[data-guide-target="${current.value.target}"]`);
  const rect = el?.getBoundingClientRect();

  if (!rect || rect.width <= 0 || rect.height <= 0) {
    hole.value = null;
    pop.value = { top: Math.round(vh / 3), left: Math.round((vw - POP_W) / 2) };
    return;
  }

  const pad = 6;
  hole.value = {
    top: Math.round(rect.top - pad),
    left: Math.round(rect.left - pad),
    width: Math.round(rect.width + pad * 2),
    height: Math.round(rect.height + pad * 2),
  };

  const left = clamp(Math.round(rect.left + rect.width / 2 - POP_W / 2), 16, vw - POP_W - 16);
  let top = Math.round(rect.bottom + GAP);
  if (top + POP_H_EST > vh - 16) top = Math.round(rect.top - GAP - POP_H_EST);
  if (top < 16) top = 16;
  pop.value = { top, left };

  // 真实高度校正：估高偏差大于 8px 时按实际情况翻到目标上方 / 收回视口内
  void nextTick(() => {
    const height = popRef.value?.offsetHeight ?? POP_H_EST;
    if (!hole.value) return;
    let nextTop = Math.round(rect.bottom + GAP);
    if (nextTop + height > vh - 16) nextTop = Math.round(rect.top - GAP - height);
    pop.value = { top: clamp(nextTop, 16, vh - height - 16), left };
  });
}

function start(): void {
  index.value = 0;
  open.value = true;
  // 等目标元素渲染出来再量（首页首帧 skeleton 阶段目标块已存在，但要防止 config 排序后位移）
  void nextTick(() => {
    measure();
    nextRef.value?.focus({ preventScroll: true });
  });
}

function finish(): void {
  open.value = false;
  try {
    localStorage.setItem(STORAGE_KEY, "done");
  } catch {
    /* 隐私模式下写不了 localStorage：本会话内不再自动弹，刷新后会再出现一次 */
  }
}

function next(): void {
  if (index.value >= steps.value.length - 1) {
    finish();
    return;
  }
  index.value += 1;
  void nextTick(() => {
    measure();
    nextRef.value?.focus({ preventScroll: true });
  });
}

function onKeydown(event: KeyboardEvent): void {
  if (!open.value) return;
  if (event.key === "Escape") {
    event.preventDefault();
    finish();
  } else if (event.key === "ArrowRight" || event.key === "Enter") {
    event.preventDefault();
    next();
  }
}

function onViewportChange(): void {
  measure();
}

// 从壳层头像菜单「新手引导」（/home?guide=1）进来时，组件可能已经挂载过：
// 只靠 onMounted 不会重跑，这里监听 query 变化再起一次。
watch(
  () => route.query.guide,
  (value) => {
    if (value !== "1") return;
    const query = { ...route.query };
    delete query.guide;
    void router.replace({ query });
    start();
  },
);

onMounted(() => {
  if (route.query.guide === "1") {
    const query = { ...route.query };
    delete query.guide;
    void router.replace({ query });
    start();
  } else {
    let done = false;
    try {
      done = localStorage.getItem(STORAGE_KEY) === "done";
    } catch {
      done = false;
    }
    if (!done) setTimeout(start, 600);
  }
  window.addEventListener("resize", onViewportChange);
  window.addEventListener("scroll", onViewportChange, true);
  window.addEventListener("keydown", onKeydown);
});

onUnmounted(() => {
  window.removeEventListener("resize", onViewportChange);
  window.removeEventListener("scroll", onViewportChange, true);
  window.removeEventListener("keydown", onKeydown);
});

defineExpose({ start, finish });
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="gcm" :aria-label="t('guide.title')" role="dialog" aria-modal="true" data-guide-overlay="1">
      <!-- 目标高亮：一层 9999px 的外阴影把页面压暗，中间留出目标本身（不复制目标 DOM） -->
      <div class="gcm-hole" :style="holeStyle" data-guide-hole="1" />
      <section
        ref="popRef"
        class="gcm-pop"
        :style="popStyle"
        :data-guide-step="index + 1"
      >
        <p class="gcm-progress">{{ t("guide.stepOf", { current: index + 1, total: steps.length }) }}</p>
        <h3 class="gcm-title">{{ current.title }}</h3>
        <p class="gcm-desc">{{ current.desc }}</p>
        <div class="gcm-dots" aria-hidden="true">
          <i v-for="(step, i) in steps" :key="step.target" :class="{ on: i === index }" />
        </div>
        <div class="gcm-foot">
          <button class="gcm-skip" type="button" data-guide-action="skip" @click="finish">
            {{ t("guide.skip") }}
          </button>
          <button ref="nextRef" class="gcm-next" type="button" data-guide-action="next" @click="next">
            {{
              index === steps.length - 1
                ? t("guide.done")
                : t("guide.next", { current: index + 1, total: steps.length })
            }}
          </button>
        </div>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.gcm {
  position: fixed;
  inset: 0;
  z-index: var(--z-modal);
}

.gcm-hole {
  position: fixed;
  border-radius: 14px;
  border: 1px solid #c4a6ffcc;
  /* 把目标之外全部压暗；9999px 足够覆盖 4K，不需要再叠一层遮罩 */
  box-shadow: 0 0 0 9999px #05050899;
  pointer-events: none;
  transition:
    top var(--duration-base) var(--ease-out),
    left var(--duration-base) var(--ease-out),
    width var(--duration-base) var(--ease-out),
    height var(--duration-base) var(--ease-out);
}

/* 浮层：竞品第 1 步是紫色实底 + 白字 + 白描边按钮（ref-coachmark-2026-10-25.png） */
.gcm-pop {
  position: fixed;
  padding: 14px 16px 14px;
  border-radius: 14px;
  background: linear-gradient(135deg, #6b3bf5 0%, #8b5bff 100%);
  color: #fff;
  box-shadow: 0 20px 50px #00000073;
}

.gcm-progress {
  margin: 0 0 6px;
  font-size: 11px;
  letter-spacing: 0.04em;
  color: #ffffffb8;
}

.gcm-title {
  margin: 0 0 6px;
  font-size: 15px;
  font-weight: 600;
  line-height: 1.35;
}

.gcm-desc {
  margin: 0;
  font-size: 13px;
  line-height: 1.55;
  color: #ffffffd9;
}

.gcm-dots {
  display: flex;
  gap: 6px;
  margin-top: 12px;
}

.gcm-dots i {
  width: 16px;
  height: 4px;
  border-radius: 999px;
  background: #ffffff40;
}

.gcm-dots i.on {
  background: #ffffff;
}

.gcm-foot {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 12px;
}

.gcm-skip,
.gcm-next {
  height: 32px;
  border-radius: 999px;
  font-size: 13px;
  cursor: pointer;
  transition:
    background var(--duration-fast) var(--ease-out),
    color var(--duration-fast) var(--ease-out);
}

.gcm-skip {
  padding: 0 14px;
  border: 1px solid #ffffff4d;
  background: transparent;
  color: #fff;
}

.gcm-skip:hover {
  background: #ffffff1f;
}

.gcm-next {
  padding: 0 16px;
  border: 0;
  background: #fff;
  color: #5b2fd6;
  font-weight: 600;
}

.gcm-next:hover {
  background: #f1e9ff;
}
</style>
