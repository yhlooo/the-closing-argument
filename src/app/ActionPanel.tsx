import { useState } from "react";
import type { ContentBundle, EvidenceProfile } from "../domain/profiles";
import { phaseLabels, type CourtState, type Side } from "../domain/courtroom";
import type { CourtroomEngine } from "../engine/courtroom";
import { Tag } from "./controls";
export function ActionPanel({
  runId,
  legacyDrafts,
  state,
  bundle,
  selected,
  busy,
  choose,
  run,
  engine,
}: {
  runId: string;
  legacyDrafts?: boolean;
  state: CourtState;
  bundle: ContentBundle;
  selected?: EvidenceProfile;
  busy: boolean;
  choose: (id: string) => void;
  run: (action: (signal: AbortSignal) => Promise<unknown>) => Promise<void>;
  engine: CourtroomEngine;
}) {
  const c = bundle.case,
    phase = state.phase;
  const defaults =
    phase === "openings"
      ? c.defenseOpening
      : phase === "closings"
        ? c.defenseClosing
        : phase === "defense"
          ? selected?.purpose
          : "请审查该材料的来源、真实性和证明范围。该材料能够证明的事实，与控方希望推断的结论应当区分。";
  const legacyKey = [
    "court-draft",
    bundle.case.id,
    state.jurors.map((j) => j.name).join(","),
    phase,
    state.openings.length,
    state.closings.length,
    selected?.id,
  ].join("/");
  const draftKey = [
    "court-draft",
    runId,
    phase,
    state.openings.length,
    state.closings.length,
    selected?.id,
  ].join("/");
  const [value, setValue] = useState(
    () =>
      sessionStorage.getItem(draftKey) ??
      (legacyDrafts ? sessionStorage.getItem(legacyKey) : null) ??
      defaults ??
      "",
  );
  const [question, setQuestion] = useState(
    () => sessionStorage.getItem(draftKey + "/question") ?? "",
  );
  function editQuestion(text: string) {
    setQuestion(text);
    sessionStorage.setItem(draftKey + "/question", text);
  }
  const updateDraft = (text: string) => {
    setValue(text);
    sessionStorage.setItem(draftKey, text);
  };

  const action = (fn: (signal: AbortSignal) => Promise<unknown>) => () => {
    void run(fn);
  };
  const submitText = (
    label: string,
    fn: (value: string, signal: AbortSignal) => Promise<unknown>,
  ) => (
    <>
      <label htmlFor="defense-statement">{label}</label>
      <textarea
        id="defense-statement"
        value={value}
        onChange={(e) => updateDraft(e.target.value)}
        rows={4}
        maxLength={20000}
      />
      <button
        className="button primary full"
        disabled={busy || !value.trim()}
        onClick={action((signal) => fn(value, signal))}
      >
        向法庭提交{" "}
      </button>
    </>
  );
  if (phase === "setup")
    return (
      <>
        <h2>选任陪审团</h2>
        <p>从候选人池抽取十二位陪审员。就席后可在陪审团名单查看成员资料。</p>
        <button
          className="button primary full"
          disabled={busy}
          onClick={action((s) => engine.selectJury(s))}
        >
          开始庭审
        </button>
      </>
    );
  if (phase === "openings" || phase === "closings") {
    const closing = phase === "closings",
      title = closing ? "辩方最后陈述" : "辩方开庭陈述";
    return (
      <>
        <h2>{title}</h2>
        {submitText("你的辩方陈述（可修改）", (v, s) =>
          closing
            ? engine.recordClosing("defense", v, s)
            : engine.recordOpening("defense", v, s),
        )}
      </>
    );
  }
  if (phase === "prosecution" || phase === "defense") {
    const side: Side = phase,
      items =
        phase === "prosecution" ? c.prosecutionEvidence : c.defenseEvidence;
    const allDone = items.every((e) =>
      state.evidence.some((r) => r.id === e.id),
    );
    const reviewed = state.evidence.find((e) => e.id === selected?.id);
    return (
      <>
        <h2>{phaseLabels[phase]}</h2>
        <p>
          {phase === "prosecution"
            ? "检验控方提交的材料。对于证人，你可以在裁定前进行交叉询问。"
            : "说明你的证据能够证明什么。控方将质证，由法官决定是否采纳。"}
        </p>
        {side === "defense" && (
          <div className="evidence-list">
            {items.map((e) => (
              <button
                key={e.id}
                disabled={
                  busy ||
                  phase === "prosecution" ||
                  state.evidence.some((r) => r.id === e.id) ||
                  state.events.some(
                    (v) =>
                      v.type === "evidence" &&
                      !state.evidence.some((r) => r.id === v.evidenceId) &&
                      v.evidenceId !== e.id,
                  )
                }
                className={selected?.id === e.id ? "active" : ""}
                onClick={() => choose(e.id)}
              >
                <span>
                  {e.kind === "witness" ? "◉" : "▤"} {e.title}
                </span>
                <small>
                  {state.evidence.some((r) => r.id === e.id)
                    ? "已裁决"
                    : "待审查"}
                </small>
              </button>
            ))}
          </div>
        )}
        {selected && (
          <div className="evidence-detail">
            <Tag>{selected.kind === "witness" ? "证人" : "书面材料"}</Tag>
            <p>{selected.description}</p>
            <details>
              <summary>引用理由</summary>
              <p>{selected.purpose}</p>
            </details>
          </div>
        )}
        {reviewed ? (
          <div className="reviewed">
            <Tag tone={reviewed.admitted ? "green" : "red"}>
              {reviewed.admitted ? "已采纳" : "已排除"}
            </Tag>
            <p>{reviewed.reason}</p>
          </div>
        ) : (
          selected &&
          (selected.kind === "witness" &&
          !state.events.some(
            (e) => e.type === "evidence" && e.evidenceId === selected.id,
          ) ? (
            <button
              className="button primary"
              disabled={busy}
              onClick={action((s) =>
                engine.introduceWitness(side, selected.id, s),
              )}
            >
              请证人出庭
            </button>
          ) : (
            <>
              {selected.kind === "witness" && (
                <div className="witness-question">
                  <label htmlFor="witness-question">询问证人</label>
                  <textarea
                    id="witness-question"
                    rows={3}
                    value={question}
                    maxLength={4000}
                    placeholder="写下你要向证人提出的问题"
                    onChange={(e) => editQuestion(e.target.value)}
                  />
                  <button
                    className="button quiet full"
                    disabled={busy || !question.trim()}
                    onClick={action(async (s) => {
                      await engine.questionWitness(
                        side,
                        selected.id,
                        question,
                        s,
                      );
                      editQuestion("");
                    })}
                  >
                    提出问题
                  </button>
                  {(side === "defense"
                    ? selected.directExamination.map((qa) => qa.question)
                    : ["你能亲自确认哪些事实？", "哪些细节你无法确认？"]
                  ).map((q) => (
                    <button
                      type="button"
                      className="suggestion"
                      key={q}
                      disabled={busy}
                      onClick={() => editQuestion(q)}
                    >
                      {q}
                    </button>
                  ))}
                </div>
              )}
              {submitText(
                side === "prosecution" ? "你的质证意见" : "你的举证说明",
                (v, s) => engine.presentEvidence(side, selected.id, v, s),
              )}
            </>
          ))
        )}
        {side === "defense" && !allDone && (
          <button
            className="button quiet full rest-button"
            disabled={
              busy ||
              !!state.events.find(
                (ev) =>
                  ev.type === "evidence" &&
                  !state.evidence.some((r) => r.id === ev.evidenceId),
              )
            }
            onClick={action((s) => engine.rest(side, s))}
          >
            结束辩方举证
          </button>
        )}
      </>
    );
  }
  return null;
}
