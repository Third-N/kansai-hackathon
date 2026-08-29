export type SpotKind = "spot" | "meal" | "rest";
export type DayType = "weekday" | "saturday" | "holiday";

export interface Spot {
  id: string;
  name: string;
  sub: string;
  kind: SpotKind;
  /** 消耗の重み。坂道や階段が多いほど大きい。1.0 が平地の基準 */
  burn: number;
  /** 体験の濃さ。気分の上がりやすさ */
  joy: number;
  /** 時刻(時)→混雑推定 0..1。C が天候と利用者分布で補正する */
  crowdByHour: Record<number, number>;
  /** 曜日別の混雑推定。未設定時は crowdByHour を全曜日の基準にする */
  crowdByDay?: Partial<Record<DayType, Record<number, number>>>;
  /** 推奨滞在時間。80%以上滞在したときのテンション回復判定に使う */
  recommendedStayMin?: number;
  /** 閉門・閉店時刻（0時からの分） */
  closeMin: number;
  lat: number;
  lng: number;
}

export interface PlanItem {
  spotId: string;
  stayMin: number;
}

export interface Member {
  id: string;
  label: string;
  isHost: boolean;
  /** 個人差。1.0 が基準、大きいほど疲れやすい */
  staminaFactor: number;
}

export type TripMode = "solo" | "party";

export interface Trip {
  id: string;
  mode: TripMode;
  /** パーティのあいことば。solo では undefined */
  code?: string;
  /** YYYY-MM-DD */
  date: string;
  /** 出発時刻（0時からの分） */
  startMin: number;
  plan: PlanItem[];
  /** 検索して自分で足した行き先。SPOTS(lib/spots.ts)には無いのでここに持つ */
  customSpots?: Record<string, Spot>;
  members: Member[];
  /** 今日すでに呼び出した回数 */
  callsUsed: number;
  status: "planning" | "running" | "done";
  /** 待合を閉じたか。閉じると新しい人は入れない */
  locked?: boolean;
  /** 部屋の寿命。過ぎたら閉じ、あいことばが解放される */
  expiresAt?: string;
}

export interface Segment {
  type: "move" | "stay";
  /** move のときは行き先、stay のときは滞在先 */
  spotId: string;
  startMin: number;
  endMin: number;
  hpIn: number;
  hpOut: number;
  mpIn: number;
  mpOut: number;
  /** その区間の混雑推定。move では null */
  crowd: number | null;
  /** move 区間の推定徒歩距離 */
  distanceKm?: number;
  /** stay 区間の推定行列時間 */
  queueMin?: number;
}

export interface SimResult {
  timeline: Segment[];
  /** 体力が尽きる時刻。尽きなければ null */
  collapseMin: number | null;
  /** 閉門後に着いてしまうスポット */
  lateArrivals: { spotId: string; arriveMin: number }[];
  /** HP/MP が破綻ラインを初めて下回る時刻 */
  lowHpMin?: number | null;
  lowMpMin?: number | null;
  endHp: number;
  endMp: number;
}

export interface Revision {
  plan: PlanItem[];
  result: SimResult;
  /** 何を変えたか。文面生成に使う */
  changes: {
    reordered: boolean;
    insertedRestId: string | null;
    movedLater: string | null;
    /** 落とした1件。無ければ null */
    droppedId: string | null;
    /** 滞在時間を縮めたか */
    shortened: boolean;
  };
}

/* ---------- せーの ---------- */

export interface RoundOption {
  id: string;
  label: string;
  sub: string;
}

export type RoundStatus = "open" | "revealed";

export interface Round {
  id: string;
  tripId: string;
  question: string;
  options: RoundOption[];
  /** サーバー時刻。全端末はこれを見て逆算する */
  revealAt: string;
  status: RoundStatus;
  /** 提出済みの人数。誰が出したかは返さない */
  submittedCount: number;
  memberCount: number;
  result: RoundResult | null;
  /** 選ばれた案を適用するための対応表 optionId -> plan */
  planByOption: Record<string, PlanItem[]>;
}

export interface RoundResult {
  tally: { optionId: string; count: number }[];
  winnerId: string;
  /** unanimous: 反対ゼロが1つ / tied: 反対ゼロが複数 / compromise: 全滅したので最少反対 */
  kind: "unanimous" | "tied" | "compromise";
  survivorCount: number;
}
