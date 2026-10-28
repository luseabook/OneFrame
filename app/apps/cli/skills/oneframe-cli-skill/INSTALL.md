# 安装 OneFrame CLI Skill

CLI 与配套 Skill 都在同一个 npm 包里（`@app/cli`，当前版本 **0.1.0**）。Skill **不要**从别处下载或手动拼装——它必须与二进制同版本，否则命令清单会对不上。

## Agent 步骤

1. 确认本机有 `npm` 与 Node.js 18+；否则停止并请用户先安装。
2. 安装 CLI（此包当前为私有包，用 workspace 内 `pnpm --filter @app/cli build` 得到 `dist/`）。
3. 执行 `oneframe skill-path`，得到**已安装包内**的 Skill 目录。
4. 按**当前宿主**的规则定位用户 Skill 目录。不要扫描其他工具的配置目录。
5. 若已有同名 `oneframe-cli-skill`，先**整目录删除**再把 `skill-path` 指出的目录拷入。**禁止与旧文件合并**（旧文件残留会让命令清单漂移）。
6. 执行 `oneframe --version` 与 `oneframe --help`，版本必须与拷贝来的 `VERSION` 一致。
7. 报告 CLI 版本、二进制路径、Skill 安装路径。
8. **登录由 Agent 亲自执行**，不要甩给用户：
   - 先探测 `oneframe account info --json`；stdout 已含 `credentialStore` 则跳过。
   - 否则在**可交互、能开浏览器并回调本机 loopback** 的终端执行 `oneframe login`。
   - 宿主沙箱拦截 loopback 或浏览器时申请提权后重试；**禁止**把「请用户自己跑 login」当安装完成。

当前宿主不支持 Skills 时：仍安装 CLI 并按需完成登录，并明确报告 Skill 未落地。

## 人手工安装

```text
pnpm --filter @app/cli build
node apps/cli/dist/index.js skill-path
node apps/cli/dist/index.js --version
```

## 重复执行即升级

已装过也必须重跑安装，再用 `oneframe skill-path` **整目录替换**当前宿主 Skill。「本机已有旧版」不是跳过理由；升级后凭据仍在时不必重复 login。
