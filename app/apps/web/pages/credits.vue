<script setup lang="ts">
import type { Credits, FlowDto } from "~/types/api";

definePageMeta({ ssr: false, requiresAuth: true });

const api = useApi();
const auth = useAuth();
const flows = ref<FlowDto[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = 30;
const error = ref("");

async function load(): Promise<void> {
  try {
    const data = await api.get<{ list: FlowDto[]; total: number }>(`/credits/flows?page=${page.value}&page_size=${pageSize}`);
    flows.value = data.list;
    total.value = data.total;
    await auth.me();
  } catch (e) {
    error.value = e instanceof Error ? e.message : "加载失败";
  }
}

const kindLabel = (kind: string): string =>
  ({ gift: "赠送", freeze: "冻结", settle: "结算", unfreeze: "解冻", purchase: "充值", refund: "退款", invite: "邀请" })[kind] ?? kind;

onMounted(load);
</script>

<template>
  <main class="page">
    <div class="head">
      <h1>积分</h1>
      <div class="balance">
        <span>可用 <b>{{ auth.state.value.credits?.balance ?? "-" }}</b></span>
        <span>冻结 <b>{{ auth.state.value.credits?.frozen ?? "-" }}</b></span>
      </div>
    </div>

    <p class="muted">创建任务时冻结，成功结算、失败/取消解冻；Alpha 期积分不过期。</p>
    <p v-if="error" class="error">{{ error }}</p>

    <div class="table">
      <div class="row head-row"><span>类型</span><span>积分</span><span>冻结</span><span>余额</span><span>备注</span><span>时间</span></div>
      <div v-for="flow in flows" :key="flow.id" class="row">
        <span>{{ kindLabel(flow.kind) }}</span>
        <span :class="{ plus: flow.delta > 0, minus: flow.delta < 0 }">{{ flow.delta > 0 ? `+${flow.delta}` : flow.delta }}</span>
        <span>{{ flow.frozen_delta > 0 ? `+${flow.frozen_delta}` : flow.frozen_delta }}</span>
        <span>{{ flow.balance_after }}</span>
        <span class="muted">{{ flow.memo ?? "-" }}</span>
        <span class="muted">{{ new Date(flow.created_at).toLocaleString() }}</span>
      </div>
      <p v-if="flows.length === 0" class="muted empty">暂无流水</p>
    </div>

    <div class="pager">
      <Button variant="ghost" :disabled="page <= 1" @click="page -= 1; load()">上一页</Button>
      <span class="muted">共 {{ total }} 条 · 第 {{ page }} 页</span>
      <Button variant="ghost" :disabled="page * pageSize >= total" @click="page += 1; load()">下一页</Button>
    </div>
  </main>
</template>

<style scoped>
.page {
  flex: 1;
  max-width: 1000px;
  width: 100%;
  margin: 0 auto;
  padding: 24px 32px;
}
.head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
}
h1 {
  margin: 0;
  font-size: 22px;
}
.balance {
  display: flex;
  gap: 16px;
  font-size: 13px;
  color: var(--text-2);
}
.balance b {
  color: var(--text-1);
  font-size: 18px;
}
.table {
  border: 1px solid var(--color-border);
  border-radius: var(--radius-l);
  overflow: hidden;
  margin-top: 16px;
}
.row {
  display: grid;
  grid-template-columns: 80px 80px 80px 80px 1fr 170px;
  gap: 8px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--color-border);
  align-items: center;
  font-size: 12px;
}
.row:last-child {
  border-bottom: 0;
}
.head-row {
  background: var(--color-surface);
  color: var(--text-3);
}
.plus {
  color: #4ade80;
}
.minus {
  color: #ff6b6b;
}
.pager {
  display: flex;
  justify-content: center;
  gap: 16px;
  align-items: center;
  margin-top: 16px;
}
.muted {
  color: var(--text-3);
  font-size: 12px;
}
.error {
  color: #ff6b6b;
  font-size: 12px;
}
.empty {
  padding: 20px;
  text-align: center;
}
</style>
