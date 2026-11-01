/**
 * 布尔 / 枚举环境变量的**唯一**读取入口（第 124 批）。
 *
 * ## 为什么要收口
 * 仓库里布尔与枚举型配置的判据是就地写的 `=== "true"` / `!== "false"` / `=== "real"`，
 * 共 9 处（worker 6、api 3）外加一处把 `process.env.STORAGE_DRIVER` 直接 `as "local"|"s3"`
 * 的裸转换。写法差一个字母不会报错、类型检查也过，行为却悄悄落到另一侧
 * （实测 15/15，见 `_acceptance/d124/flag-probe.log`）：
 *
 * - `AI_LABEL_ENABLED=0` / `=off`：`!== "false"` 判为 true —— 想关的合规开关没关上；
 * - `ARK_IMAGE_WATERMARK=no` / `=0`：同上 —— 水印照加；
 * - `ADAPTER_MODE=Real`（生产）：worker 主程序读成 mock，生产守卫读成「不是 real」，
 *   **同一变量两个读者给出相反结论**；`=REAL` 在非生产同样落回 mock；
 * - `STORAGE_S3_FORCE_PATH_STYLE=TRUE`：`=== "true"` 判为 false —— 配了等于没配；
 * - `STORAGE_DRIVER=S3` / `=Local`：裸转换把它当未知驱动，`s3` 配置不透传，
 *   报错是「s3 storage requires s3 config」，排查方向整个跑偏；
 * - `OAUTH_MOCK=" 1 "` / `=true`、`CAPTCHA_ENFORCE=" 1 "` / `=true`：判为关 ——
 *   前者让联调拿不到 mock 登录，后者让行为验证码在生产直接放行。
 *
 * ## 行为约定
 * - **未设置或纯空白 → 默认值**。空白是「没配置」，不是 false。
 * - **布尔接受表固定**：`1 / true / yes / on` 与 `0 / false / no / off`，
 *   大小写不敏感、首尾空白裁掉。其余一律抛 `RangeError`。
 * - **枚举按 values 逐项不区分大小写匹配，返回规范拼写**：`STORAGE_DRIVER=S3` → `"s3"`，
 *   而不是把 `"S3"` 原样传下去。未知取值抛 `RangeError`，文案列出全部合法取值。
 * - **默认值本人也要合规格**：布尔默认不是 true/false、枚举默认不在 values 里、
 *   values 为空或大小写重复，都是写错代码，与是否设置环境变量无关，同样抛。
 *
 * 与 `readEnvNumber` 同一条策略：启动即失败，不进「悄悄回落默认值」的分支。
 * 这些变量都不含密钥，错误信息可直接打日志。
 *
 * ## 诚实边界
 * - 只统一「怎么读」，**不改变各变量的默认值**（默认值仍由调用点的 spec 决定）。
 * - 接受表是固定的：不会为某个键额外接受 `enable` / `disabled` 之类写法；
 *   要加写法就改这张表，让所有键一起变。
 * - `NODE_ENV` 由运行时注入、取值是 `test` / `development` / `production`，
 *   仍是直接比较（本仓库 3 处），不在本模块收口范围内。
 * - 运行期热改 env 是否生效取决于调用方是否在**调用时**读：api 的两个测试开关
 *   （`OAUTH_MOCK` / `CAPTCHA_ENFORCE`）保持调用时读，供同一进程内切换。
 */
export interface EnvFlagSpec {
  /** 未设置或纯空白时的取值；只接受 true / false（写错立刻抛，别等上线才暴露） */
  readonly default: boolean;
}

export interface EnvEnumSpec<T extends string> {
  /** 全部合法取值（规范拼写）；匹配时不区分大小写，返回的也是这里的拼写 */
  readonly values: readonly T[];
  /** 未设置或纯空白时的取值；必须在 values 里 */
  readonly default: T;
}

/** 认作「开」的写法（大小写不敏感，首尾空白裁掉） */
export const ENV_TRUE_WORDS = ["1", "true", "yes", "on"] as const;
/** 认作「关」的写法（大小写不敏感，首尾空白裁掉） */
export const ENV_FALSE_WORDS = ["0", "false", "no", "off"] as const;

const FLAG_RULE = `${ENV_TRUE_WORDS.join(", ")} / ${ENV_FALSE_WORDS.join(", ")}`;

