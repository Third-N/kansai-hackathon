import type { Member, PlanItem, Round, RoundOption, Spot, Trip, TripMode } from "./types";

/* ============================================================
   データ境界。UI は TripStore しか触らない。
   実装は2つある:
     - store.local.ts    … localStorage。開発とオフラインの既定
     - store.supabase.ts … Supabase。Realtime と「せーの」の本番
   どちらを使うかは store.ts が環境変数で決める。
   ------------------------------------------------------------
   実装を増やすときは、このファイルの型と test/store.contract.ts の
   契約テストだけを見ればよい。UI 側は一行も変わらない。
   ============================================================ */

/** 1日に呼び出せる回数。企画の「1日5回しか呼びません」 */
export const CALL_BUDGET = 5;

/** 待合の定員。README の「デモの本番は5〜7人で」に対する上限側の歯止め */
export const ROOM_CAPACITY = 12;

/** 部屋の寿命（分）。過ぎたら閉じ、あいことばが次の組に回る */
export const ROOM_TTL_MINUTES = 720;

export interface TripStore {
  /**
   * この端末の参加者ID。
   * Supabase で匿名ログインが有効なときは auth のユーザーIDになるので、
   * 画面側が localStorage から自前で作ってはいけない。
   */
  currentMemberId(): Promise<string>;
  getActiveTrip(): Promise<Trip | null>;
  getTrip(id: string): Promise<Trip | null>;
  getLastFinished(): Promise<Trip | null>;
  createTrip(
    mode: TripMode,
    plan: PlanItem[],
    startMin: number,
    /** 検索して足した行き先。SPOTS に無いIDを plan が参照するときはここに入れる */
    customSpots?: Record<string, Spot>
  ): Promise<Trip>;
  updatePlan(id: string, plan: PlanItem[]): Promise<Trip>;
  consumeCall(id: string): Promise<Trip>;
  /** 道中を終える。これを呼ばないと getLastFinished が永久に空になる。幹事だけ */
  finishTrip(id: string): Promise<Trip>;
  /** 待合を閉じる／開ける。幹事だけ。閉じると新しい人は入れない */
  setRoomLocked(id: string, locked: boolean): Promise<Trip>;
  joinByCode(code: string, label: string): Promise<Trip | null>;
  /** パーティの参加者更新を購読する。B が Realtime に置き換える */
  subscribeMembers(id: string, cb: (members: Member[]) => void): () => void;

  /* --- せーの --- */
  /** 問いと選択肢を開き、開示時刻を決める */
  openRound(
    tripId: string,
    question: string,
    options: RoundOption[],
    planByOption: Record<string, PlanItem[]>,
    seconds: number
  ): Promise<Round>;
  getRound(roundId: string): Promise<Round | null>;
  getOpenRound(tripId: string): Promise<Round | null>;
  /** 「嫌」を出す。書き込み専用。他人の票は誰も読めない */
  castVetoes(roundId: string, memberId: string, optionIds: string[]): Promise<void>;
  /** 開示。冪等。開示時刻より前なら何もしない。誰が呼んでもよい */
  reveal(roundId: string): Promise<Round>;
  subscribeRound(roundId: string, cb: (round: Round) => void): () => void;
}

/** どちらの実装が動いているか。設定画面と診断に出す */
export type StoreKind = "local" | "supabase";
