import { describe, expect, it } from "vitest";
import { pickWeightedRoute, type ProviderRouteCandidate } from "../src/modules/generations/provider-route";

function candidate(routeId: bigint, priority: number, weight: number): ProviderRouteCandidate {
  return {
    routeId,
    providerId: 100n,
    protocol: "openai-compatible",
    baseUrl: "https://provider.example.com",
    remoteModelId: `remote-${routeId}`,
    authType: "bearer",
    authHeader: "Authorization",
    priority,
    weight,
    providerOptions: {},
    routeOptions: {},
  };
}

describe("provider route selection", () => {
  it("always prefers the smallest priority before weight", () => {
    const picked = pickWeightedRoute([candidate(1n, 10, 1), candidate(2n, 20, 1000)], () => 0.99);
    expect(picked?.routeId).toBe(1n);
  });

  it("uses weight inside the same priority", () => {
    const rows = [candidate(1n, 10, 100), candidate(2n, 10, 300)];
    expect(pickWeightedRoute(rows, () => 0.1)?.routeId).toBe(1n);
    expect(pickWeightedRoute(rows, () => 0.5)?.routeId).toBe(2n);
  });

  it("treats non-positive or non-finite weights as one instead of dividing by zero", () => {
    const rows = [candidate(1n, 10, 0), candidate(2n, 10, Number.NaN)];
    expect(pickWeightedRoute(rows, () => 0)?.routeId).toBe(1n);
    expect(pickWeightedRoute(rows, () => 0.999)?.routeId).toBe(2n);
  });
});
