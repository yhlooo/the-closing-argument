import { z } from "zod";
import { text } from "../domain/profiles";
import type { RoleProfile } from "../domain/profiles";

export type Task = "speak" | "challenge" | "ruling" | "vote" | "summary";
const speechSchema = z.object({ speech: text }).strict();
const rulingSchema = z.object({ speech: text, admitted: z.boolean() }).strict();
const voteSchema = z
  .object({ speech: text, vote: z.enum(["guilty", "not_guilty"]) })
  .strict();
export type Reply = {
  speech: string;
  admitted?: boolean;
  vote?: "guilty" | "not_guilty";
  reasoning?: string;
};
export interface RoleRequest {
  task: Task;
  role: RoleProfile;
  system: string;
  prompt: string;
  round: number;
  hearing?: {
    caseId?: string;
    admittedDefense: number;
    admittedProsecution: number;
    question?: string;
  };
  onSpeech?: (body: string) => void;
  participants: string[];
  askParticipant?: (
    target: string,
    question: string,
    signal?: AbortSignal,
  ) => Promise<string>;
  signal: AbortSignal;
}
export interface LlmDriver {
  live?: boolean;
  complete(request: RoleRequest): Promise<Reply>;
}
export function validateReply(task: Task, value: unknown): Reply {
  return (
    task === "ruling"
      ? rulingSchema
      : task === "vote"
        ? voteSchema
        : speechSchema
  ).parse(value);
}
export function replyFormat(task: Task): string {
  return task === "ruling"
    ? '{"speech":"公开裁定及理由","admitted":true或false}'
    : task === "vote"
      ? '{"speech":"公开简短投票理由","vote":"guilty或not_guilty"}'
      : '{"speech":"公开发言"}';
}
export function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException("已取消当前操作", "AbortError");
}
/** Never surface SDK request headers, URLs or raw server bodies in the UI. */
export function describeError(error: unknown): string {
  if (
    error instanceof DOMException &&
    (error.name === "AbortError" || error.name === "TimeoutError")
  )
    return "操作已取消或超时；本次操作未提交。";
  if (error instanceof z.ZodError)
    return error.issues
      .map((i) => `${i.path.join(".") || "内容"}：${i.message}`)
      .join("\n");
  const status = (error as { statusCode?: number } | null)?.statusCode;
  if (status)
    return `模型服务请求失败（HTTP ${status}）。请检查服务地址、模型名称和账户权限。`;
  if (error instanceof TypeError)
    return "请求未完成，请检查网络、服务地址和浏览器 CORS 支持。";
  if (
    error instanceof Error &&
    ["CourtError", "ContentError", "YAMLParseError"].includes(error.name)
  )
    return error.message;
  return "操作失败，状态未改变。请检查模型连接或返回格式后重试。";
}
