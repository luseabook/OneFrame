import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import { Queue } from "bullmq";
import { env } from "../config/env";

export const QUEUES = {
  GEN_SUBMIT: "gen.submit",
  GEN_POLL: "gen.poll",
  RESULT_TRANSFER: "result.transfer",
  NOTIFY: "notify",
  EXPORT: "export.zip",
} as const;

function connectionOptions(): { host: string; port: number; password?: string } {
  const url = new URL(env.REDIS_URL);
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    ...(url.password ? { password: decodeURIComponent(url.password) } : {}),
  };
}

@Injectable()
export class QueueService implements OnModuleDestroy {
  readonly submitQueue: Queue;
  readonly exportQueue: Queue;

  constructor() {
    this.submitQueue = new Queue(QUEUES.GEN_SUBMIT, { connection: connectionOptions() });
    this.exportQueue = new Queue(QUEUES.EXPORT, { connection: connectionOptions() });
  }

  async enqueueTask(taskId: string): Promise<void> {
    await this.submitQueue.add(
      "submit",
      { taskId },
      {
        // BullMQ 禁止纯数字 custom jobId；加前缀保持幂等且可读
        jobId: `task-${taskId}`,
        attempts: 1,
        removeOnComplete: 1000,
        removeOnFail: 1000,
      },
    );
  }

  async enqueueExport(exportId: string): Promise<void> {
    await this.exportQueue.add(
      "export",
      { exportId },
      {
        jobId: `export-${exportId}`,
        attempts: 1,
        removeOnComplete: 100,
        removeOnFail: 100,
      },
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.submitQueue.close();
    await this.exportQueue.close();
  }
}
