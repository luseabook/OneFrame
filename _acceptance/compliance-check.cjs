#!/usr/bin/env node
/**
 * 一帧 OneFrame · 上线合规可执行检查（代码侧）
 * ============================================
 *
 * 目的：把 docs/06-security-compliance/launch-checklist.md 里**代码侧**条目变成可复跑的检查，
 *       避免"纸面合规"。外部资质/密钥（备案、商户号、DPA、发票服务等）脚本无法验证，
 *       由清单人工跟踪；脚本只负责代码事实，并在结论里点名外部待办数量。
 *
 * 约束：
 * - 只用 Node 内置模块（fs/path/http），无第三方依赖、无外网访问；
 * - 唯一的"网络"行为是对 127.0.0.1 的本地运行态探测（request_id 响应头），
 *   服务未启动时判为 SKIP 并说明原因，不算失败；
 * - 输出 PASS/FAIL/SKIP + 每条证据（文件:行 / 端点 / 命令）+ 汇总；有 FAIL 时退出码 1。
 *
 * 用法：
 *   node _acceptance/compliance-check.cjs                 # 静态检查 + 本地运行态探测
 *   API_URL=http://127.0.0.1:3000 node _acceptance/compliance-check.cjs
 *   node _acceptance/compliance-check.cjs --quiet         # 只打印汇总与失败项
 *
 * 代码侧条目与清单编号一一对应（PAGE-/AGE-/MOD-/REP-/DEL-/PIPL-/AI-/PAY-/OPS-/LOG-/SEC-/DOC-）。
 */

"use strict";

const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

// ───────────────────────── 路径常量 ─────────────────────────

const ROOT = path.resolve(__dirname, "..");
const APP = path.join(ROOT, "app");
const API_SRC = path.join(APP, "apps", "api", "src");
const API_TEST = path.join(APP, "apps", "api", "test");
const WEB = path.join(APP, "apps", "web");
const WORKER_SRC = path.join(APP, "apps", "worker", "src");
const PKG_DB = path.join(APP, "packages", "db", "src");
const PKG_SHARED = path.join(APP, "packages", "shared", "src");
const DEPLOY = path.join(APP, "deploy");
const DOCS = path.join(ROOT, "docs");
const COMPLIANCE_DOCS = path.join(DOCS, "06-security-compliance");
const OPS_DOCS = path.join(DOCS, "05-ops");

const QUIET = process.argv.includes("--quiet");

// ───────────────────────── 断言与证据工具 ─────────────────────────

/** 当前检查收到的一条证据/状态 */
const results = [];

class CheckFailure extends Error {}

function fail(message) {
  throw new CheckFailure(message);
}

function escapeRe(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * 把检查里的 pattern 统一成"无状态正则"：
 * - RegExp 直接克隆并去掉 g/y 标志（避免 test() 的 lastIndex 副作用）；
 * - 字符串按**正则源码**处理（含中文与转义），写错语法时回退为字面量匹配，保证不会因笔误崩掉检查。
 */
function toRe(pattern) {
  if (pattern instanceof RegExp) return new RegExp(pattern.source, pattern.flags.replace(/[gy]/g, ""));
  try {
    return new RegExp(pattern);
  } catch {
    return new RegExp(escapeRe(pattern));
  }
}

/** 展示用相对路径（统一正斜杠，便于人读与 grep） */
function rel(absPath) {
  return path.relative(ROOT, absPath).split(path.sep).join("/");
}

function readText(absPath, label) {
  if (!fs.existsSync(absPath)) fail(`${label ?? "文件"}不存在：${rel(absPath)}`);
  const stat = fs.statSync(absPath);
  if (!stat.isFile()) fail(`不是文件：${rel(absPath)}`);
  return fs.readFileSync(absPath, "utf8");
}

/** 返回首个命中行的证据串 `file:line`；未命中即判定失败 */
function hit(absPath, pattern, label) {
  const content = readText(absPath, label);
  const re = toRe(pattern);
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    if (re.test(lines[i])) return `${rel(absPath)}:${i + 1}`;
  }
  fail(`${rel(absPath)} 未包含 ${String(pattern)}${label ? `（${label}）` : ""}`);
}

/** 同一文件多处命中，返回 `file:l1 + file:l2` */
function hits(absPath, patterns, label) {
  return patterns.map((pattern) => hit(absPath, pattern, label)).join(" + ");
}

/** 断言文件不存在该模式（用于"禁止事项"，如日志不得记录手机号字段） */
function absent(absPath, pattern, why) {
  const content = readText(absPath);
  if (toRe(pattern).test(content)) fail(why ?? `${rel(absPath)} 不应包含 ${String(pattern)}`);
  return rel(absPath);
}

/** 断言文件存在，返回相对路径作为证据 */
function existsFile(absPath, label) {
  if (!fs.existsSync(absPath)) fail(`${label ?? "文件"}不存在：${rel(absPath)}`);
  return rel(absPath);
}

