import type { RoleProfile } from "./profiles";

export type Side = "prosecution" | "defense";
export type Phase =
  | "setup"
  | "openings"
  | "prosecution"
  | "defense"
  | "closings"
  | "deliberation"
  | "finished";
export type Vote = "guilty" | "not_guilty";
export type Verdict = Vote | "hung";
export interface CourtEvent {
  sequence: number;
  type: string;
  speakerId: string;
  speakerName: string;
  text: string;
  visibility: "public" | "jury";
  evidenceId?: string;
  round?: number;
}
export interface EvidenceRecord {
  id: string;
  title: string;
  side: Side;
  admitted: boolean;
  reason: string;
}
export interface JuryRound {
  number: number;
  votes: { jurorId: string; vote: Vote }[];
}
export interface CourtState {
  phase: Phase;
  jurors: RoleProfile[];
  events: CourtEvent[];
  evidence: EvidenceRecord[];
  openings: Side[];
  closings: Side[];
  rounds: JuryRound[];
  result?: { verdict: Verdict; summary: string };
}
export const phaseLabels: Record<Phase, string> = {
  setup: "陪审团选任",
  openings: "开庭陈述",
  prosecution: "控方举证",
  defense: "辩方举证",
  closings: "最后陈述",
  deliberation: "陪审团评议",
  finished: "裁决宣告",
};
export const verdictLabels: Record<Verdict, string> = {
  guilty: "有罪",
  not_guilty: "无罪",
  hung: "陪审团僵局",
};
