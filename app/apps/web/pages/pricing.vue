<script setup lang="ts">
// 定价页需登录：未登录时导航不暴露该入口，Alpha 期额度来自邀请码
definePageMeta({ ssr: false, requiresAuth: true });

const api = useApi();

// 余额在客户端挂载后读取：首屏 SSR 无登录态，直接渲染会与客户端 hydrate 结果不一致
const balance = ref<number | null>(null);
onMounted(async () => {
  try {
    const me = await api.get<{ credits: { balance: number } }>("/me");
    balance.value = me.credits.balance;
  } catch {
    balance.value = null;
  }
});

const skus = [
  { price: 50, credits: 500 },
  { price: 100, credits: 1000 },
  { price: 300, credits: 3000 },
  { price: 600, credits: 6000 },
];
</script>

<template>
  <main class="page">
    <section class="hero">
      <h1>价格透明，按量计费</h1>
      <p class="sub">10 积分 = 1 元；文生视频 5s/720p 低至 8 积分（0.8 元）。Alpha 期注册赠送 80 积分。</p>
      <p class="sub">
        当前余额：<b>{{ balance ?? "-" }}</b>
      </p>
    </section>

    <section class="cards">
      <article v-for="sku in skus" :key="sku.price" class="card">
        <h3>¥{{ sku.price }}</h3>
        <p class="credits">{{ sku.credits }} 积分</p>
        <p class="muted">Beta 支付上线后可购买；Alpha 期通过邀请码获取额度。</p>
        <Button disabled>Beta 开放购买</Button>
      </article>
    </section>

    <section class="notes">
      <h3>计费规则</h3>
      <ul>
        <li>提交时冻结积分，成功结算、失败/取消自动解冻；</li>
        <li>LLM 步骤（大纲/角色/分镜）单次 1~2 积分，失败不扣；</li>
        <li>批量投递支持预算上限，触顶部分成功、可提高预算续投；</li>
        <li>所有价格均来自模型目录实时报价，不存在隐藏加价。</li>
      </ul>
    </section>
  </main>
</template>

<style scoped>
.page {
  flex: 1;
  max-width: 960px;
  width: 100%;
  margin: 0 auto;
  padding: 24px 32px;
}
.hero {
  text-align: center;
  padding: 40px 0 24px;
}
h1 {
  margin: 0 0 12px;
  font-size: 28px;
}
.sub {
  color: var(--text-2);
  font-size: 14px;
  margin: 6px 0;
}
.cards {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
}
.card {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-l);
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.card h3 {
  margin: 0;
  font-size: 22px;
}
.credits {
  margin: 0;
  font-size: 15px;
}
.muted {
  color: var(--text-3);
  font-size: 12px;
}
.notes {
  margin-top: 32px;
  color: var(--text-2);
  font-size: 13px;
}
.notes h3 {
  color: var(--text-1);
  font-size: 16px;
}
.notes li {
  margin: 6px 0;
}
@media (max-width: 720px) {
  .cards {
    grid-template-columns: 1fr 1fr;
  }
}
</style>