/** 断言某个目录下存在满足模式的文件，返回**绝对路径**（供后续 hit() 读取内容） */
function matchingPath(dir, pattern, label) {
  if (!fs.existsSync(dir)) fail(`目录不存在：${rel(dir)}`);
  const re = toRe(pattern);
  const found = fs.readdirSync(dir).filter((name) => re.test(name)).sort();
  if (found.length === 0) fail(`${rel(dir)} 下未找到 ${String(pattern)}${label ? `（${label}）` : ""}`);
  return path.join(dir, found[0]);
}

/** 断言某个目录下存在满足模式的文件，返回相对路径作为证据 */
function existsMatching(dir, pattern, label) {
  return rel(matchingPath(dir, pattern, label));
}

/** 执行一条同步检查；fn 返回证据字符串 */
function check(group, id, title, fn) {
  try {
    const evidence = fn();
    results.push({ group, id, title, status: "PASS", evidence });
  } catch (err) {
    if (err instanceof CheckFailure) {
      results.push({ group, id, title, status: "FAIL", evidence: err.message });
      return;
    }
    results.push({ group, id, title, status: "FAIL", evidence: `检查脚本异常：${err && err.message}` });
  }
}

function skipResult(group, id, title, reason) {
  results.push({ group, id, title, status: "SKIP", evidence: reason });
}

// ───────────────────────── 文件别名 ─────────────────────────

const F = {
  // 前端（法务页面 / 披露 / 门禁）
  termsPage: path.join(WEB, "pages", "terms.vue"),
  privacyPage: path.join(WEB, "pages", "privacy.vue"),
  reportPage: path.join(WEB, "pages", "report.vue"),
  sharePage: path.join(WEB, "pages", "share", "[token].vue"),
  loginPage: path.join(WEB, "pages", "login.vue"),
  landingPage: path.join(WEB, "pages", "index.vue"),
  layoutDefault: path.join(WEB, "layouts", "default.vue"),
  layoutApp: path.join(WEB, "layouts", "app.vue"),
  settingsPage: path.join(WEB, "pages", "settings.vue"),

  // 后端
  appModule: path.join(API_SRC, "app.module.ts"),
  authController: path.join(API_SRC, "modules", "auth", "auth.controller.ts"),
  authService: path.join(API_SRC, "modules", "auth", "auth.service.ts"),
  authCrypto: path.join(API_SRC, "modules", "auth", "crypto.ts"),
  adminController: path.join(API_SRC, "modules", "admin", "admin.controller.ts"),
  adminService: path.join(API_SRC, "modules", "admin", "admin.service.ts"),
  adminAuthService: path.join(API_SRC, "modules", "admin", "admin-auth.service.ts"),
  reportsController: path.join(API_SRC, "modules", "reports", "reports.controller.ts"),
  moderationService: path.join(API_SRC, "modules", "moderation", "moderation.service.ts"),
  generationsService: path.join(API_SRC, "modules", "generations", "generations.service.ts"),
  llmService: path.join(API_SRC, "modules", "script", "llm.service.ts"),
  tasksService: path.join(API_SRC, "modules", "tasks", "tasks.service.ts"),
  healthController: path.join(API_SRC, "health", "health.controller.ts"),
  metricsController: path.join(API_SRC, "health", "metrics.controller.ts"),
  billingController: path.join(API_SRC, "modules", "billing", "billing.controller.ts"),
  billingService: path.join(API_SRC, "modules", "billing", "billing.service.ts"),
  channelService: path.join(API_SRC, "modules", "billing", "channels", "channel.service.ts"),
  paymentSignature: path.join(API_SRC, "modules", "billing", "payment-signature.ts"),
  apiEnv: path.join(API_SRC, "config", "env.ts"),
  ledger: path.join(PKG_DB, "ledger.ts"),
  drizzleDir: path.join(APP, "apps", "api", "drizzle"),
  requestLog: path.join(API_SRC, "common", "logging", "request-log.ts"),
  requestLogMw: path.join(API_SRC, "common", "logging", "request-logging.middleware.ts"),
  observabilitySpec: path.join(API_TEST, "observability.spec.ts"),
  paymentSpec: path.join(API_TEST, "payment-signature.spec.ts"),
  refundsSpec: path.join(API_TEST, "refunds.spec.ts"),
  refundsWechatSpec: path.join(API_TEST, "refunds-wechat.spec.ts"),
  certRotationSpec: path.join(API_TEST, "billing-notify-cert-rotation.spec.ts"),
  envGuardSpec: path.join(API_TEST, "env-production-guard.spec.ts"),
  flowSpec: path.join(API_TEST, "flow.spec.ts"),

  // worker / packages
  workerLabel: path.join(WORKER_SRC, "label.ts"),
  workerMain: path.join(WORKER_SRC, "main.ts"),
  workerMaintenance: path.join(WORKER_SRC, "maintenance.ts"),
  workerEnvGuard: path.join(WORKER_SRC, "env-guard.ts"),
  workerEnvGuardSpec: path.join(WORKER_SRC, "env-guard.spec.ts"),
  executor: path.join(WORKER_SRC, "executor.ts"),
  dbSchema: path.join(PKG_DB, "schema.ts"),
  sharedErrors: path.join(PKG_SHARED, "errors.ts"),

  // 验收脚本（全量验收入口，见 launch-checklist §6）
  acceptanceScript: path.join(ROOT, "_acceptance", "b-type-acceptance.ps1"),

  // 部署与配置
  backupSh: path.join(DEPLOY, "backup-db.sh"),
  restoreSh: path.join(DEPLOY, "restore-db.sh"),
  rollbackSh: path.join(DEPLOY, "rollback.sh"),
  verifyBackupPs1: path.join(DEPLOY, "verify-backup.ps1"),
  envProd: path.join(APP, ".env.production.example"),

  // 文档
  launchChecklist: path.join(COMPLIANCE_DOCS, "launch-checklist.md"),
  complianceDoc: path.join(COMPLIANCE_DOCS, "compliance.md"),
  observabilityDoc: path.join(OPS_DOCS, "observability.md"),
  deploymentDoc: path.join(OPS_DOCS, "deployment.md"),
};

