#!/usr/bin/env node
/**
 * 账本对账与修复脚本（ledger repair）
 *
 * 不变式（database.md §4 / PRD F6）：
 *   credit_accounts.balance == Σ credit_flows.delta
 *   credit_accounts.frozen  == Σ credit_flows.frozen_delta
 *
 * 用法：
 *   node _acceptance/ledger-repair.cjs                 # 默认 dry-run：只扫描并打印不一致清单
 *   node _acceptance/ledger-repair.cjs --dry-run       # 同上（显式）
 *   node _acceptance/ledger-repair.cjs --fix           # 按流水重算账户，并写 kind=adjust 对账流水
 *   node _acceptance/ledger-repair.cjs --fix --space 107517947000438785,107584284706127873
 *   node _acceptance/ledger-repair.cjs --json          # 机器可读输出
 *
 * 修复口径（只追加 adjust 流水，绝不修改/删除历史流水）：
 *   1) frozen 流水汇总 F < 0 → 说明历史上出现过「凭空解冻/重复解冻」：
 *      target_frozen = 0，target_balance = max(0, Σdelta + F)（把多发的余额一起扣回）；
 *   2) 否则以流水为准：target_balance = max(0, Σdelta)，target_frozen = F；
 *   3) Δdelta = target_balance - Σdelta，Δfrozen = target_frozen - Σfrozen，
 *      写入一条 kind=adjust、memo 含 repair 明细的流水，账户置为 target_*；
 *      修复后两条不变式必然成立（除非余额为负被 CHECK 拦截，脚本会报错并跳过）。
 *
 * 环境变量：DATABASE_URL（默认 postgres://app@127.0.0.1:55432/app）
 * 依赖：pg（复用 app/apps/api 的依赖，不新增包）
 */
const path = require("node:path");
const { randomInt } = require("node:crypto");

/** 对账流水 id：时间戳 + 随机段，避免与 snowflake/newId 及并发维护写冲突 */
function nextFlowId() {
  return BigInt(Date.now()) * 1_000_000n + BigInt(randomInt(0, 1_000_000));
}

function loadPg() {
  try {
    return require("pg");
  } catch {
    /* 从仓库根执行时解析不到，回退到 api 包依赖 */
  }
  const apiDir = path.join(__dirname, "..", "app", "apps", "api");
  const resolved = require.resolve("pg", { paths: [apiDir, path.join(__dirname, "..", "app")] });
  return require(resolved);
}

const { Client } = loadPg();

const DATABASE_URL = process.env.DATABASE_URL || "postgres://app@127.0.0.1:55432/app";

