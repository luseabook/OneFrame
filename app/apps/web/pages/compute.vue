<script setup lang="ts">
definePageMeta({ ssr: false, requiresAuth: true, layout: "app" });

// 「我的算力」：用户自带 AutoDL 账号（BYOC）。
// 设计：docs/02-architecture/autodl-integration.md §3.2；接口：§2.5。
const { t } = useI18n();
const api = useApi();
const toast = useToast();
useHead({ title: () => t("compute.title") });

interface Summary {
  enabled: boolean;
  bound: boolean;
  tokenHint?: string;
  pool?: {
    id: string;
    gpuSpec: string;
    gpuCount: number;
    lifecycle: string;
    idleMinutes: number;
    imageReady: boolean;
    imageSource: string;
    applicationUuid: string | null;
    state: string;
    budgetDailyCents: number;
    budgetMonthCents: number;
  };
  nodes: Array<{ id: string; state: string; gpuSpec: string; costCents: number; startedAt: string | null }>;
  todayCents: number;
  monthCents: number;
}

const summary = ref<Summary | null>(null);
const bills = ref<Array<{ taskId: string; gpuSeconds: number; costCents: number; status: string; createdAt: string }>>([]);
const token = ref("");
const busy = ref("");
const error = ref("");
const lifecycle = ref("session");
const idleMinutes = ref(15);
const saving = ref(false);
// 社区镜像路线：没有 image_uuid 时后端返回引导命令，前端展示让用户在自己的实例里执行
const guidedCommand = ref("");

const yuan = (cents: number) => `¥${(cents / 100).toFixed(2)}`;
const dailyPct = computed(() => {
  const s = summary.value;
  if (!s?.pool || s.pool.budgetDailyCents <= 0) return 0;
  return Math.min(100, Math.round((s.todayCents / s.pool.budgetDailyCents) * 100));
});
const node = computed(() => summary.value?.nodes.find((n) => n.state !== "destroyed" && n.state !== "stopped") ?? null);

async function load(): Promise<void> {
  error.value = "";
  try {
    summary.value = await api.get<Summary>("/compute/summary");
    if (summary.value.pool) {
      lifecycle.value = summary.value.pool.lifecycle;
      idleMinutes.value = summary.value.pool.idleMinutes;
    }
    bills.value = (await api.get<{ list: typeof bills.value }>("/compute/bills?limit=20")).list;
  } catch (e) {
    error.value = (e as Error).message;
  }
}

async function bind(): Promise<void> {
  if (!token.value.trim()) return;
  busy.value = "bind";
  error.value = "";
  try {
    await api.post("/compute/account", { token: token.value.trim() });
    token.value = "";
    toast.success(t("compute.bound"));
    await load();
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = "";
  }
}

async function unbind(): Promise<void> {
  busy.value = "unbind";
  try {
    await api.delete("/compute/account");
    await load();
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = "";
  }
}

async function startNode(): Promise<void> {
  busy.value = "start";
  error.value = "";
  try {
    const res = await api.post<{ mode: string; command?: string }>("/compute/nodes", {});
    if (res.mode === "guided") guidedCommand.value = res.command ?? "";
    await load();
  } catch (e) {
    // 745207：环境没构建；给明确引导而不是"未知错误"
    error.value = (e as { code?: number }).code === 746207 ? t("compute.errorImage") : (e as Error).message;
  } finally {
    busy.value = "";
  }
}

async function stopNode(id: string): Promise<void> {
  busy.value = "stop";
  try {
    await api.post(`/compute/nodes/${id}/stop`, {});
    await load();
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = "";
  }
}

async function copyCommand(): Promise<void> {
  try {
    await navigator.clipboard.writeText(guidedCommand.value);
    toast.success(t("compute.guideCopied"));
  } catch {
    toast.info(guidedCommand.value);
  }
}

async function savePool(): Promise<void> {
  saving.value = true;
  try {
    await api.patch("/compute/pool", { lifecycle: lifecycle.value, idle_minutes: idleMinutes.value });
    toast.success(t("compute.saved"));
    await load();
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    saving.value = false;
  }
}

let timer: ReturnType<typeof setInterval> | undefined;
onMounted(async () => {
  await load();
  // 开机/加载阶段每 10s 刷新一次；就绪后停表，避免无意义轮询
  timer = setInterval(() => {
    if (node.value && ["provisioning", "booting", "loading"].includes(node.value.state)) void load();
  }, 10_000);
});
onBeforeUnmount(() => timer && clearInterval(timer));
</script>

