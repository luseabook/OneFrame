<template>
  <div class="app">
    <header class="header">
      <NuxtLink to="/" class="logo">AI 漫剧工作台</NuxtLink>
      <nav class="nav">
        <Button variant="ghost" disabled>登录（内测筹备中）</Button>
      </nav>
    </header>
    <NuxtPage />
    <footer class="footer">
      <span>内容由 AI 生成，请仔细甄别</span>
      <span class="sep">·</span>
      <span>ICP 备案号占位（上线前替换，docs/06-security-compliance/compliance.md A3）</span>
    </footer>
  </div>
</template>

<style scoped>
.app {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}
.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 32px;
  border-bottom: 1px solid var(--color-border);
}
.logo {
  font-size: 16px;
  font-weight: 600;
}
.footer {
  margin-top: auto;
  padding: 20px 32px;
  color: var(--text-3);
  font-size: 12px;
  display: flex;
  gap: 8px;
}
.sep {
  color: var(--color-border);
}
</style>
