import type { CourtState } from "../domain/courtroom";
import type { ContentBundle } from "../domain/profiles";
import type { CourtroomEngine } from "../engine/courtroom";

export function courtTurn(
  state: CourtState,
  bundle: ContentBundle,
):
  | ((engine: CourtroomEngine, signal: AbortSignal) => Promise<void>)
  | undefined {
  const c = bundle.case;
  switch (state.phase) {
    case "openings":
      if (!state.openings.includes("prosecution"))
        return (e, s) =>
          e.recordOpening("prosecution", c.prosecutionOpening, s);
      break;
    case "prosecution": {
      const next = c.prosecutionEvidence.find(
        (item) => !state.evidence.some((r) => r.id === item.id),
      );
      if (!next) return (e, s) => e.rest("prosecution", s);
      if (
        !state.events.some(
          (ev) => ev.evidenceId === next.id && ev.type === "evidence",
        )
      )
        return (e, s) => e.introduceProsecution(next.id, s);
      break;
    }
    case "defense":
      if (
        c.defenseEvidence.every((item) =>
          state.evidence.some((r) => r.id === item.id),
        )
      )
        return (e, s) => e.rest("defense", s);
      break;
    case "closings":
      if (!state.closings.includes("prosecution"))
        return (e, s) =>
          e.recordClosing("prosecution", c.prosecutionClosing, s);
      break;
    case "deliberation":
      return (e, s) => e.deliberateRound(s);
  }
}

export function delay(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    signal.throwIfAborted();
    const cancel = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", cancel);
      resolve();
    }, ms);
    signal.addEventListener("abort", cancel, { once: true });
  });
}
