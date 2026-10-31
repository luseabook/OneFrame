# 运营后台待合并文案（pending-admin）

每个 owner 只写自己名字的 JSON（例如 `prices.json`），**不要直接改 `../locales/*.json`**。

格式：namespace → key → `[中文, English]`，最多两层；合并后 zh-CN 用中文、其余语言用英文。

```json
{
  "adminPrices": {
    "title": ["价格管理", "Pricing"],
    "colModel": ["模型", "Model"]
  }
}
```

合并：`node _acceptance/merge-admin-i18n.cjs`（只校验：`--check`）。
合并后跑：`node _acceptance/i18n-check.cjs`。
