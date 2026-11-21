export type Protocol =
  "demo" | "openai-chat" | "openai-responses" | "anthropic";
export interface Connection {
  protocol: Protocol;
  baseURL: string;
  model: string;
  apiKey: string;
}
export function validateConnection(config: Connection): Connection {
  const url = new URL(config.baseURL);
  if (
    (url.protocol !== "https:" &&
      !(
        url.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
      )) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error(
      "服务地址需要 HTTPS，或本机 HTTP；不能包含认证信息、查询参数或片段。",
    );
  if (!config.model.trim() || !config.apiKey.trim())
    throw new Error("请填写模型名称和 API Key。");
  return {
    ...config,
    baseURL: url.toString().replace(/\/$/, ""),
    model: config.model.trim(),
    apiKey: config.apiKey.trim(),
  };
}