// ───────────────────────── A. 法务页面与入口 ─────────────────────────

check("A 法务页面与入口", "PAGE-01", "用户协议页 /terms 存在且含服务条款", () =>
  hits(F.termsPage, ["用户协议", "知识产权|生成成果|归属"], "协议要素"),
);

check("A 法务页面与入口", "PAGE-02", "隐私政策页 /privacy 存在且含收集清单", () =>
  hits(F.privacyPage, ["隐私政策", "收集|信息类型"], "PIPL 要素"),
);

check("A 法务页面与入口", "PAGE-03", "举报投诉页 /report 存在", () =>
  hits(F.reportPage, ["举报"], "举报入口页"),
);

check("A 法务页面与入口", "PAGE-04", "公开分享页 /share/:token 含 AI 声明与举报入口", () =>
  `${hits(F.sharePage, ["内容由 AI 生成"], "AI 声明")} + ${hits(
    F.sharePage,
    ["/share/\\$\\{[^}]+\\}/report|submitReport|举报"],
    "页内举报入口",
  )}`,
);

check("A 法务页面与入口", "PAGE-05", "三类页面均有页脚入口（用户协议/隐私政策/举报）", () => {
  const layouts = [F.layoutDefault, F.layoutApp, F.landingPage];
  const terms = layouts.map((file) => hit(file, "/terms"));
  const privacy = layouts.map((file) => hit(file, "/privacy"));
  const report = layouts.map((file) => hit(file, "/report"));
  return [terms[0], privacy[0], report[0]].join(" · ") + `（共 ${layouts.length} 个布局/落地页均含三链路）`;
});

check("A 法务页面与入口", "PAGE-06", "ICP 备案号位置已预留（上线前须替换真实号）", () => {
  const evidence = hits(F.landingPage, ["ICP"], "备案号占位");
  return `${evidence}（占位符，真实备案号属外部待办 EXT-03）`;
});

// ───────────────────────── B. 未成年人 / 年龄门禁 ─────────────────────────

check("B 未成年人", "AGE-01", "注册页要求勾选「已满 18 周岁」且未勾选即阻断提交", () => {
  const checkbox = hit(F.loginPage, "type=\"checkbox\"", "年龄勾选框");
  const gate = hit(F.loginPage, "ageConfirmed", "提交前门禁");
  return `${checkbox} + ${gate}`;
});

check("B 未成年人", "AGE-02", "后端强制校验：未确认年龄拒绝建号", () =>
  hits(F.authService, ["ageConfirmed !== true", "age_confirmed"], "后端门禁"),
);

check("B 未成年人", "AGE-03", "年龄声明留痕：字段 + 建号事务写入 + 回归断言（GAP-01 已关闭）", () => {
  const column = hit(F.dbSchema, "age_declared_at", "users.age_declared_at");
  const write = hit(F.authService, "ageDeclaredAt: new Date\\(\\)", "建号事务写入");
  const spec = hit(F.flowSpec, "ageDeclaredAt\\)\\.toBeInstanceOf\\(Date\\)", "回归断言");
  return `${column} + ${write} + ${spec}`;
});

// ───────────────────────── C. 内容审核 ─────────────────────────

check("C 内容审核", "MOD-01", "输入审核：敏感词命中返回 745801", () => {
  const code = hits(F.sharedErrors, ["INPUT_REJECTED: 745801"]);
  const impl = hits(F.moderationService, ["INPUT_REJECTED", "MODERATION_WORDS"], "词表可扩展");
  return `${code} + ${impl}`;
});

