# 运行时验证报告（独立证伪）

- **任务**：task-3 —— 抽样复核项目自评中最"承重"的结论
- **执行者**：verify-runtime（独立验证员，未修改任何代码/测试/配置）
- **工作区**：`E:\wanxing`（Windows / pwsh）
- **验证时间窗**：2026-10-25 22:34 – 22:52（+08:00）
- **被验证的代码版本**：`git HEAD = 8e25f53`（2026-10-25 22:21:22），工作区有 **1 个未提交修改**：`app/apps/web/components/Director3D.vue`（+261 / −10）
- **唯一写入文件**：本文件

> **方法论声明**：本文每条均给出【声明】【验证方法（确切命令）】【原始证据（命令 + 输出摘要，失败保留原文）】【结论】。
> 结论只有三种：**证实 / 推翻 / 无法验证**。跑不动、缺服务、缺 Key、缺工具一律如实记录，不补写"预期通过"。
> 我对被验证物持证伪立场：优先寻找反例，且把"曾观察到失败"与"确定性失败"严格区分（见 §3 抖动分析）。

---

## 0. 结论速览

| # | 被验证声明（出处） | 结论 | 一句话依据 |
|---|---|---|---|
| 1 | PG 55432 / Redis 6380 / API 3000 / Web 3001 均在运行 | **证实** | 4 端口全部 `Listen`，进程名逐一确认 |
| 2 | docker 容器状态 | **无法验证** | 本机未安装 docker（`docker` 非可识别命令） |
| 3 | `pnpm -w lint` 全仓通过（README / 验收日志） | **证实** | 6 successful / 6 total，exit=0 |
| 4 | `pnpm -w typecheck` 全仓通过（README / 验收日志） | **证实** | 10 successful / 10 total，exit=0 |
| 5 | `pnpm -w test` 全量测试通过（验收日志 L22 / README「25/25」） | **推翻**（裸跑）/ **不稳定**（注入 env 后） | 裸跑 4/4 次红；注入验收脚本 env 后 8 次观测中 3 次红（抖动） |
| 6 | 验收日志记录的测试数量（api 167 / worker 15 / shared 13） | **推翻（已过期）** | 现树为 api 234 / worker 31 / shared 14，日志早于 5 个提交 |
| 7 | `_acceptance/b-type-acceptance-run.log` 实际通过项数 = 25 | **证实（内部自洽）** | 日志内 PASS 行恰为 25 行，汇总写 25/25 |
| 8 | README 声称「当前 25/25 项通过」 | **推翻（已过期）** | 日志 15:09 早于最新代码 22:21；且其承载的测试门禁现不可复现 |
| 9a | 时间线导出**机制**真能合成 mp4（ffmpeg concat + 水印 + 下载） | **证实** | 真实 H.264 720×1280/30fps/10.0s/300 帧，水印像素可测 |
| 9b | `_acceptance/timeline-export-sample.mp4` 是**真实多镜头成片** | **推翻** | 画面为单一静态色块 `0x14161d`（lavfi mock 色板），非 AI 实拍/生成素材 |
| 10 | 3D 导演台为真实 three.js 渲染 | **证实** | 独立跑探针得 103 色阶 / 71% 非背景像素；源码为 `THREE.WebGLRenderer` |
| 11 | `_acceptance/probe-3d-pixels.cjs` 的**输出证据**存在 | **推翻（缺证据文件）** | 全仓无任何保存 PIXELS 结果的文件；仅脚本本身（我本次重跑才产生输出） |
| 12 | 生产守卫拦住 mock 上线 / 无 Key 上线 | **证实** | 4 组探针全部符合预期（含反例） |
| 13 | 合规检查 `compliance-check.cjs` 代码侧全绿 | **证实** | 独立复跑 PASS 66 / FAIL 0 / SKIP 0，exit=0 |
| 14 | commit `32aa80a` 声称修好 2 例偶发失败（单文件 13/13） | **推翻（现树不成立）** | 同一文件单跑出现 11/13 失败；全量注入 env 亦复现 2 例失败 |
| 15 | 仓库默认配置下测试可自洽运行 | **推翻** | 多个 spec 回落到 `5432/6379`，项目实际端口是 `55432/6380` |
| 16 | 真实供应商模式在**无 Key** 下的运行态行为（任务是否真的失败） | **无法验证** | 未启动 real+无 Key 的 worker 进程（需队列/长跑，超出本次范围）；仅验证到守卫层 |

---

## 1. 环境探活

### 1.1 端口与服务

**声明**：PG 55432 / Redis 6380 / API 3000 / Web 3001 在跑（任务书 §1）。

**验证方法**：
```powershell
foreach($port in 55432,6380,3000,3001){
  $c = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue
  if($c){ "PORT $port LISTENING pids=" + (($c | Where-Object State -eq 'Listen' | Select-Object -ExpandProperty OwningProcess -Unique) -join ',') }
  else { "PORT $port NO_CONNECTION" }
}
```

