import { describe, expect, it } from "vitest";
import { builtinBundle } from "../src/content/builtin";
import { CourtroomEngine, projectEvents } from "../src/engine/courtroom";
import { createEvidenceSandbox } from "../src/engine/sandbox";
import { DemoDriver } from "../src/llm/demo";
import type { LlmDriver, Reply, RoleRequest } from "../src/llm/driver";
import type { ContentBundle } from "../src/domain/profiles";

class RecordingDriver extends DemoDriver {
  requests: RoleRequest[] = [];
  override async complete(request: RoleRequest): Promise<Reply> {
    const {
      askParticipant: _askParticipant,
      signal: _signal,
      ...record
    } = request;
    this.requests.push({
      ...structuredClone(record),
      signal: new AbortController().signal,
    });
    return super.complete(request);
  }
}
const fresh = (driver: LlmDriver = new DemoDriver(), bundle = builtinBundle) =>
  new CourtroomEngine(bundle, driver, { seed: 142 });
async function open(engine: CourtroomEngine) {
  await engine.selectJury();
  await engine.recordOpening("prosecution", "控方陈述");
  await engine.recordOpening("defense", "辩方陈述");
}
async function toDeliberation(engine: CourtroomEngine, bundle = builtinBundle) {
  await open(engine);
  for (const e of bundle.case.prosecutionEvidence)
    await engine.presentEvidence("prosecution", e.id, "质证");
  await engine.rest("prosecution");
  for (const e of bundle.case.defenseEvidence)
    await engine.presentEvidence("defense", e.id, "举证");
  await engine.rest("defense");
  await engine.recordClosing("prosecution", "控方总结");
  await engine.recordClosing("defense", "辩方总结");
}
describe("庭审状态与裁决", () => {
  it("完整演示经过分歧和第二轮一致无罪，终局后不能再投票", async () => {
    const engine = fresh();
    await toDeliberation(engine);
    await engine.deliberateRound();
    expect(engine.getState().phase).toBe("deliberation");
    expect(
      engine.getState().rounds[0].votes.filter((v) => v.vote === "guilty"),
    ).toHaveLength(4);
    await engine.deliberateRound();
    expect(engine.getState().result?.verdict).toBe("not_guilty");
    expect(engine.getState().rounds[1].votes).toHaveLength(12);
    await expect(engine.deliberateRound()).rejects.toThrow("评议条件");
  });
  it("阶段、双方顺序、空白陈述、重复提交均由引擎拒绝", async () => {
    const engine = fresh();
    await expect(engine.deliberateRound()).rejects.toThrow();
    await engine.selectJury();
    await expect(engine.selectJury()).rejects.toThrow();
    await expect(engine.recordOpening("defense", "提前")).rejects.toThrow(
      "先进行控方",
    );
    await expect(engine.recordOpening("prosecution", "  ")).rejects.toThrow();
    await engine.recordOpening("prosecution", "控方");
    await expect(engine.recordOpening("prosecution", "重复")).rejects.toThrow();
    await engine.recordOpening("defense", "辩方");
    await expect(engine.rest("prosecution")).rejects.toThrow("全部");
    await expect(
      engine.presentEvidence("defense", "maintenance-order", "提前"),
    ).rejects.toThrow();
    await expect(
      engine.questionWitness("prosecution", "access-log", "问题"),
    ).rejects.toThrow("不是证人");
    await engine.presentEvidence("prosecution", "access-log", "质证");
    await expect(
      engine.presentEvidence("prosecution", "access-log", "重复"),
    ).rejects.toThrow("已经裁决");
  });
  it("连续十轮不一致为僵局，不是无罪；汇总不得改变系统结果", async () => {
    const driver: LlmDriver = {
      complete: async (r) =>
        r.task === "vote"
          ? {
              speech: "判断",
              vote: r.role.id === "juror-1" ? "guilty" : "not_guilty",
            }
          : r.task === "summary"
            ? { speech: "模型自称无罪，但不能改变结果" }
            : new DemoDriver().complete(r),
    };
    const engine = fresh(driver);
    await toDeliberation(engine);
    for (let round = 0; round < 10; round++) await engine.deliberateRound();
    expect(engine.getState().result?.verdict).toBe("hung");
    expect(engine.getState().rounds).toHaveLength(10);
  });
  it("十二张有罪票才产生有罪", async () => {
    const driver: LlmDriver = {
      complete: async (r) =>
        r.task === "vote"
          ? { speech: "判断", vote: "guilty" }
          : new DemoDriver().complete(r),
    };
    const engine = fresh(driver);
    await toDeliberation(engine);
    await engine.deliberateRound();
    expect(engine.getState().result?.verdict).toBe("guilty");
  });
  it("不接受非法票，整轮回滚，重试不会多出半轮发言或记忆", async () => {
    let fail = true;
    const driver: LlmDriver = {
      complete: async (r) =>
        r.task === "vote" && fail
          ? { speech: "非法", vote: "abstain" as "guilty" }
          : new DemoDriver().complete(r),
    };
    const engine = fresh(driver);
    await toDeliberation(engine);
    const before = engine.getState();
    await expect(engine.deliberateRound()).rejects.toThrow();
    expect(engine.getState()).toEqual(before);
    fail = false;
    await engine.deliberateRound();
    expect(engine.getState().rounds).toHaveLength(1);
  });
  it("输入和玩家视图都是副本，不能从外部改写内部状态", async () => {
    const bundle = structuredClone(builtinBundle),
      engine = fresh(new DemoDriver(), bundle);
    bundle.judge.name = "外部修改";
    await open(engine);
    const state = engine.getState();
    state.phase = "finished";
    state.jurors[0].name = "外部修改";
    await engine.presentEvidence("prosecution", "access-log", "质证");
    expect(engine.getState().phase).toBe("prosecution");
    expect(engine.getState().events.at(-1)?.speakerName).toBe(
      builtinBundle.judge.name,
    );
    expect(engine.getState().jurors[0].name).not.toBe("外部修改");
  });
});
describe("角色上下文与事务", () => {
  it("证人秘密只在其本人 system，私有 reasoning 只回到同一角色", async () => {
    const recording = new RecordingDriver();
    const driver: LlmDriver = {
      complete: async (request) => ({
        ...(await recording.complete(request)),
        reasoning: `PRIVATE-${request.role.id}`,
      }),
    };
    const engine = fresh(driver);
    await open(engine);
    await engine.questionWitness(
      "prosecution",
      "guard-testimony",
      "你看清脸了吗？",
    );
    await engine.questionWitness(
      "prosecution",
      "guard-testimony",
      "距离是多少？",
    );
    await engine.presentEvidence("prosecution", "access-log", "质证");
    const witness = recording.requests.filter(
      (r) => r.role.roleType === "witness",
    );
    expect(witness[0].system).toContain("一盏灯损坏");
    expect(witness[1].prompt).toContain("PRIVATE-witness-reed");
    expect(
      recording.requests
        .filter((r) => r.role.roleType === "judge")
        .every(
          (r) =>
            !r.system.includes("一盏灯损坏") &&
            !r.prompt.includes("PRIVATE-witness-reed"),
        ),
    ).toBe(true);
    expect(JSON.stringify(engine.getState())).not.toContain("PRIVATE-");
    expect(JSON.stringify(engine.getState())).not.toContain("privateKnowledge");
  });
  it("排除的证据及问答不进入评议 prompt，判前裁决记忆也不再回放", async () => {
    const bundle = structuredClone(builtinBundle);
    bundle.case.prosecutionEvidence[0].description = "EXCLUDED-SECRET";
    const recording = new RecordingDriver();
    const driver: LlmDriver = {
      complete: async (request) =>
        request.task === "ruling"
          ? { speech: "EXCLUDED-REASON", admitted: false }
          : recording.complete(request),
    };
    const engine = fresh(driver, bundle);
    await toDeliberation(engine, bundle);
    await engine.deliberateRound();
    const deliberating = recording.requests.filter((r) =>
      ["juror", "judge"].includes(r.role.roleType),
    );
    expect(
      deliberating.every(
        (r) =>
          !r.prompt.includes("EXCLUDED-SECRET") &&
          !r.prompt.includes("EXCLUDED-REASON"),
      ),
    ).toBe(true);
    expect(deliberating[0].prompt).toContain("已被排除");
    const prosecutor = projectEvents(engine.getState(), bundle.prosecutor);
    expect(prosecutor.every((e) => e.visibility === "public")).toBe(true);
  });
  it("同一轮投票时看不到本轮其他人的票", async () => {
    const driver = new RecordingDriver(),
      engine = fresh(driver);
    await toDeliberation(engine);
    await engine.deliberateRound();
    expect(
      driver.requests
        .filter((r) => r.task === "vote")
        .every((r) => !r.prompt.includes('"type":"vote"')),
    ).toBe(true);
  });
  it("证人问答预设只回放一次，裁决后不可再次询问", async () => {
    const engine = fresh();
    await open(engine);
    await engine.questionWitness("prosecution", "guard-testimony", "第一问");
    await engine.questionWitness("prosecution", "guard-testimony", "第二问");
    await engine.presentEvidence("prosecution", "guard-testimony", "质证");
    expect(
      engine
        .getState()
        .events.filter(
          (e) => e.type === "evidence" && e.evidenceId === "guard-testimony",
        ),
    ).toHaveLength(1);
    await expect(
      engine.questionWitness("prosecution", "guard-testimony", "第三问"),
    ).rejects.toThrow("已经裁决");
  });
  it("工具公开问答可进入本次裁决，临时会话不污染主会话", async () => {
    const recording = new RecordingDriver();
    let rulingCalls = 0;
    const driver: LlmDriver = {
      complete: async (request) => {
        if (request.task === "ruling" && ++rulingCalls === 1) {
          await request.askParticipant!("witness-reed", "工具问题");
          await request.askParticipant!("defense", "请说明你的意见");
        }
        return {
          ...(await recording.complete(request)),
          reasoning: "TEMPORARY-REASON",
        };
      },
    };
    const engine = new CourtroomEngine(builtinBundle, driver, {
      seed: 4,
      answerDefense: async () => "玩家澄清",
    });
    await open(engine);
    await engine.presentEvidence("prosecution", "guard-testimony", "质证");
    expect(engine.getState().events.some((e) => e.text === "玩家澄清")).toBe(
      true,
    );
    // Check the next role interaction against the actual witness main memory in a separate transaction:
    const driver2: LlmDriver = {
      complete: async (r) => {
        if (r.task === "challenge") {
          await r.askParticipant!("witness-reed", "临时提问一");
          await r.askParticipant!("witness-reed", "临时提问二");
        }
        return {
          ...(await recording.complete(r)),
          reasoning: r.prompt.includes("本轮任务：回答公开问题")
            ? "TEMP-ONLY"
            : "MAIN-ONLY",
        };
      },
    };
    const bundle = structuredClone(builtinBundle);
    const e = bundle.case.prosecutionEvidence[1];
    bundle.case.prosecutionEvidence = [];
    bundle.case.defenseEvidence = [e];
    const instance = fresh(driver2, bundle);
    await open(instance);
    await instance.rest("prosecution");
    await instance.questionWitness("defense", e.id, "主会话问题");
    await instance.presentEvidence("defense", e.id, "说明");
    const temporary = recording.requests.filter(
      (r) =>
        r.role.roleType === "witness" &&
        r.prompt.includes("本轮任务：回答公开问题"),
    );
    expect(temporary.at(-1)?.prompt).toContain("MAIN-ONLY");
    expect(temporary.at(-1)?.prompt).not.toContain("TEMP-ONLY");
  });
  it("工具目标越权、调用超预算或缺少玩家回调时整项回滚", async () => {
    for (const mode of ["invalid", "budget", "no-callback"]) {
      const driver: LlmDriver = {
        complete: async (r) => {
          if (r.task === "ruling") {
            if (mode === "invalid") await r.askParticipant!("juror-1", "越权");
            else if (mode === "budget")
              for (let i = 0; i < 5; i++)
                await r.askParticipant!(
                  builtinBundle.prosecutor.id,
                  "重复询问",
                );
            else await r.askParticipant!("defense", "玩家问题");
          }
          return new DemoDriver().complete(r);
        },
      };
      const engine = fresh(driver);
      await open(engine);
      const before = engine.getState();
      await expect(
        engine.presentEvidence("prosecution", "access-log", "质证"),
      ).rejects.toThrow();
      expect(engine.getState()).toEqual(before);
    }
  });
  it("模型在证据/评议中途失败，不保留事件和私有记忆", async () => {
    let fail = true;
    const recording = new RecordingDriver();
    const driver: LlmDriver = {
      complete: async (r) => {
        if (fail && r.task === "ruling") throw new Error("network");
        return recording.complete(r);
      },
    };
    const engine = fresh(driver);
    await open(engine);
    const before = engine.getState();
    await expect(
      engine.presentEvidence("prosecution", "access-log", "FAILED-SUBMISSION"),
    ).rejects.toThrow();
    expect(engine.getState()).toEqual(before);
    fail = false;
    await engine.presentEvidence("prosecution", "access-log", "重试");
    expect(recording.requests.at(-1)?.prompt).not.toContain(
      "FAILED-SUBMISSION",
    );
  });
  it("运行中拒绝并发命令，取消后的晚到回包不能提交", async () => {
    let resolve!: (reply: Reply) => void;
    const driver: LlmDriver = {
      complete: () =>
        new Promise<Reply>((r) => {
          resolve = r;
        }),
    };
    const engine = fresh(driver);
    await open(engine);
    const before = engine.getState(),
      controller = new AbortController();
    const pending = engine.presentEvidence(
      "prosecution",
      "access-log",
      "等待",
      controller.signal,
    );
    await expect(engine.rest("prosecution")).rejects.toThrow("操作进行中");
    controller.abort();
    resolve({ speech: "晚到结果", admitted: true });
    await expect(pending).rejects.toThrow();
    expect(engine.getState()).toEqual(before);
  });
  it("独立调试辩方证人只调用该证据参与者，正式庭审不变", async () => {
    const bundle: ContentBundle = structuredClone(builtinBundle),
      live = fresh();
    await open(live);
    const before = live.getState();
    const witness = bundle.case.prosecutionEvidence[1];
    bundle.case.defenseEvidence = [witness];
    bundle.case.prosecutionEvidence = [];
    const sandbox = await createEvidenceSandbox(
      bundle,
      new DemoDriver(),
      "defense",
      witness.id,
      { seed: 1 },
    );
    await sandbox.questionWitness("defense", witness.id, "问题");
    await sandbox.presentEvidence("defense", witness.id, "说明");
    expect(sandbox.getState().evidence).toHaveLength(1);
    expect(live.getState()).toEqual(before);
    expect(
      sandbox.getState().events.find((e) => e.type === "question")?.speakerId,
    ).toBe("defense");
  });
});