check("C 内容审核", "MOD-02", "输出审核：结果违规映射 745802 且任务置 review_rejected", () => {
  const code = hits(F.sharedErrors, ["OUTPUT_REJECTED: 745802"]);
  const llm = hits(F.llmService, ["OUTPUT_REJECTED"], "LLM 结构化输出审核");
  const exec = hits(F.executor, ["REVIEW_REJECTED"], "任务状态 7");
  return `${code} + ${llm} + ${exec}`;
});

check("C 内容审核", "MOD-03", "生成入口调用审核（先审后发）", () =>
  hits(F.generationsService, ["assertPrompt|assertText"], "生成前审核"),
);

check("C 内容审核", "MOD-04", "审核/举报记录留存 ≥6 个月（清理任务不删审核痕迹）", () => {
  // 数据保留任务只清理 结果/回收站/注销账号；不得清理 task_events / content_reports
  absent(
    F.workerMaintenance,
    /content_reports|contentReports|task_events|taskEvents/,
    "maintenance.ts 不得清理审核/举报记录（合规要求留存 ≥6 个月）",
  );
  const retention = hits(F.workerMaintenance, ["90 \\* 86_400_000|purgeOldData"], "保留策略");
  const reports = hits(F.dbSchema, ["contentReports"], "举报/处置留痕表");
  return `${retention} + ${reports}（审核事件表不受 retention 清理，实证无删除逻辑）`;
});

check("C 内容审核", "MOD-05", "审核开关与词表可运维（env 扩展，无需改代码）", () =>
  hits(F.moderationService, ["env\\.MODERATION_ENABLED", "env\\.MODERATION_WORDS"], "热配置"),
);

// ───────────────────────── D. 举报与处置 ─────────────────────────

check("D 举报处置", "REP-01", "公开举报端点 POST /v1/share/:token/report", () =>
  hits(F.reportsController, ["@Post\\(':token/report'\\)|:token/report|@Controller\\('share'\\)"], "举报 API"),
);

check("D 举报处置", "REP-02", "运营处置端点 POST /v1/ops/admin/reports/:id/resolve", () =>
  hits(F.adminController, ["reports/:id/resolve"], "处置 API"),
);

check("D 举报处置", "REP-03", "处置留痕：处理人/时间/结论落库", () =>
  hits(F.adminService, ["handledBy", "handledAt", "resolution"], "留痕字段"),
);

check("D 举报处置", "REP-04", "下线动作即时撤销分享 token（违规内容立即不可访问）", () =>
  hits(F.adminService, ["revokedAt"], "撤销分享"),
);

// ───────────────────────── E. 账号注销与 PIPL ─────────────────────────

check("E 账号注销/PIPL", "DEL-01", "账号注销端点 POST /v1/me/delete", () =>
  hits(F.authController, ["me/delete"], "注销 API"),
);

check("E 账号注销/PIPL", "DEL-02", "注销后 token 即时失效 + 30 天物理清理", () => {
  const svc = hits(F.authService, ["purge_after|purgeAfter|deleteAccount"], "注销服务");
  const purge = hits(F.workerMaintenance, ["30 \\* 86_400_000|purgedUsers"], "30 天清理任务");
  return `${svc} + ${purge}`;
});

check("E 账号注销/PIPL", "PIPL-01", "隐私政策覆盖收集/保留期/共享/用户权利", () =>
  hits(F.privacyPage, ["保留|留存", "共享|第三方", "注销|删除"], "PIPL 三要素"),
);

check("E 账号注销/PIPL", "PIPL-02", "手机号加密存储（HMAC 等值查询 + AES-256-GCM 密文）", () =>
  hits(F.authCrypto, ["createHmac", "aes-256-gcm"], "ADR-007"),
);

check("E 账号注销/PIPL", "PIPL-03", "refresh_token 仅 HttpOnly + SameSite=Strict Cookie", () =>
  hits(F.authController, ["httpOnly: true", "sameSite: \"strict\""], "Cookie 安全属性"),
);

// ───────────────────────── F. AI 生成内容标识 ─────────────────────────

check("F AI 标识", "AI-01", "显式标识：成片水印（ffmpeg drawtext）", () =>
  hits(F.workerLabel, ["drawtext", "AI生成|config\\.text"], "显式水印"),
);

check("F AI 标识", "AI-02", "隐式标识：旁车元数据 <key>.ai.json + 容器 metadata", () =>
  hits(F.workerLabel, ["\\.ai\\.json", "metadata|implicit"], "隐式标识"),
);