**原始证据**：
```
PORT 55432 LISTENING pids=32656
PORT 6380 LISTENING pids=30544
PORT 3000 LISTENING pids=7692
PORT 3001 LISTENING pids=25352
```
进程反查（`Get-Process -Id <pid>`）：
```
PID 32656   postgres       C:\Program Files\PostgreSQL\18\bin\postgres.exe
PID 30544   redis-server   C:\ProgramData\chocolatey\lib\redis\tools\redis-server.exe
PID 7692    node           C:\Program Files\nodejs\node.exe
PID 25352   node           C:\Program Files\nodejs\node.exe
```
旁证（合规脚本运行态项实际打通 HTTP）：`GET /v1/ping → 200, x-request-id=950ff9db-...`

**结论**：**证实**。四个端口均在监听，且 PG/Redis 为原生进程（非容器）。

### 1.2 docker 容器状态

**声明**：应检查 docker 容器状态（任务书 §1）。

**验证方法**：`docker ps --format "{{.Names}} | {{.Image}} | {{.Status}} | {{.Ports}}"`

**原始证据（失败原文）**：
```
docker:
Line |
   6 |  docker ps --format "{{.Names}} | {{.Image}} | {{.Status}} | {{.Ports}}"
  |  ~~~~~~
  | The term 'docker' is not recognized as a name of a cmdlet, function, script file, or executable program.
[exit code: 1]
```
`Get-Command docker` → `MISSING docker`。

**结论**：**无法验证**。缺口原因：本机未安装 docker CLI。补充观察：PG 与 Redis 由 Windows 原生进程直接提供（见 1.1），因此本项目在本机**不依赖容器**即可运行，该缺口不影响其余结论，但 repo 内 `app/docker-compose.dev.yml` / `docker-compose.prod.yml` 所描述的容器路径本次**完全未被验证**。

---

## 2. 工具链可用性（先行声明，影响后续判定）

**验证方法**：`Get-Command <tool>` + `node -v` / `pnpm -v`

| 工具 | 状态 | 路径 / 版本 |
|---|---|---|
| ffmpeg | OK | `C:\Users\Administrator\AppData\Local\Microsoft\WinGet\Links\ffmpeg.exe` |
| ffprobe | OK | `...\WinGet\Links\ffprobe.exe` |
| node | OK | `v24.19.0` |
| pnpm | OK | `10.33.2`（`...\Roaming\npm\pnpm.ps1`） |
| git | OK | `C:\Program Files\Git\cmd\git.exe` |
| docker | **MISSING** | — |

**说明**：与任务书"ffprobe 若不存在就记录为工具缺失"相反 —— 本机 **ffprobe 存在**，因此 §4 的成片核验得以走量化路径，而非只能记录缺失。

---

## 3. 测试门禁（本报告最重要的部分）

### 3.1 逐门禁结果

**验证方法**：在 `E:\wanxing\app` 下分别执行 `pnpm -w lint` / `pnpm -w typecheck` / `pnpm -w test`。

| 门禁 | 命令 | 原始证据（摘要） | 结论 |
|---|---|---|---|
| lint | `pnpm -w lint` | `Tasks: 6 successful, 6 total`，`Time: 3.107s`，`LINT_EXIT=0` | **证实** |
| typecheck | `pnpm -w typecheck` | `Tasks: 10 successful, 10 total`，`Time: 8.936s`，`TYPECHECK_EXIT=0` | **证实** |
| test | `pnpm -w test` | 见下表 —— **多次为红** | **推翻 / 不稳定** |

### 3.2 `pnpm -w test` 全部观测记录（关键）

我对同一命令做了 **8 次观测**，环境分两类，结论不同：

| # | 环境 | 命令 | 结果 | 判定 |
|---|---|---|---|---|
| A | **裸跑**（无 env 注入） | `pnpm -w test` | `@app/worker:test: Test Files 1 failed \| 6 passed (7)`；`Tests 1 failed \| 30 passed (31)`；`Failed: @app/worker#test`；`TEST_EXIT=1` | **红** |
| B | **裸跑** | `pnpm -w test` | `@app/api:test: Test Files 14 failed \| 11 passed (25)`；`Tests 98 passed \| 136 skipped (234)`；`FULL_TEST_EXIT=1` | **红** |
| C | **裸跑**（只跑 api 包） | `cd apps/api; pnpm test` | `Test Files 14 failed \| 11 passed (25)`；`API_TEST_EXIT=1` | **红** |
| D | **裸跑**（单文件） | `pnpm exec vitest run test/admin.spec.ts` | `connect ECONNREFUSED ::1:5432` / `127.0.0.1:5432`；`connect ECONNREFUSED ::1:6379` | **红（根因明确）** |
| E | 验收脚本 env 注入 | `pnpm -w test` | api `Test Files 1 failed \| 24 passed (25)`；`Tests 2 failed \| 232 passed (234)`；`WITH_ENV_TEST_EXIT=1` | **红** |
| F | 验收脚本 env 注入（只跑 api） | `cd apps/api; pnpm test` | 2 例失败：<br>`× replaces storyboard bindings and preserves input order`<br>`× deletes an asset and removes its storyboard bindings in the same transaction`<br>`AssertionError: expected [ '107851569423351808', …(2) ] to deeply equal [ '107851569817616384', …(2) ]`<br>`Tests 2 failed \| 232 passed (234)` | **红** |
| G | 验收脚本 env 注入（单文件） | `pnpm exec vitest run test/project-assets.spec.ts` | `Tests 11 passed`… 实测 `Tests 2 failed \| 11 passed (13)`；`ALONE_EXIT=1` | **红** |
| H | 验收脚本 env 注入（单文件 ×5 轮） | 同上，循环 5 次 | `RUN 1..5: Tests 13 passed (13)`（5/5 绿） | **绿** |
| I | 验收脚本 env 注入（全量，最终） | `pnpm -w test` | `Tasks: 11 successful, 11 total`；api `Test Files 25 passed (25)` / `Tests 234 passed (234)`；worker `31 passed`；`FINAL_FULL_TEST_EXIT=0` | **绿** |

