import { it, expect } from "vitest";
import { builtinBundle as content } from "../src/content/builtin";
import { courtTurn } from "../src/app/conductor";
import { CourtroomEngine } from "../src/engine/courtroom";
import { DemoDriver } from "../src/llm/demo";

it("自动主持只在辩方决策点停下，恢复已介绍的材料时不会重复举证", async () => {
  const e = new CourtroomEngine(content, new DemoDriver(), { seed: 7 });
  const signal = new AbortController().signal;
  async function advance() {
    for (let i = 0; i < 16; i++) {
      const next = courtTurn(e.getState(), content);
      if (!next) return;
      await next(e, signal);
    }
    throw Error("自动推进未停止");
  }
  await e.selectJury();
  await advance();
  expect(e.getState().openings).toEqual(["prosecution"]);
  await e.recordOpening("defense", "辩方开场");
  await advance();
  for (const item of content.case.prosecutionEvidence) {
    const events = e
      .getState()
      .events.filter((ev) => ev.evidenceId === item.id);
    expect(events[0].type).toBe("evidence");
    if (item.kind === "witness")
      expect(events.map((ev) => ev.type)).toEqual([
        "evidence",
        "question",
        "answer",
        "question",
        "answer",
        "supplement",
      ]);
    await e.presentEvidence("prosecution", item.id, "质证意见");
    await advance();
    expect(
      e
        .getState()
        .events.filter(
          (ev) => ev.type === "evidence" && ev.evidenceId === item.id,
        ),
    ).toHaveLength(1);
  }
  expect(e.getState().phase).toBe("defense");
  await e.rest("defense");
  await advance();
  expect(e.getState().closings).toEqual(["prosecution"]);
  await e.recordClosing("defense", "辩方结案");
  await advance();
  expect(e.getState().phase).toBe("finished");
});