check("F AI 标识", "AI-03", "生产环境默认开启标识（AI_LABEL_ENABLED=true）", () => {
  const worker = hits(F.workerMain, ["AI_LABEL_ENABLED !== \"false\""], "默认开启");
  const envProd = hits(F.envProd, ["AI_LABEL_ENABLED=true"], "生产模板");
  return `${worker} + ${envProd}`;
});

check("F AI 标识", "AI-04", "页面披露：协议声明双重标识 + 分享页/工具页 AI 提示", () => {
  const terms = hits(F.termsPage, ["显式水印|隐式元数据"], "协议声明");
  const share = hit(F.sharePage, "内容由 AI 生成", "分享页提示");
  return `${terms} + ${share}`;
});

// ───────────────────────── G. 支付合规 ─────────────────────────

check("G 支付合规", "PAY-01", "微信支付回调：未配置平台公钥一律拒绝（默认拒绝）", () => {
  const guard = hits(
    F.billingController,
    ["hasWechatPlatformKeys", "wechat platform public key not configured", "fail\\(401"],
    "未配密钥即 401",
  );
  const verifier = hits(F.paymentSignature, ["if \\(!platformPublicKeyPem \\|\\| !signature\\) return false"], "验签缺省失败");
  const resolve = hits(F.channelService, ["WECHAT_PLATFORM_PUBLIC_KEY or WECHAT_PLATFORM_PUBLIC_KEYS"], "凭据缺失计入 missing");
  return `${guard} + ${verifier} + ${resolve}`;
});

check("G 支付合规", "PAY-02", "支付宝回调：未配置公钥一律拒绝", () =>
  hits(F.billingController, ["ALIPAY_PUBLIC_KEY"], "未配密钥即拒绝"),
);

check("G 支付合规", "PAY-03", "生产禁 mock 渠道（PAYMENT_LIVE 时下单/回调/代付全部拒绝）", () =>
  hits(F.billingController, ["PAYMENT_LIVE"], "防假支付绕过"),
);

check("G 支付合规", "PAY-04", "回调防重放（时间戳容差）+ 验签回归测试", () => {
  const replay = hits(F.paymentSignature, ["> 300"], "5 分钟容差");
  const spec = existsFile(F.paymentSpec, "支付验签单测");
  return `${replay} + ${spec}`;
});

check("G 支付合规", "PAY-05", "退款端点仅管理端可用（AdminGuard 保护）", () => {
  const endpoint = hit(F.adminController, '@Post\\("orders/:id/refund"\\)', "退款 API");
  const guard = hit(F.adminController, "UseGuards\\(AdminGuard\\)", "后台鉴权");
  return `${endpoint} + ${guard}`;
});

check("G 支付合规", "PAY-06", "退款仅支持全额（部分退款显式拒绝）", () =>
  hit(F.billingService, "partial refund is not supported", "拒绝部分退款"),
);

check("G 支付合规", "PAY-07", "已退款幂等：不重复扣积分、不重复调渠道", () =>
  hits(F.billingService, ["row.status === OrderStatus.REFUNDED", "idempotent: true"], "幂等返回"),
);

check("G 支付合规", "PAY-08", "余额不足在调渠道前拒绝（保护 balance == Σdelta）", () =>
  hits(F.billingService, ["lockCreditAccount", "insufficient credits to roll back"], "前置余额校验"),
);

check("G 支付合规", "PAY-09", "渠道退款失败即回滚事务（订单仍已支付、积分不冲正）", () => {
  const tx = hit(F.billingService, "db.transaction\\(async \\(tx\\)", "单事务包裹");
  const mapping = hit(F.billingService, "toChannelAppError", "渠道错误映射");
  const rollback = hit(F.billingService, "事务回滚", "回滚语义");
  return `${tx} + ${mapping} + ${rollback}`;
});

check("G 支付合规", "PAY-10", "退款写负向流水 kind=refund（creditOut，可审计）", () => {
  const ledgerFn = hits(F.ledger, ["export async function creditOut", 'kind: "refund"'], "负向流水实现");
  const called = hit(F.billingService, "await creditOut\\(", "退款调用点");
  return `${ledgerFn} + ${called}`;
});

check("G 支付合规", "PAY-11", "退款字段迁移 0009（refund_no/status/amount/reason/operator）", () => {
  const migration = matchingPath(F.drizzleDir, /^0009.*\.sql$/, "迁移 0009");
  return hits(
    migration,
    ["refund_no", "refund_status", "refund_amount_cents", "refund_reason", "refund_operator"],
    "退款字段",
  );
});

check("G 支付合规", "PAY-12", "退款回归测试（全额/幂等/余额不足/渠道失败回滚）", () => {
  const core = existsFile(F.refundsSpec, "退款单测");
  const wechat = existsFile(F.refundsWechatSpec, "微信渠道退款失败测试");
  const assertInsufficient = hit(F.refundsSpec, "insufficient credits to roll back", "余额不足断言");
  return `${core} · ${wechat} + ${assertInsufficient}`;
});

