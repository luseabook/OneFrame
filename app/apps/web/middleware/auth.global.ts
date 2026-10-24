export default defineNuxtRouteMiddleware(async (to) => {
  if (import.meta.server) return;
  if (!to.meta.requiresAuth) return;
  const auth = useAuth();
  if (!auth.state.value.accessToken) await auth.refresh();
  if (!auth.state.value.accessToken) {
    return navigateTo(`/login?redirect=${encodeURIComponent(to.fullPath)}`);
  }
});
