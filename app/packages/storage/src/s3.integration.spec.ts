import { CreateBucketCommand, DeleteBucketCommand, DeleteObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { S3Storage } from "./s3";

const endpoint = process.env.S3_TEST_ENDPOINT;
const accessKeyId = process.env.S3_TEST_ACCESS_KEY_ID ?? "minioadmin";
const secretAccessKey = process.env.S3_TEST_SECRET_ACCESS_KEY ?? "minioadmin";
const bucket = `app-test-${Date.now()}`;

// 需要 MinIO/S3 的集成测试；未配置 S3_TEST_ENDPOINT 时跳过（普通单测仍覆盖预签名）
describe.skipIf(!endpoint)("S3Storage against MinIO", () => {
  let client: S3Client;
  let storage: S3Storage;

  beforeAll(async () => {
    client = new S3Client({
      region: "us-east-1",
      endpoint,
      forcePathStyle: true,
      credentials: { accessKeyId, secretAccessKey },
    });
    await client.send(new CreateBucketCommand({ Bucket: bucket }));
    storage = new S3Storage({
      bucket,
      region: "us-east-1",
      accessKeyId,
      secretAccessKey,
      endpoint,
      forcePathStyle: true,
    });
  });

  afterAll(async () => {
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: "u/1/tasks/2/r0.mp4" })).catch(() => undefined);
    await client.send(new DeleteBucketCommand({ Bucket: bucket })).catch(() => undefined);
  });

  it("puts, reads and presigns an object", async () => {
    const payload = Buffer.from("s3-integration-payload");
    await storage.put("u/1/tasks/2/r0.mp4", payload, "video/mp4");
    const read = await storage.read("u/1/tasks/2/r0.mp4");
    expect(read.toString()).toBe("s3-integration-payload");

    const signed = await storage.signDownload("u/1/tasks/2/r0.mp4", 60);
    const res = await fetch(signed);
    expect(res.status).toBe(200);
    expect(Buffer.from(await res.arrayBuffer()).toString()).toBe("s3-integration-payload");
  });
});
