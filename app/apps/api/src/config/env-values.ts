/**
 * api 侧布尔 / 枚举环境变量的取值表，以及 zod 适配（第 124 批）。
 *
 * 为什么要有这一层：同一个键在两处各判一次，接受范围就会漂移。第 124 批量到的
 * 15 例静默错向里，`OAUTH_MOCK=true` / `CAPTCHA_ENFORCE=" 1 "` 被 `=== "1"` 判成「关」
 * 直接放行，`CATALOG_SYNC_TOOLS=TRUE` 被 `=== "true"` 判成「不覆盖」，`STORAGE_DRIVER=S3`
 * 既过不了 schema 也不该让 `createStorage` 去猜。读取逻辑统一在
 * `packages/shared/src/env-flag.ts`（接受表：1/true/yes/on 与 0/false/no/off，
 * 大小写不敏感、裁首尾空白、空白=未设置），这里只放**取值表**与 zod 接线，
 * 让 schema 校验与运行期读取共用同一份接受范围。
 *
 * 两类消费者：
 * - 启动快照（`env.*`）：schema 里的 `zEnvFlag` / `zEnvEnum` 在 `buildEnv` 时解析一次，
 *   坏值直接让进程起不来；
 * - 调用时现场读（OAuth mock / 行为验证码）：测试要在同一进程内切态，因此不能读快照，
 *   由调用点用 `readEnvFlag` + 本文件的 spec 现场取值；坏值在调用点抛错（响亮），
 *   而进程启动时 schema 已经先拦过一遍。
 *
 * 诚实边界：本层只统一「怎么读」，**不改变任何变量的默认值**。默认值原样搬自原 schema
 * （`OAUTH_MOCK`/`CAPTCHA_ENFORCE`/`CATALOG_SYNC_TOOLS` 关、`MODERATION_ENABLED` 开）。
 * 接受范围因此比以前宽：`CATALOG_SYNC_TOOLS=1` 从此表示「开」（旧行为是启动失败），
 * `MODERATION_ENABLED=off` 从此表示「关」（旧行为同样是启动失败）——这些是显式拼写，
 * 不再有「拼错一个字母静默走到另一侧」的第三种结局。
 */
import { z } from "zod";
import {
  parseEnvEnum,
  parseEnvFlag,
  type EnvEnumSpec,
  type EnvFlagSpec,
} from "@app/shared";

/** 仅非生产生效：把 OAuth 回调短路成本地假用户（默认关）。调用时现场读取。 */
export const OAUTH_MOCK_SPEC: EnvFlagSpec = { default: false };

/** 登录 / 发码入口是否强制行为验证码（默认关）。调用时现场读取。 */
export const CAPTCHA_ENFORCE_SPEC: EnvFlagSpec = { default: false };

/** 工具目录是否用代码定义覆盖库内模型 / 价目（默认关，运营资产以库为准）。 */
export const CATALOG_SYNC_TOOLS_SPEC: EnvFlagSpec = { default: false };

/** 内容安全敏感词审核（默认开）。 */
export const MODERATION_ENABLED_SPEC: EnvFlagSpec = { default: true };

/**
 * schema 里的布尔变量：空白 / 未设置 → 默认值；接受表外的拼写 → 一条 zod issue，
 * 文案沿用 shared 的 `invalid <键>: "<原值>" (must be …; blank = unset)`，不泄露其他配置。
 */
export function zEnvFlag(name: string, spec: EnvFlagSpec) {
  return z
    .string()
    .optional()
    .transform((raw, ctx): boolean => {
      try {
        return parseEnvFlag(name, raw) ?? spec.default;
      } catch (error) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: (error as Error).message });
        return z.NEVER;
      }
    });
}

/**
 * schema 里的枚举变量：按 `values` 不区分大小写匹配并返回**规范拼写**
 * （`STORAGE_DRIVER=S3` → `"s3"`），不在表内则 zod issue 列出全部合法取值。
 */
export function zEnvEnum<T extends string>(name: string, spec: EnvEnumSpec<T>) {
  return z
    .string()
    .optional()
    .transform((raw, ctx): T => {
      try {
        return parseEnvEnum(name, raw, spec.values) ?? spec.default;
      } catch (error) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: (error as Error).message });
        return z.NEVER;
      }
    });
}