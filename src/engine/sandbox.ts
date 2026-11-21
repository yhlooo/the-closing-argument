import type { ContentBundle } from "../domain/profiles";
import type { Side } from "../domain/courtroom";
import type { LlmDriver } from "../llm/driver";
import { CourtroomEngine } from "./courtroom";

/** A separate, minimal fixture: no skipped state guards and no live-game mutation. */
export async function createEvidenceSandbox(
  bundle: ContentBundle,
  driver: LlmDriver,
  side: Side,
  evidenceId: string,
  options: ConstructorParameters<typeof CourtroomEngine>[2],
) {
  const fixture = structuredClone(bundle);
  fixture.case.prosecutionEvidence =
    side === "prosecution"
      ? fixture.case.prosecutionEvidence.filter((e) => e.id === evidenceId)
      : [];
  fixture.case.defenseEvidence =
    side === "defense"
      ? fixture.case.defenseEvidence.filter((e) => e.id === evidenceId)
      : [];
  const engine = new CourtroomEngine(fixture, driver, options);
  await engine.selectJury();
  await engine.recordOpening("prosecution", fixture.case.prosecutionOpening);
  await engine.recordOpening("defense", fixture.case.defenseOpening);
  if (side === "defense") await engine.rest("prosecution");
  return engine;
}
