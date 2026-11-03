<script setup lang="ts">
import { CLI_CATALOG as catalog } from "~/utils/cli-catalog";

/**
 * CLI 公测页（对齐竞品 `/cli`，第 133 批）。
 *
 * 竞品页面结构（`rea-reelmate/x4.png`，1664×955）：
 * 1) Hero：品牌标 + 「CLI 公测版 × Agent 工具」+ 一句说明；
 * 2) 安装面板：一段可复制的 Agent 指令 + 「查看使用指南」按钮；
 * 3) 能力区：三张卡（资产+分镜自动执行 / 智能回填批量生成 / 一句话写剧本）。
 *
 * 我方数据不编：命令总数来自 `apps/web/data/cli-catalog.json`（由
 * `apps/cli/scripts/export-catalog.ts` 从 `COMMANDS` 生成），页面直接展示
 * 「38 组 / 204 条 / 171 条已落地」以及每组的前几条命令；`ready:false` 的骨架
 * 明确标注「骨架」，不把 `--help` 里的名字当成已实现能力。
 *
 * Agent 安装指令里的分发地址是部署期配置（`NUXT_PUBLIC_CLI_SKILL_URL`）；
 * 未配置时只显示仓库内可跑的本地命令，不伪造公网 zip 地址。
 */
definePageMeta({ ssr: false, requiresAuth: true, layout: "app" });
const { t } = useI18n();
useHead({ title: () => t("cliPage.metaTitle") });

const config = useRuntimeConfig();
const toast = useToast();
const skillUrl = computed(() => String(config.public.cliSkillUrl ?? "").trim());

const localCommand = "pnpm --filter @app/cli build && node apps/cli/dist/index.js --help";
const agentCommand = computed(() =>
  skillUrl.value
    ? t("cliPage.agentCommand", { url: skillUrl.value })
    : "",
);

const keyword = ref("");
const groups = computed(() => catalog.groupList);

const visibleGroups = computed(() => {
  const k = keyword.value.trim().toLowerCase();
  if (!k) return groups.value;
  return groups.value.filter(
    (g) =>
      g.group.toLowerCase().includes(k) ||
      g.commands.some((c) => c.cmd.toLowerCase().includes(k) || c.summary.toLowerCase().includes(k)),
  );
});

async function copy(text: string, label: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(t("cliPage.copied"));
  } catch {
    toast.error(t("cliPage.copyFailed"));
  }
  void label;
}

const capabilities = computed(() => [
  {
    key: "asset",
    title: t("cliPage.capAssetTitle"),
    desc: t("cliPage.capAssetDesc"),
    bullets: [t("cliPage.capAssetB1"), t("cliPage.capAssetB2"), t("cliPage.capAssetB3")],
  },
  {
    key: "prompt",
    title: t("cliPage.capPromptTitle"),
    desc: t("cliPage.capPromptDesc"),
    bullets: [t("cliPage.capPromptB1"), t("cliPage.capPromptB2"), t("cliPage.capPromptB3")],
  },
  {
    key: "script",
    title: t("cliPage.capScriptTitle"),
    desc: t("cliPage.capScriptDesc"),
    bullets: [t("cliPage.capScriptB1"), t("cliPage.capScriptB2"), t("cliPage.capScriptB3")],
  },
]);

function commandLine(group: string, cmd: string): string {
  return cmd ? `oneframe ${group} ${cmd}` : `oneframe ${group}`;
}
</script>

