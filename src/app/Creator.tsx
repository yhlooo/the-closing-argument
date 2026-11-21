import { useState, useRef } from "react";
import {
  bundleSchema,
  parseResource,
  toYaml,
  MAX_CONTENT_BYTES,
  type ContentBundle,
} from "../domain/profiles";
import type { CourtState, Side } from "../domain/courtroom";
import { CourtError } from "../engine/courtroom";
import { describeError } from "../llm/driver";
import { Tag, download } from "./controls";
import { EventLog } from "./Transcript";
type ResourceKey = "case" | "judge" | "prosecutor" | "juryPool";
const resourceLabels: Record<ResourceKey, string> = {
  case: "案件",
  judge: "法官",
  prosecutor: "控方",
  juryPool: "候选人池",
};
export function Creator({
  bundle,
  setBundle,
  busy,
  sandbox,
  debug,
  setError,
  setNotice,
}: {
  bundle: ContentBundle;
  setBundle: (bundle: ContentBundle) => void;
  busy: boolean;
  sandbox?: CourtState;
  debug: (
    side: Side,
    id: string,
    argument: string,
    question: string,
  ) => Promise<void>;
  setError: (message: string) => void;
  setNotice: (message: string) => void;
}) {
  const [key, setKey] = useState<ResourceKey>("case"),
    [source, setSource] = useState(toYaml(bundle.case));
  const [selectedId, setSelectedId] = useState(
    bundle.case.prosecutionEvidence[0]?.id ?? "",
  );
  const [argument, setArgument] = useState(
      "请说明这份材料的证明范围，并审查其可靠性。",
    ),
    [question, setQuestion] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const entries = [
    ...bundle.case.prosecutionEvidence.map((e) => ({
      ...e,
      side: "prosecution" as const,
    })),
    ...bundle.case.defenseEvidence.map((e) => ({
      ...e,
      side: "defense" as const,
    })),
  ];
  const selected = entries.find((e) => e.id === selectedId) ?? entries[0];
  function apply(value: string) {
    const resource = parseResource(value);
    const nextKey =
      resource.kind === "case"
        ? "case"
        : resource.kind === "jury-pool"
          ? "juryPool"
          : resource.kind === "role"
            ? resource.roleType === "judge"
              ? "judge"
              : resource.roleType === "prosecutor"
                ? "prosecutor"
                : undefined
            : key;
    if (!nextKey)
      throw new CourtError("固定角色只能导入法官或控方；证人请放入案件定义。");
    const next =
      resource.kind === "bundle"
        ? bundleSchema.parse(resource)
        : bundleSchema.parse({ ...bundle, [nextKey]: resource });
    setBundle(next);
    setKey(nextKey);
    setSource(toYaml(next[nextKey]));
    setError("");
    setNotice("内容已通过完整校验；新建庭审后应用。当前庭审保持原内容。");
  }
  return (
    <main className="creator-grid">
      <section className="panel editor-panel">
        <div className="transcript-head">
          <div>
            <span className="eyebrow">CONTENT STUDIO</span>
            <h2>卷宗编辑器</h2>
          </div>
          <Tag tone="gold">YAML · v1</Tag>
        </div>
        <div className="resource-tabs">
          {(Object.keys(resourceLabels) as ResourceKey[]).map((k) => (
            <button
              key={k}
              className={k === key ? "selected" : ""}
              onClick={() => {
                setKey(k);
                setSource(toYaml(bundle[k]));
              }}
            >
              {resourceLabels[k]}
            </button>
          ))}
        </div>
        <div className="inline-note">
          作者材料包含证人秘密。校验并应用后才会更新创作内容；切换资源会放弃尚未校验的文本。
        </div>
        <label className="sr-only" htmlFor="yaml-editor">
          {resourceLabels[key]} YAML
        </label>
        <textarea
          id="yaml-editor"
          className="code-editor"
          value={source}
          onChange={(e) => setSource(e.target.value)}
          spellCheck={false}
        />
        <div className="editor-toolbar">
          <button
            className="button primary"
            disabled={busy}
            onClick={() => {
              try {
                apply(source);
              } catch (error) {
                setError(
                  error instanceof Error && error.message.startsWith("未知")
                    ? error.message
                    : describeError(error),
                );
              }
            }}
          >
            校验并应用
          </button>
          <button
            className="button quiet"
            onClick={() => download(`${key}.yaml`, source)}
          >
            导出当前文本
          </button>
          <button
            className="button quiet"
            onClick={() => download("courtroom-bundle.yaml", toYaml(bundle))}
          >
            导出已校验内容包
          </button>
          <button
            className="button quiet"
            disabled={busy}
            onClick={() => fileInput.current?.click()}
          >
            导入 YAML
          </button>
          <input
            className="sr-only"
            type="file"
            accept=".yaml,.yml"
            ref={fileInput}
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              try {
                if (file.size > MAX_CONTENT_BYTES)
                  throw new CourtError("文件不得超过 512 KiB");
                apply(await file.text());
              } catch (error) {
                setError(describeError(error));
              }
            }}
          />
        </div>
      </section>
      <aside>
        <section className="panel sandbox-panel">
          <span className="eyebrow">ISOLATED REHEARSAL</span>
          <h2>单项证据调试</h2>
          <p>
            直接演练一项举证事件。使用已校验内容与当前连接，不改变正式庭审。
          </p>
          <label htmlFor="debug-evidence">选择证据或证人</label>
          <select
            id="debug-evidence"
            value={selected?.id ?? ""}
            onChange={(e) => {
              setSelectedId(e.target.value);
              setQuestion("");
            }}
          >
            {entries.map((e) => (
              <option key={e.id} value={e.id}>
                {e.side === "prosecution" ? "控方" : "辩方"} · {e.title}
              </option>
            ))}
          </select>
          {selected?.kind === "witness" && (
            <>
              <label htmlFor="debug-question">先询问证人（可选）</label>
              <textarea
                id="debug-question"
                rows={3}
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
              />
            </>
          )}
          <label htmlFor="debug-argument">辩方质证 / 举证说明</label>
          <textarea
            id="debug-argument"
            value={argument}
            rows={4}
            onChange={(e) => setArgument(e.target.value)}
          />
          <button
            className="button primary full"
            disabled={busy || !selected || !argument.trim()}
            onClick={() =>
              selected &&
              debug(
                selected.side,
                selected.id,
                argument,
                selected.kind === "witness" ? question : "",
              )
            }
          >
            运行独立调试
          </button>
        </section>
        {sandbox && (
          <section className="panel sandbox-output">
            <div className="section-heading">
              <h3>调试记录</h3>
              <Tag tone="green">已完成</Tag>
            </div>
            <EventLog
              bundle={bundle}
              events={sandbox.events.filter((e) => e.evidenceId)}
            />
          </section>
        )}
        <section className="instructions">
          <h3>内容约定</h3>
          <p>
            案件保留中立背景、控辩陈述及双方有序材料。客观描述与引用目的分开填写。候选池权重必须大于零；ID
            全局唯一，保持稳定。
          </p>
          <p>创建内容后，可在案件列表中选择这份卷宗开始庭审。</p>
        </section>
      </aside>
    </main>
  );
}