check("G 支付合规", "PAY-13", "微信平台证书轮换：多证书映射 + 按 Wechatpay-Serial 选公钥", () => {
  const env = hit(F.apiEnv, "WECHAT_PLATFORM_PUBLIC_KEYS", "多证书配置项");
  const select = hits(F.channelService, ["selectWechatPlatformPublicKey", "bySerial"], "按 serial 选择");
  const header = hits(F.billingController, ["wechatpay-serial", "wechatPlatformPublicKey"], "回调读取 serial");
  return `${env} + ${select} + ${header}`;
});

check("G 支付合规", "PAY-14", "未知 serial 一律 401 拒绝（轮换期不误放行）", () => {
  const reject = hit(F.billingController, "unknown wechat platform certificate serial", "未知 serial 拒绝");
  const deny = hit(F.billingController, "默认拒绝", "策略注释");
  return `${reject} + ${deny}`;
});

check("G 支付合规", "PAY-15", "无 serial 兼容回退（单证书老部署不受影响）", () =>
  hits(F.channelService, ["无 serial：仅一张平台证书时可直接用", "return keyring.fallback"], "兼容回退"),
);

check("G 支付合规", "PAY-16", "证书轮换回归测试（双证书/未知 serial/回退全场景）", () =>
  hits(F.certRotationSpec, ["WECHAT_PLATFORM_PUBLIC_KEYS", "Wechatpay-Serial", "未知 serial"], "轮换测试"),
);

// ───────────────────────── H. 运维可观测 ─────────────────────────

check("H 运维可观测", "OPS-01", "健康检查 live/ready 语义分离（ready 依赖不可用即 503）", () =>
  hits(F.healthController, ["healthz/live|@Get\\(\"live\"\\)", "@Get\\(\"ready\"\\)", "503"], "探针端点"),
);

check("H 运维可观测", "OPS-02", "Prometheus 指标端点 /v1/metrics（含已支付未入账）", () =>
  hits(F.metricsController, ["@Controller\\(\"metrics\"\\)", "oneframe_orders_paid_without_credit"], "资金链路指标"),
);

check("H 运维可观测", "OPS-03", "备份/恢复/校验/回滚脚本齐备", () => {
  const files = [F.backupSh, F.restoreSh, F.verifyBackupPs1, F.rollbackSh].map((file) =>
    existsFile(file, "运维脚本"),
  );
  return files.join(" · ");
});

check("H 运维可观测", "OPS-04", "回滚脚本含 readiness 校验与不可逆迁移提示", () => {
  const health = hits(F.rollbackSh, ["healthz/ready"], "回滚后健康校验");
  const note = hits(F.rollbackSh, ["不可逆|备份恢复"], "迁移不可逆提示");
  return `${health} + ${note}`;
});

check("H 运维可观测", "OPS-05", "优雅停机：先摘流再等在途请求，超时强制退出", () => {
  const controller = hits(F.healthController, ["__of_shutting_down"], "停机即 503");
  const doc = hits(F.deploymentDoc, ["优雅停机|SIGTERM"], "运维口径");
  return `${controller} + ${doc}`;
});

check("H 运维可观测", "OPS-06", "生产启动守卫（api）：弱默认密钥/缺 COOKIE_SECURE/支付凭据半配 → 拒绝启动且聚合报错", () => {
  const entry = hits(F.apiEnv, ["export function collectProductionProblems", "export function buildEnv"], "守卫入口");
  const aggregate = hits(F.apiEnv, ["生产环境配置校验失败", "不含任何密钥值|problems.join"], "聚合报错（不打印值）");
  return `${entry} + ${aggregate}`;
});

check("H 运维可观测", "OPS-07", "api 生产守卫回归测试（正反例 + 不泄漏密钥值）", () =>
  hits(F.envGuardSpec, ["rejects repository default secrets", "never prints secret values"], "守卫测试"),
);

check("H 运维可观测", "OPS-08", "生产启动守卫（worker）：禁 ADAPTER_MODE=mock 且需至少一种真实供应商", () => {
  const entry = hits(F.workerEnvGuard, ["collectWorkerProductionProblems", "assertWorkerEnv"], "守卫入口");
  const rule = hits(F.workerEnvGuard, ["ADAPTER_MODE"], "假生成拦截");
  return `${entry} + ${rule}`;
});

check("H 运维可观测", "OPS-09", "worker 生产守卫回归测试（mock 拒绝 / 无真实供应商拒绝）", () =>
  hits(F.workerEnvGuardSpec, ["ADAPTER_MODE 必须为 real", "rejects production without any real vendor"], "守卫测试"),
);

check("H 运维可观测", "LOG-01", "worker 日志脱敏：token 字段 redact", () =>
  hits(F.workerMain, ["redact:", "access_token"], "pino redact"),
);

