import { afterEach, expect, it, vi } from "vitest";
import { readConnection, storeConnection } from "../src/app/storage";

afterEach(() => vi.unstubAllGlobals());

it("在浏览器独立保存并完整恢复连接，包括 API Key", () => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => values.get(k) ?? null,
    setItem: (k: string, v: string) => values.set(k, v),
  });
  expect(readConnection()).toBeUndefined();
  const config = {
    protocol: "openai-chat" as const,
    baseURL: "http://localhost:9090/v1",
    model: "local-test-model",
    apiKey: "test-only-key",
  };
  storeConnection(config);
  expect(readConnection()).toEqual(config);
});

it("缺少密钥的联网配置重新进入首次配置流程", () => {
  vi.stubGlobal("localStorage", {
    getItem: () =>
      JSON.stringify({
        protocol: "anthropic",
        baseURL: "https://api.anthropic.com/v1",
        model: "test",
        apiKey: "",
      }),
  });
  expect(readConnection()).toBeUndefined();
});
