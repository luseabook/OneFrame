<script setup lang="ts">
import { onMounted, ref } from "vue";

definePageMeta({ ssr: false });

const route = useRoute();
const auth = useAuth();
const error = ref("");
const done = ref(false);

onMounted(async () => {
  const provider = String(route.params.provider ?? "");
  const code = String(route.query.code ?? "");
  const state = String(route.query.state ?? "");
  if (!provider || !code || !state) {
    error.value = "缺少 OAuth 回调参数";
    return;
  }
  try {
    const result = await auth.completeOauth(provider, code, state);
    done.value = true;
    await navigateTo(result.bound ? "/settings?bound=oauth" : "/projects", { replace: true });
  } catch (e) {
    error.value = e instanceof Error ? e.message : "OAuth 登录失败";
  }
});
</script>

<template>
  <main class="callback">
    <p v-if="!error && !done">正在完成授权…</p>
    <p v-else-if="error" class="error">{{ error }}</p>
  </main>
</template>

<style scoped>
.callback {
  min-height: 60vh;
  display: grid;
  place-items: center;
  color: var(--text-2);
}
.error {
  color: var(--danger);
}
</style>
