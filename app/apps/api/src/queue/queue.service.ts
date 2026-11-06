import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import { Queue } from "bullmq";
import { redisConnectionOptions } from "@app/shared";
import { env } from "../config/env";

export const QUEUES = {
  GEN_SUBMIT: "gen.submit",
  GEN_POLL: "gen.poll",
  RESULT_TRANSFER: "result.transfer",
  NOTIFY: "notify",
  EXPORT: "export.zip",
  TIMELINE_EXPORT: "timeline.export",
  PUBLISH_TRANSCODE: "publish.transcode",
} as const;

function connectionOptions() {
  // 统一解析（shared）：TLS / ACL 用户名 / db 序号都不再被丢掉
  return redisConnectionOptions(env.REDIS_URL);
}

@Injectable()
export class QueueService implements OnModuleDestroy {
  readonly submitQueue: Queue;
  readonly exportQueue: Queue;
  readonly timelineExportQueue: Queue;
  readonly publishTranscodeQueue: Queue;

  constructor() {
    this.submitQueue = new Queue(QUEUES.GEN_SUBMIT, { connection: connectionOptions() });
    this.exportQueue = new Queue(QUEUES.EXPORT, { connection: connectionOptions() });
    this.timelineExportQueue = new Queue(QUEUES.TIMELINE_EXPORT, { connection: connectionOptions() });
    this.publishTranscodeQueue = new Queue(QUEUES.PUBLISH_TRANSCODE, { connection: connectionOptions() });
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
        // 同一导出可重试：jobId 带时间戳，避免被已完成的同名 job 去重
        jobId: `export-${exportId}-${Date.now()}`,
        attempts: 1,
        removeOnComplete: 100,
        removeOnFail: 100,
      },
    );
  }

  async enqueueTimelineExport(exportId: string): Promise<void> {
    await this.timelineExportQueue.add(
      "timeline-export",
      { exportId },
      {
        jobId: `timeline-export-${exportId}-${Date.now()}`,
        attempts: 1,
        removeOnComplete: 100,
        removeOnFail: 100,
      },
    );
  }

  /**
   * 切片发布转码任务（第 57 批）：publicationId 即可幂等去重——同一个发布重投不会把已发布
   * 的作品打回转码中（状态机在 `@app/shared runPublishTranscode` 里先查终态）。
   */
  async enqueuePublishTranscode(payload: {
    publicationId: string;
    spaceId: string;
    sourceKey: string;
  }): Promise<void> {
    await this.publishTranscodeQueue.add("transcode", payload, {
      jobId: `publish-transcode-${payload.publicationId}`,
      attempts: 1,
      removeOnComplete: 200,
      removeOnFail: 200,
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.submitQueue.close();
    await this.exportQueue.close();
    await this.timelineExportQueue.close();
    await this.publishTranscodeQueue.close();
  }
}
