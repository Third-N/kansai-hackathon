/* ============================================================
   「せーの」— 全員が匿名で「これは嫌」だけを出し、一斉に開く。
   ここは純関数だけ。通信は lib/store.ts、画面は app/ 側。
   ============================================================ */
/** 選択肢の数から、1人が出せる「嫌」の上限を決める。
 *  上限が無いと全滅が通常ケースになる（M×(1−v/M)^N が1を下回る）。 */
export function vetoCap(optionCount) {
    return Math.max(1, Math.floor(optionCount / 3));
}
/** 再構成案の並びを、投票にかけられる選択肢に変える */
export function optionsFromRevisions(revisions, spots, max = 4) {
    return revisions.slice(0, max).map((r, i) => ({
        id: `opt${i + 1}`,
        label: labelFor(r, spots),
        sub: subFor(r),
    }));
}
function labelFor(r, spots) {
    const { droppedId, insertedRestId, shortened, movedLater } = r.changes;
    if (droppedId)
        return `${spots[droppedId].name}をあきらめる`;
    if (insertedRestId && shortened)
        return `休憩を入れて、少しずつ短くする`;
    if (insertedRestId)
        return `${spots[insertedRestId].name}で休憩を挟む`;
    if (shortened)
        return `どこも少しずつ短くする`;
    if (movedLater)
        return `${spots[movedLater].name}を後ろにまわす`;
    return "順番を入れ替える";
}
function subFor(r) {
    return `着地 体力${Math.round(r.result.endHp)} ・ 気分${Math.round(r.result.endMp)}`;
}
/**
 * 開示の計算。反対ゼロの選択肢を残す。
 * 全部に誰かが反対していたら、反対の最も少ないものを妥協点として出す。
 * 同数のときは決めきれないので、tiebreak（呼び出し側が渡す乱数）で1つ選ぶ。
 */
export function resolveRound(options, vetoes, tiebreak) {
    const counts = new Map(options.map((o) => [o.id, 0]));
    for (const v of vetoes) {
        if (counts.has(v.optionId))
            counts.set(v.optionId, counts.get(v.optionId) + 1);
    }
    const tally = options.map((o) => ({ optionId: o.id, count: counts.get(o.id) }));
    const survivors = tally.filter((t) => t.count === 0);
    if (survivors.length > 0) {
        const pick = survivors[Math.floor(tiebreak * survivors.length) % survivors.length];
        return {
            tally,
            winnerId: pick.optionId,
            kind: survivors.length === 1 ? "unanimous" : "tied",
            survivorCount: survivors.length,
        };
    }
    const min = Math.min(...tally.map((t) => t.count));
    const least = tally.filter((t) => t.count === min);
    const pick = least[Math.floor(tiebreak * least.length) % least.length];
    return { tally, winnerId: pick.optionId, kind: "compromise", survivorCount: 0 };
}
/**
 * 決めきれないときの選び手。乱数ではなく round id から決める。
 * 開示は冪等でなければならないので、同じ round なら何度呼んでも同じ答えが要る。
 * Math.random() だと、2回目の開示で別の案が勝ちうる。
 * SQL 側の round_tiebreak() と同じ役割（値の一致は要らない。どちらも決定論的であればよい）。
 */
export function roundTiebreak(roundId) {
    let h = 0x811c9dc5;
    for (let i = 0; i < roundId.length; i++) {
        h ^= roundId.charCodeAt(i);
        h = Math.imul(h, 0x01000193) >>> 0;
    }
    return (h % 1000000) / 1000000;
}
/** 開示までの残り秒。サーバー時刻から逆算する。端末のタイマーは信用しない */
export function secondsUntil(revealAtIso, now = Date.now()) {
    return Math.max(0, (new Date(revealAtIso).getTime() - now) / 1000);
}
export function isRevealable(round, now = Date.now()) {
    return round.status !== "revealed" && secondsUntil(round.revealAt, now) <= 0;
}
