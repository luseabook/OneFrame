type ToastApi = {
  success: (text: string) => void;
  error: (text: string) => void;
  info: (text: string) => void;
};

const noop: ToastApi = { success: () => {}, error: () => {}, info: () => {} };

function resolve(): ToastApi {
  if (import.meta.server) return noop;
  return (globalThis as unknown as { __of_toast?: ToastApi }).__of_toast ?? noop;
}

/**
 * 全局轻提示。必须在调用时惰性解析宿主，不能缓存——
 * 页面 setup 早于 <ToastHost /> 挂载，提前取值会拿到空实现。
 */
export const useToast = (): ToastApi => ({
  success: (text: string) => resolve().success(text),
  error: (text: string) => resolve().error(text),
  info: (text: string) => resolve().info(text),
});
