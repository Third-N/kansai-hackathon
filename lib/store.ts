"use client";
import type { Member, PlanItem, Round, RoundOption, Trip, TripMode } from "./types";
import { resolveRound } from "./round";
import { isoDate } from "./format";

/* ============================================================
   データ境界。B が Supabase 実装に差し替える。
   UI は TripStore しか触らない。
   ------------------------------------------------------------
   Supabase 側の想定:
     trips(id, mode, code, date, start_min, plan jsonb,
           calls_used, status, revealed_at)
     members(id, trip_id, label, is_host, stamina_factor)
     vetoes(id, trip_id, round_id, member_id, option_id)  -- SELECT 不可
   同時開示は RPC reveal(round_id) を冪等に。
   ============================================================ */

export interface TripStore {
  getActiveTrip(): Promise<Trip | null>;
  getTrip(id: string): Promise<Trip | null>;
  getLastFinished(): Promise<Trip | null>;
  createTrip(mode: TripMode, plan: PlanItem[], startMin: number): Promise<Trip>;
  updatePlan(id: string, plan: PlanItem[]): Promise<Trip>;
  consumeCall(id: string): Promise<Trip>;
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

const KEY = "dochu:trips";
const RKEY = "dochu:rounds";
const VKEY = "dochu:vetoes";
const CALL_BUDGET = 5;

function read(): Trip[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(window.localStorage.getItem(KEY) ?? "[]") as Trip[];
  } catch {
    return [];
  }
}

function write(trips: Trip[]) {
  window.localStorage.setItem(KEY, JSON.stringify(trips));
}

function code(): string {
  const words = ["ひがし", "にし", "みなみ", "きた", "かも", "あらし", "きよ", "いなり"];
  return words[Math.floor(Math.random() * words.length)];
}

interface StoredVeto { roundId: string; memberId: string; optionId: string }

function readRounds(): Round[] {
  if (typeof window === "undefined") return [];
  try { return JSON.parse(window.localStorage.getItem(RKEY) ?? "[]") as Round[]; } catch { return []; }
}
function writeRounds(rs: Round[]) { window.localStorage.setItem(RKEY, JSON.stringify(rs)); }

/* 票は本来クライアントから読めてはいけない。
   Supabase では vetoes を SELECT 不可の RLS にして、集計は RPC の中だけで行う。
   ローカル実装では同じ約束を守るため、この2つの関数の外に票を出さない。 */
function readVetoes(): StoredVeto[] {
  if (typeof window === "undefined") return [];
  try { return JSON.parse(window.localStorage.getItem(VKEY) ?? "[]") as StoredVeto[]; } catch { return []; }
}
function writeVetoes(vs: StoredVeto[]) { window.localStorage.setItem(VKEY, JSON.stringify(vs)); }