function normalize(raw: string): string {
  return raw.trim().toLowerCase();
}

function assertEnumValues<T extends string>(name: string, values: readonly T[]): void {
  if (values.length === 0) {
    throw new RangeError(`invalid spec for ${name}: values must not be empty`);
  }
  const seen = new Set<string>();
  for (const value of values) {
    if (value.trim() === "" || value !== value.trim()) {
      throw new RangeError(
        `invalid spec for ${name}: ${JSON.stringify(value)} (values must be non-empty without surrounding blanks)`,
      );
    }
    const key = value.toLowerCase();
    if (seen.has(key)) {
      throw new RangeError(`invalid spec for ${name}: duplicate value ${JSON.stringify(value)} (case-insensitive)`);
    }
    seen.add(key);
  }
}

/**
 * 解析单个布尔值。
 *
 * @returns 未设置 / 纯空白 → `undefined`（由调用方取默认值）；否则 true / false
 * @throws RangeError 取值不在接受表里
 */
export function parseEnvFlag(name: string, raw: string | undefined): boolean | undefined {
  if (raw === undefined) return undefined;
  const value = normalize(raw);
  if (value === "") return undefined;
  if ((ENV_TRUE_WORDS as readonly string[]).includes(value)) return true;
  if ((ENV_FALSE_WORDS as readonly string[]).includes(value)) return false;
  throw new RangeError(`invalid ${name}: ${JSON.stringify(raw)} (must be one of: ${FLAG_RULE}; blank = unset)`);
}

/**
 * 读取一个布尔环境变量。
 *
 * @param name 变量名（错误信息里原样出现，便于运维定位）
 * @param spec 默认值
 * @param env  注入点，默认 `process.env`（测试不该改全局 env）
 */
export function readEnvFlag(
  name: string,
  spec: EnvFlagSpec,
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  // 默认值是代码，不是配置：写错立刻抛
  if (spec.default !== true && spec.default !== false) {
    throw new RangeError(`invalid default for ${name}: ${JSON.stringify(spec.default)} (must be true or false)`);
  }
  return parseEnvFlag(name, env[name]) ?? spec.default;
}

/**
 * 解析单个枚举值：未设置 / 纯空白 → `undefined`；否则返回 **values 里的规范拼写**。
 *
 * @throws RangeError 取值不在 values 里（大小写不敏感比较）
 */
export function parseEnvEnum<T extends string>(
  name: string,
  raw: string | undefined,
  values: readonly T[],
): T | undefined {
  assertEnumValues(name, values);
  if (raw === undefined) return undefined;
  const value = normalize(raw);
  if (value === "") return undefined;
  const match = values.find((candidate) => candidate.toLowerCase() === value);
  if (match !== undefined) return match;
  throw new RangeError(`invalid ${name}: ${JSON.stringify(raw)} (must be one of: ${values.join(", ")}; blank = unset)`);
}

/**
 * 读取一个枚举环境变量。
 *
 * @param name 变量名（错误信息里原样出现，便于运维定位）
 * @param spec 合法取值 + 默认值
 * @param env  注入点，默认 `process.env`（测试不该改全局 env）
 */
export function readEnvEnum<T extends string>(
  name: string,
  spec: EnvEnumSpec<T>,
  env: Readonly<Record<string, string | undefined>> = process.env,
): T {
  assertEnumValues(name, spec.values);
  if (!spec.values.includes(spec.default)) {
    throw new RangeError(
      `invalid default for ${name}: ${JSON.stringify(spec.default)} (must be one of: ${spec.values.join(", ")})`,
    );
  }
  return parseEnvEnum(name, env[name], spec.values) ?? spec.default;
}

// ---------------------------------------------------------------------------
// 跨包共用的取值表。同一个键被 api 与 worker 各读一次时，必须共用这张表 ——
// 否则两边接受范围漂移，正是本批要消的形状。
// ---------------------------------------------------------------------------

/** 存储驱动：api 生成访问 URL（`storage.service.ts`）与 worker 构造存储（`main.ts`）同口径 */
export const STORAGE_DRIVER_SPEC: EnvEnumSpec<"local" | "s3"> = {
  values: ["local", "s3"],
  default: "local",
};

/** S3 path-style 开关：api 与 worker 对同一桶的寻址方式必须一致 */
export const STORAGE_S3_FORCE_PATH_STYLE_SPEC: EnvFlagSpec = { default: false };