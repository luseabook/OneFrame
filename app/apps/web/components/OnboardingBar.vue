<script setup lang="ts">
// 新手引导条（PRD 增补 §3.2）：仅在未关闭且当前无任何作品时展示
const emit = defineEmits<{ dismiss: [] }>();

const steps = [
  { n: 1, title: "新建作品", desc: "粘贴小说或写一句话想法" },
  { n: 2, title: "生成大纲", desc: "AI 拆成 3~6 集，可逐条改" },
  { n: 3, title: "投递出片", desc: "选模型与预算，一键批量" },
];
</script>

<template>
  <aside class="onboard">
    <div class="left">
      <p class="title">3 步做出第一集</p>
      <ol class="steps">
        <li v-for="s in steps" :key="s.n">
          <span class="n">{{ s.n }}</span>
          <span class="txt">
            <b>{{ s.title }}</b>
            <em>{{ s.desc }}</em>
          </span>
        </li>
      </ol>
    </div>
    <div class="right">
      <NuxtLink to="/projects" class="go">开始创建</NuxtLink>
      <button class="skip" @click="emit('dismiss')">不再提示</button>
    </div>
  </aside>
</template>

<style scoped>
.onboard {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-6);
  padding: var(--space-4) var(--space-5);
  margin-bottom: var(--space-5);
  border: 1px solid var(--brand-border);
  border-radius: var(--radius-xl);
  background: linear-gradient(120deg, var(--brand-soft), transparent 70%), var(--bg-surface);
}
.title {
  margin: 0 0 var(--space-3);
  font-size: var(--text-base);
  font-weight: 600;
  color: var(--text-1);
}
.steps {
  display: flex;
  gap: var(--space-6);
  margin: 0;
  padding: 0;
  list-style: none;
  flex-wrap: wrap;
}
.steps li {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}
.n {
  width: 20px;
  height: 20px;
  flex-shrink: 0;
  border-radius: var(--radius-full);
  background: var(--brand-500);
  color: #fff;
  font-size: 11px;
  display: grid;
  place-items: center;
}
.txt {
  display: flex;
  flex-direction: column;
  line-height: 1.35;
}
.txt b {
  font-size: var(--text-sm);
  color: var(--text-1);
  font-weight: 600;
}
.txt em {
  font-style: normal;
  font-size: var(--text-xs);
  color: var(--text-3);
}
.right {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  flex-shrink: 0;
}
.go {
  display: inline-flex;
  align-items: center;
  height: 32px;
  padding: 0 var(--space-4);
  border-radius: var(--radius-md);
  background: var(--brand-500);
  color: #fff;
  font-size: var(--text-sm);
  font-weight: 500;
}
.go:hover {
  background: var(--brand-600);
}
.skip {
  background: none;
  border: 0;
  color: var(--text-4);
  font-size: var(--text-xs);
  cursor: pointer;
}
.skip:hover {
  color: var(--text-2);
}
@media (max-width: 900px) {
  .onboard {
    flex-direction: column;
    align-items: flex-start;
  }
}
</style>