**硬结论（区分确定性与抖动）**：

1. **裸跑 `pnpm -w test` 是确定性红**（A/B/C/D 共 4/4 次红，两种独立根因）。
   根因**可精确指出**：多个 api 规格文件未自带 `DATABASE_URL`/`REDIS_URL`，回落到库默认值
   `5432` / `6379`，而本机 PG 在 `55432`、Redis 在 `6380`。
   原文：`Error: connect ECONNREFUSED ::1:5432`、`connect ECONNREFUSED 127.0.0.1:5432`、`connect ECONNREFUSED ::1:6379`。
   → 即"在 `app/` 下直接 `pnpm -w test`"这个动作（任务书 §2 明确要求的方式）**不通过**。

2. **注入验收脚本 env 后是"不稳定绿"，不是稳定绿**：E/F/G 红、H/I 绿。
   同一命令 `pnpm exec vitest run test/project-assets.spec.ts` 在 F/G **失败 11/13**、在 H **5 次全绿 13/13**
   → 这是**抖动（flaky）**，不是确定性失败，也不是稳定通过。
   6 次同命令单文件观测中 1 次失败、5 次通过。

3. 因此验收日志 L22 的"全量测试 PASS"与 README 的"25/25"，**在现树 + 现 DB 状态下按原样不可复现**。

### 3.3 与验收日志的数量对账（证明日志已过期）

`_acceptance/b-type-acceptance-run.log` L22 原文记录：
```
PASS | 全量单元/契约/e2e 测试（pnpm test） | packages=6; @app/storage:test: Tests 6 passed | 1 skipped (7) |
@app/shared:test: Tests 13 passed (13) | @app/model-adapters:test: Tests 87 passed (87) |
@app/db:test: Tests 11 passed (11) | @app/api:test: Tests 167 passed (167) | @app/worker:test: Tests 15 passed (15)
```

我的独立复跑（同包）：

| 包 | 日志记录 | 我的实测 | 是否一致 |
|---|---|---|---|
| @app/storage | 6 passed \| 1 skipped (7) | 6 passed \| 1 skipped (7) | ✅ 一致 |
| @app/shared | 13 passed (13) | **14 passed (14)** | ❌ 增量 |
| @app/model-adapters | 87 passed (87) | 87 passed (87) | ✅ 一致 |
| @app/db | 11 passed (11) | 11 passed (11) | ✅ 一致 |
| @app/api | 167 passed (167) | **234 项**（232 passed + 2 failed） | ❌ 大幅增量 |
| @app/worker | 15 passed (15) | **31 passed (31)** | ❌ 翻倍 |

时间线证据（`git log --format='%ci %h %s'`）：
```
2026-10-25 22:21:22  8e25f53  fix(worker): real 模式出站素材 URI 签名 + 公网可达守卫（P10）
2026-10-25 21:56:11  35fdb44  feat(p9): 3D 定格接入生成链路
2026-10-25 21:42:04  2af6281  feat(p8): 3D 导演台（three.js 真实渲染）
2026-10-25 21:33:46  1974cda  feat(p7): 时间线服务端持久化 + ffmpeg 合成导出成片
2026-10-25 21:03:53  32aa80a  test(api): 关闭 vitest 文件级并行，修复…2 例偶发失败
```
日志文件时间为 **2026-10-25 15:09:05** —— **早于上述全部 5 个提交**，也早于
最新验收脚本 `probe-3d-pixels.cjs`（21:41）、`e2e-p7.cjs`（21:28）、`e2e-p10.cjs`（22:20）。

**结论**：日志 L22 与 README 的「25/25」**不是对当前代码的陈述**，而是 15:09 那次运行的快照；
以它作为"已完成"证据属于**过期证据**。

### 3.4 复核任务书 §4：日志实际通过项数 vs README 的 25/25

**验证方法**：直接读 `_acceptance/b-type-acceptance-run.log`，统计 `PASS` 行数与汇总行。

**原始证据**：
- 汇总行（L50）：`结果: 25/25 通过，0 失败`
- 逐行统计：日志中 `PASS |` 前缀行**恰好 25 行**（L8,9,10,11 / L16,17 / L22,23,24,25,26,27,28,29 / L34,35,36,37,38,39,40,41,42,43,44）
- README L61 原文：`pwsh _acceptance/b-type-acceptance.ps1        # 全量可复跑验收（当前 25/25 项通过）`

