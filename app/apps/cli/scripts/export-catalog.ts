import fs from "node:fs";
import path from "node:path";
import { COMMANDS, GROUP_ORDER } from "../src/registry";

/**
 * 导出 CLI 命令目录到 Web 页面（`/cli`）用的静态快照。
 *
 * 为什么不让 Web 直接 import `@app/cli`：CLI 是 Node 侧包（依赖 fs/网络），
 * 而页面只需要"组 / 子命令 / 是否已落地"这三列展示数据；把整包带进浏览器
 * 会把 Node 依赖也拖进 bundle。快照是**生成物**，改了 registry 重跑本脚本即可：
 *
 * ```bash
 * cd app/apps/cli && npx tsx scripts/export-catalog.ts
 * ```
 *
 * 只导出展示字段，不导出 `method`/`path`（避免把接口形状当公开文档，且页面不需要）。
 */
const groups = GROUP_ORDER.map((group) => {
  const cmds = COMMANDS.filter((c) => c.group === group);
  return {
    group,
    total: cmds.length,
    ready: cmds.filter((c) => c.ready).length,
    commands: cmds.map((c) => ({
      cmd: c.cmd,
      summary: c.summary,
      ready: c.ready,
    })),
  };
});

const payload = {
  generatedFrom: "apps/cli/src/registry.ts",
  groups: groups.length,
  commands: COMMANDS.length,
  ready: COMMANDS.filter((c) => c.ready).length,
  groupList: groups,
};

const out = path.resolve(__dirname, "../../web/data/cli-catalog.json");
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, `${JSON.stringify(payload, null, 2)}\n`);
console.log(`wrote ${out}: ${payload.groups} groups / ${payload.commands} commands (${payload.ready} ready)`);