import {
  bundleSchema,
  generateJury,
  text,
  type ContentBundle,
  type EvidenceProfile,
  type RoleProfile,
} from "../domain/profiles";
import type {
  CourtEvent,
  CourtState,
  Side,
  Verdict,
  Vote,
} from "../domain/courtroom";
import { verdictLabels } from "../domain/courtroom";
import type { LlmDriver, Task } from "../llm/driver";
import { replyFormat, throwIfAborted, validateReply } from "../llm/driver";

export class CourtError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CourtError";
  }
}
const requireThat: (
  condition: unknown,
  message: string,
) => asserts condition = (condition, message) => {
  if (!condition) throw new CourtError(message);
};
const clean = (value: string) => text.parse(value);
type Memories = Record<
  string,
  { task: Task; speech: string; reasoning?: string }[]
>;
interface Work {
  state: CourtState;
  memories: Memories;
  signal: AbortSignal;
}
export interface Snapshot {
  state: CourtState;
  memories: Memories;
}
interface EngineOptions {
  snapshot?: Snapshot;
  onCommit?: (snapshot: Snapshot) => Promise<void>;
  seed: number;
  answerDefense?: (question: string, signal: AbortSignal) => Promise<string>;
  onLine?: (event: CourtEvent, signal: AbortSignal) => Promise<void>;
  onSpeech?: (event: CourtEvent) => void;
  onProgress?: (message: string) => void;
}
export function projectEvents(
  state: CourtState,
  role: RoleProfile,
): CourtEvent[] {
  const deliberating = ["deliberation", "finished"].includes(state.phase);
  const excluded = new Set(
    state.evidence.filter((e) => !e.admitted).map((e) => e.id),
  );
  const judicial = role.roleType === "judge" || role.roleType === "juror";
  return state.events
    .filter(
      (e) =>
        (e.visibility === "public" || judicial) &&
        !(deliberating && e.evidenceId && excluded.has(e.evidenceId)),
    )
    .concat(
      deliberating
        ? state.evidence
            .filter((e) => !e.admitted)
            .map((e) => ({
              sequence: 0,
              type: "excluded",
              speakerId: "system",
              speakerName: "书记员",
              text: `${e.id} 已被排除，不得用于裁决。`,
              visibility: "public" as const,
            }))
        : [],
    );
}
export class CourtroomEngine {
  private readonly bundle: ContentBundle;
  private state: CourtState = {
    phase: "setup",
    jurors: [],
    events: [],
    evidence: [],
    openings: [],
    closings: [],
    rounds: [],
  };
  private memories: Memories = {};
  private running = false;
  constructor(
    bundle: ContentBundle,
    private driver: LlmDriver,
    private options: EngineOptions,
  ) {
    this.bundle = bundleSchema.parse(structuredClone(bundle));
    if (options.snapshot) {
      const saved = structuredClone(options.snapshot);
      this.state = saved.state;
      this.memories = saved.memories;
    }
  }
  getState(): CourtState {
    return structuredClone(this.state);
  }
  private async transaction<T>(
    fn: (work: Work) => Promise<T> | T,
    signal = new AbortController().signal,
  ): Promise<T> {
    requireThat(!this.running, "当前已有操作进行中");
    this.running = true;
    const work: Work = {
      state: structuredClone(this.state),
      memories: structuredClone(this.memories),
      signal,
    };
    try {
      throwIfAborted(signal);
      const result = await fn(work);
      throwIfAborted(signal);
      await this.options.onCommit?.({
        state: work.state,
        memories: work.memories,
      });
      this.state = work.state;
      this.memories = work.memories;
      return result;
    } finally {
      this.running = false;
    }
  }
  private async append(
    work: Work,
    speaker: RoleProfile | Side | "system",
    type: string,
    value: string,
    extra: Partial<CourtEvent> = {},
  ) {
    const role = typeof speaker === "string" ? undefined : speaker;
    work.state.events.push({
      sequence: work.state.events.length + 1,
      type,
      speakerId: role?.id ?? String(speaker),
      speakerName:
        role?.name ??
        (speaker === "defense"
          ? "你 · 辩护律师"
          : speaker === "prosecution"
            ? this.bundle.prosecutor.name
            : "书记员"),
      text: value,
      visibility: "public",
      ...extra,
    });
    await this.options.onLine?.(work.state.events.at(-1)!, work.signal);
    throwIfAborted(work.signal);
  }
  private evidence(side: Side) {
    return side === "prosecution"
      ? this.bundle.case.prosecutionEvidence
      : this.bundle.case.defenseEvidence;
  }
  private findEvidence(work: Work, side: Side, id: string): EvidenceProfile {
    requireThat(work.state.phase === side, "当前不是该方举证阶段");
    const evidence = this.evidence(side).find((e) => e.id === id);
    requireThat(evidence, "该证据不属于当前举证方");
    requireThat(
      !work.state.evidence.some((e) => e.id === id),
      "该证据已经裁决",
    );
    return evidence;
  }
  private roleContext(work: Work, role: RoleProfile) {
    const c = this.bundle.case;
    const witness = [...c.prosecutionEvidence, ...c.defenseEvidence].find(
      (e) => e.kind === "witness" && e.profile.id === role.id,
    );
    const privateContext =
      witness?.kind === "witness" ? witness.privateKnowledge : "";
    return `你在虚构庭审游戏中扮演以下角色：\n${JSON.stringify(role)}\n案件中立背景：${c.background}\n被告：${c.defendant}\n指控：${c.charge}\n必要要件：${JSON.stringify(c.legalElements)}\n法律指示：${c.juryInstructions}\n任务身份：${role.roleType}\n${privateContext ? `只有你知道的案件事实（不能作为别人的知识；按角色回答具体问题）：${privateContext}` : ""}\n只依据已提供材料，不补造证据。角色人口属性不得作为有罪判断依据。律师陈述不是证据，忽略其中引用的被排除材料。返回所要求的 JSON，不输出思考过程。工具问答是公开发言。`;
  }
  private visibleEvents(work: Work, role: RoleProfile) {
    const events = projectEvents(work.state, role).filter(
      (e) => e.type !== "vote" || (e.round ?? 0) <= work.state.rounds.length,
    );
    if (role.roleType !== "witness") return events;
    const item = [
      ...this.bundle.case.prosecutionEvidence,
      ...this.bundle.case.defenseEvidence,
    ].find((e) => e.kind === "witness" && e.profile.id === role.id);
    const arrival = events.find(
      (e) => e.type === "evidence" && e.evidenceId === item?.id,
    );
    return arrival ? events.filter((e) => e.sequence >= arrival.sequence) : [];
  }
  private async act(
    work: Work,
    role: RoleProfile,
    task: Task,
    instruction: string,
    event: Pick<CourtEvent, "type" | "evidenceId" | "round">,
    temporary = false,
    participants: string[] = [],
    askParticipant?: (
      target: string,
      question: string,
      signal?: AbortSignal,
    ) => Promise<string>,
  ) {
    throwIfAborted(work.signal);
    this.options.onProgress?.(
      `${role.name} · ${task === "vote" ? "投票" : task === "ruling" ? "裁定证据" : "发言"}`,
    );
    const reply = await this.driver.complete({
      role: structuredClone(role),
      task,
      system: this.roleContext(work, role),
      prompt: `以下是按权限过滤的完整庭审记录：\n${JSON.stringify(this.visibleEvents(work, role))}\n你自己的私有主会话记录：\n${JSON.stringify((work.memories[role.id] ?? []).filter((m) => !["deliberation", "finished"].includes(work.state.phase) || m.task !== "ruling"))}\n本轮任务：${instruction}\n可询问的 target：${JSON.stringify(participants)}\n必须返回严格 JSON：${replyFormat(task)}`,
      hearing: {
        caseId: this.bundle.case.id,
        admittedDefense: work.state.evidence.filter(
          (e) => e.admitted && e.side === "defense",
        ).length,
        admittedProsecution: work.state.evidence.filter(
          (e) => e.admitted && e.side === "prosecution",
        ).length,
        question:
          role.roleType === "witness"
            ? work.state.events.at(-1)?.text
            : undefined,
      },
      round: work.state.rounds.length + 1,
      participants,
      askParticipant,
      ...(this.options.onSpeech && {
        onSpeech: (body: string) => {
          throwIfAborted(work.signal);
          this.options.onSpeech!({
            ...event,
            sequence: work.state.events.length + 1,
            speakerId: role.id,
            speakerName: role.name,
            text: body,
            visibility: event.round ? "jury" : "public",
          });
        },
      }),
      signal: work.signal,
    });
    throwIfAborted(work.signal);
    const { reasoning, ...output } = reply;
    const valid = validateReply(task, output);
    if (!temporary)
      (work.memories[role.id] ??= []).push({
        task,
        speech: valid.speech,
        ...(reasoning ? { reasoning } : {}),
      });
    return valid;
  }
  selectJury(signal?: AbortSignal) {
    return this.transaction(async (work) => {
      requireThat(work.state.phase === "setup", "陪审团已选任");
      work.state.jurors = generateJury(this.bundle.juryPool, this.options.seed);
      work.state.phase = "openings";
      await this.append(
        work,
        "system",
        "jury-selected",
        "十二位陪审员已就席。被告享有无罪推定，控方承担排除合理怀疑的证明责任。",
      );
    }, signal);
  }
  recordOpening(side: Side, value: string, signal?: AbortSignal) {
    return this.transaction(async (work) => {
      requireThat(work.state.phase === "openings", "当前不是开庭陈述阶段");
      requireThat(!work.state.openings.includes(side), "该方已完成开庭陈述");
      requireThat(
        side === "prosecution" || work.state.openings.includes("prosecution"),
        "应先进行控方陈述",
      );
      await this.append(work, side, "opening", clean(value));
      work.state.openings.push(side);
      if (work.state.openings.length === 2) work.state.phase = "prosecution";
    }, signal);
  }
  questionWitness(side: Side, id: string, value: string, signal?: AbortSignal) {
    return this.transaction(async (work) => {
      const e = this.findEvidence(work, side, id);
      requireThat(e.kind === "witness", "该材料不是证人");
      await this.ensureWitness(work, e, side);
      await this.append(work, "defense", "question", clean(value), {
        evidenceId: id,
      });
      const reply = await this.act(
        work,
        e.profile,
        "speak",
        `回答辩方刚才的问题：${clean(value)}`,
        { type: "answer", evidenceId: id },
      );
      await this.append(work, e.profile, "answer", reply.speech, {
        evidenceId: id,
      });
    }, signal);
  }
  private async ensureWitness(
    work: Work,
    e: Extract<EvidenceProfile, { kind: "witness" }>,
    side: Side,
  ) {
    if (
      work.state.events.some(
        (event) => event.type === "evidence" && event.evidenceId === e.id,
      )
    )
      return;
    await this.append(work, side, "evidence", `${e.title}\n${e.description}`, {
      evidenceId: e.id,
    });
    if (side === "prosecution") {
      await this.examine(work, e, this.bundle.prosecutor, e.directExamination);
      await this.append(work, side, "supplement", e.purpose, {
        evidenceId: e.id,
      });
    }
  }
  private async examine(
    work: Work,
    witness: Extract<EvidenceProfile, { kind: "witness" }>,
    examiner: RoleProfile,
    references: { question: string; answer: string }[],
  ) {
    const questions = references.length
      ? references.slice(0, 3)
      : [
          {
            question: "请澄清哪些情况是你亲自观察到的。",
            answer: "我只能确认本人亲自观察到的情况。",
          },
        ];
    for (const qa of questions) {
      const question = this.driver.live
        ? (
            await this.act(
              work,
              examiner,
              "speak",
              "只提出一个问题。参考提问：" + qa.question,
              { type: "question", evidenceId: witness.id },
            )
          ).speech
        : qa.question;
      await this.append(work, examiner, "question", question, {
        evidenceId: witness.id,
      });
      const answer = this.driver.live
        ? (
            await this.act(
              work,
              witness.profile,
              "speak",
              "回答刚才的问题。仅供本人参考：" + qa.answer,
              { type: "answer", evidenceId: witness.id },
            )
          ).speech
        : qa.answer;
      await this.append(work, witness.profile, "answer", answer, {
        evidenceId: witness.id,
      });
    }
  }
  introduceWitness(side: Side, id: string, signal?: AbortSignal) {
    return this.transaction(async (work) => {
      const item = this.findEvidence(work, side, id);
      requireThat(item.kind === "witness", "该材料不是证人");
      await this.ensureWitness(work, item, side);
    }, signal);
  }
  introduceProsecution(id: string, signal?: AbortSignal) {
    return this.transaction(async (work) => {
      const item = this.findEvidence(work, "prosecution", id);
      requireThat(
        !work.state.events.some(
          (e) => e.evidenceId === id && e.type === "evidence",
        ),
        "该材料已出庭",
      );
      if (item.kind === "witness")
        await this.ensureWitness(work, item, "prosecution");
      else
        await this.append(
          work,
          "prosecution",
          "evidence",
          item.title + "\n" + item.description + "\n引用理由：" + item.purpose,
          { evidenceId: id },
        );
    }, signal);
  }
  presentEvidence(
    side: Side,
    id: string,
    argument: string,
    signal?: AbortSignal,
  ) {
    return this.transaction(async (work) => {
      const e = this.findEvidence(work, side, id),
        statement = clean(argument);
      if (e.kind === "witness") await this.ensureWitness(work, e, side);
      else if (
        !work.state.events.some(
          (ev) => ev.type === "evidence" && ev.evidenceId === id,
        )
      )
        await this.append(
          work,
          side,
          "evidence",
          side === "prosecution"
            ? `${e.title}\n${e.description}\n引用理由：${e.purpose}`
            : `${e.title}\n${e.description}`,
          { evidenceId: id },
        );
      const targets = [
        this.bundle.prosecutor.id,
        "defense",
        ...(e.kind === "witness" ? [e.profile.id] : []),
      ];
      let toolCount = 0;
      const ask =
        (allowed: string[], speaker: RoleProfile) =>
        async (target: string, question: string, signal = work.signal) => {
          const taskSignal = AbortSignal.any([work.signal, signal]);
          requireThat(allowed.includes(target), "该角色无权询问此对象");
          requireThat(++toolCount <= 4, "当前角色任务的工具调用预算已耗尽");
          const q = clean(question);
          throwIfAborted(taskSignal);
          await this.append(work, speaker, "question", q, { evidenceId: id });
          let answer: string, respondent: RoleProfile | "defense";
          if (target === "defense") {
            requireThat(
              this.options.answerDefense,
              "当前调用未提供辩方澄清回调",
            );
            answer = clean(await this.options.answerDefense(q, taskSignal));
            respondent = "defense";
          } else {
            respondent =
              target === this.bundle.prosecutor.id
                ? this.bundle.prosecutor
                : e.kind === "witness"
                  ? e.profile
                  : this.bundle.prosecutor;
            answer = (
              await this.act(
                { ...work, signal: taskSignal },
                respondent,
                "speak",
                `回答公开问题：${q}`,
                { type: "answer", evidenceId: id },
                true,
              )
            ).speech;
          }
          throwIfAborted(taskSignal);
          await this.append(work, respondent, "answer", answer, {
            evidenceId: id,
          });
          return answer;
        };
      await this.append(
        work,
        "defense",
        side === "prosecution" ? "challenge" : "submission",
        statement,
        { evidenceId: id },
      );
      if (side === "defense") {
        const allowed = e.kind === "witness" ? [e.profile.id] : [];
        if (e.kind === "witness") {
          const question = "你能亲自确认哪些事实？哪些情况超出了你的观察范围？";
          await ask(allowed, this.bundle.prosecutor)(e.profile.id, question);
        }
        const reply = await this.act(
          work,
          this.bundle.prosecutor,
          "challenge",
          `请对辩方提交的 ${e.title} 发表质证意见。`,
          { type: "challenge", evidenceId: id },
          false,
          allowed,
          ask(allowed, this.bundle.prosecutor),
        );
        await this.append(
          work,
          this.bundle.prosecutor,
          "challenge",
          reply.speech,
          {
            evidenceId: id,
          },
        );
      }
      if (e.kind === "witness") {
        await this.examine(work, e, this.bundle.judge, e.judgeExamination);
      }
      toolCount = 0;
      const ruling = await this.act(
        work,
        this.bundle.judge,
        "ruling",
        `只裁定 ${e.title} 是否采纳，并给出理由。不要裁定被告有罪与否。必要时使用工具澄清，最多四次。`,
        { type: "ruling", evidenceId: id },
        false,
        targets,
        ask(targets, this.bundle.judge),
      );
      await this.append(
        work,
        this.bundle.judge,
        "ruling",
        `${ruling.admitted ? "采纳" : "排除"} · ${ruling.speech}`,
        { evidenceId: id },
      );
      work.state.evidence.push({
        id,
        title: e.title,
        side,
        admitted: ruling.admitted!,
        reason: ruling.speech,
      });
    }, signal);
  }
  rest(side: Side, signal?: AbortSignal) {
    return this.transaction(async (work) => {
      requireThat(work.state.phase === side, "当前不是该方举证阶段");
      requireThat(
        !work.state.events.some(
          (e) =>
            e.type === "evidence" &&
            !work.state.evidence.some((r) => r.id === e.evidenceId),
        ),
        "请先完成当前材料的裁决",
      );
      requireThat(
        side === "defense" ||
          this.evidence(side).every((e) =>
            work.state.evidence.some((r) => r.id === e.id),
          ),
        "请先完成本方全部预设证据的裁决",
      );
      await this.append(
        work,
        side,
        "rest",
        `${side === "prosecution" ? "控方" : "辩方"}举证完毕。`,
      );
      work.state.phase = side === "prosecution" ? "defense" : "closings";
    }, signal);
  }
  recordClosing(side: Side, value: string, signal?: AbortSignal) {
    return this.transaction(async (work) => {
      requireThat(work.state.phase === "closings", "当前不是最后陈述阶段");
      requireThat(!work.state.closings.includes(side), "该方已完成最后陈述");
      requireThat(
        side === "prosecution" || work.state.closings.includes("prosecution"),
        "应先进行控方最后陈述",
      );
      const body =
        side === "prosecution" && this.driver.live
          ? (
              await this.act(
                work,
                this.bundle.prosecutor,
                "speak",
                "依据本庭已采纳证据作最后陈述。参考草稿：" + clean(value),
                { type: "closing" },
              )
            ).speech
          : clean(value);
      await this.append(work, side, "closing", body);
      work.state.closings.push(side);
      if (work.state.closings.length === 2) work.state.phase = "deliberation";
    }, signal);
  }
  deliberateRound(signal?: AbortSignal) {
    return this.transaction(async (work) => {
      requireThat(
        work.state.phase === "deliberation" && work.state.jurors.length === 12,
        "尚未满足评议条件",
      );
      const round = work.state.rounds.length + 1;
      requireThat(round <= 10, "已达到十轮上限");
      for (const juror of work.state.jurors) {
        const reply = await this.act(
          work,
          juror,
          "speak",
          `第 ${round} 轮：依照获采纳证据评价各项要件，与其他陪审员交换意见。`,
          { type: "deliberation", round },
        );
        await this.append(work, juror, "deliberation", reply.speech, {
          visibility: "jury",
          round,
        });
      }
      const guidance = await this.act(
        work,
        this.bundle.judge,
        "speak",
        "提供中立法律指示，纠正对未采纳材料或证明责任的误解，不替陪审员决定事实。",
        { type: "guidance", round },
      );
      await this.append(work, this.bundle.judge, "guidance", guidance.speech, {
        visibility: "jury",
        round,
      });
      const votes: { jurorId: string; vote: Vote }[] = [];
      for (const juror of work.state.jurors) {
        const reply = await this.act(
          work,
          juror,
          "vote",
          "请独立投票：所有必要要件是否均排除合理怀疑？仅可 guilty 或 not_guilty。",
          { type: "vote", round },
        );
        votes.push({ jurorId: juror.id, vote: reply.vote! });
        await this.append(
          work,
          juror,
          "vote",
          verdictLabels[reply.vote!] + " · " + reply.speech,
          { visibility: "jury", round },
        );
      }
      work.state.rounds.push({ number: round, votes });
      const unanimous = votes.every((v) => v.vote === votes[0].vote);
      if (unanimous || round === 10) {
        const verdict: Verdict = unanimous ? votes[0].vote : "hung";
        const summary = await this.act(
          work,
          this.bundle.judge,
          "summary",
          `系统统计的最终结果为「${verdictLabels[verdict]}」。请总结主要意见与分歧，不改变该结果，不推测未公开的心理活动。`,
          { type: "verdict" },
        );
        work.state.result = { verdict, summary: summary.speech };
        work.state.phase = "finished";
        await this.append(
          work,
          this.bundle.judge,
          "verdict",
          `${verdictLabels[verdict]}\n${summary.speech}`,
        );
      }
    }, signal);
  }
}
