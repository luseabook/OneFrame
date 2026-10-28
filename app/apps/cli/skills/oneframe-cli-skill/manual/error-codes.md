# 退出码与错误码

> 本文件由 `gen-skill.cjs` 从 `src/exit-codes.ts` 生成，**不要手改**；改映射请改源码后重跑 `pnpm --filter @app/cli build`。

## 两种码，别混

- **退出码（0..10）** 表示「脚本下一步该做什么」。
- **`error.kind`** 表示错误类别。
- **后端业务码** 以响应 envelope 里的 `code` 为准（业务错误是 HTTP 200 + 非零 code）。

## 退出码全集

| 码 | 名称 | 含义 |
| --- | --- | --- |
| 0 | `OK` | 成功 |
| 1 | `FAILURE` | 一般失败（未知错误、权限拒绝、not_found 也是 1） |
| 2 | `USAGE` | 参数/用法错误 |
| 3 | `AUTH` | 未登录或凭据失效 |
| 4 | `TASK_FAILED` | 任务失败（不是网络问题） |
| 5 | `CANCELED` | 取消（含 Ctrl-C） |
| 6 | `TIMEOUT` | 超时/游标过期 |
| 7 | `INSUFFICIENT_CREDITS` | 积分不足或超预算 |
| 8 | `MODERATION_REJECTED` | 内容安全拒绝 |
| 9 | `VERSION_CONFLICT` | 版本冲突 |
| 10 | `NODE_LOCKED` | 节点被锁 |

## `error.kind` → 退出码

| kind | 退出码 | 处理建议 |
| --- | --- | --- |
| `usage` | 2 | 参数写错或后端判为参数问题；看 `error.message` 改参数后重试 |
| `auth` | 3 | 未登录或 token 失效；先 `oneframe login` |
| `permission` | 1 | 已登录但无权限（注意：退出码是 1 不是 3） |
| `not_found` | 1 | 对象不存在或已被删 |
| `task_failed` | 4 | 任务失败（生成失败/资产未定稿/闸门拒绝），不是网络问题 |
| `canceled` | 5 | 任务已取消或终态不可取消 |
| `timeout` | 6 | 超时或游标过期；可重试，先看 `error.retryable` |
| `credits` | 7 | 积分不足或超预算；充值或调小批量后重试 |
| `moderation` | 8 | 内容安全拒绝；换素材而不是重试 |
| `version_conflict` | 9 | 版本冲突；重新拉取最新版本再改 |
| `node_locked` | 10 | 节点被锁；等锁释放或换节点 |
| `network` | 1 | 网络或频控问题；退避后重试 |
| `server` | 1 | 服务端错误；先看是否可重试 |
| `unsupported` | 1 | 该命令在我方尚未接入（骨架），不要当失败重试 |
| `internal` | 1 | 未知错误；按一般失败处理，收集 stderr 报障 |

## 后端业务码 → 退出码

| 业务码 | kind | 退出码 |
| --- | --- | --- |
| 400100 | `usage` | 2 |
| 400101 | `usage` | 2 |
| 400102 | `not_found` | 1 |
| 400103 | `canceled` | 1 |
| 400104 | `usage` | 2 |
| 400105 | `task_failed` | 4 |
| 400106 | `task_failed` | 4 |
| 400107 | `usage` | 2 |
| 400108 | `permission` | 1 |
| 401101 | `auth` | 3 |
| 401102 | `auth` | 3 |
| 403101 | `permission` | 1 |
| 429100 | `network` | 1 |
| 429101 | `auth` | 3 |
| 500000 | `server` | 1 |
| 745701 | `credits` | 7 |
| 745702 | `usage` | 2 |
| 745703 | `credits` | 7 |
| 745801 | `moderation` | 8 |
| 745802 | `moderation` | 8 |
| 745900 | `task_failed` | 4 |
| 745901 | `timeout` | 6 |
| 746001 | `internal` | 1 |
| 746002 | `version_conflict` | 9 |
| 746003 | `node_locked` | 10 |
| 746004 | `timeout` | 6 |
| 746005 | `task_failed` | 4 |
| 747007 | `usage` | 2 |

未登记的业务码按 `internal` / 退出码 1 处理，**绝不静默成功**。
