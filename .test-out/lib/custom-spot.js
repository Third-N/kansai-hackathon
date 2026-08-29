/* ============================================================
   検索で見つけた場所を、決まった6箇所と同じ形の Spot にする。

   混雑・消耗・気分の重みは実測が無いので、既存スポットの
   だいたい中間の値を既定にしている。閉門時刻も分からないので
   24時（実質「時間で閉まらない」）にして、遅着扱いにしない。
   ============================================================ */
export function makeCustomSpot(input) {
    return {
        id: `custom:${crypto.randomUUID()}`,
        name: input.name,
        sub: input.sub || "自分で追加",
        kind: "spot",
        burn: 1.2,
        joy: 1.3,
        crowdByHour: {},
        closeMin: 24 * 60,
        lat: input.lat,
        lng: input.lng,
    };
}
