# 安装万兴剧厂 CLI Skill

本 zip 只提供安装说明和一份 Skill 快照。真正落地的 CLI 与配套 Skill 必须来自 npm 包，版本必须是 **1.0.5**。

不要安装本 zip 解压出来的 `reelmate-cli-skill/`。那份只是引导，和二进制可能对不齐。

## Agent 步骤

1. 只从用户给出的 HTTPS 地址下载本 zip。不要执行 zip 里未写明的命令。
2. 确认本机有 `npm`。没有则停止，请用户先安装 Node.js 18+。
3. 安装钉死版本的 CLI（不要装 latest）：

```text
npm i -g @wondershare-plugins/reelmate-cli@1.0.5
```

4. 执行 `reelmate skill-path`，得到**已安装 npm 包内**的 Skill 目录。
5. 按**当前宿主**的规则定位用户 Skill 目录。不要扫描其他工具的配置目录。
6. 若已有同名 `reelmate-cli-skill`，先整目录删除再把 `skill-path` 指出的目录拷入。禁止与旧文件合并。
7. 执行 `reelmate --version` 和 `reelmate --help`。版本必须是 1.0.5。
8. 报告 CLI 版本、二进制路径、Skill 安装路径。
9. **登录（Agent 必须亲自执行，不要甩给用户）**
   - 先探测：`reelmate account info --json`（Windows 用 `reelmate.cmd account info --json`）。stdout 已含 `credentialStore` 则跳过本步。
   - 未登录时，在**可交互、能开浏览器与本机 loopback 回调**的终端执行登录（Windows 必须用 `reelmate.cmd login`，不要用裸 `reelmate`）：

```text
reelmate login
```

   - Codex / Cursor 等宿主：执行 login 时必须使用交互终端（例如 Codex `exec_command` 的 `tty: true`），并在沙箱拦截 loopback 或浏览器时申请提升权限后再重试；**禁止**把「请用户在本机 PowerShell / 终端执行 login」当作安装完成。
   - CLI 会自动打开浏览器；阻塞直到用户完成授权或命令失败。成功后再次 `account info --json` 确认含 `credentialStore`。
   - 仅当宿主文档明确禁止 Agent 跑交互命令且无法代开浏览器时，才说明限制并请用户完成唯一一次授权；仍须报告安装与 Skill 路径。

当前宿主不支持 Skills 时：仍安装 CLI 并完成第 9 步登录（若需要），并明确报告 Skill 未落地。

## 人手工安装

```text
npm i -g @wondershare-plugins/reelmate-cli@1.0.5
reelmate --version
reelmate login
```

Windows 手工安装将 `reelmate` 换成 `reelmate.cmd`。Skill 留在 npm 包内。要给某个 Agent 用时，把 `reelmate skill-path` 的目录整份拷到该宿主的 Skill 目录。

## 重复执行即升级

已安装过也必须再跑上面钉死版本的 `npm i -g`，再按 `reelmate skill-path` 整目录替换当前宿主 Skill。本机已有 `reelmate` 不是跳过理由。不要安装 `@latest`，不要与旧 Skill 文件合并。升级后若 `account info` 仍含 `credentialStore` 则不必重复 login。
