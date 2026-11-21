import type { LlmDriver, RoleRequest, Reply } from "./driver";
import { throwIfAborted } from "./driver";

/** Deliberately scripted: this driver demonstrates mechanics, never evaluates a real case. */
export class DemoDriver implements LlmDriver {
  async complete(request: RoleRequest): Promise<Reply> {
    throwIfAborted(request.signal);
    if (request.task === "ruling")
      return {
        admitted: true,
        speech:
          "【演示裁定】本项材料予以采纳。采纳仅表示允许考虑，不代表其内容已被证明；可信度与分量交由陪审团判断。",
      };
    if (request.task === "vote") {
      const seat = Number(request.role.id.split("-").at(-1));
      const defense = request.hearing?.admittedDefense ?? 2;
      const prosecution = request.hearing?.admittedProsecution ?? 2;
      const guilty =
        prosecution > 0 &&
        (defense === 0
          ? request.round > 1 || seat % 3 !== 0
          : defense === 1
            ? seat % 3 === 0
            : request.round === 1 && seat % 3 === 0);
      return {
        vote: guilty ? "guilty" : "not_guilty",
        speech: guilty
          ? "【演示投票】我暂时认为线索能够相互印证。"
          : "【演示投票】身份和意图的证明仍有合理怀疑。",
      };
    }
    if (request.task === "challenge")
      return {
        speech:
          "【演示质证】请区分文件的存在与它实际能够证明的事实。该材料的来源和证明范围仍需核对。",
      };
    if (request.task === "summary")
      return {
        speech:
          "【演示汇总】陪审员围绕身份识别、记录的局限与证明责任交换意见。结果以系统统计的十二张票为准；这一演示采用预设投票，不代表模型推断。",
      };
    if (request.role.roleType === "witness") {
      const q = request.hearing?.question ?? "";
      if (request.role.id === "witness-reed") {
        if (/距|光|雨|灯|看清|脸|面部/.test(q))
          return {
            speech:
              "我距离装卸区约三十米。当时下着雨，有一盏灯坏了，我没看清他的脸。",
          };
        if (/外套|衣服|工装|身份|林安|确定/.test(q))
          return {
            speech:
              "我只认出了深蓝外套。那是仓库统一发的工装，我不能确定穿外套的人就是林安。",
          };
        if (/笔录|主管|报告/.test(q))
          return {
            speech: "我向主管说的是“可能是林安”。我看到笔录写成了“是林安”。",
          };
        return {
          speech: "我看见有人搬箱子，但看不清箱内物品，也没能确认对方的身份。",
        };
      }
      if (request.role.id === "witness-ortiz")
        return {
          speech: /工单|维护|安排/.test(q)
            ? "工单由主管签发，是我把网络维护任务派给林安的。"
            : "我能确认派单过程。我当晚留在调度室，没有看到谁搬走了设备。",
        };
      return { speech: "我只能确认已经陈述的观察。其他细节我无法确认。" };
    }
    if (request.role.roleType === "judge")
      return {
        speech:
          "【演示法律指示】控方须对每个必要要件排除合理怀疑。请只考虑获采纳的证据，律师的陈述不能替代证据，也不应迫使任何人放弃诚实判断。",
      };
    if (request.role.roleType === "prosecutor")
      return {
        speech:
          "【演示控方答复】请结合已经呈交的记录及其证明范围评估这一问题。",
      };
    const comments = [
      "门禁卡被使用，与确定持卡人的身份，仍是两件需要分别证明的事。",
      "目击观察的距离、光线与记忆局限，都影响证言分量。",
      "合法维护能够解释进入仓库的机会，但不能单独决定是否发生盗窃。",
      "我关注每一个要件是否得到证明，而不是要求被告先证明无罪。",
    ];
    return {
      speech: `【演示评议】${comments[(Number(request.role.id.split("-").at(-1)) - 1) % comments.length]}`,
    };
  }
}
