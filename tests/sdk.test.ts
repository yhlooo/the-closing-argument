import { describe, expect, it } from "vitest";
import { SdkDriver, validateConnection, type Protocol } from "../src/llm/sdk";
import { builtinBundle } from "../src/content/builtin";
import { describeError, type RoleRequest } from "../src/llm/driver";

const json = JSON.stringify({
  speech: "证据来源已经澄清，可以采纳。",
  admitted: true,
});
const sse = (event: unknown) => "data: " + JSON.stringify(event) + "\n\n";
const eventsResponse = (body: BodyInit) =>
  new Response(body, { headers: { "content-type": "text/event-stream" } });
const argumentsJson = JSON.stringify({
  target: "defense",
  question: "材料来自何处？",
});
function chatChunk(delta: object, finishReason: string | null = null) {
  return {
    id: "chatcmpl-1",
    object: "chat.completion.chunk",
    created: 1,
    model: "test-model",
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  };
}
function response(protocol: Protocol, toolCall = false, speech = json) {
  if (protocol === "openai-chat") {
    const delta = toolCall
      ? {
          tool_calls: [
            {
              index: 0,
              id: "call-1",
              type: "function",
              function: { name: "ask_participant", arguments: argumentsJson },
            },
          ],
        }
      : { content: speech };
    return eventsResponse(
      sse(chatChunk(delta)) +
        sse(chatChunk({}, toolCall ? "tool_calls" : "stop")) +
        "data: [DONE]\n\n",
    );
  }
  if (protocol === "openai-responses") {
    const item = toolCall
      ? {
          type: "function_call",
          id: "fc-1",
          call_id: "call-1",
          name: "ask_participant",
          arguments: argumentsJson,
          status: "completed",
        }
      : { type: "message", id: "msg-1", role: "assistant", content: [] };
    return eventsResponse(
      [
        { type: "response.output_item.added", output_index: 0, item },
        toolCall
          ? { type: "response.output_item.done", output_index: 0, item }
          : {
              type: "response.output_text.delta",
              item_id: item.id,
              delta: speech,
            },
        { type: "response.completed", response: {} },
      ]
        .map(sse)
        .join(""),
    );
  }
  return eventsResponse(
    [
      {
        type: "message_start",
        message: {
          id: "msg-1",
          model: "test-model",
          usage: { input_tokens: 10, output_tokens: 0 },
        },
      },
      {
        type: "content_block_start",
        index: 0,
        content_block: toolCall
          ? {
              type: "tool_use",
              id: "call-1",
              name: "ask_participant",
              input: {},
            }
          : { type: "text", text: "" },
      },
      {
        type: "content_block_delta",
        index: 0,
        delta: toolCall
          ? { type: "input_json_delta", partial_json: argumentsJson }
          : { type: "text_delta", text: speech },
      },
      { type: "content_block_stop", index: 0 },
      {
        type: "message_delta",
        delta: { stop_reason: toolCall ? "tool_use" : "end_turn" },
        usage: { output_tokens: 20 },
      },
      { type: "message_stop" },
    ]
      .map(sse)
      .join(""),
  );
}
function request(): RoleRequest {
  return {
    task: "ruling",
    role: builtinBundle.judge,
    system: "你是法官",
    prompt: "裁定证据，返回 JSON",
    round: 1,
    participants: [],
    signal: new AbortController().signal,
  };
}
describe("真实 SDK 的协议边界（mock fetch，无真实密钥）", () => {
  for (const protocol of [
    "openai-chat",
    "openai-responses",
    "anthropic",
  ] as const) {
    it(`${protocol} 使用指定 endpoint、认证与结构化结果`, async () => {
      let seenUrl = "",
        headers = new Headers(),
        body: Record<string, unknown> = {};
      const mock: typeof fetch = async (input, init) => {
        seenUrl = String(input);
        headers = new Headers(init?.headers);
        body = JSON.parse(String(init?.body));
        return response(protocol);
      };
      const driver = new SdkDriver(
        {
          protocol,
          baseURL: "https://mock.example/v1/",
          apiKey: "test-key",
          model: "test-model",
        },
        mock,
      );
      const result = await driver.complete(request());
      expect(result.admitted).toBe(true);
      expect(seenUrl).toBe(
        `https://mock.example/v1/${protocol === "openai-chat" ? "chat/completions" : protocol === "openai-responses" ? "responses" : "messages"}`,
      );
      expect(body.model).toBe("test-model");
      expect(body.stream).toBe(true);
      if (protocol === "anthropic") {
        expect(headers.get("x-api-key")).toBe("test-key");
        expect(headers.get("anthropic-dangerous-direct-browser-access")).toBe(
          "true",
        );
      } else {
        expect(headers.get("authorization")).toBe("Bearer test-key");
        expect(body.store).toBe(false);
      }
    });
    it(`${protocol} 能执行工具并把结果按对应协议返回模型`, async () => {
      const bodies: Record<string, unknown>[] = [],
        questions: string[] = [];
      const mock: typeof fetch = async (_input, init) => {
        bodies.push(JSON.parse(String(init?.body)));
        return response(protocol, bodies.length === 1);
      };
      const driver = new SdkDriver(
        {
          protocol,
          baseURL: "https://mock.example/v1",
          apiKey: "test-key",
          model: "test-model",
        },
        mock,
      );
      const result = await driver.complete({
        ...request(),
        participants: ["defense"],
        askParticipant: async (target, question) => {
          questions.push(`${target}:${question}`);
          return "来源是仓库工单系统";
        },
      });
      expect(result.admitted).toBe(true);
      expect(questions).toEqual(["defense:材料来自何处？"]);
      expect(bodies).toHaveLength(2);
      const wire = JSON.stringify(bodies[1]);
      expect(wire).toContain("来源是仓库工单系统");
      expect(wire).toContain(
        protocol === "anthropic"
          ? "tool_result"
          : protocol === "openai-responses"
            ? "function_call_output"
            : "tool_call_id",
      );
    });
  }
  it("不自动重试网络错误，不泄露原始响应和 Key", async () => {
    let calls = 0;
    const driver = new SdkDriver(
      {
        protocol: "openai-chat",
        baseURL: "https://mock.example/v1",
        apiKey: "SECRET-KEY",
        model: "model",
      },
      async () => {
        calls++;
        return new Response("SECRET-KEY server raw error", { status: 401 });
      },
    );
    let message = "";
    try {
      await driver.complete(request());
    } catch (error) {
      message = describeError(error);
    }
    expect(calls).toBe(1);
    expect(message).toContain("401");
    expect(message).not.toContain("SECRET-KEY");
  });
  it("拒绝模型坏 JSON，不把解析失败当作采纳或演示结果", async () => {
    const driver = new SdkDriver(
      {
        protocol: "openai-chat",
        baseURL: "https://mock.example/v1",
        apiKey: "test-key",
        model: "model",
      },
      async () => response("openai-chat", false, "bad-json"),
    );
    await expect(driver.complete(request())).rejects.toThrow();
  });
  it("校验连接地址，HTTPS 与本地 HTTP 合法，远程 HTTP 和凭据 URL 拒绝", () => {
    const config = {
      protocol: "openai-chat" as const,
      model: "model",
      apiKey: "key",
    };
    for (const baseURL of [
      "https://mock.example/v1",
      "http://127.0.0.1:8080/v1",
    ])
      expect(validateConnection({ ...config, baseURL }).baseURL).toBe(baseURL);
    for (const baseURL of [
      "http://mock.example/v1",
      "https://user:secret@mock.example/v1",
      "https://mock.example/v1?key=x",
      "file:///tmp/file",
    ])
      expect(() => validateConnection({ ...config, baseURL })).toThrow();
  });
});

it("接收最后一个数据块前已渲染公开正文，结构字段不进入发言", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let seen = "";
  const encoder = new TextEncoder();
  const encode = (content: string, finish = false) =>
    encoder.encode(sse(chatChunk({ content }, finish ? "stop" : null)));
  const driver = new SdkDriver(
    {
      protocol: "openai-chat",
      baseURL: "https://mock.example/v1",
      apiKey: "test",
      model: "test",
    },
    async () =>
      new Response(
        new ReadableStream({
          async start(c) {
            c.enqueue(encode('{"speech":"证人'));
            await gate;
            c.enqueue(encode('已到庭","admitted":true}', true));
            c.enqueue(encoder.encode("data: [DONE]\n\n"));
            c.close();
          },
        }),
        { headers: { "content-type": "text/event-stream" } },
      ),
  );
  const reply = await driver.complete({
    ...request(),
    onSpeech: (value) => {
      if (!seen) {
        seen = value;
        release();
      }
    },
  });
  expect(seen).toBe("证人");
  expect(reply.speech).toBe("证人已到庭");
  expect(reply.admitted).toBe(true);
});