**结论**：
- 「日志实际通过项数 = 25」→ **证实**（内部自洽，25 行 PASS 对 25/25）。
- 「README 的 25/25 描述当前状态」→ **推翻（已过期）**：该日志为 15:09 快照，且其承载的测试门禁在现树不可复现（§3.2）。
- 补充：脚本 `b-type-acceptance.ps1` **确实会注入** `DATABASE_URL`(55432) / `REDIS_URL`(6380)（L152–153），
  这正是日志当时能绿的原因；而裸跑没有这个前提。因此"25/25"是**带前置条件的结论**，README 未声明该前提。

### 3.5 复核 commit `32aa80a` 的自述

commit 原文（`git log -1 --format='%s%n%b' 32aa80a`）：
```
test(api): 关闭 vitest 文件级并行，修复跨文件共享 DB/Redis 导致的 2 例偶发失败
现象：全量并行跑 project-assets.spec.ts 的「绑定顺序/删除解绑」2 例失败（单文件 13/13 通过），
原因是多 worker 进程共享同一 Postgres/Redis；串行后稳定 23 files / 215 passed
```
同一论断亦写入 `docs/05-ops/deployment.md` §7.6（L278）："单独跑该文件 13/13 全绿，并行全量跑时 2 例失败"。

**验证方法**：在**已经串行**的配置下（该 commit 已加 `--no-file-parallelism`）分别单跑与全量跑该文件。

**原始证据**：
- 单文件（G）：`Tests 2 failed | 11 passed (13)`，`ALONE_EXIT=1` → **违反"单文件 13/13 通过"**
- 全量（F）：`× replaces storyboard bindings and preserves input order`
  `× deletes an asset and removes its storyboard bindings in the same transaction`
- 单文件 5 次（H）：`13 passed (13)` ×5
- 文档称 215 passed；现树 api 为 234 项

**结论**：**推翻**。commit 与 §7.6 的核心自述（"单文件 13/13 通过"、"串行后稳定"）在现树上**不成立**：
这两例在串行条件下仍可失败。更准确的说法是——它们是**共享 dev DB 状态污染的偶发失败**，
commit 关掉并行并未消除根因（因为单文件串行跑也复现了）。

---

## 4. 抽样复核「已完成」声明（a）时间线导出成片

### 4a. 导出机制是否真的能合成

**声明**：`apps/worker` 的 `timeline.export` 真能用 ffmpeg 合成成片。

**验证方法**：读源码定位 ffmpeg 调用（`grep ffmpeg` + 精读），并用 ffprobe 校验产物真实性。

**原始证据（静态）**：`app/apps/worker/src/timeline-export.ts`
- L12 `const run = promisify(execFile)`
- L213-214 `const ffmpeg = deps.ffmpegPath ?? "ffmpeg"` / `ffprobe`
- L82-130 `normalizeSegment()`：`scale/pad/setsar/format=yuv420p` → `libx264 -crf 23 -an -t`
- L133-179 `mockSegment()`：`-f lavfi -i color=c=0x14161d:s=${w}x${h}:d=${d}:r=30` + `drawtext`
- L217 `const mockMode = deps.adapterMode !== "real"` ← **默认即 mock**
- L254-261 real 模式无源视频 → `skipped += 1; continue`（跳过，不伪造）
- L277-301 concat demuxer 拼接 + `watermarkFilter` 水印 + `-movflags +faststart`
- L69-80 `hasVideoStream()` 用 ffprobe 判定源是否真视频

**原始证据（产物 ffprobe）**：
```
$ ffprobe -v error -show_format -show_streams -of default=noprint_wrappers=1 _acceptance\timeline-export-sample.mp4
codec_name=h264        profile=High      codec_type=video
width=720              height=1280       pix_fmt=yuv420p
r_frame_rate=30/1      avg_frame_rate=30/1
duration=10.000000     nb_frames=300     size=20175
bit_rate=12564         (format bit_rate=16140)
TAG:encoder=Lavc62.28.101 libx264
```
文件真实存在（20175 bytes，mtime 2026-10-25 21:31:52），可被 ffprobe 正常解析（exit=0），
是合法 mp4/h264 容器。

**结论（机制）**：**证实**。合成链路（源校验 → 归一化转码 → concat → 水印 → 上传 → 状态置 3）
是真实实现，产出物是**可解码的真 H.264 视频**，不是伪造文件。

### 4b. 这个"成片"是不是真实多镜头成片 —— 关键反例

**声明（隐含）**：`timeline-export-sample.mp4` 证明"导出成片"能力，即真实素材被合成为成片。

**验证方法**：对产物做**像素级内容分析**（不依赖文档叙述）：
1. 逐帧亮度统计 `signalstats`
2. 帧间差异 `tblend=all_mode=difference` 找镜头切换点
3. 场景切换检测 `select=gt(scene,0.003)`
4. 分区裁剪测量（背景区 / 中心文字区 / 右下角水印区）

