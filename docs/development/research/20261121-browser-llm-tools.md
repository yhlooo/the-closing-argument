# 浏览器端证人询问的工具调用

## 调查问题

控方一次提问需要两种身份分别推理。控方模型提出问题，应用用证人的独立上下文取得回答，再把当庭回答交还控方。三种协议能否共用这个业务操作？

## 接口结论

| 协议 | 读取模型请求 | 应用交回结果 |
| --- | --- | --- |
| OpenAI Chat Completions | assistant 消息的 tool_calls，取 id、函数名和 JSON 参数字符串 | 保留该消息，追加 role=tool 的消息，tool_call_id 对应原 id |
| OpenAI Responses | 保留 response.output，取 function_call 项、call_id 和 JSON 参数字符串 | 在 input 中追加 function_call_output 项，通过 call_id 关联 |
| Anthropic Messages | 保留 assistant 内容中的 tool_use 块，取 id、name 和 input 对象 | 紧接着用 user 消息提交 tool_result，tool_use_id 对应原 id |

因此可以统一“工具名、参数、调用标识、返回正文”的业务接口，同一轮询问的原始续聊记录要交给各适配器维护。模拟器负责判断提问人当下能问哪个证人。角色档案、API Key 和证人私有材料均无需出现在工具参数或结果中。[协议原文节选](../reference/llm-tools/excerpts.md) · [OpenAI](https://developers.openai.com/api/docs/guides/function-calling?strict-mode=disabled) · [Anthropic](https://platform.claude.com/docs/en/agents-and-tools/tool-use/handle-tool-calls)

## 验证边界

本次核对的是文档中的协议。浏览器直连仍需选定服务端点允许页面来源及所需请求头，并用目标模型完成一次真实工具往返。兼容端点的名称不能代替这项集成测试。

## 发言流

所用 AI SDK 版本的 fullStream 区分文本增量、工具调用及其他事件。实现只拼接本次文本段的 text-delta，在 parsePartialJson 的局部结果中读取公开 speech。完整响应仍需通过角色任务的结构校验。测试使用分两次发送的 HTTP 事件流，在页面回调收到“证人”后才允许发送剩余字节，验证能在请求完成前显示正文。[SDK 源码摘录](../reference/llm-tools/excerpts.md)
