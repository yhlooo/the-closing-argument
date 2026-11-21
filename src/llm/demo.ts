import { screeningAssessment } from "./screening-demo";
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
    if (
      request.hearing?.caseId === "last-screening" &&
      request.role.roleType === "juror"
    )
      return screeningAssessment(request);
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
          : "【演示投票】对指控要件的证明仍有合理怀疑。",
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
          "【演示汇总】陪审员围绕已采纳材料、证言的局限与证明责任交换意见。结果以系统统计的十二张票为准；这一演示采用预设投票，不代表模型推断。",
      };
    if (request.role.roleType === "witness") {
      if (request.hearing?.scriptedAnswer)
        return { speech: request.hearing.scriptedAnswer };
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
      if (request.role.id === "witness-park")
        return {
          speech: /付|知道|通知/.test(q)
            ? "我没有告诉周宁首笔款项已付。公共邮箱由财务人员轮流查看。"
            : "我登记了周宁送来的补发发票。她说是按通知补材料。",
        };
      if (request.role.id === "witness-vale")
        return {
          speech: /校|读数|确认/.test(q)
            ? "我没有校验设备，不能判断纸带上的数字是否可靠。"
            : "交班时许川指着空白的那一栏，说还要等复核。",
        };
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
    const comments =
      request.hearing?.caseId === "restoration-invoice"
        ? [
            "同一份委托收到了两笔钱，但我们还得弄清经手人提交申请时知道什么。",
            "公共邮箱的付款回执，能证明是谁读过它吗？",
            "要判断意图，应当把补交材料的时间放回事情发生的顺序里。",
          ]
        : request.hearing?.caseId === "observatory-log"
          ? [
              "签署日报的人知道有空栏，与明知读数有效是两个问题。",
              "纸带留下了墨迹，我想知道怎样确认那是有效读数。",
              "记录员可以证明交班时说过什么，但没有校验仪器。",
            ]
          : request.hearing?.caseId === "harbor-ledger"
            ? [
                "门禁卡被使用，与确定持卡人的身份，仍是两件需要分别证明的事。",
                "目击观察的距离、光线与记忆局限，都影响证言分量。",
                "合法维护能够解释进入仓库的机会，但不能单独决定是否发生盗窃。",
                "我关注每一个要件是否得到证明，而不是要求被告先证明无罪。",
              ]
            : [
                "我关注控方是否对每个要件都给出了充分的证明。",
                "材料的来源和它能证明的事实需要分别判断。",
              ];
    return {
      speech: `【演示评议】${comments[(Number(request.role.id.split("-").at(-1)) - 1) % comments.length]}`,
    };
  }
}
