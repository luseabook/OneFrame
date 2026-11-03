#!/usr/bin/env python3
"""产物内容摘要 + 基准（OPS-15）。

摘要算法：按相对路径排序 → 每文件 sha256 → 拼 "path sha\\n" → 整体再 sha256。
**不跳过任何目录**：web 的 `.output/server/node_modules` 是 Nitro 产物的一部分，
当初 500（`Cannot find package 'vue-bundle-renderer'`）就是漏了它。

基准里除四个产物的 {files, sha256} 外，还记录 commit 与生成时间——
生成端只如实记录，**校验端（⑩）负责判红**：有人手工生成错基准也会被拦下。

用法：
  artifact_digest.py <目录>
  artifact_digest.py --json [--commit SHA] [--generated-at ISO] name=dir ...
"""
import hashlib, json, os, sys, time

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
    args = sys.argv[1:]
    if not args:
        print(__doc__); return 1
    if args[0] == "--json":
        commit, gen_at, pairs = None, None, []
        i = 1
        while i < len(args):
            if args[i] == "--commit":
                commit = args[i+1]; i += 2; continue
            if args[i] == "--generated-at":
                gen_at = args[i+1]; i += 2; continue
            pairs.append(args[i]); i += 1
        out = {"commit": commit, "generated_at": gen_at or time.strftime("%Y-%m-%dT%H:%M:%S%z")}
        for pair in pairs:
            name, _, d = pair.partition("=")
            digest, n = tree_digest(d)
            out[name] = {"sha256": digest, "files": n}
        print(json.dumps(out, indent=1, ensure_ascii=False))
        return 0
    digest, n = tree_digest(args[0])
    print(f"{digest}  files={n}  {args[0]}")
    return 0

if __name__ == "__main__":
    sys.exit(main())
