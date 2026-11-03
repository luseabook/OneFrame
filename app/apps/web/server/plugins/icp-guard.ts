/**
 * 生产守卫：没配备案号就不许起服务（PAGE-07）。
 *
 * 为什么放 Nitro 插件而不是 `nuxt.config.ts`：
 * `nuxt.config.ts` 只在**构建期**执行一次；而部署流程是「构建 → 上传产物 → systemd 注入 env 启动」
 * （`runtimeConfig.public` 支持运行期由 `NUXT_PUBLIC_*` 覆盖，已实测同一份产物换 env 即生效）。
 * 守卫若写在 nuxt.config 里，结果是**构建时**就抛错 —— 备案号还没下发时每次 build 都会失败，
 * 而且它并不能保证「运行时真的配了」，等于把 fail-fast 放错了环节。
 * Nitro 插件在进程启动时执行，抛错 → 进程退出 → systemd 标记 failed，运维立刻看得见。
 *
 * 为什么必须有逃生舱 `ONEFRAME_ALLOW_MISSING_ICP`：
 * 验收机跑的就是生产构建（`NODE_ENV=production`），但备案号要等行政流程，最短也是数周。
 * 没有逃生舱则这台机器今天起不来，整轮验收全停。逃生舱必须显式给值，
 * 且每次启动都打一条醒目 WARN ——「悄悄没有备案号」正是 PAGE-07 要防的那件事。
 * 正式对外的那台机器上不设这个变量，忘配就起不来。
 */
export default defineNitroPlugin(() => {
  if (process.env.NODE_ENV !== "production") return;

  const config = useRuntimeConfig();
  const icpRaw = String(config.public.icpBeian ?? "").trim();
  /**
   * 判据本体在 `server/utils/icp-format.ts`（纯函数，可被 spec 直接调用）。
   *
   * 为什么抽出去：本插件带 `defineNitroPlugin`/`useRuntimeConfig`，只能在 Nitro 运行时加载，
   * 校验逻辑留在文件里就没法被用例锁住，只能靠人工起服务去撞 —— 而"带空格的真号"
   * 正是靠人工撞出来的（第一次漏了）。抽成纯函数后，好值与坏值都能进 spec。
   *
   * 报错回显用**归一化前**的原值（`icpRaw`），运维才知道自己到底填了什么。
   */
  const icp = normalizeIcp(icpRaw);

  if (icp !== "") {
    if (isValidIcp(icpRaw)) return;
    throw new Error(
      `[oneframe/web] NUXT_PUBLIC_ICP_BEIAN=${JSON.stringify(icpRaw)} 不像备案号。` +
        "合法形态形如 京ICP备2024000000号-1 或 京ICP证030173号（省简称开头、`号`/`-N` 结尾；空格会自动忽略）。" +
        "占位值（pending / TODO / 待备案 / TEST-…）会被页脚当成真号显示，等于对外宣称已备案 —— 这是刻意拦下的。",
    );
  }

  const rawAllow = String(process.env.ONEFRAME_ALLOW_MISSING_ICP ?? "").trim();
  const allowMissing = rawAllow === "1";
  const hint =
    "生产环境缺少 NUXT_PUBLIC_ICP_BEIAN（ICP 备案号）。" +
    "缺了它的后果不是报错，而是全站页脚没有备案号 —— 与未备案等价，且不会留下任何痕迹。";

  if (!allowMissing) {
    // 逃生舱写了但没写对：这是最容易踩的一脚。`readEnvFlag` 那套取值表在 api/worker 侧，
    // web 的启动插件有意不依赖 `@app/shared`，所以这里只认 "1"，
    // 但**必须把实际值回报出来**，否则运维看到「缺少备案号」会去查备案，方向完全跑偏。
    const wrongSpelling = rawAllow !== "";
    const spellingNote = wrongSpelling
      ? `检测到 ONEFRAME_ALLOW_MISSING_ICP=${JSON.stringify(rawAllow)}，本守卫只认字符串 "1"` +
        "（`true` / `yes` / `on` 都不算，这是刻意收紧的：逃生舱宁可失败得很吵，也不能悄悄开着）。"
      : "";
    throw new Error(
      `[oneframe/web] ${hint} ${spellingNote}` +
        "请由运维注入 NUXT_PUBLIC_ICP_BEIAN（形如 京ICP备2024000000号-1）；" +
        "若这是非对外的验收环境，显式设置 ONEFRAME_ALLOW_MISSING_ICP=1 后重启。",
    );
  }

  // 逃生舱：不阻断启动，但每次启动都留痕，避免「验收环境」被误当成可对外环境。
  console.warn(
    `[oneframe/web] WARN ${hint} ` +
      "当前因 ONEFRAME_ALLOW_MISSING_ICP=1 继续启动 —— 本进程不得对外提供访问。",
  );
});