check("H 运维可观测", "LOG-02", "api 请求日志脱敏：不落请求体/查询串/Authorization，手机号掩码", () => {
  const white = hits(F.requestLog, ["interface RequestLogRecord", "sanitizePath", "maskPhoneLike"], "字段白名单");
  // 记录结构里不得出现请求体/授权头字段
  absent(F.requestLog, /\bbody\??:/, "请求日志记录结构不得含 body 字段");
  absent(F.requestLog, /\bauthorization\??:/i, "请求日志记录结构不得含 authorization 字段");
  return white;
});

check("H 运维可观测", "LOG-03", "request_id 中间件已接入 AppModule 并回写响应头", () => {
  const wiring = hits(F.appModule, ["RequestLoggingMiddleware", "configure\\(", "forRoutes"], "全路由注册");
  const header = hits(F.requestLogMw, ["REQUEST_ID_HEADER"], "响应头回写");
  return `${wiring} + ${header}`;
});

check("H 运维可观测", "LOG-05", "观测契约有测试守护（响应头=日志字段、脱敏、慢请求告警）", () => {
  const spec = existsFile(F.observabilitySpec, "observability 测试");
  const asserts = hits(F.observabilitySpec, ["REQUEST_ID_HEADER", "level: \"warn\"|level\\).toBe\\(\"warn\"\\)"], "关键断言");
  return `${spec} + ${asserts}`;
});

// ───────────────────────── I. 安全 ─────────────────────────

check("I 安全", "SEC-01", "运营后台口令以 scrypt 加盐哈希存储（非明文）", () =>
  hits(F.adminAuthService, ["scryptSync", "timingSafeEqual"], "口令哈希"),
);

check("I 安全", "SEC-02", "分享 token 高熵随机 + 有过期时间", () =>
  hits(F.tasksService, ["randomBytes\\(", "expiresAt"], "token 生成"),
);

// ───────────────────────── J. 文档一致性（防漂移） ─────────────────────────

check("J 文档一致性", "DOC-01", "上线清单存在且区分外部/代码两大区、含阻塞级别", () => {
  const external = hits(F.launchChecklist, ["外部资质|外部资质与密钥"], "外部区");
  const code = hits(F.launchChecklist, ["代码侧"], "代码区");
  const level = hits(F.launchChecklist, ["P0"], "阻塞级别");
  return `${external} + ${code} + ${level}`;
});

check("J 文档一致性", "DOC-02", "compliance.md G 节引用上线清单（单一事实来源，避免两份漂移）", () =>
  hits(F.complianceDoc, ["launch-checklist\\.md"], "G 节引用"),
);

check("J 文档一致性", "DOC-03", "observability.md 含 request_id 字段表与告警口径", () =>
  hits(F.observabilityDoc, ["request_id", "duration_ms"], "字段表"),
);

check("J 文档一致性", "DOC-04", "上线清单外部项不得纸面标记完成（✅ 必须附回执/归档证据）", () => {
  const content = readText(F.launchChecklist, "上线清单");
  const rows = content.split(/\r?\n/).filter((line) => /^\|\s*EXT-\d+/.test(line));
  if (rows.length === 0) fail("未在 launch-checklist.md 找到 EXT- 外部资质条目");
  const bad = rows.filter((row) => row.includes("✅") && !/(回执|已归档)/.test(row));
  if (bad.length > 0) fail(`外部项被标记 ✅ 但无回执/归档证据：${bad[0].slice(0, 90)}`);
  return `${rel(F.launchChecklist)}（EXT- 条目 ${rows.length} 条，全部为 ⏳/❌ 或带归档证据）`;
});

// ───────────────────────── L. 全量验收闭环 ─────────────────────────

check("L 验收闭环", "ACC-01", "全量验收脚本存在且含阶段：前置检查→迁移→质量门禁→运行态→汇总", () =>
  hits(F.acceptanceScript, ["前置检查", "数据库迁移", "质量门禁", "运行态冒烟", "验收汇总"], "五阶段齐备"),
);

check("L 验收闭环", "ACC-02", "全量验收脚本串接本合规检查（单一口径，不维护两套）", () =>
  hits(F.acceptanceScript, ["compliance-check\\.cjs"], "调用合规检查"),
);

check("L 验收闭环", "ACC-03", "全量验收覆盖退款闭环与生产守卫正反例（运行态 HTTP，不是纯静态）", () => {
  const refund = hit(F.acceptanceScript, "退款闭环（HTTP）", "退款运行态");
  const guard = hit(F.acceptanceScript, "生产守卫：api 完整安全配置 → 通过|生产守卫", "生产守卫正反例");
  return `${refund} + ${guard}`;
});

// ───────────────────────── K. 运行态探测（本地，服务未启动则 SKIP） ─────────────────────────

