"use client";
import type { Member, Round, Trip } from "./types";
import type { TripStore } from "./store-contract";
import { CALL_BUDGET } from "./store-contract";
import { resolveRound, roundTiebreak } from "./round";
import { myMemberId } from "./identity";
import { isoDate } from "./format";
import { makeCode } from "./code";
import { onStorageChange, storage } from "./storage";

/* ============================================================
   localStorage 実装。サーバーが要らないので開発と単機デモはこれで足りる。
   同じ端末の別タブとしか同期しない（storage イベント）。
   本番の「せーの」は store.supabase.ts。
   ============================================================ */

const KEY = "dochu:trips";
const RKEY = "dochu:rounds";
const VKEY = "dochu:vetoes";
const SKEY = "dochu:submissions";

function read(): Trip[] {
  try {
    return JSON.parse(storage().getItem(KEY) ?? "[]") as Trip[];
  } catch {
    return [];
  }
}

function write(trips: Trip[]) {
  storage().setItem(KEY, JSON.stringify(trips));
}

function uniqueCode(existing: Trip[]): string {
  const used = new Set(existing.filter((t) => t.status !== "done").map((t) => t.code));
  for (let i = 0; i < 30; i++) {
    const c = makeCode();
    if (!used.has(c)) return c;
  }
  return makeCode();
}



interface StoredVeto { roundId: string; memberId: string; optionId: string }
/* 「出した」という事実だけを別に持つ。
   票の有無から数えると、何も嫌でない人（空提出）が
   他の誰かの出し直しで消える。SQL 側の submissions テーブルと同じ役割。 */
interface StoredSubmission { roundId: string; memberId: string }

function readRounds(): Round[] {
  try { return JSON.parse(storage().getItem(RKEY) ?? "[]") as Round[]; } catch { return []; }
}
function writeRounds(rs: Round[]) { storage().setItem(RKEY, JSON.stringify(rs)); }

/* 票は本来クライアントから読めてはいけない。
   Supabase では vetoes を SELECT 不可の RLS にして、集計は RPC の中だけで行う。
   ローカル実装では同じ約束を守るため、この2つの関数の外に票を出さない。 */
function readSubmissions(): StoredSubmission[] {
  try { return JSON.parse(storage().getItem(SKEY) ?? "[]") as StoredSubmission[]; } catch { return []; }
}
function writeSubmissions(ss: StoredSubmission[]) { storage().setItem(SKEY, JSON.stringify(ss)); }

function readVetoes(): StoredVeto[] {
  try { return JSON.parse(storage().getItem(VKEY) ?? "[]") as StoredVeto[]; } catch { return []; }
}
function writeVetoes(vs: StoredVeto[]) { storage().setItem(VKEY, JSON.stringify(vs)); }

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
      code: mode === "party" ? uniqueCode(trips) : undefined,
      date: isoDate(),
      startMin,
      plan,
      members: [{ id: myMemberId(), label: "あなた", isHost: true, staminaFactor: 1 }],
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

  async finishTrip(id) {
    const trips = read();
    const i = trips.findIndex((t) => t.id === id);
    if (i < 0) throw new Error("trip not found");
    trips[i] = { ...trips[i], status: "done" };
    write(trips);
    return trips[i];
  },

  async joinByCode(c, label) {
    const trips = read();
    const i = trips.findIndex((t) => t.code === c && t.status !== "done");
    if (i < 0) return null;
    // 同じ端末が二度入っても増やさない。Supabase 実装の on conflict と揃える
    const me = myMemberId();
    const already = trips[i].members.some((m) => m.id === me);
    const member: Member = { id: me, label, isHost: false, staminaFactor: 1 };
    trips[i] = already
      ? { ...trips[i], members: trips[i].members.map((m) => (m.id === me ? { ...m, label } : m)) }
      : { ...trips[i], members: [...trips[i].members, member] };
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

    const subs = readSubmissions();
    if (!subs.some((x) => x.roundId === roundId && x.memberId === memberId)) {
      writeSubmissions([...subs, { roundId, memberId }]);
    }

    const submitted = readSubmissions().filter((x) => x.roundId === roundId).length;
    rounds[i] = { ...rounds[i], submittedCount: submitted };
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
    const result = resolveRound(rounds[i].options, votes, roundTiebreak(roundId));
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
    const off = onStorageChange((key) => {
      if (key === RKEY || key === VKEY || key === SKEY) void tick();
    });
    void tick();
    return () => {
      stopped = true;
      clearInterval(id);
      off();
    };
  },

  subscribeMembers(id, cb) {
    const tick = () => {
      const t = read().find((x) => x.id === id);
      if (t) cb(t.members);
    };
    const off = onStorageChange((key) => {
      if (key === KEY) tick();
    });
    tick();
    return off;
  },
};


