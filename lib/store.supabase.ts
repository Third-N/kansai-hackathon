"use client";
import type { Member, PlanItem, Round, RoundOption, RoundResult, Spot, Trip, TripMode } from "./types";
import type { TripStore } from "./store-contract";
import { CALL_BUDGET, ROOM_CAPACITY, ROOM_TTL_MINUTES } from "./store-contract";
import type { Channel, Row, SupabaseLike } from "./supabase-like";
import { myMemberId } from "./identity";
import { isoDate } from "./format";

/* ============================================================
   Supabase 実装。

   守っている約束（supabase/migrations/0001_init.sql と対）:
     - 票は誰も読めない。vetoes / submissions には権限を1つも与えず、
       security definer の RPC の中だけで触る
     - 開示は冪等。開示時刻より前なら何もしない。誰の端末から呼んでもよい
     - カウントダウンは reveal_at（サーバー時刻）から逆算する。
       開く側の端末の時計も混ぜないよう、reveal_at は open_round RPC が決める
     - 購読するのは rounds の1行だけ

   Realtime が落ちても止まらないよう、購読には必ずポーリングの保険を付けている。
   会場のWi-Fiで WebSocket が切れることを前提にしている。
   ============================================================ */

interface TripRow {
  id: string;
  mode: TripMode;
  code: string | null;
  date: string;
  start_min: number;
  plan: PlanItem[];
  custom_spots: Record<string, Spot> | null;
  calls_used: number;
  status: Trip["status"];
  locked: boolean | null;
  expires_at: string | null;
}

interface MemberRow {
  id: string;
  trip_id: string;
  label: string;
  is_host: boolean;
  stamina_factor: number;
}

interface RoundRow {
  id: string;
  trip_id: string;
  question: string;
  options: RoundOption[];
  plan_by_option: Record<string, PlanItem[]>;
  reveal_at: string;
  status: Round["status"];
  submitted_count: number;
  member_count: number;
  result: RoundResult | null;
}

/* ---------- 行 → ドメイン ----------
   PostgREST は ISO 文字列、PGlite は Date を返す。どちらでも同じ形にする */

const asIso = (v: unknown): string =>
  v instanceof Date ? v.toISOString() : String(v);

const asDate = (v: unknown): string =>
  v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);

function toMember(r: MemberRow): Member {
  return {
    id: r.id,
    label: r.label,
    isHost: r.is_host,
    staminaFactor: Number(r.stamina_factor),
  };
}

function toTrip(r: TripRow, members: Member[]): Trip {
  return {
    id: r.id,
    mode: r.mode,
    code: r.code ?? undefined,
    date: asDate(r.date),
    startMin: Number(r.start_min),
    plan: r.plan ?? [],
    customSpots: r.custom_spots && Object.keys(r.custom_spots).length > 0 ? r.custom_spots : undefined,
    members,
    callsUsed: Number(r.calls_used),
    status: r.status,
    locked: r.locked ?? false,
    expiresAt: r.expires_at ? asIso(r.expires_at) : undefined,
  };
}

function toRound(r: RoundRow): Round {
  return {
    id: r.id,
    tripId: r.trip_id,
    question: r.question,
    options: r.options ?? [],
    revealAt: asIso(r.reveal_at),
    status: r.status,
    submittedCount: Number(r.submitted_count),
    memberCount: Number(r.member_count),
    result: r.result ?? null,
    planByOption: r.plan_by_option ?? {},
  };
}

export interface SupabaseStoreOptions {
  /** Realtime が届かないときの保険。会場Wi-Fi を前提に既定で1秒 */
  pollMs?: number;
  /** テストから現在時刻を差し替える */
  now?: () => number;
}

