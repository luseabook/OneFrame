import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LocalStorage } from "./local";

let dir = "";
let storage: LocalStorage;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "app-storage-"));
  storage = new LocalStorage({
    rootDir: dir,
    publicBaseUrl: "http://127.0.0.1:3000/v1",
    signSecret: "test-secret",
  });
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("LocalStorage", () => {
  it("puts/reads bytes and returns an internal key", async () => {
    const stored = await storage.put("u/1/tasks/2/r0.mp4", Buffer.from("hello"), "video/mp4");
    expect(stored.key).toBe("u/1/tasks/2/r0.mp4");
    expect((await storage.read(stored.key)).toString()).toBe("hello");
  });

  it("signs download URLs and verifies signature + expiry", async () => {
    const url = new URL(await storage.signDownload("u/1/r0.mp4", 60));
    expect(url.pathname).toBe("/v1/files/local");
    const key = url.searchParams.get("key")!;
    const expires = Number(url.searchParams.get("expires"));
    const sig = url.searchParams.get("sig")!;
    expect(storage.verify(key, expires, sig)).toBe(true);
    expect(storage.verify(key, expires, "bad")).toBe(false);
    expect(storage.verify(key, Math.floor(Date.now() / 1000) - 1, sig)).toBe(false);
  });

  it("rejects traversal keys", async () => {
    await expect(storage.put("../escape", Buffer.from("x"), "text/plain")).rejects.toThrow(/invalid storage key/);
  });
});
