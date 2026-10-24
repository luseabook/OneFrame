import { describe, expect, it } from "vitest";
import { S3Storage } from "./s3";

const storage = new S3Storage({
  bucket: "app-results",
  region: "cn-hangzhou",
  accessKeyId: "test-ak",
  secretAccessKey: "test-sk",
  endpoint: "http://127.0.0.1:9000",
  forcePathStyle: true,
});

describe("S3Storage signing", () => {
  it("returns a presigned GET URL for an object key", async () => {
    const url = new URL(await storage.signDownload("u/1/tasks/2/r0.mp4", 3600));
    expect(url.pathname).toBe("/app-results/u/1/tasks/2/r0.mp4");
    expect(url.searchParams.get("X-Amz-Algorithm")).toBe("AWS4-HMAC-SHA256");
    expect(url.searchParams.get("X-Amz-Signature")).toMatch(/^[a-f0-9]{64}$/);
    expect(Number(url.searchParams.get("X-Amz-Expires"))).toBe(3600);
  });

  it("uses path-style endpoint when configured (MinIO/OSS compatible)", async () => {
    const url = await storage.signDownload("u/1/file.png", 60);
    expect(url.startsWith("http://127.0.0.1:9000/app-results/")).toBe(true);
  });
});