function parseArgs(argv) {
  const opts = { fix: false, json: false, spaceIds: null, limit: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--fix") opts.fix = true;
    else if (arg === "--dry-run") opts.fix = false;
    else if (arg === "--json") opts.json = true;
    else if (arg === "--space") {
      const value = argv[i + 1];
      if (!value) throw new Error("--space requires a comma-separated space id list");
      opts.spaceIds = value
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      i += 1;
    } else if (arg === "--limit") {
      const value = Number(argv[i + 1]);
      if (!Number.isInteger(value) || value <= 0) throw new Error("--limit requires a positive integer");
      opts.limit = value;
      i += 1;
    } else if (arg === "--help" || arg === "-h") {
      opts.help = true;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return opts;
}

async function scanMismatches(client, opts) {
  const params = [];
  let where = "";
  if (opts.spaceIds && opts.spaceIds.length > 0) {
    params.push(opts.spaceIds);
    where = `where a.space_id = any($1::bigint[])`;
  }
  const limit = opts.limit ? `limit ${Number(opts.limit)}` : "";
  const { rows } = await client.query(
    `select a.space_id,
            a.balance,
            a.frozen,
            coalesce(sum(f.delta), 0)::int as sum_delta,
            coalesce(sum(f.frozen_delta), 0)::int as sum_frozen
       from credit_accounts a
       left join credit_flows f on f.space_id = a.space_id
       ${where}
      group by a.space_id, a.balance, a.frozen
     having a.balance <> coalesce(sum(f.delta), 0)
         or a.frozen <> coalesce(sum(f.frozen_delta), 0)
      order by a.space_id
      ${limit}`,
    params,
  );
  return rows.map((row) => ({
    space_id: String(row.space_id),
    balance: Number(row.balance),
    frozen: Number(row.frozen),
    sum_delta: Number(row.sum_delta),
    sum_frozen: Number(row.sum_frozen),
    balance_diff: Number(row.balance) - Number(row.sum_delta),
    frozen_diff: Number(row.frozen) - Number(row.sum_frozen),
  }));
}

async function scanFlowsWithoutAccount(client) {
  const { rows } = await client.query(
    `select f.space_id, count(*)::int as flows, coalesce(sum(f.delta),0)::int as sum_delta,
            coalesce(sum(f.frozen_delta),0)::int as sum_frozen
       from credit_flows f
       left join credit_accounts a on a.space_id = f.space_id
      where a.space_id is null
      group by f.space_id
      order by f.space_id`,
  );
  return rows.map((row) => ({
    space_id: String(row.space_id),
    flows: Number(row.flows),
    sum_delta: Number(row.sum_delta),
    sum_frozen: Number(row.sum_frozen),
  }));
}

/** 计算修复目标值（纯函数，便于单测/推演） */
function computeRepair(row) {
  const { balance, frozen, sum_delta, sum_frozen } = row;
  const negativeFrozen = sum_frozen < 0;
  // 以流水为准重算账户；frozen 汇总为负（凭空/重复解冻）时把多发的余额一并扣回
  const targetBalance = negativeFrozen
    ? Math.max(0, sum_delta + sum_frozen)
    : Math.max(0, sum_delta);
  const targetFrozen = negativeFrozen ? 0 : sum_frozen;
  return {
    targetBalance,
    targetFrozen,
    // Δ 用于 adjust 流水：使 修复后 Σdelta == targetBalance（audit 留痕；纯账户重置时可为 0）
    adjustDelta: targetBalance - sum_delta,
    adjustFrozen: targetFrozen - sum_frozen,
    currentBalance: balance,
    currentFrozen: frozen,
    needsAccountUpdate: balance !== targetBalance || frozen !== targetFrozen,
    reason: negativeFrozen ? "negative_frozen_sum (phantom/double unfreeze)" : "flows_are_source_of_truth",
  };
}

async function repairOne(client, row) {
  const plan = computeRepair(row);
  if (!plan.needsAccountUpdate && plan.adjustDelta === 0 && plan.adjustFrozen === 0) {
    return { skipped: true, reason: "no adjustment needed", plan };
  }
  try {
    await client.query("begin");
    // 锁账户并基于最新流水重算，避免与并发维护重复修复
    const locked = await client.query(
      `select balance, frozen from credit_accounts where space_id = $1 for update`,
      [row.space_id],
    );
    if (locked.rows.length === 0) {
      await client.query("rollback");
      return { skipped: true, reason: "account vanished", plan };
    }
    const sums = await client.query(
      `select coalesce(sum(delta),0)::int as s, coalesce(sum(frozen_delta),0)::int as f
         from credit_flows where space_id = $1`,
      [row.space_id],
    );
    const fresh = {
      space_id: row.space_id,
      balance: Number(locked.rows[0].balance),
      frozen: Number(locked.rows[0].frozen),
      sum_delta: Number(sums.rows[0].s),
      sum_frozen: Number(sums.rows[0].f),
    };
    const freshPlan = computeRepair(fresh);
    if (!freshPlan.needsAccountUpdate && freshPlan.adjustDelta === 0 && freshPlan.adjustFrozen === 0) {
      await client.query("rollback");
      return { skipped: true, reason: "already consistent (concurrent repair)", plan: freshPlan };
    }
    // 账户列有 CHECK >= 0；目标值理论不会为负，双保险
    const targetBalance = Math.max(0, freshPlan.targetBalance);
    const targetFrozen = Math.max(0, freshPlan.targetFrozen);
    await client.query(
      `update credit_accounts set balance = $2, frozen = $3, updated_at = now() where space_id = $1`,
      [row.space_id, targetBalance, targetFrozen],
    );
    await client.query(
      `insert into credit_flows (id, space_id, delta, frozen_delta, kind, balance_after, memo, created_at)
       values ($1, $2, $3, $4, 'adjust', $5, $6, now())`,
      [
        nextFlowId().toString(),
        row.space_id,
        freshPlan.adjustDelta,
        freshPlan.adjustFrozen,
        targetBalance,
        `ledger repair: account ${fresh.balance}/${fresh.frozen} -> ${targetBalance}/${targetFrozen}, ` +
          `flows sum delta=${fresh.sum_delta} frozen=${fresh.sum_frozen} (${freshPlan.reason})`,
      ],
    );
    await client.query("commit");
    return { skipped: false, plan: freshPlan, applied: { targetBalance, targetFrozen } };
  } catch (err) {
    try {
      await client.query("rollback");
    } catch {
      /* ignore */
    }
    throw err;
  }
}

function fmt(n) {
  return String(n).padStart(7, " ");
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(
      "usage: node _acceptance/ledger-repair.cjs [--dry-run|--fix] [--space id1,id2] [--limit N] [--json]",
    );
    return 0;
  }

  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    const mismatches = await scanMismatches(client, opts);
    const orphanFlows = await scanFlowsWithoutAccount(client);

    if (opts.json) {
      console.log(JSON.stringify({ dry_run: !opts.fix, mismatches, orphan_flows: orphanFlows }, null, 2));
    } else {
      console.log(`\n=== 账本对账（${opts.fix ? "FIX 模式" : "DRY-RUN（不写库）"}）===`);
      console.log(`DB: ${DATABASE_URL.replace(/:\/\/([^:]+):[^@]*@/, "://$1:***@")}`);
      console.log(
        [
          "space_id".padEnd(20),
          "bal".padStart(7),
          "Σdelta".padStart(8),
          "Δbal".padStart(8),
          "frozen".padStart(7),
          "Σfrozen".padStart(8),
          "Δfrozen".padStart(8),
          " action",
        ].join(""),
      );
      for (const row of mismatches) {
        const plan = computeRepair(row);
        console.log(
          [
            row.space_id.padEnd(20),
            fmt(row.balance),
            fmt(row.sum_delta),
            fmt(plan.adjustDelta),
            fmt(row.frozen),
            fmt(row.sum_frozen),
            fmt(plan.adjustFrozen),
            ` ${opts.fix ? "fix" : "dry-run"} (${plan.reason})`,
          ].join(""),
        );
      }
      console.log(
        `\n不一致 space：${mismatches.length}` +
          (orphanFlows.length ? `；有流水无账户的 space：${orphanFlows.length}（需人工建账户/追查）` : ""),
      );
      if (orphanFlows.length) {
        for (const o of orphanFlows) {
          console.log(
            `  orphan space ${o.space_id}: flows=${o.flows} Σdelta=${o.sum_delta} Σfrozen=${o.sum_frozen}`,
          );
        }
      }
    }

    if (!opts.fix) {
      if (!opts.json) {
        console.log(
          mismatches.length
            ? "\nDRY-RUN 结束：未写库。确认清单后执行 --fix（只追加 kind=adjust 对账流水，不改历史流水）。"
            : "\nDRY-RUN 结束：账本一致，无需修复。",
        );
      }
      return 0;
    }

    let repaired = 0;
    let skipped = 0;
    let failed = 0;
    for (const row of mismatches) {
      try {
        const result = await repairOne(client, row);
        if (result.skipped) {
          skipped += 1;
          if (!opts.json) console.log(`SKIP ${row.space_id}: ${result.reason}`);
        } else {
          repaired += 1;
          if (!opts.json) {
            console.log(
              `FIX  ${row.space_id}: account ${result.plan.currentBalance}/${result.plan.currentFrozen} -> ` +
                `${result.applied.targetBalance}/${result.applied.targetFrozen} ` +
                `(adjust delta=${result.plan.adjustDelta}, frozen_delta=${result.plan.adjustFrozen})`,
            );
          }
        }
      } catch (err) {
        failed += 1;
        console.error(`FAIL ${row.space_id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    const remaining = await scanMismatches(client, { spaceIds: opts.spaceIds, limit: null });
    if (!opts.json) {
      console.log(`\n修复完成：repaired=${repaired} skipped=${skipped} failed=${failed}`);
      console.log(`修复后仍未一致的 space：${remaining.length}`);
      for (const row of remaining) {
        console.log(
          `  space ${row.space_id}: balance=${row.balance} Σdelta=${row.sum_delta} ` +
            `frozen=${row.frozen} Σfrozen=${row.sum_frozen}`,
        );
      }
    }
    return failed > 0 || remaining.length > 0 ? 1 : 0;
  } finally {
    await client.end();
  }
}

if (require.main === module) {
  main()
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error("ledger-repair failed:", err instanceof Error ? err.stack || err.message : err);
      process.exit(1);
    });
} else {
  module.exports = { computeRepair, parseArgs };
}
