import { hhmm } from "./format";
/** 体力が尽きる区間のスポット名 */
export function collapseSpotName(result, spots) {
    if (result.collapseMin === null)
        return null;
    const g = result.timeline.find((s) => result.collapseMin >= s.startMin && result.collapseMin <= s.endMin);
    return g ? spots[g.spotId].name : null;
}
/** 割り込みの文面。何を変えるかから組み立てる */
export function interruptCopy(current, revision, spots, mode) {
    const late = current.lateArrivals[0];
    let title;
    if (current.lowHpMin !== null || current.collapseMin !== null) {
        const riskMin = current.lowHpMin ?? current.collapseMin;
        const segment = current.timeline.find((s) => riskMin >= s.startMin && riskMin <= s.endMin);
        const where = segment ? spots[segment.spotId].name : collapseSpotName(current, spots);
        title = mode === "party"
            ? `このまま行くと、${where}でパーティの体力が限界に近づきます。`
            : `このまま行くと、${where}で体力が15を下回ります。`;
    }
    else if (current.lowMpMin !== null) {
        const segment = current.timeline.find((s) => current.lowMpMin >= s.startMin && current.lowMpMin <= s.endMin);
        title = `このまま行くと、${segment ? spots[segment.spotId].name : "この先"}でテンションが15を下回ります。`;
    }
    else if (late) {
        title = `${spots[late.spotId].name}は、着く頃には閉まっています。`;
    }
    else {
        return null;
    }
    if (!revision) {
        return {
            title,
            body: "順路を組み替えても、今日中に全部はまわれません。1件減らすか、明日にまわすかになります。",
            primary: "1件減らす",
            secondary: "このまま行く",
        };
    }
    const parts = [];
    const { insertedRestId, movedLater, droppedId, shortened } = revision.changes;
    // 落とすことは必ず最初に、はっきり言う
    if (droppedId) {
        parts.push(`${spots[droppedId].name}を今日はあきらめます`);
    }
    if (shortened) {
        parts.push("それぞれの滞在を少し短くします");
    }
    if (insertedRestId) {
        parts.push(`${spots[insertedRestId].name}で休憩を挟みます`);
    }
    if (movedLater) {
        const s = spots[movedLater];
        const after = revision.result.timeline.find((g) => g.type === "stay" && g.spotId === movedLater);
        const before = current.timeline.find((g) => g.type === "stay" && g.spotId === movedLater);
        if (after) {
            // 混雑は simulate() がその旅程の dayType で計算済みの値をそのまま使う。
            // ここで crowdAt を引数無しで呼び直すと平日テーブルに固定されてしまい、
            // 土日祝の旅程で実際の値と食い違う
            const cAfter = after.crowd;
            const cBefore = before ? before.crowd : null;
            // 実際に空く場合だけ混雑を持ち出す。変わらないなら時刻だけ言う
            if (cBefore !== null && cAfter !== null && cAfter < cBefore - 0.1) {
                parts.push(`${s.name}を${hhmm(after.startMin)}にずらすと、混雑が${Math.round(cBefore * 100)}%から${Math.round(cAfter * 100)}%まで下がります`);
            }
            else {
                parts.push(`${s.name}を${hhmm(after.startMin)}にまわします`);
            }
        }
    }
    if (parts.length === 0 && revision.changes.reordered) {
        parts.push("順路を入れ替えます");
    }
    const end = revision.result;
    parts.push(`最後まで体力が残ります（着地 体力${Math.round(end.endHp)}）`);
    return {
        title,
        body: parts.join("。") + "。",
        primary: droppedId
            ? (mode === "party" ? "みんなで決める" : "1件あきらめる")
            : (mode === "party" ? "みんなで決める" : "入れ替える"),
        secondary: "このまま行く",
    };
}
