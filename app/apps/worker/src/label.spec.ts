import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LocalStorage } from "@app/storage";
import { labelResults } from "./label";

let dir = "";
let storage: LocalStorage;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "ai-label-"));
  storage = new LocalStorage({
    rootDir: dir,
    publicBaseUrl: "http://127.0.0.1:3000/v1",
    signSecret: "test-secret",
  });
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("labelResults", () => {
  it("writes implicit sidecar and degrades explicit when ffmpeg is unavailable", async () => {
    await storage.put("u/1/tasks/2/r0.mp4", Buffer.from("not-a-real-video"), "video/mp4");
    const results = await labelResults(
      storage,
      { id: "2", capability: "video" },
      [{ uri: "u/1/tasks/2/r0.mp4" }],
      { enabled: true, text: "AI生成", ffmpegPath: "false" },
    );
    const label = results[0]?.meta?.ai_label as {
      implicit: boolean;
      explicit: boolean;
      explicit_reason?: string;
    };
    expect(label.implicit).toBe(true);
    expect(label.explicit).toBe(false);
    expect(label.explicit_reason).toBeTruthy();
    const sidecar = (await storage.read("u/1/tasks/2/r0.mp4.ai.json")).toString();
    expect(JSON.parse(sidecar).ai_generated).toBe(true);
  });

  it("skips labeling when disabled", async () => {
    const results = await labelResults(
      storage,
      { id: "3", capability: "image" },
      [{ uri: "u/1/tasks/3/r0.png" }],
      { enabled: false, text: "AI生成" },
    );
    expect((results[0]?.meta?.ai_label as { enabled: boolean }).enabled).toBe(false);
  });
});
