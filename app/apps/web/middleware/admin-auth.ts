// 运营后台路由守卫：未登录一律回到独立登录页 /admin/login
// 与用户端 auth 中间件互不影响（admin token 独立存放在 localStorage.admin_token）
export default defineNuxtRouteMiddleware((to) => {
  if (import.meta.server) return;
  const token = localStorage.getItem("admin_token");
  if (!token) return navigateTo("/admin/login", { replace: true });
  if (to.path === "/admin/login") return navigateTo("/admin", { replace: true });
});
