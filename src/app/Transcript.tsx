import { useEffect, useRef, type ReactNode } from "react";
import {
  phaseLabels,
  type Phase,
  type CourtEvent,
  type CourtState,
} from "../domain/courtroom";
import type { ContentBundle } from "../domain/profiles";

const labels: Record<string, string> = {
  "jury-selected": "陪审员就席",
  opening: "开庭陈述",
  evidence: "材料出庭",
  supplement: "证明目的",
  question: "询问",
  answer: "回答",
  challenge: "质证意见",
  submission: "举证说明",
  ruling: "证据裁定",
  rest: "举证结束",
  closing: "最后陈述",
  deliberation: "评议意见",
  guidance: "法律指示",
  vote: "投票",
  verdict: "最终裁决",
  registration: "案件登记",
};
export function signature(id: string, name: string, bundle: ContentBundle) {
  if (id === "system") return "书记员";
  if (id === "defense") return "你 · 辩护律师";
  if (id === "prosecution" || id === bundle.prosecutor.id)
    return name + " · 控方律师";
  if (id === bundle.judge.id) return name + " · 法官";
  if (id.startsWith("juror-"))
    return name + " · 第 " + id.slice(6) + " 席陪审员";
  return name + " · 证人";
}

function RecordLine({
  event,
  bundle,
  live,
}: {
  event: CourtEvent;
  bundle: ContentBundle;
  live: boolean;
}) {
  const node = useRef<HTMLElement>(null);
  const cursor = useRef<HTMLElement>(null);
  useEffect(() => {
    if (live && !node.current?.closest("details:not([open])"))
      node.current?.focus({ preventScroll: true });
  }, [live, event.speakerId]);
  useEffect(() => {
    if (live && !cursor.current?.closest("details:not([open])"))
      cursor.current?.scrollIntoView({ block: "nearest" });
  }, [live, event.text]);
  return (
    <article
      ref={node}
      tabIndex={live ? -1 : undefined}
      aria-label={live ? "当前发言" : undefined}
      className={live ? "live-speech" : undefined}
    >
      <header>
        <strong>{signature(event.speakerId, event.speakerName, bundle)}</strong>
        <small>{labels[event.type]}</small>
      </header>
      <p>
        {event.text}
        {live && (
          <i ref={cursor} aria-hidden="true">
            ▍
          </i>
        )}
      </p>
    </article>
  );
}
export function EventLog({
  events,
  bundle,
  liveSequence,
}: {
  events: CourtEvent[];
  bundle: ContentBundle;
  liveSequence?: number;
}) {
  return (
    <div className="minutes">
      {events.map((event) => (
        <RecordLine
          key={event.sequence}
          bundle={bundle}
          event={event}
          live={event.sequence === liveSequence}
        />
      ))}
    </div>
  );
}
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details open className="minutes-section">
      <summary>{title}</summary>
      {children}
    </details>
  );
}
export function Transcript({
  state,
  bundle,
  staged,
  speech,
}: {
  state: CourtState;
  bundle: ContentBundle;
  staged: CourtEvent[];
  speech?: CourtEvent;
}) {
  const items = [
    ...bundle.case.prosecutionEvidence,
    ...bundle.case.defenseEvidence,
  ];
  const prosecution = new Set(bundle.case.prosecutionEvidence.map((e) => e.id));
  const sections = new Map<Phase, CourtEvent[]>();
  const registration: CourtEvent = {
    sequence: 0,
    type: "registration",
    speakerId: "system",
    speakerName: "书记员",
    visibility: "public",
    text: bundle.case.synopsis ?? bundle.case.background,
  };
  for (const e of [
    registration,
    ...state.events,
    ...staged.filter((e) => e.sequence > state.events.length),
    ...(speech ? [speech] : []),
  ]) {
    let phase: Phase = "setup";
    if (e.evidenceId)
      phase = prosecution.has(e.evidenceId) ? "prosecution" : "defense";
    else if (e.type === "rest")
      phase = e.speakerId === "defense" ? "defense" : "prosecution";
    else if (e.type === "opening") phase = "openings";
    else if (e.type === "closing") phase = "closings";
    else if (e.round) phase = "deliberation";
    else if (e.type === "verdict") phase = "finished";
    const list = sections.get(phase) ?? [];
    list.push(e);
    sections.set(phase, list);
  }
  if (!sections.has(state.phase)) sections.set(state.phase, []);
  return (
    <section aria-label="庭审记录">
      {Array.from(sections, ([phase, entries]) => {
        const groups = new Map<string, CourtEvent[]>();
        for (const e of entries) {
          const key = e.evidenceId ?? (e.round ? "round-" + e.round : "main");
          const list = groups.get(key) ?? [];
          list.push(e);
          groups.set(key, list);
        }
        return (
          <Section
            key={phase}
            title={
              phase === "setup"
                ? "庭审准备"
                : phase === "deliberation"
                  ? "陪审团评议 · 旁观记录"
                  : phaseLabels[phase]
            }
          >
            {Array.from(groups, ([key, events]) => {
              const log = (
                <EventLog
                  bundle={bundle}
                  events={events}
                  liveSequence={speech?.sequence}
                />
              );
              if (key === "main") return <div key={key}>{log}</div>;
              const round = events[0].round;
              const title = round
                ? "第 " + round + " 轮评议"
                : (items.find((item) => item.id === key)?.title ?? key);
              const votes = state.rounds.find((r) => r.number === round)?.votes;
              const count =
                votes?.filter((v) => v.vote === "guilty").length ?? 0;
              const item = items.find((item) => item.id === key);
              const ruling = state.evidence.find((r) => r.id === key);
              const outcome = votes
                ? ` · ${count} 票有罪 / ${votes.length - count} 票无罪`
                : ruling
                  ? ruling.admitted
                    ? " · 已采纳"
                    : " · 已排除"
                  : "";
              return (
                <Section key={key} title={title + outcome}>
                  {item?.kind === "witness" && (
                    <details>
                      <summary>{item.profile.name} · 证人小传</summary>
                      <p className="dossier-prose">
                        {item.profile.personality}
                        {"\n\n"}
                        {item.profile.background}
                      </p>
                    </details>
                  )}
                  {log}
                </Section>
              );
            })}
          </Section>
        );
      })}
      {state.result && (
        <p className="tally">
          {state.rounds.length} 轮评议 ·{" "}
          {state.rounds.at(-1)?.votes.filter((v) => v.vote === "guilty").length}{" "}
          票有罪 /{" "}
          {
            state.rounds.at(-1)?.votes.filter((v) => v.vote === "not_guilty")
              .length
          }{" "}
          票无罪
        </p>
      )}
    </section>
  );
}
