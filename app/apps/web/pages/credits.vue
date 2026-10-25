<script setup lang="ts">
import type { FlowDto } from "~/types/api";

definePageMeta({ ssr: false, requiresAuth: true, layout: "app" });
useHead({ title: "积分 · 一帧" });

const api = useApi();
const flows = ref<FlowDto[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = 30;
const error = ref("");
const loading = ref(true);
// 余额在客户端挂载后读取：首屏 SSR 无登录态，直接读 auth.state 会与 hydrate 结果不一致
const balance = ref<number | null>(null);
const frozen = ref<number | null>(null);

async function load(): Promise<void> {
  loading.value = true;
  try {
    const data = await api.get<{ list: FlowDto[]; total: number }>(
      `/credits/flows?page=${page.value}&page_size=${pageSize}`,
    );
    flows.value = data.list;
    total.value = data.total;
    const me = await api.get<{ credits: { balance: number; frozen: number } }>("/me");
    balance.value = me.credits.balance;
    frozen.value = me.credits.frozen;
  } catch (e) {
    error.value = e instanceof Error ? e.message : "加载失败";
  } finally {
    loading.value = false;
  }
}

const KIND_META: Record<string, { label: string; tone: "neutral" | "success" | "brand" | "warning" | "danger" }> = {
  gift: { label: "赠送", tone: "success" },
  recharge: { label: "充值", tone: "success" },
  freeze: { label: "冻结", tone: "warning" },
  settle: { label: "结算", tone: "neutral" },
  unfreeze: { label: "解冻", tone: "brand" },
  // 兼容旧口径（后端历史数据可能为 purchase）
  purchase: { label: "充值", tone: "success" },
  refund: { label: "退款", tone: "brand" },
  invite: { label: "邀请", tone: "success" },
  adjust: { label: "调整", tone: "neutral" },
};

const kindLabel = (kind: string): string => KIND_META[kind]?.label ?? kind;
const kindTone = (kind: string) => KIND_META[kind]?.tone ?? "neutral";

onMounted(load);
</script>

<template>
  <div class="credits">
    <header class="head">
      <div>
        <h1>积分</h1>
        <p class="sub">创建任务时冻结，成功结算、失败/取消解冻；Alpha 期积分不过期。</p>
      </div>
    </header>

    <!-- 余额概览 -->
    <section class="summary">
      <div class="stat">
        <span class="label">可用积分</span>
        <b class="value">{{ balance ?? "-" }}</b>
      </div>
      <div class="divider" />
      <div class="stat">
        <span class="label">冻结中</span>
        <b class="value frozen">{{ frozen ?? "-" }}</b>
      </div>
      <div class="divider" />
      <div class="stat">
        <span class="label">累计流水</span>
        <b class="value">{{ total }}</b>
      </div>
    </section>

    <p v-if="error" class="err">{{ error }}</p>

    <Skeleton v-if="loading" :rows="4" />

    <template v-else>
      <div v-if="flows.length" class="flow-table">
        <div class="flow-row flow-head">
          <span class="c-kind">类型</span>
          <span class="c-num">积分</span>
          <span class="c-num">冻结</span>
          <span class="c-num">余额</span>
          <span class="c-memo">备注</span>
          <span class="c-time">时间</span>
        </div>
        <div v-for="flow in flows" :key="flow.id" class="flow-row">
          <span class="c-kind">
            <Tag :tone="kindTone(flow.kind)" size="sm">{{ kindLabel(flow.kind) }}</Tag>
          </span>
          <span class="c-num mono" :class="{ plus: flow.delta > 0, minus: flow.delta < 0 }">
            {{ flow.delta > 0 ? `+${flow.delta}` : flow.delta }}
          </span>
          <span class="c-num mono muted">
            {{ flow.frozen_delta > 0 ? `+${flow.frozen_delta}` : flow.frozen_delta }}
          </span>
          <span class="c-num mono">{{ flow.balance_after }}</span>
          <span class="c-memo muted">{{ flow.memo ?? "—" }}</span>
          <span class="c-time muted">{{ new Date(flow.created_at).toLocaleString("zh-CN") }}</span>
        </div>
      </div>

      <EmptyState
        v-else
        icon="◉"
        title="暂无积分流水"
        description="注册赠送、任务冻结与结算记录都会出现在这里。"
      />

      <div v-if="total > pageSize" class="pager">
        <Button variant="ghost" :disabled="page <= 1" @click="page -= 1; load()">上一页</Button>
        <span class="muted">第 {{ page }} 页 / 共 {{ total }} 条</span>
        <Button variant="ghost" :disabled="page * pageSize >= total" @click="page += 1; load()">下一页</Button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.credits {
  max-width: 1280px;
  margin: 0 auto;
  padding: 32px 72px 80px;
}
.head h1 {
  font-size: 24px;
  font-weight: 700;
  letter-spacing: -0.01em;
}
.sub {
  margin: 6px 0 24px;
  color: var(--text-3);
  font-size: var(--text-sm);
}

.summary {
  display: flex;
  align-items: center;
  gap: var(--space-8);
  padding: var(--space-5) var(--space-6);
  background: var(--bg-surface);
  border: 1px solid var(--border-1);
  border-radius: var(--radius-2xl);
  margin-bottom: var(--space-5);
}
.stat {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}
.label {
  color: var(--text-3);
  font-size: var(--text-xs);
}
.value {
  font-size: var(--text-3xl);
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  line-height: 1.1;
  color: var(--text-1);
}
.value.frozen {
  color: var(--warning);
}
.divider {
  width: 1px;
  height: 40px;
  background: var(--border-1);
}

.err {
  padding: var(--space-3) var(--space-4);
  background: var(--danger-bg);
  color: var(--danger);
  border-radius: var(--radius-md);
  font-size: var(--text-sm);
}

.flow-table {
  border: 1px solid var(--border-1);
  border-radius: var(--radius-2xl);
  overflow: hidden;
  background: var(--bg-surface);
}
.flow-row {
  display: grid;
  grid-template-columns: 84px 96px 96px 96px minmax(0, 1fr) 172px;
  gap: var(--space-3);
  align-items: center;
  padding: var(--space-3) var(--space-4);
  border-bottom: 1px solid var(--border-1);
  font-size: var(--text-sm);
}
.flow-row:last-child {
  border-bottom: 0;
}
.flow-row:not(.flow-head):hover {
  background: var(--bg-hover);
}
.flow-head {
  background: var(--bg-sunken);
  color: var(--text-3);
  font-size: var(--text-xs);
  font-weight: 600;
}
.mono {
  font-variant-numeric: tabular-nums;
}
.plus {
  color: var(--success);
  font-weight: 600;
}
.minus {
  color: var(--danger);
  font-weight: 600;
}
.muted {
  color: var(--text-3);
}
.pager {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-3);
  margin-top: var(--space-6);
}

@media (max-width: 1024px) {
  .credits {
    padding: 24px 24px 64px;
  }
  .summary {
    gap: var(--space-5);
    padding: var(--space-4);
  }
  .value {
    font-size: var(--text-2xl);
  }
}
@media (max-width: 760px) {
  .credits {
    padding: 16px 16px 48px;
  }
  .flow-row {
    grid-template-columns: 72px 72px 1fr;
  }
  .c-num:nth-child(3),
  .c-memo,
  .c-time {
    display: none;
  }
}
</style>
