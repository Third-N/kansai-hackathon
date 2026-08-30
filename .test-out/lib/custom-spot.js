/* ============================================================
   検索で見つけた場所を、決まった6箇所と同じ形の Spot にする。

   前は混雑を常に30%固定・recommendedStayMin を未設定にしていた。
   後者は model.ts の「滞在の8割で気分回復」判定が
   d >= (recommendedStayMin ?? d) * 0.8 という式のせいで、
   未設定だと常に d 自身と比べて必ず真になり、1分の素通りでも
   じっくり2時間まわったのと同じ気分ボーナスが付いてしまっていた。

   端末内900件の検索（lib/local-place-search.ts）はカテゴリと
   priority（1000+は厳選スポット、それ未満はOSMの実測タグから
   推定した知名度）を持っているので、それを使って
   lib/spots.ts の手作業チューニングに近い、時間帯で山のある
   混雑カーブと、カテゴリなりの消耗・気分の重み・推奨滞在時間を作る。
   Geoapifyのオンライン検索にはカテゴリが無いので「その他・並」で作る。

   閉門時刻は分からないので24時（実質「時間で閉まらない」）にして、
   遅着扱いにしない。
   ============================================================ */
/** 時間帯ごとの相対的な混雑の山。0..1。lib/spots.ts の手作業カーブと同じ発想 */
const CATEGORY_SHAPE = {
    temple: { 8: .25, 9: .4, 10: .55, 11: .75, 12: .85, 13: .85, 14: .75, 15: .6, 16: .4, 17: .25 },
    shrine: { 8: .25, 9: .4, 10: .55, 11: .75, 12: .85, 13: .85, 14: .75, 15: .6, 16: .4, 17: .25 },
    historic: { 8: .15, 9: .3, 10: .45, 11: .6, 12: .65, 13: .65, 14: .6, 15: .5, 16: .35, 17: .2 },
    culture: { 9: .3, 10: .5, 11: .6, 12: .55, 13: .6, 14: .65, 15: .6, 16: .45, 17: .25 },
    nature: { 8: .2, 9: .4, 10: .65, 11: .8, 12: .85, 13: .8, 14: .75, 15: .65, 16: .45, 17: .25 },
    // 駅は通勤時間帯の朝夕2山。観光の山とは形が違う
    station: { 7: .5, 8: .75, 9: .5, 10: .3, 11: .3, 12: .35, 13: .3, 14: .3, 15: .35, 16: .45, 17: .6, 18: .75, 19: .65, 20: .45 },
    // 飲食は昼と夜の2山
    food: { 10: .3, 11: .55, 12: .8, 13: .75, 14: .45, 15: .3, 16: .3, 17: .45, 18: .75, 19: .8, 20: .6 },
    shopping: { 10: .3, 11: .45, 12: .55, 13: .6, 14: .65, 15: .7, 16: .65, 17: .55, 18: .4 },
    other: { 9: .25, 10: .35, 11: .45, 12: .5, 13: .5, 14: .45, 15: .4, 16: .3, 17: .2 },
};
/** カテゴリなりの消耗（坂・階段等）と気分の上がりやすさ。lib/spots.ts の値の範囲に合わせた */
const CATEGORY_WEIGHT = {
    temple: { burn: 1.3, joy: 1.3, stayMin: 60 },
    shrine: { burn: 1.2, joy: 1.4, stayMin: 45 },
    historic: { burn: 1.0, joy: 1.2, stayMin: 40 },
    culture: { burn: 0.7, joy: 1.2, stayMin: 50 },
    nature: { burn: 1.1, joy: 1.5, stayMin: 50 },
    station: { burn: 0.5, joy: 0.8, stayMin: 10 },
    food: { burn: 0.5, joy: 1.4, stayMin: 40 },
    shopping: { burn: 0.7, joy: 1.2, stayMin: 40 },
    other: { burn: 1.0, joy: 1.2, stayMin: 30 },
};
/** 端末内データの priority が無い（Geoapify経由）ときの既定値。一般OSM相当の並スポット扱い */
const DEFAULT_PRIORITY = 40;
/**
 * priority から、混雑カーブの高さ（0..1）を作る。
 * 1000以上は厳選スポット（伏見稲荷・清水寺など、実際によく混む場所）で
 * 0.65〜1.0。それ未満は一般のOSM由来で、タグの充実度なりに0.25〜0.60。
 */
function fameAmplitude(priority) {
    if (priority >= 1000) {
        const t = Math.min(1, (priority - 1000) / 100);
        return 0.65 + t * 0.35;
    }
    const t = Math.min(1, Math.max(0, priority) / 150);
    return 0.25 + t * 0.35;
}
export function makeCustomSpot(input) {
    const category = input.category && CATEGORY_SHAPE[input.category] ? input.category : "other";
    const priority = input.priority ?? DEFAULT_PRIORITY;
    const amplitude = fameAmplitude(priority);
    const shape = CATEGORY_SHAPE[category];
    const weight = CATEGORY_WEIGHT[category];
    const crowdByHour = Object.fromEntries(Object.entries(shape).map(([hour, v]) => [Number(hour), Math.min(1, Math.round(v * amplitude * 100) / 100)]));
    // 厳選スポットほどじっくり回る前提で、推奨滞在時間を少し伸ばす
    const stayBoost = priority >= 1000 ? 15 : 0;
    return {
        id: `custom:${crypto.randomUUID()}`,
        name: input.name,
        sub: input.sub || "自分で追加",
        kind: "spot",
        burn: weight.burn,
        joy: weight.joy,
        crowdByHour,
        recommendedStayMin: weight.stayMin + stayBoost,
        closeMin: 24 * 60,
        lat: input.lat,
        lng: input.lng,
    };
}
