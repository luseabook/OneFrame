// 本文件由 apps/cli/scripts/export-catalog.ts 生成，请勿手改。
// 重新生成：cd app/apps/cli && npx tsx scripts/export-catalog.ts
export const CLI_CATALOG = {
  "generatedFrom": "apps/cli/src/registry.ts",
  "groups": 38,
  "commands": 204,
  "ready": 171,
  "groupList": [
    {
      "group": "login",
      "total": 1,
      "ready": 1,
      "commands": [
        {
          "cmd": "",
          "summary": "登录并保存凭据（手机号验证码 / --token-file / stdin）",
          "ready": true
        }
      ]
    },
    {
      "group": "logout",
      "total": 1,
      "ready": 1,
      "commands": [
        {
          "cmd": "",
          "summary": "注销并删除本地凭据",
          "ready": true
        }
      ]
    },
    {
      "group": "account",
      "total": 2,
      "ready": 2,
      "commands": [
        {
          "cmd": "info",
          "summary": "查看当前账号与空间（不含 token）",
          "ready": true
        },
        {
          "cmd": "use",
          "summary": "切换本地当前账号（不发远端请求）",
          "ready": true
        }
      ]
    },
    {
      "group": "env",
      "total": 1,
      "ready": 1,
      "commands": [
        {
          "cmd": "info",
          "summary": "查看 API/账号/作用域/缓存根（排障用）",
          "ready": true
        }
      ]
    },
    {
      "group": "cache",
      "total": 2,
      "ready": 2,
      "commands": [
        {
          "cmd": "info",
          "summary": "查看本地可重建缓存",
          "ready": true
        },
        {
          "cmd": "clear",
          "summary": "清理缓存范围 --scope models|env|uploads",
          "ready": true
        }
      ]
    },
    {
      "group": "version",
      "total": 2,
      "ready": 2,
      "commands": [
        {
          "cmd": "",
          "summary": "打印本机版本",
          "ready": true
        },
        {
          "cmd": "check",
          "summary": "检查是否有新版本",
          "ready": true
        }
      ]
    },
    {
      "group": "skill",
      "total": 1,
      "ready": 1,
      "commands": [
        {
          "cmd": "path",
          "summary": "打印随包 Skill 目录（给宿主整目录拷贝/替换用）",
          "ready": true
        }
      ]
    },
    {
      "group": "workflow",
      "total": 3,
      "ready": 3,
      "commands": [
        {
          "cmd": "detect",
          "summary": "只读探测当前阶段（服务端 GET /workflow/detect）",
          "ready": true
        },
        {
          "cmd": "status",
          "summary": "同 detect，另附本地上次执行位置",
          "ready": true
        },
        {
          "cmd": "resume",
          "summary": "以 --from 阶段为起点重算待办并记录位置",
          "ready": true
        }
      ]
    },
    {
      "group": "model",
      "total": 4,
      "ready": 3,
      "commands": [
        {
          "cmd": "list",
          "summary": "列出可用模型目录",
          "ready": true
        },
        {
          "cmd": "search",
          "summary": "按关键词筛选模型（客户端过滤展示名/说明）",
          "ready": true
        },
        {
          "cmd": "params",
          "summary": "查看某模型的各生成模式参数规则",
          "ready": true
        },
        {
          "cmd": "price",
          "summary": "查看模型定价",
          "ready": false
        }
      ]
    },
    {
      "group": "task",
      "total": 8,
      "ready": 8,
      "commands": [
        {
          "cmd": "get",
          "summary": "查询任务详情",
          "ready": true
        },
        {
          "cmd": "list",
          "summary": "列出当前空间任务",
          "ready": true
        },
        {
          "cmd": "wait",
          "summary": "阻塞等待任务终态（客户端轮询 GET /tasks/:id）",
          "ready": true
        },
        {
          "cmd": "cancel",
          "summary": "取消任务",
          "ready": true
        },
        {
          "cmd": "retry",
          "summary": "重试失败任务（会重复下单扣费）",
          "ready": true
        },
        {
          "cmd": "download",
          "summary": "把任务产物下载到 ./outputs/<task_id>-<n>.<ext>（不输出签名 URL）",
          "ready": true
        },
        {
          "cmd": "regenerate",
          "summary": "用原任务信息重新提交生成（会再次扣费，先 --dry-run）",
          "ready": true
        },
        {
          "cmd": "delete",
          "summary": "删除任务记录（软删；只有终态可删，运行中请先 task cancel）",
          "ready": true
        }
      ]
    },
    {
      "group": "credits",
      "total": 4,
      "ready": 4,
      "commands": [
        {
          "cmd": "balance",
          "summary": "查询积分余额",
          "ready": true
        },
        {
          "cmd": "flows",
          "summary": "查询积分流水（带符号 points）",
          "ready": true
        },
        {
          "cmd": "estimate",
          "summary": "生成前试算消耗（不扣费）",
          "ready": true
        },
        {
          "cmd": "log",
          "summary": "查询积分流水（竞品旧接口语义：event_type + 无符号 val，由 CLI 从带符号 delta 派生）",
          "ready": true
        }
      ]
    },
    {
      "group": "workspace",
      "total": 7,
      "ready": 7,
      "commands": [
        {
          "cmd": "create",
          "summary": "创建工作区（我方 = 项目）",
          "ready": true
        },
        {
          "cmd": "list",
          "summary": "列出当前空间工作区",
          "ready": true
        },
        {
          "cmd": "info",
          "summary": "工作区详情",
          "ready": true
        },
        {
          "cmd": "edit",
          "summary": "修改工作区名称",
          "ready": true
        },
        {
          "cmd": "delete",
          "summary": "删除工作区（我方为归档）",
          "ready": true
        },
        {
          "cmd": "use",
          "summary": "绑定当前工作区",
          "ready": true
        },
        {
          "cmd": "show",
          "summary": "查看当前绑定",
          "ready": true
        }
      ]
    },
    {
      "group": "episode",
      "total": 15,
      "ready": 13,
      "commands": [
        {
          "cmd": "list",
          "summary": "列出项目剧集与分镜矩阵",
          "ready": true
        },
        {
          "cmd": "create",
          "summary": "新增空集（我方按 count 批量）",
          "ready": true
        },
        {
          "cmd": "get",
          "summary": "剧集详情（含分镜）",
          "ready": true
        },
        {
          "cmd": "edit",
          "summary": "修改剧集",
          "ready": true
        },
        {
          "cmd": "split",
          "summary": "按剧本文本拆集",
          "ready": true
        },
        {
          "cmd": "delete",
          "summary": "删除剧集（连同该集的分镜、时间线、导出与资源引用一起删；不重排集号）",
          "ready": true
        },
        {
          "cmd": "batch-create",
          "summary": "批量建集，逐集给标题/集号（`--set @episodes.json`，items 每项 name/sort/synopsis）",
          "ready": true
        },
        {
          "cmd": "split-list",
          "summary": "查看拆集结果（= 项目剧集矩阵，拆集结果直接落 episodes）",
          "ready": true
        },
        {
          "cmd": "split-delete",
          "summary": "删除拆集结果",
          "ready": false
        },
        {
          "cmd": "prompt-templates",
          "summary": "提示词模板目录",
          "ready": false
        },
        {
          "cmd": "match-resources",
          "summary": "提交资产匹配组合任务（异步，返回 task_id）",
          "ready": true
        },
        {
          "cmd": "save-resource-matches",
          "summary": "保存资产匹配结果",
          "ready": true
        },
        {
          "cmd": "parse",
          "summary": "逐集解析角色/场景/道具（项目级，异步）",
          "ready": true
        },
        {
          "cmd": "parse-retry",
          "summary": "重试解析",
          "ready": true
        },
        {
          "cmd": "parse-result",
          "summary": "查看解析/匹配结果",
          "ready": true
        }
      ]
    },
    {
      "group": "storyboard",
      "total": 18,
      "ready": 9,
      "commands": [
        {
          "cmd": "list",
          "summary": "列出剧集分镜",
          "ready": true
        },
        {
          "cmd": "batch-generate",
          "summary": "AI 拆分镜生成",
          "ready": true
        },
        {
          "cmd": "batch-generate-video",
          "summary": "批量生视频",
          "ready": true
        },
        {
          "cmd": "edit",
          "summary": "修改分镜",
          "ready": true
        },
        {
          "cmd": "match-assets",
          "summary": "绑定分镜资产",
          "ready": true
        },
        {
          "cmd": "add",
          "summary": "新增分镜（追加到末尾；`--set insert_after=<分镜ID>` 或 `--set shot_no=<号>` 可插队）",
          "ready": true
        },
        {
          "cmd": "delete",
          "summary": "删除单条分镜",
          "ready": true
        },
        {
          "cmd": "batch-delete",
          "summary": "批量删除分镜（`--set shot_ids=[id,id]`）",
          "ready": true
        },
        {
          "cmd": "num-update",
          "summary": "重排分镜号（不给 shot_ids 则按现有顺序压实；`--set step=10` 可留空号）",
          "ready": true
        },
        {
          "cmd": "link-draft",
          "summary": "关联草稿",
          "ready": false
        },
        {
          "cmd": "ext",
          "summary": "分镜扩展参数",
          "ready": false
        },
        {
          "cmd": "total-list",
          "summary": "跨集全量分镜",
          "ready": false
        },
        {
          "cmd": "batch-add",
          "summary": "批量新增分镜",
          "ready": false
        },
        {
          "cmd": "prompt-template",
          "summary": "生成官方分镜提示词空表",
          "ready": false
        },
        {
          "cmd": "sheet-read",
          "summary": "回读分镜提示词表",
          "ready": false
        },
        {
          "cmd": "draft-import",
          "summary": "导入分镜草稿",
          "ready": false
        },
        {
          "cmd": "draft-delete",
          "summary": "删除分镜草稿",
          "ready": false
        },
        {
          "cmd": "draft-batch-update",
          "summary": "批量更新分镜草稿",
          "ready": false
        }
      ]
    },
    {
      "group": "upload",
      "total": 1,
      "ready": 1,
      "commands": [
        {
          "cmd": "",
          "summary": "上传并解析剧本文件（txt/md/csv/docx/xlsx）",
          "ready": true
        }
      ]
    },
    {
      "group": "resource",
      "total": 17,
      "ready": 15,
      "commands": [
        {
          "cmd": "list",
          "summary": "列出项目资产（角色/场景/道具）",
          "ready": true
        },
        {
          "cmd": "extract",
          "summary": "创建资产提取任务（异步，返回 et_id）",
          "ready": true
        },
        {
          "cmd": "extract-status",
          "summary": "查询提取任务状态（1 进行中/2 成功/3 失败/4 失效）",
          "ready": true
        },
        {
          "cmd": "extract-redo",
          "summary": "重做失败/失效的提取任务",
          "ready": true
        },
        {
          "cmd": "draft-list",
          "summary": "列出提取草稿",
          "ready": true
        },
        {
          "cmd": "draft-import",
          "summary": "导入/更新提取草稿（返回 eed_id）",
          "ready": true
        },
        {
          "cmd": "generate-list",
          "summary": "查看资产生成候选",
          "ready": true
        },
        {
          "cmd": "get",
          "summary": "查看单个资源（项目资产详情）",
          "ready": true
        },
        {
          "cmd": "add",
          "summary": "新增项目资产（kind=scene|prop|other，角色走 characters）",
          "ready": true
        },
        {
          "cmd": "generate",
          "summary": "生成资产参考图（异步，返回 task_id）",
          "ready": true
        },
        {
          "cmd": "confirm",
          "summary": "确认资产（status=2 定稿）",
          "ready": true
        },
        {
          "cmd": "unconfirm",
          "summary": "取消确认（status=1 退回草稿）",
          "ready": true
        },
        {
          "cmd": "batch-confirm",
          "summary": "批量确认（`--set asset_ids=[id,id]` 定稿；任一 id 不属于本项目则整批失败）",
          "ready": true
        },
        {
          "cmd": "batch-info",
          "summary": "批量查询资产详情（`--set asset_ids=[id,id]`；查不到的进 missing，不整体报错）",
          "ready": true
        },
        {
          "cmd": "extract-wait",
          "summary": "阻塞等待提取任务到终态（客户端轮询 GET /extraction/tasks/:id）",
          "ready": true
        },
        {
          "cmd": "prompt-template",
          "summary": "生成官方资产提示词空表",
          "ready": false
        },
        {
          "cmd": "prompt-sheet-read",
          "summary": "回读资产提示词表",
          "ready": false
        }
      ]
    },
    {
      "group": "subject",
      "total": 10,
      "ready": 7,
      "commands": [
        {
          "cmd": "list",
          "summary": "主体列表",
          "ready": true
        },
        {
          "cmd": "get",
          "summary": "主体详情",
          "ready": true
        },
        {
          "cmd": "create",
          "summary": "创建主体（必填 name）",
          "ready": true
        },
        {
          "cmd": "edit",
          "summary": "修改主体（审核态也走这里）",
          "ready": true
        },
        {
          "cmd": "delete",
          "summary": "删除主体（软删）",
          "ready": true
        },
        {
          "cmd": "status",
          "summary": "批量查询审核状态（三态，未知不默认通过）",
          "ready": true
        },
        {
          "cmd": "save-from-resource",
          "summary": "从项目资产保存为主体（同资产幂等）",
          "ready": true
        },
        {
          "cmd": "batch-details",
          "summary": "批量主体详情",
          "ready": false
        },
        {
          "cmd": "from-resource",
          "summary": "从资源创建主体（含 confirm 流程）",
          "ready": false
        },
        {
          "cmd": "reset",
          "summary": "重置解析/匹配状态",
          "ready": false
        }
      ]
    },
    {
      "group": "asset-lib",
      "total": 12,
      "ready": 9,
      "commands": [
        {
          "cmd": "list",
          "summary": "列出空间资产",
          "ready": true
        },
        {
          "cmd": "dir-list",
          "summary": "列出资产目录",
          "ready": true
        },
        {
          "cmd": "rename",
          "summary": "重命名资产",
          "ready": true
        },
        {
          "cmd": "delete",
          "summary": "删除资产",
          "ready": true
        },
        {
          "cmd": "dir-create",
          "summary": "创建资产目录",
          "ready": true
        },
        {
          "cmd": "get",
          "summary": "查看资产详情（第 88 批补的单个资源端点，与列表同一形状）",
          "ready": true
        },
        {
          "cmd": "import",
          "summary": "从生成任务导入资产（= 素材入库）",
          "ready": true
        },
        {
          "cmd": "search",
          "summary": "搜索资产",
          "ready": false
        },
        {
          "cmd": "resource-list",
          "summary": "asset-lib resource list",
          "ready": false
        },
        {
          "cmd": "tag-add",
          "summary": "设置资产标签（`--set 'tags=[a,b]'`，我方 tags 是整体替换的数组字段）",
          "ready": true
        },
        {
          "cmd": "move",
          "summary": "移动资产到目录（`--set folder_id=null` 表示移出目录）",
          "ready": true
        },
        {
          "cmd": "batch-delete",
          "summary": "批量删除资产",
          "ready": false
        }
      ]
    },
    {
      "group": "file",
      "total": 3,
      "ready": 0,
      "commands": [
        {
          "cmd": "metadata",
          "summary": "查看文件元数据",
          "ready": false
        },
        {
          "cmd": "object",
          "summary": "查看对象",
          "ready": false
        },
        {
          "cmd": "sign-url",
          "summary": "获取文件签名 URL",
          "ready": false
        }
      ]
    },
    {
      "group": "canvas",
      "total": 10,
      "ready": 10,
      "commands": [
        {
          "cmd": "create",
          "summary": "创建画布",
          "ready": true
        },
        {
          "cmd": "list",
          "summary": "列出画布",
          "ready": true
        },
        {
          "cmd": "get",
          "summary": "画布详情（含 node_list）",
          "ready": true
        },
        {
          "cmd": "edit",
          "summary": "修改画布",
          "ready": true
        },
        {
          "cmd": "delete",
          "summary": "删除画布",
          "ready": true
        },
        {
          "cmd": "template-publish",
          "summary": "把画布发布成模板",
          "ready": true
        },
        {
          "cmd": "template-list",
          "summary": "列出模板",
          "ready": true
        },
        {
          "cmd": "template-get",
          "summary": "模板详情",
          "ready": true
        },
        {
          "cmd": "template-apply",
          "summary": "实例化模板到画布",
          "ready": true
        },
        {
          "cmd": "snapshots",
          "summary": "列出画布快照（我方端点，竞品无对应子命令）",
          "ready": true
        }
      ]
    },
    {
      "group": "node",
      "total": 10,
      "ready": 10,
      "commands": [
        {
          "cmd": "create",
          "summary": "创建节点",
          "ready": true
        },
        {
          "cmd": "batch-create",
          "summary": "批量创建节点",
          "ready": true
        },
        {
          "cmd": "list",
          "summary": "列出画布节点",
          "ready": true
        },
        {
          "cmd": "get",
          "summary": "查看单个节点（客户端按 --node/位置参数过滤）",
          "ready": true
        },
        {
          "cmd": "edit",
          "summary": "修改节点",
          "ready": true
        },
        {
          "cmd": "delete",
          "summary": "删除节点",
          "ready": true
        },
        {
          "cmd": "generate",
          "summary": "节点生成（图/视频/文本，付费）",
          "ready": true
        },
        {
          "cmd": "table-import",
          "summary": "表格节点导入文件",
          "ready": true
        },
        {
          "cmd": "table-confirm",
          "summary": "表格节点确认工作表",
          "ready": true
        },
        {
          "cmd": "edge",
          "summary": "建立连线（--left / --right）",
          "ready": true
        }
      ]
    },
    {
      "group": "group",
      "total": 6,
      "ready": 4,
      "commands": [
        {
          "cmd": "create",
          "summary": "创建组",
          "ready": true
        },
        {
          "cmd": "delete",
          "summary": "删除组",
          "ready": true
        },
        {
          "cmd": "template-save",
          "summary": "把组存成模板",
          "ready": true
        },
        {
          "cmd": "template-list",
          "summary": "列出组模板",
          "ready": true
        },
        {
          "cmd": "execute",
          "summary": "组执行（整组跑生成）",
          "ready": false
        },
        {
          "cmd": "template-get",
          "summary": "查看单个组模板",
          "ready": false
        }
      ]
    },
    {
      "group": "pin-group",
      "total": 3,
      "ready": 3,
      "commands": [
        {
          "cmd": "create",
          "summary": "创建/替换固定组成员（按 slot）",
          "ready": true
        },
        {
          "cmd": "delete",
          "summary": "删除固定组",
          "ready": true
        },
        {
          "cmd": "list",
          "summary": "列出固定组（我方端点，竞品无对应子命令）",
          "ready": true
        }
      ]
    },
    {
      "group": "material",
      "total": 6,
      "ready": 3,
      "commands": [
        {
          "cmd": "add",
          "summary": "添加画布素材",
          "ready": true
        },
        {
          "cmd": "list",
          "summary": "列出画布素材",
          "ready": true
        },
        {
          "cmd": "delete",
          "summary": "批量删除素材",
          "ready": true
        },
        {
          "cmd": "batch-add",
          "summary": "批量添加素材",
          "ready": false
        },
        {
          "cmd": "get",
          "summary": "查看素材信息",
          "ready": false
        },
        {
          "cmd": "confirm",
          "summary": "确认素材",
          "ready": false
        }
      ]
    },
    {
      "group": "script",
      "total": 6,
      "ready": 6,
      "commands": [
        {
          "cmd": "storyboard",
          "summary": "从文本节点拆分镜",
          "ready": true
        },
        {
          "cmd": "asset-extract",
          "summary": "从文本节点提取资产",
          "ready": true
        },
        {
          "cmd": "asset-match",
          "summary": "分镜资产匹配",
          "ready": true
        },
        {
          "cmd": "rematch",
          "summary": "重新匹配",
          "ready": true
        },
        {
          "cmd": "cancel",
          "summary": "取消匹配",
          "ready": true
        },
        {
          "cmd": "optimize",
          "summary": "脚本优化",
          "ready": true
        }
      ]
    },
    {
      "group": "export",
      "total": 4,
      "ready": 3,
      "commands": [
        {
          "cmd": "",
          "summary": "导出单集",
          "ready": true
        },
        {
          "cmd": "get",
          "summary": "查看导出任务",
          "ready": true
        },
        {
          "cmd": "merge",
          "summary": "合并导出整集",
          "ready": true
        },
        {
          "cmd": "download",
          "summary": "下载导出产物",
          "ready": false
        }
      ]
    },
    {
      "group": "deeplink",
      "total": 11,
      "ready": 11,
      "commands": [
        {
          "cmd": "canvas",
          "summary": "画布深链",
          "ready": true
        },
        {
          "cmd": "task",
          "summary": "任务中心深链",
          "ready": true
        },
        {
          "cmd": "pricing",
          "summary": "充值弹窗深链",
          "ready": true
        },
        {
          "cmd": "credits",
          "summary": "积分明细入口深链",
          "ready": true
        },
        {
          "cmd": "project",
          "summary": "项目总览深链",
          "ready": true
        },
        {
          "cmd": "episode",
          "summary": "剧集列表/单集分镜深链",
          "ready": true
        },
        {
          "cmd": "asset",
          "summary": "项目资产页深链",
          "ready": true
        },
        {
          "cmd": "asset-confirm",
          "summary": "资产确认页深链",
          "ready": true
        },
        {
          "cmd": "asset-extract",
          "summary": "资产确认页深链（兼容名）",
          "ready": true
        },
        {
          "cmd": "asset-result",
          "summary": "资产主形态结果页深链",
          "ready": true
        },
        {
          "cmd": "asset-lib",
          "summary": "我的资产库深链",
          "ready": true
        }
      ]
    },
    {
      "group": "ledger",
      "total": 3,
      "ready": 3,
      "commands": [
        {
          "cmd": "list",
          "summary": "列出本地幂等账本条目",
          "ready": true
        },
        {
          "cmd": "show",
          "summary": "查看单条账本与成因",
          "ready": true
        },
        {
          "cmd": "resolve",
          "summary": "解除一条 in_doubt（人工复核确认未生效后）",
          "ready": true
        }
      ]
    },
    {
      "group": "team",
      "total": 2,
      "ready": 2,
      "commands": [
        {
          "cmd": "info",
          "summary": "团队信息",
          "ready": true
        },
        {
          "cmd": "permission",
          "summary": "当前成员权限上下文",
          "ready": true
        }
      ]
    },
    {
      "group": "agent",
      "total": 6,
      "ready": 6,
      "commands": [
        {
          "cmd": "session-create",
          "summary": "创建智能体会话",
          "ready": true
        },
        {
          "cmd": "session-list",
          "summary": "列出智能体会话",
          "ready": true
        },
        {
          "cmd": "session-delete",
          "summary": "删除智能体会话",
          "ready": true
        },
        {
          "cmd": "enter",
          "summary": "进入交互式会话（REPL：逐行发送并实时消费 SSE 事件）",
          "ready": true
        },
        {
          "cmd": "run",
          "summary": "跑一轮对话（--set content=\"…\"；加 --follow 消费 SSE 到本轮有结论）",
          "ready": true
        },
        {
          "cmd": "exit",
          "summary": "结束会话（服务端把 status 置 2，之后发言会被拒）",
          "ready": true
        }
      ]
    },
    {
      "group": "novel",
      "total": 6,
      "ready": 5,
      "commands": [
        {
          "cmd": "config",
          "summary": "小说改写配置",
          "ready": false
        },
        {
          "cmd": "create",
          "summary": "创建小说改写任务（--set title=… / source_text=…）",
          "ready": true
        },
        {
          "cmd": "analyze",
          "summary": "触发内容分析（世界/角色/章节）",
          "ready": true
        },
        {
          "cmd": "list",
          "summary": "小说任务列表",
          "ready": true
        },
        {
          "cmd": "get",
          "summary": "小说任务详情",
          "ready": true
        },
        {
          "cmd": "finalize",
          "summary": "小说定稿（定稿后才能作为制片工坊拆集源）",
          "ready": true
        }
      ]
    },
    {
      "group": "market",
      "total": 3,
      "ready": 3,
      "commands": [
        {
          "cmd": "list",
          "summary": "市场剧本列表",
          "ready": true
        },
        {
          "cmd": "get",
          "summary": "市场剧本详情",
          "ready": true
        },
        {
          "cmd": "mine",
          "summary": "我的上架作品",
          "ready": true
        }
      ]
    },
    {
      "group": "ad",
      "total": 8,
      "ready": 8,
      "commands": [
        {
          "cmd": "info",
          "summary": "广告项目详情 + 五段进度（--workspace 提供项目 ID）",
          "ready": true
        },
        {
          "cmd": "save",
          "summary": "新建/更新广告项目（--set material_name=… material_highlight=… material_image=… style=… ratio=9:16）",
          "ready": true
        },
        {
          "cmd": "selling-point",
          "summary": "生成商品卖点（`--set count=1..8` 可选）",
          "ready": true
        },
        {
          "cmd": "plot",
          "summary": "生成剧情方案候选（`--set count=1..5` 可选）",
          "ready": true
        },
        {
          "cmd": "script",
          "summary": "按选中方案生成广告脚本（`--set brief_id=`）",
          "ready": true
        },
        {
          "cmd": "asset",
          "summary": "抽取广告资产（`--set need_voice=1|2`）",
          "ready": true
        },
        {
          "cmd": "plan",
          "summary": "生成分镜规划（`--set template_type=1|2`）",
          "ready": true
        },
        {
          "cmd": "reset",
          "summary": "重置脚本，回到剧情方案选择",
          "ready": true
        }
      ]
    },
    {
      "group": "redraw",
      "total": 2,
      "ready": 2,
      "commands": [
        {
          "cmd": "info",
          "summary": "转绘项目四段进度（`video_redraw_stage` / `video_redraw_stage_status`）",
          "ready": true
        },
        {
          "cmd": "create",
          "summary": "创建转绘项目（--set title=… source_uri=… 可选 redraw_strength=0..100 / style=anime|ghibli|ink|comic|cyberpunk）",
          "ready": true
        }
      ]
    },
    {
      "group": "ai",
      "total": 2,
      "ready": 2,
      "commands": [
        {
          "cmd": "upscale",
          "summary": "AI 放大（工具箱 video_upscale：1080p/2K/4K 按档计费）",
          "ready": true
        },
        {
          "cmd": "subtitle-erase",
          "summary": "去字幕（默认自动检测；框选区域用 `--set mode=de_subtitle_region --set model=toolbox-de-subtitle-region`）",
          "ready": true
        }
      ]
    },
    {
      "group": "clip",
      "total": 2,
      "ready": 0,
      "commands": [
        {
          "cmd": "create",
          "summary": "创建剪辑",
          "ready": false
        },
        {
          "cmd": "crop",
          "summary": "裁剪",
          "ready": false
        }
      ]
    },
    {
      "group": "voice",
      "total": 1,
      "ready": 1,
      "commands": [
        {
          "cmd": "list",
          "summary": "音色列表（模型目录里 capability=speech 的条目；竞品 voice/list 归此）",
          "ready": true
        }
      ]
    },
    {
      "group": "sync-fm",
      "total": 1,
      "ready": 0,
      "commands": [
        {
          "cmd": "",
          "summary": "同步到 Filmora",
          "ready": false
        }
      ]
    }
  ]
} as const;
