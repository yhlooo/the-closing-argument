import { describe, expect, it } from "vitest";
import { caseLibrary } from "../src/content/builtin";
import { generateJury, parseResource, toYaml } from "../src/domain/profiles";
import { CourtroomEngine } from "../src/engine/courtroom";
import { DemoDriver } from "../src/llm/demo";

const bundle = caseLibrary.find((b) => b.case.id === "last-screening")!;
const c = bundle.case;
const hanLength = (s: string) => s.match(/\p{Script=Han}/gu)?.length ?? 0;

describe("散场以后，第九场", () => {
  it("可携完整案件包导入；每位具名角色和案情均超过千字", () => {
    expect(parseResource(toYaml(bundle))).toEqual(bundle);
    expect(c.background).toContain("无争议的调查事实");
    expect(c.background).toContain("检方试图证明的事项");
    expect(hanLength(c.background)).toBeGreaterThanOrEqual(1000);
    expect(hanLength(c.defendantBiography!)).toBeGreaterThanOrEqual(1000);
    const jury = generateJury(bundle.juryPool, 12);
    expect(jury).toEqual(generateJury(bundle.juryPool, 12));
    expect(new Set(jury.map((j) => j.name)).size).toBe(12);
    expect(jury).not.toEqual(generateJury(bundle.juryPool, 13));
    const people = [...jury, bundle.judge, bundle.prosecutor];
    for (const side of [c.prosecutionEvidence, c.defenseEvidence]) {
      expect(side).toHaveLength(5);
      const witnesses = side.filter((e) => e.kind === "witness");
      expect(witnesses).toHaveLength(2);
      people.push(...witnesses.map((w) => w.profile));
    }
    for (const p of people)
      expect(
        hanLength(p.personality + p.background),
        p.name,
      ).toBeGreaterThanOrEqual(1000);
  });

  async function tryCase(
    defense: string[],
    questions: Record<string, string> = {},
  ) {
    const engine = new CourtroomEngine(bundle, new DemoDriver(), { seed: 52 });
    await engine.selectJury();
    await engine.recordOpening("prosecution", c.prosecutionOpening);
    await engine.recordOpening("defense", "保留陈述。");
    for (const item of c.prosecutionEvidence) {
      await engine.introduceProsecution(item.id);
      if (questions[item.id])
        await engine.questionWitness(
          "prosecution",
          item.id,
          questions[item.id],
        );
      await engine.presentEvidence("prosecution", item.id, "无补充意见。");
    }
    await engine.rest("prosecution");
    for (const id of defense) {
      const item = c.defenseEvidence.find((e) => e.id === id)!;
      if (item.kind === "witness")
        await engine.questionWitness(
          "defense",
          id,
          item.directExamination[0].question,
        );
      await engine.presentEvidence("defense", id, item.purpose);
    }
    await engine.rest("defense");
    await engine.recordClosing("prosecution", c.prosecutionClosing);
    await engine.recordClosing("defense", "请依法裁决。");
    while (!engine.getState().result) await engine.deliberateRound();
    return engine.getState();
  }

  it("不质询、不举证时控方能独立说服十二席，秘密仍未进入证言", async () => {
    const state = await tryCase([]);
    expect(state.result?.verdict).toBe("guilty");
    expect(
      state.rounds.at(-1)?.votes.filter((v) => v.vote === "guilty"),
    ).toHaveLength(12);
    expect(
      state.events
        .filter((e) => e.type === "answer")
        .map((e) => e.text)
        .join(" "),
    ).not.toMatch(/下午三点预填|离开西窗六分钟/);
  });
  it.each([
    { items: ["d-strip", "d-receipt"], verdict: "guilty" },
    { items: ["d-strip", "d-stubs", "d-viewer"], verdict: "not_guilty" },
    { items: ["d-receipt", "d-runner"], verdict: "not_guilty" },
  ])("只按已形成的证据联系评议：$items", async ({ items, verdict }) => {
    expect((await tryCase(items)).result?.verdict).toBe(verdict);
  });
  it("只靠针对性的交叉询问也能改变票型", async () => {
    const state = await tryCase([], {
      "p-window": "你全程都在西窗吗？",
      "p-keeper": "两种笔色是同时落笔的吗？",
    });
    expect(state.result?.verdict).toBe("hung");
    expect(
      state.events
        .filter((e) => e.type === "answer")
        .map((e) => e.text)
        .join(" "),
    ).toMatch(/离开西窗六分钟/);
  });
});