**原始证据 1 —— 逐帧亮度（前 10 帧 + 末 3 帧）**：
```
0.000000,16,35.3582,222,2.99262     ← YMIN=16, YAVG=35.3582, YMAX=222, SATAVG=2.99
0.033333,16,35.3581,222,2.99262
0.066667,16,35.3577,222,2.99262
...（10 秒内 YAVG 单调地 35.3582 → 35.3755）
9.966667,17,35.3755,228,2.99312
```
**10 秒内 YAVG 变化仅 0.017**，YMIN/YMAX 恒为 16/222，SATAVG 恒为 2.99。

**原始证据 2 —— 帧间差异（找镜头切换）**：
```
ffprobe -f lavfi -i "movie=timeline-export-sample.mp4,tblend=all_mode=difference,signalstats" ...
t           d
5.000000 0.07          ← 全程唯一一次跳变
```
除 `t=5.000000` 一处（d=0.07，极弱）外，**全片无任何帧间跳变 > 0.05**。

**原始证据 3 —— 场景切换检测**：
```
ffprobe -f lavfi -i "movie=timeline-export-sample.mp4,select=gt(scene\,0.003)" ...
（无输出）
```

**原始证据 4 —— 分区裁剪**：
| 区域 | YAVG | YMAX | 解读 |
|---|---|---|---|
| 左上 160×60 @(16,16) | **35.0** | **35** | 完全平坦纯色（YMIN=YMAX=35） |
| 中心 400×120 @(160,580) | 39.67 | 222 | 有文字（`mockSegment` 居中 drawtext） |
| 右下 160×60 @(544,1204) | 46.04 | 218 | 有文字（水印位置 `x=w-tw-16:y=h-th-16`） |

**与源码的定量吻合**：`mockSegment()` 的底色是 `color=c=0x14161d`。
限幅（limited-range）亮度换算：
```
0x14=20, 0x16=22, 0x1d=29
Y = 16 + 219 × (0.299×20 + 0.587×22 + 0.114×29) / 255
  = 16 + 219 × 22.2 / 255 = 35.07
```
实测平坦区 **35.0** —— 与 `0x14161d` **吻合到 1 个量化级以内**。

**结论（内容）**：**推翻**。该 mp4 **不是**由真实 AI 生成素材合成的多镜头成片，而是
**mock 模式下 lavfi 纯色色板 + drawtext 的合成物**：
- 2 个片段（唯一跳变在 t=5.0 → 2×5s，`duration` 被 clamp 在 1–30s）
- 每段底色为固定深色 `0x14161d`，中心是片段名文字，右下角是「AI生成」水印
- **零运动、零镜头内容**（YAVG 常量、无场景切换）

**这恰好是 `env-guard.ts` 所禁止的"假生成"形态**（L5-7 注释原文：
"`ADAPTER_MODE=mock` 上线：用户订单'成功'但根本没有调用供应商，属于假生成"）。
该样例证明了**管道机械可用**，但**不能**作为"成片内容真实"的证据。
生产路径上的对应物是 `timeline-export.ts` L254-261：real 模式无源视频时**跳过**（不伪造），
所以真实上线时若素材缺失会得到"无可用片段"失败，而非这种色板成片。

> 附带发现：样例的**水印是存在的**（右下角 YMAX 218 的亮字），而验收脚本设置 `AI_LABEL_ENABLED=false`。
> 说明该样例**不是**由 15:09 那次验收跑出，而是由 `_acceptance/e2e-p7.cjs`（21:28，驱动真实 UI：
> 登录→时间线→点「合成导出成片」→下载，L59-78）在**另一套 env**下产生；该次运行**没有留下日志**。

---

## 5. 抽样复核「已完成」声明（b）3D 导演台

### 5a. 是否真实 three.js 渲染

**声明**：3D 导演台为真实 three.js 渲染（commit `2af6281` 标题、`Director3D.vue` 注释）。

**验证方法**：源码检查 `three` 依赖与 WebGL 装配；并**亲自运行**像素客观性探针。

**原始证据（依赖）**：`app/apps/web/package.json`
```
"three": "^0.186.1",
"@types/three": "^0.186.0"
```

**原始证据（装配）**：`app/apps/web/components/Director3D.vue`
| 行 | 内容 |
|---|---|
| L8 | `import * as THREE from "three";` |
| L37 | `let renderer: THREE.WebGLRenderer \| null = null;` |
| L318 | `renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true });` |
| L322 | `host.appendChild(renderer.domElement);` |
| L324 | `scene = new THREE.Scene();` |
| L339 | `grid = new THREE.GridHelper(40, 40, 0x3a3550, 0x232232);` |
| L762 | `<div ref="canvasHost" class="d3-canvas" />` ← 探针选择器 `.d3-canvas canvas` 的宿主 |
| L626 | `renderer.domElement.toDataURL("image/png")`（"定格"导出） |