describe("MVP 行为回归", () => {
  it("辩方可直接结束举证，已请证人必须先完成裁决", async () => {
    const noEvidence = structuredClone(builtinBundle);
    noEvidence.case.prosecutionEvidence = [];
    const first = fresh(new DemoDriver(), noEvidence);
    await open(first);
    await first.rest("prosecution");
    await first.rest("defense");
    expect(first.getState().phase).toBe("closings");
    const second = fresh(new DemoDriver(), noEvidence);
    await open(second);
    await second.rest("prosecution");
    await second.introduceWitness("defense", "dispatcher-testimony");
    await expect(second.rest("defense")).rejects.toThrow("当前材料");
  });
  it("证人只收到出庭后的公开记录，最后由法官询问", async () => {
    const driver = new RecordingDriver(),
      engine = fresh(driver);
    await open(engine);
    await engine.presentEvidence("prosecution", "access-log", "BEFORE-WITNESS");
    await engine.questionWitness(
      "prosecution",
      "guard-testimony",
      "距离是多少？",
    );
    await engine.presentEvidence("prosecution", "guard-testimony", "质证");
    const questions = engine
      .getState()
      .events.filter((e) => e.type === "question");
    expect(questions[0].speakerId).toBe(builtinBundle.prosecutor.id);
    expect(questions.at(-1)?.speakerId).toBe(builtinBundle.judge.id);
    expect(
      driver.requests
        .filter((r) => r.role.roleType === "witness")
        .every((r) => !r.prompt.includes("BEFORE-WITNESS")),
    ).toBe(true);
  });
  it("从已提交快照继续，存档事务失败时不推进游戏", async () => {
    let saved: import("../src/engine/courtroom").Snapshot | undefined;
    const first = new CourtroomEngine(builtinBundle, new DemoDriver(), {
      seed: 3,
      onCommit: async (snapshot) => {
        saved = snapshot;
      },
    });
    await first.selectJury();
    const resumed = new CourtroomEngine(builtinBundle, new DemoDriver(), {
      seed: 9,
      snapshot: saved,
      onCommit: async () => {
        throw new Error("disk");
      },
    });
    expect(resumed.getState()).toEqual(first.getState());
    await expect(resumed.recordOpening("prosecution", "提交")).rejects.toThrow(
      "disk",
    );
    expect(resumed.getState().openings).toEqual([]);
  });
});

describe("离线举证选择", () => {
  it.each([
    [0, "guilty", 2],
    [1, "hung", 10],
    [2, "not_guilty", 2],
  ] as const)(
    "提交 %i 份辩方材料，终局为 %s",
    async (count, verdict, rounds) => {
      const engine = fresh();
      await open(engine);
      for (const item of builtinBundle.case.prosecutionEvidence) {
        await engine.presentEvidence("prosecution", item.id, "请核实证明范围");
      }
      await engine.rest("prosecution");
      for (const item of builtinBundle.case.defenseEvidence.slice(0, count)) {
        await engine.presentEvidence("defense", item.id, item.purpose);
      }
      await engine.rest("defense");
      await engine.recordClosing("prosecution", "控方陈述");
      await engine.recordClosing("defense", "辩方陈述");
      for (let i = 0; i < rounds; i++) await engine.deliberateRound();
      expect(engine.getState().result?.verdict).toBe(verdict);
    },
  );
});
