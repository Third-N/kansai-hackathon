/* 混雑は時間帯別の推定値。リアルタイム値ではない。
   C が天候と自アプリ利用者の位置分布で補正する。 */
export const SPOTS = {
    inari: {
        id: "inari", name: "伏見稲荷大社", sub: "稲荷山 登拝", kind: "spot",
        burn: 1.9, joy: 1.5, recommendedStayMin: 90, closeMin: 24 * 60, lat: 34.9671, lng: 135.7727,
        crowdByHour: { 8: .3, 9: .45, 10: .6, 11: .7, 12: .7, 13: .6, 14: .5, 15: .4, 16: .3, 17: .2 },
    },
    kiyomizu: {
        id: "kiyomizu", name: "清水寺", sub: "拝観 18:00まで", kind: "spot",
        burn: 1.4, joy: 1.4, recommendedStayMin: 75, closeMin: 18 * 60, lat: 34.9948, lng: 135.7850,
        crowdByHour: { 8: .35, 9: .5, 10: .6, 11: .8, 12: .9, 13: .95, 14: .95, 15: .85, 16: .45, 17: .25 },
    },
    nishiki: {
        id: "nishiki", name: "錦市場", sub: "昼食", kind: "meal",
        burn: 0.6, joy: 1.4, recommendedStayMin: 45, closeMin: 17 * 60 + 30, lat: 35.0050, lng: 135.7648,
        crowdByHour: { 10: .4, 11: .6, 12: .8, 13: .8, 14: .7, 15: .5, 16: .4, 17: .3 },
    },
    nanzenji: {
        id: "nanzenji", name: "南禅寺", sub: "拝観 17:00まで", kind: "spot",
        burn: 1.0, joy: 1.2, recommendedStayMin: 60, closeMin: 17 * 60, lat: 35.0114, lng: 135.7944,
        crowdByHour: { 9: .2, 10: .2, 11: .3, 12: .3, 13: .3, 14: .3, 15: .3, 16: .25, 17: .2 },
    },
    ginkakuji: {
        id: "ginkakuji", name: "銀閣寺", sub: "拝観 17:00まで", kind: "spot",
        burn: 1.2, joy: 1.3, recommendedStayMin: 60, closeMin: 17 * 60, lat: 35.0270, lng: 135.7982,
        crowdByHour: { 9: .3, 10: .45, 11: .6, 12: .65, 13: .65, 14: .6, 15: .5, 16: .35, 17: .2 },
    },
    arashiyama: {
        id: "arashiyama", name: "竹林の小径", sub: "嵐山", kind: "spot",
        burn: 1.1, joy: 1.5, recommendedStayMin: 60, closeMin: 24 * 60, lat: 35.0170, lng: 135.6716,
        crowdByHour: { 8: .2, 9: .4, 10: .7, 11: .85, 12: .9, 13: .85, 14: .8, 15: .7, 16: .5, 17: .3 },
    },
    /* 休憩候補。再構成のときに挿入される */
    tetsugaku: {
        id: "tetsugaku", name: "哲学の道のカフェ", sub: "休憩", kind: "rest",
        burn: 0, joy: 1.0, recommendedStayMin: 30, closeMin: 18 * 60, lat: 35.0230, lng: 135.7950,
        crowdByHour: { 10: .2, 11: .2, 12: .4, 13: .4, 14: .3, 15: .3, 16: .3, 17: .2 },
    },
    kamogawa: {
        id: "kamogawa", name: "鴨川の河原", sub: "休憩", kind: "rest",
        burn: 0, joy: 1.1, recommendedStayMin: 30, closeMin: 24 * 60, lat: 35.0090, lng: 135.7720,
        crowdByHour: { 10: .2, 11: .2, 12: .3, 13: .3, 14: .3, 15: .35, 16: .4, 17: .5 },
    },
};
/**
 * スポット × 時間帯 × 曜日の混雑推定テーブル。
 * 現時点は平日実測値を基準にした初期推定で、土曜+12%、日祝+20%。
 * 実測データが集まったスポットから、この生成値を個別テーブルへ置き換える。
 */
for (const spot of Object.values(SPOTS)) {
    const scaled = (factor) => Object.fromEntries(Object.entries(spot.crowdByHour).map(([hour, value]) => [Number(hour), Math.min(1, value * factor)]));
    spot.crowdByDay = {
        weekday: { ...spot.crowdByHour },
        saturday: scaled(1.12),
        holiday: scaled(1.20),
    };
}
/** 決まったSPOTSに、その道中で検索して足した行き先を重ねる */
export function spotsFor(trip) {
    return trip.customSpots ? { ...SPOTS, ...trip.customSpots } : SPOTS;
}
export const REST_CANDIDATES = ["tetsugaku", "kamogawa"];
/** 実測に近い所要分。無い組は model 側で距離から近似する */
export const TRAVEL_TABLE = {
    "inari|kiyomizu": 30,
    "inari|nishiki": 25,
    "inari|nanzenji": 40,
    "kiyomizu|nishiki": 20,
    "kiyomizu|nanzenji": 25,
    "nanzenji|nishiki": 22,
    "ginkakuji|nanzenji": 20,
    "ginkakuji|kiyomizu": 32,
    "nanzenji|tetsugaku": 8,
    "kiyomizu|tetsugaku": 25,
    "nishiki|tetsugaku": 24,
    "inari|tetsugaku": 42,
    "kamogawa|nishiki": 8,
    "kamogawa|kiyomizu": 18,
    "kamogawa|nanzenji": 20,
    "inari|kamogawa": 22,
};
