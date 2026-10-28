#!/usr/bin/env node
/**
 * 生成随包 Skill（第 61 批）。
 *
 * 为什么要有这个脚本：竞品 `SKILL.md:8` 规定「发布态只依赖当前二进制帮助、本 Skill 和
 * 随包命令文档」。命令文档如果手写，一定与 `src/registry.ts` 漂移（今晚就见过一次：
 * 帮助里 196 条命令、文档里 183 条）。所以 `commands/*.md`、`VERSION`、`manual/error-codes.md`
 * 全部从编译产物渲染，build 尾部自动重跑。
 *
 * 用法：`node scripts/gen-skill.cjs`（需先 `tsc`，因为要 require `../dist/skill.js`）。
 * 幂等：内容没变就不写盘，避免 build 弄脏 git。
 */
const { mkdirSync, readFileSync, writeFileSync, existsSync } = require("node:fs");
const { dirname, join } = require("node:path");

const pkgRoot = join(__dirname, "..");
const distSkill = join(pkgRoot, "dist", "skill.js");

if (!existsSync(distSkill)) {
  console.error(`[gen-skill] 缺少 ${distSkill}：先执行 tsc -p tsconfig.json`);
  process.exit(1);
}

const { renderAllFiles, SKILL_DIR_FROM_DIST } = require(distSkill);
const outRoot = join(pkgRoot, SKILL_DIR_FROM_DIST);
const files = renderAllFiles();

let written = 0;
let unchanged = 0;
for (const [rel, content] of files) {
  const target = join(outRoot, rel);
  mkdirSync(dirname(target), { recursive: true });
  if (existsSync(target) && readFileSync(target, "utf8") === content) {
    unchanged += 1;
    continue;
  }
  writeFileSync(target, content, "utf8");
  written += 1;
}

console.log(`[gen-skill] ${outRoot}: 写入 ${written} 个、未变 ${unchanged} 个（共 ${files.size}）`);
