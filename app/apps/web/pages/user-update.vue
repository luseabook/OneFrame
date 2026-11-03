<script setup lang="ts">
/**
 * 账号资料（竞品 `/user-update`，第 134 批）。
 *
 * 竞品该路由带 `middleware:"auth"`（`capture_page.json` 里可见），是登录后的资料编辑页；
 * 但没有字段证据。我方已有 `POST /user-info`（`nickname` / `avatar_uri`）与 `GET /me`，
 * 这页就是把这两个端点接成一个表单，不新增后端。
 *
 * 边界：
 * - 头像只收 HTTPS/相对路径字符串（本仓库没有对象存储头像上传链路，不伪造上传按钮）；
 * - 昵称长度 1..40（与 `userInfoBody` 一致），空串不发请求；
 * - 成功后只更新本地展示，不重发 `/me`（下一次进入页面自然拿到最新值）。
 */
definePageMeta({ ssr: false, requiresAuth: true, layout: "app" });
const { t } = useI18n();
useHead({ title: () => t("userUpdate.metaTitle") });

const api = useApi();
const toast = useToast();

const loading = ref(true);
const saving = ref(false);
const error = ref("");
const nickname = ref("");
const avatarUri = ref("");
const currentNickname = ref("");

onMounted(async () => {
  try {
    const me = await api.get<{ user: { nickname?: string; avatar_uri?: string | null } }>("/me");
    nickname.value = me.user.nickname ?? "";
    avatarUri.value = me.user.avatar_uri ?? "";
    currentNickname.value = nickname.value;
  } catch (e) {
    error.value = e instanceof Error ? e.message : t("userUpdate.loadFailed");
  } finally {
    loading.value = false;
  }
});

async function save(): Promise<void> {
  error.value = "";
  const name = nickname.value.trim();
  if (name.length === 0 || name.length > 40) {
    error.value = t("userUpdate.nicknameInvalid");
    return;
  }
  saving.value = true;
  try {
    await api.post("/user-info", {
      nickname: name,
      avatar_uri: avatarUri.value.trim() === "" ? null : avatarUri.value.trim(),
    });
    currentNickname.value = name;
    toast.success(t("userUpdate.saved"));
  } catch (e) {
    error.value = e instanceof Error ? e.message : t("userUpdate.saveFailed");
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="uu">
    <header class="uu-head">
      <h1 class="uu-title">{{ t("userUpdate.title") }}</h1>
      <p class="uu-sub">{{ t("userUpdate.sub") }}</p>
    </header>

    <p v-if="loading" class="uu-muted">{{ t("userUpdate.loading") }}</p>
    <p v-else-if="error" class="uu-err" role="alert">{{ error }}</p>

    <section v-else class="uu-card">
      <label class="uu-field">
        <span class="uu-label">{{ t("userUpdate.nickname") }}</span>
        <input v-model="nickname" class="uu-input" maxlength="40" :placeholder="t('userUpdate.nicknamePlaceholder')" />
      </label>

      <label class="uu-field">
        <span class="uu-label">{{ t("userUpdate.avatar") }}</span>
        <input v-model="avatarUri" class="uu-input" maxlength="512" :placeholder="t('userUpdate.avatarPlaceholder')" />
        <span class="uu-hint">{{ t("userUpdate.avatarHint") }}</span>
      </label>

      <div v-if="avatarUri" class="uu-preview">
        <img :src="avatarUri" alt="" class="uu-avatar" />
      </div>

      <div class="uu-actions">
        <Button :disabled="saving" @click="save">
          {{ saving ? t("userUpdate.saving") : t("userUpdate.save") }}
        </Button>
        <NuxtLink class="uu-back" to="/settings">{{ t("userUpdate.back") }}</NuxtLink>
      </div>
    </section>
  </div>
</template>

<style scoped>
.uu {
  max-width: 720px;
  margin: 0 auto;
  padding: 24px 24px 56px;
  color: var(--text-1);
}
.uu-head {
  margin-bottom: 18px;
}
.uu-title {
  margin: 0 0 6px;
  font-size: 22px;
  font-weight: 600;
}
.uu-sub {
  margin: 0;
  color: var(--text-3);
  font-size: 13px;
}
.uu-muted {
  color: var(--text-3);
  font-size: 13px;
}
.uu-err {
  padding: 10px 14px;
  border: 1px solid var(--danger, #f56c6c);
  border-radius: var(--radius-control);
  color: var(--danger, #f56c6c);
  font-size: 13px;
}
.uu-card {
  padding: 20px;
  border: 1px solid var(--panel-line);
  border-radius: var(--radius-card, 16px);
  background: var(--panel-tint, rgb(194 204 241 / 8%));
}
.uu-field {
  display: block;
  margin-bottom: 16px;
}
.uu-label {
  display: block;
  margin-bottom: 6px;
  color: var(--text-2);
  font-size: 13px;
}
.uu-input {
  width: 100%;
  height: 36px;
  padding: 0 12px;
  border: 1px solid var(--panel-line);
  border-radius: var(--radius-control);
  background: transparent;
  color: var(--text-1);
  font-size: 13px;
  outline: none;
}
.uu-input:focus {
  border-color: var(--brand, #9b46ff);
}
.uu-hint {
  display: block;
  margin-top: 6px;
  color: var(--text-4);
  font-size: 12px;
}
.uu-preview {
  margin-bottom: 16px;
}
.uu-avatar {
  width: 64px;
  height: 64px;
  border-radius: 50%;
  object-fit: cover;
  border: 1px solid var(--panel-line);
}
.uu-actions {
  display: flex;
  align-items: center;
  gap: 16px;
}
.uu-back {
  color: var(--text-3);
  font-size: 13px;
  text-decoration: none;
}
</style>