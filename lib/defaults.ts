import type { PlanItem } from "./types";

/** 行き先が未選択のときの初期プラン。
 *  C の候補生成が入ったら、ここは選択結果で置き換わる。 */
export const DEFAULT_PLAN: PlanItem[] = [
  { spotId: "inari", stayMin: 70 },
  { spotId: "kiyomizu", stayMin: 60 },
  { spotId: "nishiki", stayMin: 50 },
  { spotId: "nanzenji", stayMin: 50 },
];

export const DEFAULT_START_MIN = 10 * 60 + 30;