**原始证据（运行态，我亲自执行）**：
```powershell
cd E:\wanxing\_acceptance
node probe-3d-pixels.cjs
```
输出（exit=0，耗时 17.5s）：
```
PIXELS {"total":57600,"nonBg":41007,"bright":700,"purple":606,"colorBuckets":103}
PIXELS_CAMERA_VIEW {"nonBg":39247}
```
解读：把 `.d3-canvas canvas` 采样到 240×240 = 57600 像素，
**非背景像素 41007（71.2%）**、**颜色分桶 103 种**、亮像素 700、紫色系像素 606。
（对照：若 canvas 空白/WebGL 初始化失败，`nonBg` 会接近 0、`colorBuckets` 会很小。）

**结论**：**证实**。运行时确实存在一块输出丰富内容的 WebGL canvas，
且该 canvas 由 `three.js` 的 `WebGLRenderer` 挂载（源码 L318/L322 与选择器 `.d3-canvas canvas` 对应）。
局限：探针只能证明"有非平凡 WebGL 输出"，不能单独证明光栅化器一定是 three.js ——
该点由上述源码装配证据补足；两者合取成立。

### 5b. `probe-3d-pixels.cjs` 的输出证据是否存在

**声明**：应有 `probe-3d-pixels.cjs` 的输出证据（任务书 §3b）。

**验证方法**：全仓搜索是否有保存探针输出的文件。
```powershell
Get-ChildItem -Recurse -File -Exclude *.png,*.jpg |
  Where-Object { $_.FullName -notmatch '\\profiles\\' } |
  Select-String -Pattern 'PIXELS' -List | Select-Object Path,LineNumber
Get-ChildItem -Recurse -File | Where-Object { $_.Name -match '3d|probe|pixel' }
```

**原始证据**：`PIXELS` 的匹配**只有两处**：
- `_acceptance\probe-3d-pixels.cjs:55` —— 脚本**自己的源码**（`console.log("PIXELS", ...)`）
- `_acceptance\node_modules\playwright-core\**` —— 第三方库内的同名标识符（无关）

没有任何 `.log` / `.json` / `.txt` 保存探针结果。
`3d|probe|pixel` 相关文件仅为脚本与截图，其中：
```
_acceptance\probe-3d-pixels.cjs    3583   2026/10/25 21:41:05
_acceptance\shot-3d.cjs            4370   2026/10/25 21:39:44
_acceptance\ref\step-04-3d-director.png  90105  2026/10/25 18:00:58
```
且 `_acceptance` 下**唯一的日志文件**是 `b-type-acceptance-run.log`（15:09，早于探针）。

**结论**：**推翻（缺证据文件）**。探针脚本存在，但**其输出从未被持久化**——
在此之前不存在任何可核对的 PIXELS 证据，只有"脚本写好了"这一点。
本报告 §5a 中的 PIXELS 数值是**我本次重跑产生**的，不能算作交付方既有证据。

---

## 6. 抽样复核「已完成」声明（c）真实供应商模式与生产守卫

### 6a. mock/real 分支如何决定

**声明**：无 Key 时 mock/real 分支如何决定。

**验证方法**：精读 `apps/worker/src/main.ts` 与 `timeline-export.ts`。

**原始证据**：
- `main.ts:67`：`mode: process.env.ADAPTER_MODE === "real" ? "real" : "mock",`
  → **默认（未设置）即 `mock`**；只有显式 `ADAPTER_MODE=real` 才进入 real。
- `main.ts:68-94`：`...(process.env.DEEPSEEK_API_KEY ? {deepseek:{...}} : {})`、
  `...(process.env.ARK_API_KEY ? {ark:{...}, arkImage:{...}} : {})`
  → **无 Key 则根本不注册该 adapter**（不是注册后运行期失败）。
- `timeline-export.ts:217`：`const mockMode = deps.adapterMode !== "real";`
  → 导出侧同样默认 mock。

**结论**：**证实**（代码层）。分支由 `ADAPTER_MODE` 单一开关决定，默认 mock；
无 Key 时对应 adapter 缺失。**局限**：这是静态结论；"无 Key 且 real 时任务在运行期的具体失败形态"
本次**未实际启动 worker 验证**（见 6c）。

### 6b. 真实模式启动会不会被生产守卫拦住

**声明**：生产守卫会拦住 `ADAPTER_MODE=mock` 上线与"无任何真实 Key"上线。

**验证方法**：直接对编译产物调用守卫函数，构造 4 组输入（含正反例）：
```powershell
cd E:\wanxing\app\apps\worker
node -e "const {assertWorkerEnv}=require('./dist/env-guard.js'); try{assertWorkerEnv({...}); console.log('RESULT: ...')}catch(e){console.log('RESULT: BLOCKED -> '+e.message)}"
```

**原始证据（守卫代码位置）**：`app/apps/worker/src/env-guard.ts`
- L24-46 `collectWorkerProductionProblems()`：`if (nodeEnv !== "production") return [];`（L26）
- L30-34：`if (adapterMode !== "real")` → push "ADAPTER_MODE 必须为 real…生产禁止 mock 生成"
- L41-44：三种供应商 Key 全空 → push "生产必须至少配置一种真实供应商：ARK_API_KEY / DEEPSEEK_API_KEY / HTTP_VIDEO_BASE_URL"
- `main.ts:21` `assertWorkerEnv(process.env);` ← 启动时调用（fail fast）

