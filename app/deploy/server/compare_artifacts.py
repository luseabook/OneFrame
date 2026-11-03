#!/usr/bin/env python3
"""四个产物 sha256 双向核对 + 基准来源校验（OPS-15）。

两道判据：
  ① 内容：每个产物重算摘要 == 基准里的 {sha256, files}
  ② 来源：基准里的 commit 必须与部署时写入的 .deploy-commit 一致，且 generated_at 存在。
          缺任何一项都判红——这一条防的是「旧基准比对旧产物 → 全绿」，
          以及「有人手工生成一个错基准」。

为什么不在生成端校验：生成端只如实记录；判红放在校验端，手工生成的错基准才会被拦。

用法：
  compare_artifacts.py <baseline.json> [--deploy-commit-file PATH] name=dir ...
退出码：0 全一致；1 有不一致/缺项/来源不符。
"""
import hashlib, json, os, sys

def tree_digest(root):
    h = hashlib.sha256()
    entries = []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames.sort()
        for fn in filenames:
            full = os.path.join(dirpath, fn)
            rel = os.path.relpath(full, root).replace(os.sep, "/")
            entries.append((rel, full))
    entries.sort()
    for rel, full in entries:
        with open(full, "rb") as f:
            fh = hashlib.sha256(f.read()).hexdigest()
        h.update(f"{rel} {fh}\n".encode())
    return h.hexdigest(), len(entries)

def main():
    argv = sys.argv[1:]
    if not argv:
        print(__doc__); return 2
    baseline_path, commit_file, pairs = None, "/srv/oneframe/app/.deploy-commit", []
    i = 0
    while i < len(argv):
        if argv[i] == "--deploy-commit-file":
            commit_file = argv[i + 1]; i += 2; continue
        if baseline_path is None:
            baseline_path = argv[i]
        else:
            pairs.append(argv[i])
        i += 1

    ok = True
    try:
        base = json.load(open(baseline_path, encoding="utf-8"))
    except Exception as e:
        print(f"  [FAIL] 基准不可读：{baseline_path} ({e})")
        return 1

    if not base.get("commit"):
        print("  [FAIL] 基准未记录 commit：无法证明它对应本次构建（可能被手工生成）")
        ok = False
    elif not base.get("generated_at"):
        print("  [FAIL] 基准未记录 generated_at")
        ok = False
    elif not os.path.isfile(commit_file):
        print(f"  [FAIL] 缺部署时的 commit 记录 {commit_file}：基准来源不明")
        ok = False
    else:
        deployed = open(commit_file, encoding="utf-8").read().strip()
        if deployed != base["commit"]:
            print(f"  [FAIL] 基准 commit={base['commit']} 与部署 commit={deployed} 不一致（基准过期）")
            ok = False
        else:
            print(f"  [PASS] 基准来源可信：commit={base['commit']} generated_at={base['generated_at']}")

    for pair in pairs:
        name, _, d = pair.partition("=")
        if not os.path.isdir(d):
            print(f"  [FAIL] {name}: 目录不存在 {d}"); ok = False; continue
        digest, n = tree_digest(d)
        b = base.get(name)
        if not b:
            print(f"  [FAIL] {name}: 基准里没有这一项"); ok = False; continue
        same = b["sha256"] == digest
        extra = "" if same else f"（基准 {b['sha256'][:16]}… files={b['files']}）"
        print(f"  [{'PASS' if same else 'FAIL'}] {name}: {digest[:16]}… files={n}{extra}")
        ok &= same

    print("  ALL_MATCH" if ok else "  MISMATCH")
    return 0 if ok else 1

if __name__ == "__main__":
    sys.exit(main())
