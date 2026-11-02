import { describe, expect, it } from "vitest";
import { buildProviderAdapterOptions, type ProviderRouteSnapshot } from "./provider-runtime";

function snapshot(protocol: string, remoteModelId = "remote-model"): ProviderRouteSnapshot {
  return {
    route_id: "1",
    provider_id: "2",
    protocol,
    base_url: "https://provider.example.com",
    remote_model_id: remoteModelId,
    auth_type: "bearer",
    auth_header: "Authorization",
    provider_options: {},
    route_options: {},
  };
}

describe("worker provider runtime options", () => {
  it("maps OpenAI-compatible text to the existing DeepSeek adapter without changing adapter code", () => {
    const options = buildProviderAdapterOptions(
      { mode: "real" },
      snapshot("openai-compatible", "chat-prod"),
      "sk-secret",
      { name: "local-chat", capability: "text", adapterCode: "deepseek:chat" },
    );
    expect(options.mode).toBe("real");
    expect(options.deepseek).toMatchObject({
      apiKey: "sk-secret",
      baseUrl: "https://provider.example.com",
      model: "chat-prod",
    });
  });

  it("maps Ark image and video through the existing Ark adapters", () => {
    const image = buildProviderAdapterOptions({ mode: "real" }, snapshot("ark", "ep-image"), "ark-key", {
      name: "local-image",
      capability: "image",
      adapterCode: "volcengine:image",
    });
    expect(image.arkImage?.apiKey).toBe("ark-key");
    expect(image.arkImage?.modelMap).toEqual({ "local-image": "ep-image" });

    const video = buildProviderAdapterOptions({ mode: "real" }, snapshot("ark", "ep-video"), "ark-key", {
      name: "local-video",
      capability: "video",
      adapterCode: "volcengine:video",
    });
    expect(video.ark?.modelMap).toEqual({ "local-video": "ep-video" });
  });

  it("passes route-level HTTP paths and timeout without putting the key in the snapshot", () => {
    const route = snapshot("http-video", "vendor-video");
    route.route_options = { submit_path: "/submit", poll_path: "/poll/{id}", timeout_ms: 1234 };
    const options = buildProviderAdapterOptions({ mode: "real" }, route, "http-key", {
      name: "local-video",
      capability: "video",
      adapterCode: "http-video",
    });
    expect(options.httpVideo).toMatchObject({
      apiKey: "http-key",
      baseUrl: "https://provider.example.com",
      modelMap: { "local-video": "vendor-video" },
      submitPath: "/submit",
      pollPath: "/poll/{id}",
      timeoutMs: 1234,
    });
    expect(JSON.stringify(route)).not.toContain("http-key");
  });

  it("fails unknown protocols instead of silently falling back to mock", () => {
    expect(() =>
      buildProviderAdapterOptions({ mode: "real" }, snapshot("unknown"), "secret", {
        name: "model",
        capability: "video",
        adapterCode: "http-video",
      }),
    ).toThrow(/unsupported provider protocol/);
  });
});
