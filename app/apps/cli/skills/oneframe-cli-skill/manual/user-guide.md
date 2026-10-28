# OneFrame CLI 使用指南

版本 0.1.0，共 38 个命令组、197 条命令（可用 140 条）。

## 一次典型流程

```text
oneframe login                      # 手机号验证码登录（可 --token-file / stdin）
oneframe workspace create --set name=我的项目
oneframe workspace use <PROJECT_ID>
oneframe upload <剧本文件>
oneframe episode list --workspace <PROJECT_ID>
oneframe storyboard batch-generate <EPISODE_ID> --workspace <PROJECT_ID>
oneframe task wait <TASK_ID>
```

## 三条硬规则

1. **stdout 只读业务数据**：成功是 `{ok:true,data,links}`，失败是 `{ok:false,error}`；
   进度与人类可读摘要一律写 stderr。脚本请一律加 `--json`。
2. **付费写操作先 `--dry-run`**：dry-run 不发任何请求，只打印将发送的方法/路径/体。
3. **写操作可带 `--idempotency-key`**：同键重放会短路返回上次结果，不会重复扣费。

## 想看某条命令

```text
oneframe --help
oneframe <group> --help
oneframe <group> <cmd> --help
```

骨架命令（执行会返回 `kind=unsupported` 并说明缺什么）不是「暂时没跑通」，
它们对应的后端端点我方还没有，**不要重试**。