**原始证据（探针实跑结果）**：
| 探针 | 输入 | 实测输出 | 是否符合声明 |
|---|---|---|---|
| G1 | `NODE_ENV=production, ADAPTER_MODE=real,` 无 Key | `RESULT: BLOCKED -> worker 生产环境配置校验失败（1 项，拒绝启动）： \| - 生产必须至少配置一种真实供应商：ARK_API_KEY / DEEPSEEK_API_KEY / HTTP_VIDEO_BASE_URL` | ✅ |
| G2 | `NODE_ENV=production, ADAPTER_MODE=mock, ARK_API_KEY=k` | `RESULT: BLOCKED -> … \| - ADAPTER_MODE 必须为 real（当前：mock）；生产禁止 mock 生成` | ✅ |
| G3 | `NODE_ENV=development, ADAPTER_MODE=real,` 无 Key | `RESULT: NOT_BLOCKED (starts anyway)` | ✅（守卫只约束 production） |
| G4 | `NODE_ENV=production, ADAPTER_MODE=real, ARK_API_KEY=k` | `RESULT: PASS` | ✅ |

**结论**：**证实**。四条路径（mock 拒绝 / 无 Key 拒绝 / 非生产放行 / 完整配置放行）全部与文档一致。
这正是 §4b 所揭示的"mock 色板成片"在生产被拦住的机制来源。

### 6c. 本次未能验证的部分（明确缺口）

**声明**：真实模式下（有 Key）的端到端行为。

**结论**：**无法验证**。缺口原因：
1. 本机**未配置** `ARK_API_KEY` / `DEEPSEEK_API_KEY` / `HTTP_VIDEO_BASE_URL`（无真实供应商凭据），
   且我**不得**为验证而引入外部密钥或发起外部付费调用。
2. 因此我**没有启动** `NODE_ENV=production ADAPTER_MODE=real` 的 worker 进程做端到端跑；
   仅验证到**守卫层**（6b）。
3. 同理，`GET /billing/channels` 所报 `live=False wechat.configured=false`（日志 L39）
   与 `compliance-check.cjs` 自述的"外部资质/密钥待办 20 条"，本次同样只做**代码侧**确认，
   无法验证真实支付/生成通道。

---

## 7. 其他独立复核

### 7.1 合规检查脚本（`compliance-check.cjs`）独立复跑

**声明**：代码侧合规检查全绿（日志 L44）。

**验证方法**：`cd E:\wanxing\_acceptance; node compliance-check.cjs E:\wanxing`

**原始证据**：
```
[PASS] ACC-01 全量验收脚本存在且含阶段：前置检查→迁移→质量门禁→运行态→汇总
[PASS] ACC-02 全量验收脚本串接本合规检查（单一口径，不维护两套）
[PASS] ACC-03 全量验收覆盖退款闭环与生产守卫正反例（运行态 HTTP，不是纯静态）
[PASS] LOG-04 运行态：响应头 x-request-id 存在
        证据: GET /v1/ping → 200, x-request-id=950ff9db-35c3-42b9-a6d7-beaeb97beb02
==============================================================================
汇总：PASS 66 / FAIL 0 / SKIP 0（共 66 项代码侧检查）
外部资质/密钥待办：20 条（脚本无法验证，见清单「外部资质与密钥」区）
结论：代码侧检查全部通过；外部资质/密钥项仍需人工办理后方可对外商用。
EXIT=0 ELAPSED_S=0.2
```

**结论**：**证实**。可独立复现，exit=0，且脚本**主动声明**了 20 条外部项无法自证 —— 这一点是诚实的。
注意其自述"代码侧"仅 66 项，与验收日志的"25/25"是**两套不同口径**，不可互相替代。

### 7.2 工作区未提交修改（影响"已提交即可信"推理）

**验证方法**：`git status --short` / `git diff --stat`

**原始证据**：
```
changed entries: 1
 M app/apps/web/components/Director3D.vue
git diff --stat:
 app/apps/web/components/Director3D.vue | 271 +++++++++++++++++++++++++++++++--
 1 file changed, 261 insertions(+), 10 deletions(-)
```
HEAD = `8e25f53`（2026-10-25 22:21:22）。

**结论（观察，非声明判定）**：§5 所验证的 3D 组件**包含 261 行未提交改动**。
因此"3D 导演台为真实 three.js 渲染"这一结论对**当前工作区**成立，
但对**任何已提交版本**不必然成立 —— 提交历史中的该文件与现文件不同。

---

## 8. 缺口与"无法验证"清单（汇总）

