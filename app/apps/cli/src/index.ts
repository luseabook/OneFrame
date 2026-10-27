#!/usr/bin/env node
import { run } from "./cli";
import { EXIT } from "./exit-codes";

/**
 * 可执行入口。只做三件事：取 argv、跑 run、把退出码交给 shell。
 * 所有业务逻辑都在 cli.ts（便于单测），这里保持薄。
 */

// Ctrl-C 按「取消」处理，退出码 5（manual/error-codes.md:19）
process.on("SIGINT", () => {
  process.stderr.write("\n[canceled] 收到中断信号，按取消处理（退出码 5）\n");
  process.exit(EXIT.CANCELED);
});

const argv = process.argv.slice(2);
void run(argv)
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    process.stderr.write(`[fatal] ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = EXIT.FAILURE;
  });