export const localStore: TripStore = {
  async getActiveTrip() {
    return read().find((t) => t.status === "running" && t.date === isoDate()) ?? null;
  },

  async getTrip(id) {
    return read().find((t) => t.id === id) ?? null;
  },

  async getLastFinished() {
    const done = read().filter((t) => t.status === "done");
    return done.sort((a, b) => b.date.localeCompare(a.date))[0] ?? null;
  },

  async createTrip(mode, plan, startMin) {
    const trips = read();
    const trip: Trip = {
      id: crypto.randomUUID(),
      mode,
      code: mode === "party" ? code() : undefined,
      date: isoDate(),
      startMin,
      plan,
      members: [{ id: crypto.randomUUID(), label: "あなた", isHost: true, staminaFactor: 1 }],
      callsUsed: 0,
      status: "running",
    };
    write([...trips, trip]);
    return trip;
  },

  async updatePlan(id, plan) {
    const trips = read();
    const i = trips.findIndex((t) => t.id === id);
    if (i < 0) throw new Error("trip not found");
    trips[i] = { ...trips[i], plan };
    write(trips);
    return trips[i];
  },

  async consumeCall(id) {
    const trips = read();
    const i = trips.findIndex((t) => t.id === id);
    if (i < 0) throw new Error("trip not found");
    trips[i] = { ...trips[i], callsUsed: Math.min(CALL_BUDGET, trips[i].callsUsed + 1) };
    write(trips);
    return trips[i];
  },

  async joinByCode(c, label) {
    const trips = read();
    const i = trips.findIndex((t) => t.code === c && t.status !== "done");
    if (i < 0) return null;
    const member: Member = { id: crypto.randomUUID(), label, isHost: false, staminaFactor: 1 };
    trips[i] = { ...trips[i], members: [...trips[i].members, member] };
    write(trips);
    return trips[i];
  },

  async openRound(tripId, question, options, planByOption, seconds) {
    const trip = read().find((t) => t.id === tripId);
    const round: Round = {
      id: crypto.randomUUID(),
      tripId,
      question,
      options,
      revealAt: new Date(Date.now() + seconds * 1000).toISOString(),
      status: "open",
      submittedCount: 0,
      memberCount: trip?.members.length ?? 1,
      result: null,
      planByOption,
    };
    writeRounds([...readRounds(), round]);
    return round;
  },

  async getRound(roundId) {
    return readRounds().find((r) => r.id === roundId) ?? null;
  },

  async getOpenRound(tripId) {
    return readRounds().find((r) => r.tripId === tripId && r.status === "open") ?? null;
  },

  async castVetoes(roundId, memberId, optionIds) {
    const rounds = readRounds();
    const i = rounds.findIndex((r) => r.id === roundId);
    if (i < 0 || rounds[i].status === "revealed") return;

    const vetoes = readVetoes().filter((v) => !(v.roundId === roundId && v.memberId === memberId));
    writeVetoes([...vetoes, ...optionIds.map((optionId) => ({ roundId, memberId, optionId }))]);

    const submitted = new Set(
      readVetoes().filter((v) => v.roundId === roundId).map((v) => v.memberId)
    );
    submitted.add(memberId);
    rounds[i] = { ...rounds[i], submittedCount: submitted.size };
    writeRounds(rounds);
  },

  async reveal(roundId) {
    const rounds = readRounds();
    const i = rounds.findIndex((r) => r.id === roundId);
    if (i < 0) throw new Error("round not found");
    // 冪等。既に開示済みならそのまま返す
    if (rounds[i].status === "revealed") return rounds[i];
    // 開示時刻より前なら何もしない
    if (new Date(rounds[i].revealAt).getTime() > Date.now()) return rounds[i];

    const votes = readVetoes()
      .filter((v) => v.roundId === roundId)
      .map((v) => ({ memberId: v.memberId, optionId: v.optionId }));
    const result = resolveRound(rounds[i].options, votes, Math.random());
    rounds[i] = { ...rounds[i], status: "revealed", result };
    writeRounds(rounds);
    return rounds[i];
  },

  subscribeRound(roundId, cb) {
    let stopped = false;
    const tick = async () => {
      if (stopped) return;
      let r = readRounds().find((x) => x.id === roundId);
      if (!r) return;
      // 開示時刻を過ぎていたら誰の端末でも開示を試みる。幹事が落ちても止まらない
      if (r.status === "open" && new Date(r.revealAt).getTime() <= Date.now()) {
        r = await localStore.reveal(roundId);
      }
      cb(r);
    };
    const id = setInterval(tick, 500);
    const onStorage = (e: StorageEvent) => (e.key === RKEY || e.key === VKEY) && tick();
    window.addEventListener("storage", onStorage);
    tick();
    return () => {
      stopped = true;
      clearInterval(id);
      window.removeEventListener("storage", onStorage);
    };
  },

  subscribeMembers(id, cb) {
    const tick = () => {
      const t = read().find((x) => x.id === id);
      if (t) cb(t.members);
    };
    const onStorage = (e: StorageEvent) => e.key === KEY && tick();
    window.addEventListener("storage", onStorage);
    tick();
    return () => window.removeEventListener("storage", onStorage);
  },
};

export const CALLS_PER_DAY = CALL_BUDGET;
export const store: TripStore = localStore;
