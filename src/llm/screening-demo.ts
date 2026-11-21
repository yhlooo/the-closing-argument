import type { Reply, RoleRequest } from "./driver";

/** Authored offline outcomes for the ninth screening. The live driver reasons from the record. */
export function screeningAssessment(request: RoleRequest): Reply {
  const record = request.hearing;
  const has = (id: string) => record?.admittedIds?.includes(id);
  const said = (id: string, speaker: string, words: string) =>
    has(id) &&
    record?.testimony?.some(
      (e) =>
        e.evidenceId === id &&
        e.speakerId === speaker &&
        e.text.includes(words),
    );
  const seat = Number(request.role.id.split("-").at(-1));
  const prosecution = [
    "p-claim",
    "p-stop",
    "p-window",
    "p-room",
    "p-keeper",
  ].every(has);
  const publicScreening =
    has("d-strip") &&
    has("d-stubs") &&
    said("d-viewer", "witness-viewer", "四〇六");
  const notice =
    has("d-receipt") && said("d-runner", "witness-runner", "念「蓝夹九枚」");
  const bookingChallenged = said("p-keeper", "witness-keeper", "下午三点预填");
  const windowChallenged = said("p-window", "witness-window", "离开西窗六分钟");

  let guilty = false;
  let reasons: string[];
  if (!prosecution) {
    reasons = [
      "控方举出的材料还没有把停映、实际用途和签报时明知这几步接起来。",
    ];
  } else if (publicScreening) {
    reasons = [
      "纸带本来只能证明机器转过。四〇六号票的主人却说出了自己怎样进门、看到了哪一行字幕。我对纯属内部校片的说法有疑问。",
      "西口那张止步牌是真的。东廊撕下的小头也能与观众留下的大头对上，我不认为从西口退场的人就能说明另一边也没有开放。",
      "电影院可能没有照顾好每一位客人，但原票换场、接放四十七分钟和带字幕的片尾都有了独立来历。控方还没有证明申领确实不实。",
    ];
  } else if (notice) {
    reasons = [
      "交接笺没有主任签收，单看压痕我不会相信已经转达。可收发员听到她在领空白表以前念出蓝夹数字，两个时点接起来了。",
      "九枚票是否代表九个人仍有疑问。这里影响我判断的是，主任在签字前接到了一份报告接续放映的消息。",
      "即使她理应亲自再去问一次，也不能从漏核验直接推出她明知虚假。早班交接提供了一个有当面言词支持的解释。",
    ];
  } else if (bookingChallenged && windowChallenged && seat % 3 !== 0) {
    reasons = [
      "用途在下午预填，领班又不能替离窗的六分钟作证。两处原先看似互相印证的记录，都没有覆盖真正有争议的时刻。",
    ];
  } else {
    guilty = true;
    reasons = [
      "停映是主任亲自签收的消息。听到退票汇报以后，她仍亲口要求整场申报，次日的申领和实际付款都与这句话相合。",
      "我最在意她交回西口止步牌这件事。房间登记作校片、现场又有观众止步的牌子，签表的人知道两项情形。",
      "只凭大厅停机，我不会认定次晨的签字是故意的。亲收红单、报整场的指示和归还校片牌的证言连起来，才使我相信她明知。",
    ];
  }
  const reason = reasons[(seat + request.round - 2) % reasons.length];
  return request.task === "vote"
    ? {
        vote: guilty ? "guilty" : "not_guilty",
        speech: "【演示投票】" + reason,
      }
    : { speech: "【演示评议】" + reason };
}
