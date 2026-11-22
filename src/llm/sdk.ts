import {
  streamText,
  parsePartialJson,
  stepCountIs,
  tool,
  type LanguageModel,
} from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { z } from "zod";
import type { LlmDriver, RoleRequest } from "./driver";
import { throwIfAborted, validateReply } from "./driver";

import { validateConnection, type Connection } from "./connection";
export {
  validateConnection,
  type Connection,
  type Protocol,
} from "./connection";
export class SdkDriver implements LlmDriver {
  readonly live = true;
  private model: LanguageModel;
  constructor(
    private config: Connection,
    fetchImpl?: typeof fetch,
  ) {
    this.config = validateConnection(config);
    const options = {
      apiKey: this.config.apiKey,
      baseURL: this.config.baseURL,
      fetch: fetchImpl,
    };
    if (config.protocol === "anthropic") {
      this.model = createAnthropic({
        ...options,
        headers: { "anthropic-dangerous-direct-browser-access": "true" },
      })(this.config.model);
    } else {
      const provider = createOpenAI(options);
      this.model =
        config.protocol === "openai-chat"
          ? provider.chat(this.config.model)
          : provider.responses(this.config.model);
    }
  }
  async complete(request: RoleRequest) {
    const signal = AbortSignal.any([
      request.signal,
      AbortSignal.timeout(10 * 60 * 1000),
    ]);
    let calls = 0,
      toolError: unknown;
    // Serialize even parallel tool requests; they append to the same staged event log.
    let queue = Promise.resolve("");
    const tools =
      request.askParticipant && request.participants.length
        ? {
            ask_participant: tool({
              description:
                "向当前证据的参与者提出一个公开澄清问题。仅可使用给定 target。最多四次。",
              inputSchema: z
                .object({
                  target: z.enum(request.participants as [string, ...string[]]),
                  question: z.string().trim().min(1).max(4000),
                })
                .strict(),
              execute: (input) => {
                const answer = queue.then(async () => {
                  throwIfAborted(signal);
                  if (++calls > 4) throw new Error("工具调用预算耗尽");
                  return request.askParticipant!(
                    input.target,
                    input.question,
                    signal,
                  );
                });
                queue = answer.catch((error) => {
                  toolError = error;
                  return "";
                });
                return answer;
              },
            }),
          }
        : undefined;
    const stream = streamText({
      model: this.model,
      system: request.system,
      prompt: request.prompt,
      tools,
      stopWhen: stepCountIs(5),
      prepareStep: ({ stepNumber }) =>
        stepNumber >= 4 ? { toolChoice: "none" as const } : {},
      maxRetries: 0,
      abortSignal: signal,
      onError: () => {},
      providerOptions:
        this.config.protocol === "anthropic"
          ? {}
          : { openai: { store: false, parallelToolCalls: false } },
    });
    let buffer = "";
    let published = "";
    for await (const chunk of stream.fullStream) {
      throwIfAborted(signal);
      if (chunk.type === "error") throw chunk.error;
      if (chunk.type === "start-step") {
        buffer = "";
        published = "";
      }
      if (chunk.type !== "text-delta" || !request.onSpeech) continue;
      buffer += chunk.text;
      const partial = await parsePartialJson(
        buffer.trimStart().replace(/^```(?:json)?\s*/, ""),
      );
      const body = (partial.value as { speech?: unknown } | undefined)?.speech;
      if (typeof body === "string" && body && body !== published) {
        throwIfAborted(signal);
        request.onSpeech(body);
        published = body;
      }
    }
    throwIfAborted(signal);
    if (toolError) throw toolError;
    if (
      (await stream.steps).some((step) =>
        step.content.some((part) => part.type === "tool-error"),
      )
    )
      throw new Error("工具请求不合法或未完成");
    const finishReason = await stream.finishReason;
    if (
      ["length", "content-filter", "tool-calls", "error"].includes(finishReason)
    )
      throw new Error("模型未完成最终结果");
    const source = (await stream.text)
      .trim()
      .replace(/^```(?:json)?\s*\n?/, "")
      .replace(/\n?```$/, "");
    const reply = validateReply(request.task, JSON.parse(source));
    return { ...reply, reasoning: await stream.reasoningText };
  }
}