<template>
  <div class="cli">
    <section class="cli-hero">
      <div class="cli-mark" aria-hidden="true">一</div>
      <p class="cli-eyebrow">{{ t("cliPage.eyebrow") }}</p>
      <h1 class="cli-title">{{ t("cliPage.title") }}</h1>
      <p class="cli-sub">{{ t("cliPage.sub") }}</p>

      <div class="cli-panel">
        <p class="cli-panel__hint">{{ t("cliPage.installHint") }}</p>

        <div v-if="agentCommand" class="cli-code">
          <code class="cli-code__text">{{ agentCommand }}</code>
          <button
            type="button"
            class="cli-copy"
            :aria-label="t('cliPage.copy')"
            @click="copy(agentCommand, 'agent')"
          >
            {{ t("cliPage.copy") }}
          </button>
        </div>

        <div class="cli-code">
          <code class="cli-code__text">{{ localCommand }}</code>
          <button
            type="button"
            class="cli-copy"
            :aria-label="t('cliPage.copy')"
            @click="copy(localCommand, 'local')"
          >
            {{ t("cliPage.copy") }}
          </button>
        </div>

        <p v-if="!skillUrl" class="cli-panel__note">{{ t("cliPage.skillUrlNote") }}</p>

        <div class="cli-panel__actions">
          <a class="cli-guide" href="#capabilities">{{ t("cliPage.guide") }}</a>
        </div>
      </div>
    </section>

    <section id="capabilities" class="cli-abilities">
      <h2 class="cli-h2">{{ t("cliPage.abilitiesTitle") }}</h2>
      <div class="cli-cards">
        <article v-for="(cap, index) in capabilities" :key="cap.key" class="cli-card">
          <div class="cli-card__art" aria-hidden="true">{{ ["◈", "▤", "✎"][index] }}</div>
          <h3 class="cli-card__title">{{ cap.title }}</h3>
          <p class="cli-card__desc">{{ cap.desc }}</p>
          <ul class="cli-card__list">
            <li v-for="b in cap.bullets" :key="b">{{ b }}</li>
          </ul>
        </article>
      </div>
    </section>

    <section id="commands" class="cli-commands">
      <div class="cli-commands__head">
        <h2 class="cli-h2">{{ t("cliPage.commandsTitle") }}</h2>
        <p class="cli-commands__meta">
          {{ t("cliPage.commandsMeta", { groups: catalog.groups, commands: catalog.commands, ready: catalog.ready }) }}
        </p>
      </div>

      <div class="cli-toolbar">
        <input
          v-model="keyword"
          class="cli-search"
          type="search"
          :placeholder="t('cliPage.searchPlaceholder')"
        />
        <button type="button" class="cli-reset" @click="keyword = ''">{{ t("cliPage.clear") }}</button>
      </div>

      <p v-if="visibleGroups.length === 0" class="cli-empty">{{ t("cliPage.empty") }}</p>

      <div v-else class="cli-groups">
        <article v-for="g in visibleGroups" :key="g.group" class="cli-group">
          <header class="cli-group__head">
            <h3 class="cli-group__name">{{ g.group }}</h3>
            <span class="cli-group__count">
              {{ t("cliPage.groupMeta", { ready: g.ready, total: g.total }) }}
            </span>
          </header>
          <ul class="cli-group__list">
            <li v-for="c in g.commands.slice(0, 4)" :key="c.cmd" class="cli-group__item">
              <code class="cli-group__cmd">{{ commandLine(g.group, c.cmd) }}</code>
              <span class="cli-group__sum">{{ c.summary }}</span>
              <span v-if="!c.ready" class="cli-badge">{{ t("cliPage.skeleton") }}</span>
            </li>
          </ul>
          <p v-if="g.commands.length > 4" class="cli-group__more">
            {{ t("cliPage.more", { n: g.commands.length - 4 }) }}
          </p>
        </article>
      </div>
    </section>
  </div>
</template>

