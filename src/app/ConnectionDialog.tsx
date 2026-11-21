import { useState, type FormEvent } from "react";
import {
  validateConnection,
  type Connection,
  type Protocol,
} from "../llm/connection";
export const protocols: Record<Protocol, string> = {
  demo: "离线演示",
  "openai-chat": "OpenAI Chat Completions",
  "openai-responses": "OpenAI Responses",
  anthropic: "Anthropic Messages",
};
export function ConnectionDialog({
  connection,
  onSave,
  onClose,
}: {
  connection: Connection;
  onSave: (connection: Connection) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(connection),
    [error, setError] = useState("");
  async function save(e: FormEvent) {
    e.preventDefault();
    try {
      const config =
        draft.protocol === "demo"
          ? { ...draft, apiKey: "" }
          : validateConnection(draft);
      try {
        onSave(config);
      } catch {
        setError("无法保存连接设置，请检查浏览器的本地存储权限。");
      }
    } catch {
      setError(
        "请填写模型、API Key 和正确的 HTTPS API 根地址；本地服务允许使用 HTTP。地址不能包含认证信息或查询参数。",
      );
    }
  }
  return (
    <div
      className="modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="connection-title"
      >
        <button
          className="close-button"
          aria-label="关闭连接设置"
          onClick={onClose}
        >
          ×
        </button>
        <span className="eyebrow">MODEL CONNECTION</span>
        <h2 id="connection-title">API 连接设置</h2>
        <form onSubmit={save}>
          <label htmlFor="protocol">调用协议</label>
          <select
            id="protocol"
            value={draft.protocol}
            onChange={(e) => {
              const protocol = e.target.value as Protocol;
              setDraft({
                ...draft,
                protocol,
                baseURL:
                  protocol === "anthropic"
                    ? "https://api.anthropic.com/v1"
                    : "https://api.openai.com/v1",
                model: "",
              });
            }}
          >
            {Object.entries(protocols).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          {draft.protocol !== "demo" ? (
            <>
              <label htmlFor="base-url">API 根地址（包含 /v1）</label>
              <input
                id="base-url"
                type="url"
                required
                value={draft.baseURL}
                onChange={(e) =>
                  setDraft({ ...draft, baseURL: e.target.value })
                }
              />
              <label htmlFor="model-id">模型 ID</label>
              <input
                id="model-id"
                required
                value={draft.model}
                onChange={(e) => setDraft({ ...draft, model: e.target.value })}
                placeholder="填写服务支持的模型名称"
              />
              <label htmlFor="api-key">API Key</label>
              <input
                id="api-key"
                type="password"
                required
                autoComplete="off"
                value={draft.apiKey}
                onChange={(e) => setDraft({ ...draft, apiKey: e.target.value })}
              />
              <div className="inline-note">
                API Key 将保存在此浏览器的本地存储中，调用时发送至所填 API
                地址。浏览器直连需要服务支持 CORS；Anthropic
                还可能受组织策略限制。实际请求将产生服务费用。
              </div>
            </>
          ) : (
            <p className="demo-explanation">
              无需密钥，无网络调用。发言、证据裁定与投票均按预设脚本生成，用于体验完整流程。离线投票按双方获采纳材料的数量演算。
            </p>
          )}
          <p className="fine-print">
            设置从下一次调用开始生效。刷新后会自动恢复已保存的配置。
          </p>
          {error && (
            <p role="alert" className="field-error">
              {error}
            </p>
          )}
          <button className="button primary full" type="submit">
            保存连接设置
          </button>
        </form>
      </section>
    </div>
  );
}
