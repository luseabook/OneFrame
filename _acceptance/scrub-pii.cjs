/**
 * 证据脱敏：把采集到的 HTML/JSON 里的个人信息替换掉，再入库。
 * 只处理 _acceptance/ref-authed 与 ref2 目录下的文本文件（.html/.json/.txt）。
 * 幂等：重复运行不会破坏已脱敏内容。
 */
const fs = require("node:fs");
const path = require("node:path");

const DIRS = [
  path.join(__dirname, "ref-authed"),
  path.join(__dirname, "ref2"),
];

const RULES = [
  // 11 位手机号：要求前后是明确的分隔符（引号/冒号/逗号/空白/中文），
  // 避免误伤时间戳、SVG 坐标、OSS object_key 里的长数字串。
  [/(["':,\s=（])(1[3-9]\d{9})(?=["',\s）;])/g, "$1[REDACTED_PHONE]"],
  // 已知 uid / space_id（本次采集账号）
  [/\b267379182\b/g, "[REDACTED_UID]"],
  [/\b1960443501771751438\b/g, "[REDACTED_SPACE]"],
  // token 形态（20~200 位字母数字，紧跟 access_token 字段）
  [/("access_token"\s*:\s*")[A-Za-z0-9._\-]{16,}(")/g, "$1[REDACTED_TOKEN]$2"],
  [/("master_access_token"\s*:\s*")[A-Za-z0-9._\-]{16,}(")/g, "$1[REDACTED_TOKEN]$2"],
  // Authorization 头
  [/(Authorization["':\s]+)[A-Za-z0-9._\-]{16,}/gi, "$1[REDACTED]"],
  // 预签名 URL 的签名参数（保留 URL 结构，抹掉签名值）
  // 注意 HTML 里是转义形态 &amp;Signature=...，两种都要覆盖
  [/((?:[?&]|&amp;)(?:Signature|OSSAccessKeyId|security-token|Expires)=)[^&"'\s<>]+/g, "$1[REDACTED_SIG]"],
  // OSS AccessKeyId（LTAI 开头，独立出现时也抹）
  [/\bLTAI[A-Za-z0-9]{8,}\b/g, "[REDACTED_AK]"],
];

let changed = 0;
let scanned = 0;
for (const dir of DIRS) {
  if (!fs.existsSync(dir)) continue;
  for (const name of fs.readdirSync(dir)) {
    if (!/\.(html|json|txt)$/i.test(name)) continue;
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (!st.isFile() || st.size > 20 * 1024 * 1024) continue;
    scanned += 1;
    const before = fs.readFileSync(p, "utf8");
    let after = before;
    for (const [re, rep] of RULES) after = after.replace(re, rep);
    if (after !== before) {
      fs.writeFileSync(p, after, "utf8");
      changed += 1;
      console.log(`scrubbed: ${name}`);
    }
  }
}
console.log(`\nscanned=${scanned} changed=${changed}`);

