<script setup lang="ts">
// 营销/公共布局：深色（与竞品 ReelMate 一致）
</script>

<template>
  <div class="marketing">
    <slot />
  </div>
</template>

<style scoped>
.marketing {
  position: fixed;
  inset: 0;
  overflow-y: auto;
  background: var(--dark-base);
  color: var(--text-inverse);
  display: flex;
  flex-direction: column;
}
.marketing :deep(a) {
  color: inherit;
}
</style>
