import { describe, expect, it } from "vitest";
import { SdkDriver, validateConnection, type Protocol } from "../src/llm/sdk";
import { builtinBundle } from "../src/content/builtin";
import { describeError, type RoleRequest } from "../src/llm/driver";

const json = JSON.stringify({
  speech: "证据来源已经澄清，可以采纳。",
  admitted: true,
});
function response(protocol: Protocol, toolCall = false) {
  if (protocol === "openai-chat")
    return {
      id: "chatcmpl-1",
      object: "chat.completion",
      created: 1,
      model: "test-model",
      choices: [
        {
          index: 0,
          finish_reason: toolCall ? "tool_calls" : "stop",
          message: toolCall
            ? {
                role: "assistant",
                content: null,
                tool_calls: [
                  {
                    id: "call-1",
                    type: "function",
                    function: {
                      name: "ask_participant",
                      arguments: JSON.stringify({
                        target: "defense",
                        question: "材料来自何处？",
                      }),
                    },
                  },
                ],
              }
            : { role: "assistant", content: json },
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
    };
  if (protocol === "openai-responses")
    return {
      id: "resp-1",
      object: "response",
      created_at: 1,
      model: "test-model",
      status: "completed",
      output: toolCall
        ? [
            {
              id: "fc-1",
              type: "function_call",
              call_id: "call-1",
              name: "ask_participant",
              arguments: JSON.stringify({
                target: "defense",
                question: "材料来自何处？",
              }),
              status: "completed",
            },
          ]
        : [
            {
              id: "msg-1",
              type: "message",
              role: "assistant",
              status: "completed",
              content: [{ type: "output_text", text: json, annotations: [] }],
            },
          ],
      usage: { input_tokens: 10, output_tokens: 20, total_tokens: 30 },
    };
  return {
    id: "msg-1",
    type: "message",
    role: "assistant",
    model: "test-model",
    stop_reason: toolCall ? "tool_use" : "end_turn",
    stop_sequence: null,
    content: toolCall
      ? [
          {
            type: "tool_use",
            id: "call-1",
            name: "ask_participant",
            input: { target: "defense", question: "材料来自何处？" },
          },
        ]
      : [{ type: "text", text: json }],
    usage: { input_tokens: 10, output_tokens: 20 },
  };
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
        return new Response(JSON.stringify(response(protocol)), {
          headers: { "content-type": "application/json" },
        });
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
        return new Response(
          JSON.stringify(response(protocol, bodies.length === 1)),
          { headers: { "content-type": "application/json" } },
        );
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
    const body = response("openai-chat");
    const wire = JSON.stringify(body).replace(
      json.replaceAll('"', '\\"'),
      "bad-json",
    );
    const driver = new SdkDriver(
      {
        protocol: "openai-chat",
        baseURL: "https://mock.example/v1",
        apiKey: "test-key",
        model: "model",
      },
      async () =>
        new Response(wire, { headers: { "content-type": "application/json" } }),
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
  const encode = (content: string, finish = false) =>
    new TextEncoder().encode(
      "data: " +
        JSON.stringify({
          id: "t",
          object: "chat.completion.chunk",
          created: 1,
          model: "test",
          choices: [
            {
              index: 0,
              delta: { content },
              finish_reason: finish ? "stop" : null,
            },
          ],
        }) +
        "\n\n",
    );
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
            c.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
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