<template>
  <div class="page">
    <div class="page-head">
      <h1>{{ t("compute.title") }}</h1>
      <p class="muted">{{ t("compute.subtitle") }}</p>
    </div>

    <p v-if="error" class="error">{{ error }}</p>

    <p v-if="summary && !summary.enabled" class="info">自带算力当前未开启（FLEET_ENABLED=off）。</p>

    <template v-if="summary && summary.enabled">
      <!-- ① 绑定 -->
      <section class="card">
        <h2>{{ summary.bound ? t("compute.bound") : t("compute.bindTitle") }}</h2>
        <template v-if="summary.bound">
          <p class="muted small">Token ····{{ summary.tokenHint }}</p>
          <button class="btn-secondary" :disabled="busy === 'unbind'" @click="unbind">{{ t("compute.unbind") }}</button>
        </template>
        <template v-else>
          <p class="muted small">{{ t("compute.bindHint") }}</p>
          <ol class="muted small">
            <li>{{ t("compute.bindStep1") }}</li>
            <li>{{ t("compute.bindStep2") }}</li>
            <li>{{ t("compute.bindStep3") }}</li>
          </ol>
          <input v-model="token" class="input" type="password" :placeholder="t('compute.bindPlaceholder')" />
          <button class="btn-secondary" :disabled="busy === 'bind'" @click="bind">{{ t("compute.bindAction") }}</button>
        </template>
      </section>

      <!-- ② 没有镜像：社区镜像路线给引导命令；私有镜像路线才需要构建 -->
      <section v-if="summary.bound && summary.pool && !summary.pool.imageReady" class="card">
        <template v-if="summary.pool.imageSource === 'community'">
          <h2>{{ t("compute.guideTitle") }}</h2>
          <p class="muted small">{{ t("compute.guideHint") }}</p>
          <pre v-if="guidedCommand" class="muted small"><code>{{ guidedCommand }}</code></pre>
          <button v-if="guidedCommand" class="btn-secondary" @click="copyCommand">
            {{ t("compute.guideCopy") }}
          </button>
          <button v-else class="btn-secondary" :disabled="busy === 'start'" @click="startNode">
            {{ t("compute.guideShow") }}
          </button>
        </template>
        <template v-else>
          <h2>{{ t("compute.buildTitle") }}</h2>
          <p class="muted small">{{ t("compute.buildCostNote") }}</p>
        </template>
      </section>

      <!-- ③ 节点 -->
      <section v-if="summary.bound" class="card">
        <h2>{{ t("compute.nodeTitle") }}</h2>
        <p v-if="!summary.nodes.length" class="muted small">{{ t("compute.nodeNone") }}</p>
        <div v-for="n in summary.nodes" :key="n.id" class="provider-binding">
          <span>{{ n.gpuSpec }} · {{ n.state === "ready" ? t("compute.nodeReady") : t("compute.nodeStopped") }}</span>
          <span class="muted small">{{ yuan(n.costCents) }}</span>
          <button
            v-if="n.state === 'ready' || n.state === 'busy'"
            class="btn-secondary"
            :disabled="busy === 'stop'"
            @click="stopNode(n.id)"
          >
            {{ t("compute.stop") }}
          </button>
        </div>
        <button v-if="summary.pool?.imageReady" class="btn-secondary" :disabled="busy === 'start'" @click="startNode">
          {{ t("compute.start") }}
        </button>
      </section>

      <!-- ④ 预算 + 策略 -->
      <section v-if="summary.bound && summary.pool" class="card">
        <h2>{{ t("compute.budgetTitle") }}</h2>
        <p class="muted small">
          {{ t("compute.budgetToday") }} {{ yuan(summary.todayCents) }} / {{ yuan(summary.pool.budgetDailyCents) }}
          · {{ t("compute.budgetMonth") }} {{ yuan(summary.monthCents) }}
        </p>
        <div class="budget-bar"><span :style="{ width: dailyPct + '%' }" /></div>
        <p v-if="dailyPct >= 100" class="error">{{ t("compute.budgetOver") }}</p>

        <label class="muted small">{{ t("compute.lifecycle") }}</label>
        <select v-model="lifecycle" class="input">
          <option value="session">{{ t("compute.lifecycleSession") }}</option>
          <option value="on_demand">{{ t("compute.lifecycleOnDemand") }}</option>
          <option value="always_on">{{ t("compute.lifecycleAlways") }}</option>
        </select>
        <label class="muted small">{{ t("compute.idleMinutes") }}</label>
        <input v-model.number="idleMinutes" class="input" type="number" min="1" max="240" />
        <button class="btn-secondary" :disabled="saving" @click="savePool">{{ t("compute.save") }}</button>
      </section>

      <!-- ⑤ 账单 -->
      <section v-if="summary.bound" class="card">
        <h2>{{ t("compute.billsTitle") }}</h2>
        <p v-if="!bills.length" class="muted small">{{ t("compute.billsEmpty") }}</p>
        <table v-else class="muted small">
          <thead>
            <tr>
              <th>task</th>
              <th>{{ t("compute.billCost") }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="b in bills" :key="b.taskId + b.createdAt">
              <td>{{ b.taskId }}</td>
              <td>{{ yuan(b.costCents) }}</td>
            </tr>
          </tbody>
        </table>
      </section>
    </template>
  </div>
</template>

<style scoped>
.budget-bar {
  height: 8px;
  background: rgba(127, 127, 127, 0.2);
  border-radius: 4px;
  overflow: hidden;
  margin: 8px 0 12px;
}
.budget-bar span {
  display: block;
  height: 100%;
  background: currentColor;
}
</style>