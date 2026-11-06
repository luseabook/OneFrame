// 运营后台路由守卫（H-3）：向服务端**验证**会话，而不是只看 localStorage 有没有字符串。
// 凭证是 HttpOnly Cookie（`admin_token`），JS 读不到，所以唯一可靠的"已登录"判据是
// `GET /v1/ops/admin/me` 返回 code=0 —— 它背后是 AdminGuard 的验签 + 账号状态 + token_version。
// 网络错误不踢人：接口抖动不该把运营轰回登录页，页面自身的请求会显示错误。
export default defineNuxtRouteMiddleware(async (to) => {
  if (import.meta.server) return;
  if (to.path === "/admin/login") return; // 登录页自己处理"已登录直接进后台"
  try {
    await adminApi("/ops/admin/me");
  } catch (error) {
    if (isAdminAuthError(error) || isAdminRoleError(error)) {
      return navigateTo(`/admin/login?redirect=${encodeURIComponent(to.fullPath)}`, { replace: true });
    }
  }
});