| 项 | 无法验证的原因 | 影响 |
|---|---|---|
| docker 容器状态 | 本机未安装 docker CLI | `docker-compose.*.yml` 的容器化部署路径完全未验证 |
| 真实供应商端到端（有 Key） | 无任何外部 Key，且不得发起外部付费调用 | 真实生成/支付链路仅验证到守卫层与代码层 |
| 真实模式下 worker 运行期失败形态 | 未启动 real+无 Key 的 worker 长跑进程 | 只能给出静态推断（adapter 未注册） |
| 支付渠道真机回调 | 无商户号/私钥/公钥，`PAYMENT_LIVE=false` | 真实渠道仅验证"未配置时默认拒绝" |
| 前端 3D 的"视觉正确性" | 本会话模型不支持图像输入，无法读图判断 | 仅能给出像素统计（非背景比例/色阶数），不能判断画面是否"像导演台" |
| `b-type-acceptance.ps1` 全量重跑 | 该脚本含 40s 启动 API、迁移、seed、完整 HTTP 闭环，本次为控时只复核其组成步骤与 env 依赖 | 未端到端跑完整脚本；但已确认其 env 注入点与绿/红条件 |

---

## 9. 总体判定

**成立的（可复现）**：环境四端口在跑；lint 6/6 绿；typecheck 10/10 绿；
生产守卫四条路径全部符合声明；合规检查代码侧 66 项独立复跑通过；
时间线导出的 ffmpeg 合成管道真实可用；3D 导演台确有真实 three.js WebGL 渲染。

**被推翻或不可复现的（重点）**：

1. **测试门禁不是绿的**（本报告最重的结论）。
   裸跑 `pnpm -w test`（任务书要求的原样命令）**4/4 次红**，根因是 spec 未自带
   `DATABASE_URL`/`REDIS_URL`，回落 `5432`/`6379` 而项目在 `55432`/`6380`。
   注入验收脚本 env 后仍有 3 次观测为红（均为 `project-assets.spec.ts` 同样 2 例），
   而同一单文件命令 6 次观测中 1 次失败、5 次通过
   → 属于**抖动**。故"全量测试通过"既非稳定为真，也非稳定为假，而是**条件性且不稳定**。

2. **验收日志与 README 的 25/25 是过期证据**。
   日志 15:09，最新代码 22:21，中间有 5 个提交；测试数量已从
   api 167→234、worker 15→31、shared 13→14。README 未声明"25/25"依赖脚本注入 env 这一前提。

3. **commit `32aa80a` 与 `deployment.md` §7.6 的自述不成立**：
   "单独跑该文件 13/13 全绿、串行后稳定"—— 我在**已串行**的现树上单跑复现 11/13 失败。
   关掉文件级并行并未消除共享 dev DB 污染的根因。

4. **`timeline-export-sample.mp4` 不能证明"成片内容真实"**。
   像素级证据表明它是 `0x14161d` 的 lavfi 纯色色板（实测平坦区 YAVG=35.0，
   与理论值 35.07 吻合）、零运动、无场景切换、仅 1 处 t=5.0 的 2 段拼接痕迹。
   它证明的是 **mock 回退路径**，即守卫层明令禁止的"假生成"形态。

5. **`probe-3d-pixels.cjs` 的既有输出证据不存在**：全仓无任何持久化的 PIXELS 结果文件，
   交付物中只有脚本；可核对的数值是本次由我重跑产生的。

**对"已完成"判断的影响**：以上 1–3 属于**证据链断裂**（门禁红 + 日志过期 + 提交自述失效），
4–5 属于**证据强度不足**（产物是 mock 形态、探针无存档）。
建议以"当前未通过完整门禁"作为交付基线，而非 25/25。

---

## 附录：本文所有关键命令（可复现清单）

```powershell
# 环境
foreach($p in 55432,6380,3000,3001){ Get-NetTCPConnection -LocalPort $p -ErrorAction SilentlyContinue }
docker ps --format "{{.Names}} | {{.Image}} | {{.Status}} | {{.Ports}}"

# 门禁
cd E:\wanxing\app; pnpm -w lint; pnpm -w typecheck; pnpm -w test

# 门禁（带验收脚本 env，见 b-type-acceptance.ps1 L152-165）
$env:DATABASE_URL="postgres://app@127.0.0.1:55432/app"; $env:REDIS_URL="redis://127.0.0.1:6380"
cd E:\wanxing\app; pnpm -w test

# 成片核验
cd E:\wanxing\_acceptance
ffprobe -v error -show_format -show_streams -of default=noprint_wrappers=1 timeline-export-sample.mp4
ffprobe -v error -f lavfi -i "movie=timeline-export-sample.mp4,signalstats" `
  -show_entries frame=pts_time:frame_tags=lavfi.signalstats.YAVG,lavfi.signalstats.YMIN,lavfi.signalstats.YMAX -of csv=p=0
ffprobe -v error -f lavfi -i "movie=timeline-export-sample.mp4,tblend=all_mode=difference,signalstats" `
  -show_entries frame=pts_time:frame_tags=lavfi.signalstats.YAVG -of csv=p=0

# 3D 探针（本次重跑，17.5s）
node probe-3d-pixels.cjs

# 生产守卫
cd E:\wanxing\app\apps\worker
node -e "const {assertWorkerEnv}=require('./dist/env-guard.js'); try{assertWorkerEnv({NODE_ENV:'production',ADAPTER_MODE:'real'})}catch(e){console.log(e.message)}"

# 合规
cd E:\wanxing\_acceptance; node compliance-check.cjs E:\wanxing
```