function probeRequestIdHeader() {
  const base = process.env.API_URL ?? "http://127.0.0.1:3000";
  let target;
  try {
    target = new URL("/v1/ping", base);
  } catch {
    skipResult(
      "K 运行态",
      "LOG-04",
      "运行态：响应头 x-request-id 存在且可用于排障串联",
      `API_URL 非法：${base}`,
    );
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const req = http.get(target, { timeout: 1500 }, (res) => {
      const id = res.headers["x-request-id"];
      res.resume();
      if (!id) {
        results.push({
          group: "K 运行态",
          id: "LOG-04",
          title: "运行态：响应头 x-request-id 存在",
          status: "FAIL",
          evidence: `${target.href} 返回 ${res.statusCode} 但没有 x-request-id 响应头`,
        });
      } else {
        results.push({
          group: "K 运行态",
          id: "LOG-04",
          title: "运行态：响应头 x-request-id 存在",
          status: "PASS",
          evidence: `GET ${target.pathname} → ${res.statusCode}, x-request-id=${id}`,
        });
      }
      resolve();
    });
    req.on("timeout", () => {
      req.destroy();
      skipResult(
        "K 运行态",
        "LOG-04",
        "运行态：响应头 x-request-id 存在",
        `${target.origin} 探测超时 —— 服务未就绪，跳过运行态校验（静态接线见 LOG-03）`,
      );
      resolve();
    });
    req.on("error", (err) => {
      skipResult(
        "K 运行态",
        "LOG-04",
        "运行态：响应头 x-request-id 存在",
        `${target.origin} 不可达（${err.code ?? err.message}）—— api 未启动，跳过运行态校验；` +
          `启动后执行：node _acceptance/compliance-check.cjs`,
      );
      resolve();
    });
  });
}

// ───────────────────────── 输出 ─────────────────────────

const STATUS_ICON = { PASS: "✅", FAIL: "❌", SKIP: "⏭️ " };

function externalPendingCount() {
  if (!fs.existsSync(F.launchChecklist)) return null;
  const content = fs.readFileSync(F.launchChecklist, "utf8");
  // 待办 = 外部条目中未标 ✅ 的（✅ 且带归档证据视为已就绪，由 DOC-04 把关）
  return content
    .split(/\r?\n/)
    .filter((line) => /^\|\s*EXT-\d+/.test(line) && !line.includes("✅")).length;
}

async function main() {
  await probeRequestIdHeader();

  const groups = [];
  for (const item of results) {
    let group = groups.find((g) => g.name === item.group);
    if (!group) {
      group = { name: item.group, items: [] };
      groups.push(group);
    }
    group.items.push(item);
  }

  const passed = results.filter((item) => item.status === "PASS").length;
  const failed = results.filter((item) => item.status === "FAIL").length;
  const skipped = results.filter((item) => item.status === "SKIP").length;

  if (!QUIET) {
    console.log("=".repeat(78));
    console.log("一帧 OneFrame · 上线合规可执行检查（代码侧）");
    console.log(`仓库：${ROOT}`);
    console.log(`清单：${rel(F.launchChecklist)}（外部资质项由法务/财务人工办理）`);
    console.log("=".repeat(78));
    for (const group of groups) {
      console.log(`\n── ${group.name} ──`);
      for (const item of group.items) {
        console.log(`[${item.status}] ${item.id} ${item.title}`);
        console.log(`        证据: ${item.evidence}`);
      }
    }
  } else {
    for (const item of results.filter((entry) => entry.status !== "PASS")) {
      console.log(`[${item.status}] ${item.id} ${item.title}\n        证据: ${item.evidence}`);
    }
  }

  const externals = externalPendingCount();
  console.log(`\n${"=".repeat(78)}`);
  console.log(`汇总：PASS ${passed} / FAIL ${failed} / SKIP ${skipped}（共 ${results.length} 项代码侧检查）`);
  if (externals !== null) {
    console.log(`外部资质/密钥待办：${externals} 条（脚本无法验证，见清单「外部资质与密钥」区）`);
  }
  console.log(`状态图例：${STATUS_ICON.PASS} PASS  ${STATUS_ICON.FAIL} FAIL  ${STATUS_ICON.SKIP}SKIP`);
  if (skipped > 0) {
    console.log("SKIP 说明：本地运行态探测在服务未启动时不具备条件，属预期跳过，不计为失败。");
  }
  console.log("=".repeat(78));

  if (failed > 0) {
    console.log(`\n结论：有 ${failed} 项代码侧合规检查未通过，禁止上线（详见上方 [FAIL]）。`);
    process.exitCode = 1;
  } else {
    console.log("\n结论：代码侧检查全部通过；外部资质/密钥项仍需人工办理后方可对外商用。");
    process.exitCode = 0;
  }
}

main().catch((err) => {
  console.error("[compliance-check] 脚本异常：", err);
  process.exitCode = 2;
});
