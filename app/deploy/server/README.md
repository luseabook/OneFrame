# OneFrame 服务器部署工具包（原生安装，无 Docker）

目标环境：Ubuntu 24.04 / 2C / 1.7G / 28G，与宝塔+nginx+MySQL 共用一台机器。
这套脚本就是验收机上实际跑通的那一套，按顺序重放即可。

## 执行顺序

```bash
cd app/deploy/server
sudo ./01-install.sh                    # PG16 + Redis7 + pnpm + swap + 服务账号
sudo ./02-configure-pg.sh               # 端口 55432 / 低内存调优 / 建库建角色
sudo ./03-configure-redis.sh            # 端口 6380 / 口令 / 修 systemd 加固问题
sudo ./06-migrate-seed.sh               # 54 个 migration + seed（46 模型/997 价目/17 SKU）
DOMAIN=<精确域名> sudo -E ./04-install-vhost.sh   # 独立 server 块 + 专属日志格式
sudo ./05-install-units.sh              # 三个 systemd 单元（只装不启动）
DOMAIN=<域名> ./07-verify.sh            # 独立验证：端口预检 + 7 条硬断言（可反复重跑）
```

`07-verify.sh` 是只读步骤，不做任何变更，因此「部署后跑一次」和「排障时随时再跑」
是同一个入口；退出码可直接接 CI/门禁（0 = 全通过）。

```bash
# 对外环境（备案号已下发、逃生舱已删除）：逃生舱残留会判红
STRICT_ICP=1 DOMAIN=<域名> ./07-verify.sh
```

产物部署与自检用上层脚本：

```bash
HOST=root@<ip> DOMAIN=<域名> ../deploy-oneframe.sh web    # 先 env → 传产物 → 重启 → 自动自检
DOMAIN=<域名> API_URL=http://127.0.0.1:8080 ../verify-deploy.sh
HOST=root@<ip> ../rollback-oneframe.sh web
```

## 共享机铁律（脚本里已内建，改之前先读）

1. **不改 `/etc/nginx/nginx.conf`**，只往 `sites-available/` 加文件并软链。
2. **`server_name` 只写自己的精确域名**。别人的站是 80/443 的 `default_server`，
   `server_name` 里含 `_` 和裸 IP；我们若也写，就会抢 Host 把别人的站顶掉。
3. **不碰别人的端口与服务**（8888 / 3306 / 5001–5267 java / 80/443 的既有站点）。
4. **口令只走 env**（`/etc/oneframe/*.env`，权限 600），脚本只打印变量名与长度，不打印值。

## 几个必须知道的坑（都是真踩过的）

| 现象 | 根因 | 处置 |
|---|---|---|
| PG 起不来 | `pg_conftool set listen_addresses "'127.0.0.1'"` 多套一层引号变成 `'''…'''` | 直接 sed 写单引号，见 `02` |
| PG 数据目录 | `pg_ctlcluster` 与 `/var/lib/postgresql/16/main` 硬绑定 | 不要搬 `/srv`，收益不抵风险 |
| Redis 报 `failed to map segment from shared object` | 打包单元 `PrivateUsers=true` + `/usr/local/lib` 下他方 libjemalloc | drop-in 指回系统库并关 `PrivateUsers`，见 `03` |
| Redis 报 `Can't open the log file: Read-only file system` | 打包单元 `ProtectSystem=strict` 把 `/srv` 挂只读 | drop-in `ReadWritePaths=/srv/oneframe`，见 `03` |
| Redis 报 `Permission denied` 写日志 | 日志文件曾被 root 创建 | 按服务分目录并 `chown redis`，见 `03` |
| web 报 `Cannot find package 'vue-bundle-renderer'` | 打包时 `--exclude='node_modules'` 把 `.output/server/node_modules` 一起排掉了 | 只排除根 `node_modules`；`.output` 本身自包含（16 个包） |
| web 重启后站点 80x / 挂 | 新构建带 ICP 启动守卫，`web.env` 既无备案号也无逃生舱 | **先写 env 再换产物再 restart**；`verify-deploy.sh` 前置检查会拦住 |
| nginx 里 80 端口拿不到我们的站 | `server_name` 写了 `_`/IP，与 `default_server` 冲突 | 只留精确域名 |
| 排障时看不到 Host/来源 IP | 未定义 `log_format`，默认格式不含 `$host` | `04` 写了 `oneframe` 格式（host / xri / xff / upstream / rt） |
| 迁移报 `Cannot find module 'drizzle-kit'` | devDependency 未装（部署树用 `--prod`） | `06` 在 `/srv/oneframe/tools` 独立装并软链 |

## 未备案域名会怎样

未备案域名在**云厂商边缘**就被拦（403 + `非法阻断` 页，iframe 指向云的错误页），请求**到不了**本机：
本机同 Host 自测是 200，外网是 403，且我们的 access log 里没有这些记录。
这是备案阻塞，不是 nginx/WAF 配置问题——本机既没装 btwaf，nginx 也没编译 WAF 模块。

因此：
- `verify-deploy.sh` 在服务器内部跑（`DOMAIN=... PUBLIC_BASE=http://127.0.0.1`）。
- **对外环境**必须 `STRICT_ICP=1`：`web.env` 里若还留着 `ONEFRAME_ALLOW_MISSING_ICP=1` 就判 FAIL。

## 写脚本时自己踩过的坑（给后来改脚本的人）

| 坑 | 现象 | 处置 |
|---|---|---|
| 在 Windows 上用 Python 文本模式回写 `.sh` | Linux 报 `set: pipefail: invalid option name` / `$'\r': command not found` | 必须写 `\n`（`io.open(p,'wb')` 或 `newline=''`）；提交前用 `grep -c $'\r'` 或按字节数 CR 复核 |
| 从 `deploy/` 目录调 `verify-deploy.sh` | 第 ⑤ 条门禁 SKIP（找不到 `_acceptance/`） | `07-verify.sh` 已自动切到含 `_acceptance` 的仓库根；单独调用时 `cd` 到仓库根 |
| sitemap 字节数写死（如 `-eq 14069`） | 换域名必红（域名字符数 × URL 条数） | 只做一次性取证；日常门禁用 `< SM_MAX_BYTES`（默认 16000）+ `<loc>` 条数 + lang 三断言 |
| `grep -A8` 统计某条 `<url>` 的 hreflang | 会串到下一条 `<url>`，多算 1 | 用 awk 精确切 `<url>…</url>` 块再计数 |
| 端口预检只数「有没有监听」 | 自己服务在跑时误报冲突 | 比对端口进程命令行是否匹配本项目（`preflight.sh`） |