export function createSupabaseStore(sb: SupabaseLike, opts: SupabaseStoreOptions = {}): TripStore {
  const pollMs = opts.pollMs ?? 1000;
  const now = opts.now ?? (() => Date.now());

  const fail = (where: string, e: { message: string } | null): never => {
    throw new Error(`${where}: ${e?.message ?? "unknown error"}`);
  };

  /* この端末の参加者ID。匿名ログインが有効なら auth のユーザーID。
     無効なら端末が自分で作った ID に落ちる（なりすまし防止は効かない）。
     一度決まったら使い回す */
  let memberIdCache: Promise<string> | null = null;
  const memberId = (): Promise<string> =>
    (memberIdCache ??= sb
      .ensureSession()
      .then((uid) => uid ?? myMemberId())
      .catch(() => myMemberId()));

  async function fetchMembers(tripId: string): Promise<Member[]> {
    const res = await sb
      .from<MemberRow>("members")
      .select("*")
      .eq("trip_id", tripId)
      .order("joined_at", { ascending: true });
    if (res.error) fail("members の取得", res.error);
    return (res.data ?? []).map(toMember);
  }

  async function withMembers(row: TripRow | null): Promise<Trip | null> {
    if (!row) return null;
    return toTrip(row, await fetchMembers(row.id));
  }

  /** この端末が入っている道中の id。ログインが無いので members が身元になる */
  async function myTripIds(): Promise<string[]> {
    const res = await sb.from<MemberRow>("members").select("*").eq("id", await memberId());
    if (res.error) fail("参加中の道中の取得", res.error);
    return (res.data ?? []).map((r) => r.trip_id);
  }

  async function tripById(id: string): Promise<TripRow | null> {
    const res = await sb.from<TripRow>("trips").select("*").eq("id", id).maybeSingle();
    if (res.error) fail("trip の取得", res.error);
    return res.data;
  }

  async function roundById(roundId: string): Promise<Round | null> {
    const res = await sb.from<RoundRow>("rounds").select("*").eq("id", roundId).maybeSingle();
    if (res.error) fail("round の取得", res.error);
    return res.data ? toRound(res.data) : null;
  }

  /** Realtime とポーリングを両掛けする。片方が死んでも止まらない */
  function watch(
    channelName: string,
    table: string,
    filter: string,
    tick: () => void | Promise<void>,
    shouldStop?: () => boolean
  ): () => void {
    let stopped = false;
    const run = () => {
      if (stopped) return;
      void Promise.resolve(tick()).catch(() => {
        /* 一時的な失敗は次のポーリングで拾う。購読は止めない */
      });
    };

    let channel: Channel | null = null;
    try {
      channel = sb
        .channel(channelName)
        .on("postgres_changes", { event: "*", schema: "public", table, filter }, run)
        .subscribe();
    } catch {
      channel = null; // Realtime が使えなくてもポーリングだけで動く
    }

    const timer = setInterval(() => {
      if (shouldStop?.()) return;
      run();
    }, pollMs);

    run();
    return () => {
      stopped = true;
      clearInterval(timer);
      if (channel) {
        try {
          sb.removeChannel(channel);
        } catch {
          /* 片付けの失敗は無視してよい */
        }
      }
    };
  }

  const api: TripStore = {
    async currentMemberId() {
      return memberId();
    },

    async getActiveTrip() {
      const ids = await myTripIds();
      if (ids.length === 0) return null;
      const res = await sb
        .from<TripRow>("trips")
        .select("*")
        .in("id", ids)
        .eq("status", "running")
        .eq("date", isoDate())
        .limit(1)
        .maybeSingle();
      if (res.error) fail("進行中の道中の取得", res.error);
      return withMembers(res.data);
    },

    async getTrip(id) {
      return withMembers(await tripById(id));
    },

    async getLastFinished() {
      const ids = await myTripIds();
      if (ids.length === 0) return null;
      const res = await sb
        .from<TripRow>("trips")
        .select("*")
        .in("id", ids)
        .eq("status", "done")
        .order("date", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (res.error) fail("前の道中の取得", res.error);
      return withMembers(res.data);
    },

    async createTrip(mode, plan, startMin, customSpots) {
      // あいことばの採番と取り直しはサーバーの中。
      // クライアントに「何回か試して駄目なら諦める」を持たせない
      const res = await sb.rpc<TripRow>("create_trip", {
        p_mode: mode,
        p_plan: plan as unknown as Row[],
        p_start_min: startMin,
        p_member_id: await memberId(),
        p_label: "あなた",
        p_ttl_minutes: ROOM_TTL_MINUTES,
        p_custom_spots: (customSpots ?? {}) as unknown as Row,
      });
      if (res.error) fail("道中の作成", res.error);
      return (await withMembers(res.data))!;
    },

    async updatePlan(id, plan) {
      const res = await sb.rpc<TripRow>("update_plan", {
        p_trip_id: id,
        p_plan: plan as unknown as Row[],
        p_member_id: await memberId(),
      });
      if (res.error) fail("道程の更新", res.error);
      return (await withMembers(res.data))!;
    },

    async consumeCall(id) {
      // 読んで足して書くとぶつかる。加算は RPC の中で原子的に行う
      const res = await sb.rpc<TripRow>("consume_call", {
        p_trip_id: id,
        p_member_id: await memberId(),
        p_cap: CALL_BUDGET,
      });
      if (res.error) fail("呼び出し回数の加算", res.error);
      return (await withMembers(res.data))!;
    },

    async finishTrip(id) {
      const res = await sb.rpc<TripRow>("finish_trip", {
        p_trip_id: id,
        p_member_id: await memberId(),
      });
      if (res.error) fail("道中を終える", res.error);
      return (await withMembers(res.data))!;
    },

    async setRoomLocked(id, locked) {
      const res = await sb.rpc<TripRow>("set_room_locked", {
        p_trip_id: id,
        p_member_id: await memberId(),
        p_locked: locked,
      });
      if (res.error) fail("待合の開け閉め", res.error);
      return (await withMembers(res.data))!;
    },

    async joinByCode(c, label) {
      const res = await sb.rpc<TripRow | null>("join_by_code", {
        p_code: c,
        p_label: label,
        p_member_id: await memberId(),
        p_max: ROOM_CAPACITY,
      });
      if (res.error) fail("合流", res.error);
      return withMembers(res.data ?? null);
    },

    subscribeMembers(id, cb) {
      return watch(`members:${id}`, "members", `trip_id=eq.${id}`, async () => {
        cb(await fetchMembers(id));
      });
    },

    async openRound(tripId, question, options, planByOption, seconds) {
      // reveal_at はサーバーが決める。開いた端末の時計を全員に配らない
      const res = await sb.rpc<RoundRow>("open_round", {
        p_trip_id: tripId,
        p_question: question,
        p_options: options as unknown as Row[],
        p_plan_by_option: planByOption as unknown as Row,
        p_seconds: seconds,
        p_member_id: await memberId(),
      });
      if (res.error) fail("せーのの開始", res.error);
      return toRound(res.data as RoundRow);
    },

    async getRound(roundId) {
      return roundById(roundId);
    },

    async getOpenRound(tripId) {
      const res = await sb
        .from<RoundRow>("rounds")
        .select("*")
        .eq("trip_id", tripId)
        .eq("status", "open")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (res.error) fail("開いているせーのの取得", res.error);
      return res.data ? toRound(res.data) : null;
    },

    async castVetoes(roundId, memberId, optionIds) {
      const res = await sb.rpc<number>("cast_vetoes", {
        p_round_id: roundId,
        p_member_id: memberId,
        p_option_ids: optionIds,
      });
      if (res.error) fail("票の送信", res.error);
    },

    async reveal(roundId) {
      const res = await sb.rpc<RoundRow>("reveal_round", { p_round_id: roundId });
      if (res.error) fail("開示", res.error);
      return toRound(res.data as RoundRow);
    },

    subscribeRound(roundId, cb) {
      let revealed = false;
      let revealing = false;

      const stop = watch(
        `round:${roundId}`,
        "rounds",
        `id=eq.${roundId}`,
        async () => {
          let r = await roundById(roundId);
          if (!r) return;
          // 開示時刻を過ぎていたら誰の端末でも開示を試みる。幹事が落ちても止まらない。
          // RPC は冪等なので、全員が同時に叩いても結果は1つ
          if (r.status === "open" && new Date(r.revealAt).getTime() <= now() && !revealing) {
            revealing = true;
            try {
              r = await api.reveal(roundId);
            } finally {
              revealing = false;
            }
          }
          if (r.status === "revealed") revealed = true;
          cb(r);
        },
        () => revealed // 開示が済んだらポーリングを止める。Realtime だけ残す
      );

      return stop;
    },
  };

  return api;
}
