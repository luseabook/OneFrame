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

/**
 * 供应商附加头（第 126 批）：OpenCode Zen Go 这类网关在 OpenAI 协议之外要 `x-opencode-session`，
 * 不带就 400 `MissingSessionID`。头从 `provider.options`/`route.options` 读，代码不写死任何一家。
 */
describe("worker provider runtime：供应商附加头", () => {
  it("静态 headers + session_header 活值一起注入，session 取调用方给的稳定上下文", () => {
    const base = snapshot("openai-compatible", "zen-ds");
    const options = buildProviderAdapterOptions(
      { mode: "real" },
      {
        ...base,
        provider_options: { headers: { "user-agent": "oneframe-worker/1.0" }, session_header: "x-opencode-session" },
      },
      "sk-zen",
      { name: "zen-deepseek-flash", capability: "text", adapterCode: "openai:chat" },
      "space-7",
    );

    expect(options.deepseek).toMatchObject({
      apiKey: "sk-zen",
      baseUrl: "https://provider.example.com",
      model: "zen-ds",
      extraHeaders: { "user-agent": "oneframe-worker/1.0", "x-opencode-session": "space-7" },
    });
  });

  it("没配 headers / session_header 时不产生空 extraHeaders（保持既有请求形态）", () => {
    const options = buildProviderAdapterOptions(
      { mode: "real" },
      snapshot("openai-compatible", "chat-prod"),
      "sk-secret",
      { name: "local-chat", capability: "text", adapterCode: "deepseek:chat" },
    );
    expect(options.deepseek).not.toHaveProperty("extraHeaders");
  });

  it("headers 里的非字符串值被丢弃（坏配置不该让 worker 崩，应表现为供应商 4xx）", () => {
    const base = snapshot("openai-compatible", "m");
    const options = buildProviderAdapterOptions(
      { mode: "real" },
      { ...base, provider_options: { headers: { "x-num": 42, "x-ok": " v " } } },
      "k",
      { name: "n", capability: "text", adapterCode: "openai:chat" },
    );
    expect(options.deepseek?.extraHeaders).toEqual({ "x-ok": "v" });
  });
});
