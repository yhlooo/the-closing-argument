# 客户端工具调用原文节选

## OpenAI · Function calling

```python
"role": "tool",
"tool_call_id": tool_call.id,
"content": json.dumps(result),
```

```javascript
type: "function_call_output",
call_id: item.call_id,
output: horoscope,
```

[Function calling](https://developers.openai.com/api/docs/guides/function-calling?strict-mode=disabled)

## Anthropic · Handle tool calls

> Tool result blocks must immediately follow their corresponding tool use blocks in the message history.

```json
"type": "tool_result",
"tool_use_id": "toolu_01A09q90qw90lq917835lq9"
```

[Handle tool calls](https://platform.claude.com/docs/en/agents-and-tools/tool-use/handle-tool-calls)

## AI SDK 7.0.178 · StreamTextResult

```ts
  readonly fullStream: AsyncIterableStream<TextStreamPart<TOOLS>>;
```

```ts
export type TextStreamTextDeltaPart = {
  type: 'text-delta';
  id: string;
  providerMetadata?: ProviderMetadata;
  text: string;
};
```

来源为 npm 包 ai 的 src/generate-text/stream-text-result.ts。