<style scoped>
.cli {
  padding: 16px 24px 56px;
  color: var(--text-1);
}
.cli-hero {
  max-width: 1126px;
  margin: 0 auto;
  padding: 24px 0 8px;
  text-align: center;
}
.cli-mark {
  width: 56px;
  height: 56px;
  margin: 0 auto 14px;
  border-radius: 16px;
  background: linear-gradient(135deg, #9b46ff, #6d28d9);
  color: #fff;
  font-size: 26px;
  font-weight: 700;
  display: grid;
  place-items: center;
}
.cli-eyebrow {
  margin: 0 0 8px;
  color: var(--text-3);
  font-size: 12px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.cli-title {
  margin: 0 0 10px;
  font-size: 34px;
  line-height: 1.25;
  font-weight: 600;
  background: linear-gradient(92deg, #fff, #cbb6ff 55%, #9b46ff);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
.cli-sub {
  max-width: 620px;
  margin: 0 auto 20px;
  color: var(--text-2);
  font-size: 14px;
  line-height: 1.7;
}
.cli-panel {
  max-width: 760px;
  margin: 0 auto;
  padding: 16px;
  border: 1px solid var(--panel-line);
  border-radius: var(--radius-card, 16px);
  background: var(--panel-tint, rgb(194 204 241 / 8%));
  text-align: left;
}
.cli-panel__hint {
  margin: 0 0 10px;
  color: var(--text-2);
  font-size: 13px;
}
.cli-code {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
  padding: 10px 12px;
  border: 1px solid var(--panel-line);
  border-radius: var(--radius-control);
  background: rgb(0 0 0 / 28%);
}
.cli-code__text {
  flex: 1;
  overflow-x: auto;
  white-space: nowrap;
  color: var(--text-1);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12.5px;
}
.cli-copy {
  flex-shrink: 0;
  height: 28px;
  padding: 0 10px;
  border: 1px solid var(--panel-line);
  border-radius: 8px;
  background: transparent;
  color: var(--text-2);
  font-size: 12px;
  cursor: pointer;
}
.cli-copy:hover {
  color: var(--text-1);
  border-color: var(--brand, #9b46ff);
}
.cli-panel__note {
  margin: 4px 0 0;
  color: var(--text-4);
  font-size: 12px;
  line-height: 1.6;
}
.cli-panel__actions {
  display: flex;
  justify-content: center;
  margin-top: 12px;
}
.cli-guide {
  display: inline-flex;
  align-items: center;
  height: 36px;
  padding: 0 18px;
  border-radius: 999px;
  background: #fff;
  color: #1a1a1f;
  font-size: 13px;
  font-weight: 600;
  text-decoration: none;
}
.cli-abilities,
.cli-commands {
  max-width: 1126px;
  margin: 44px auto 0;
}
.cli-h2 {
  margin: 0 0 18px;
  font-size: 22px;
  font-weight: 600;
  text-align: center;
}
.cli-cards {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px;
}
.cli-card {
  padding: 20px;
  border: 1px solid var(--panel-line);
  border-radius: var(--radius-card, 16px);
  background: var(--panel-tint, rgb(194 204 241 / 8%));
}
.cli-card__art {
  width: 44px;
  height: 44px;
  margin-bottom: 12px;
  border-radius: 12px;
  background: rgb(155 70 255 / 16%);
  color: var(--brand, #9b46ff);
  font-size: 22px;
  display: grid;
  place-items: center;
}
.cli-card__title {
  margin: 0 0 8px;
  font-size: 15px;
  line-height: 1.5;
  font-weight: 600;
}
.cli-card__desc {
  margin: 0 0 12px;
  color: var(--text-3);
  font-size: 12.5px;
  line-height: 1.7;
}
.cli-card__list {
  margin: 0;
  padding-left: 16px;
  color: var(--text-2);
  font-size: 12.5px;
  line-height: 1.9;
}
.cli-commands__head {
  text-align: center;
}
.cli-commands__meta {
  margin: -8px 0 18px;
  color: var(--text-3);
  font-size: 12.5px;
}
.cli-toolbar {
  display: flex;
  gap: 8px;
  max-width: 420px;
  margin: 0 auto 16px;
}
.cli-search {
  flex: 1;
  height: 34px;
  padding: 0 12px;
  border: 1px solid var(--panel-line);
  border-radius: 999px;
  background: transparent;
  color: var(--text-1);
  font-size: 13px;
  outline: none;
}
.cli-search::placeholder {
  color: var(--text-4);
}
.cli-reset {
  height: 34px;
  padding: 0 14px;
  border: 1px solid var(--panel-line);
  border-radius: 999px;
  background: transparent;
  color: var(--text-2);
  font-size: 12px;
  cursor: pointer;
}
.cli-empty {
  color: var(--text-3);
  text-align: center;
  font-size: 13px;
}
.cli-groups {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}
.cli-group {
  padding: 14px 16px;
  border: 1px solid var(--panel-line);
  border-radius: var(--radius-card, 16px);
  background: var(--panel-tint, rgb(194 204 241 / 8%));
}
.cli-group__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
}
.cli-group__name {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
}
.cli-group__count {
  color: var(--text-3);
  font-size: 11.5px;
}
.cli-group__list {
  margin: 0;
  padding: 0;
  list-style: none;
}
.cli-group__item {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 4px 0;
  border-bottom: 1px dashed var(--panel-line);
  font-size: 12.5px;
}
.cli-group__item:last-child {
  border-bottom: 0;
}
.cli-group__cmd {
  flex-shrink: 0;
  color: var(--text-1);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
}
.cli-group__sum {
  flex: 1;
  color: var(--text-3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cli-badge {
  flex-shrink: 0;
  padding: 1px 6px;
  border-radius: 999px;
  background: rgb(255 255 255 / 8%);
  color: var(--text-4);
  font-size: 10.5px;
}
.cli-group__more {
  margin: 6px 0 0;
  color: var(--text-4);
  font-size: 11.5px;
}
@media (max-width: 900px) {
  .cli-cards,
  .cli-groups {
    grid-template-columns: 1fr;
  }
  .cli-title {
    font-size: 26px;
  }
}
</style>