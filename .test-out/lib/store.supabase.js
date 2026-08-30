"use client";
import { CALL_BUDGET, ROOM_CAPACITY, ROOM_TTL_MINUTES } from "./store-contract";
import { myMemberId } from "./identity";
import { isoDate } from "./format";
/* ---------- 行 → ドメイン ----------
   PostgREST は ISO 文字列、PGlite は Date を返す。どちらでも同じ形にする */
const asIso = (v) => v instanceof Date ? v.toISOString() : String(v);
const asDate = (v) => v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);
function toMember(r) {
    return {
        id: r.id,
        label: r.label,
        isHost: r.is_host,
        staminaFactor: Number(r.stamina_factor),
    };
}
function toTrip(r, members) {
    return {
        id: r.id,
        mode: r.mode,
        code: r.code ?? undefined,
        date: asDate(r.date),
        startMin: Number(r.start_min),
        plan: r.plan ?? [],
        customSpots: r.custom_spots && Object.keys(r.custom_spots).length > 0 ? r.custom_spots : undefined,
        photos: r.photos && Object.keys(r.photos).length > 0 ? r.photos : undefined,
        members,
        callsUsed: Number(r.calls_used),
        status: r.status,
        locked: r.locked ?? false,
        expiresAt: r.expires_at ? asIso(r.expires_at) : undefined,
    };
}
function toRound(r) {
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
export function createSupabaseStore(sb, opts = {}) {
    const pollMs = opts.pollMs ?? 1000;
    const now = opts.now ?? (() => Date.now());
    const fail = (where, e) => {
        throw new Error(`${where}: ${e?.message ?? "unknown error"}`);
    };
    /* この端末の参加者ID。匿名ログインが有効なら auth のユーザーID。
       無効なら端末が自分で作った ID に落ちる（なりすまし防止は効かない）。
       一度決まったら使い回す */
    let memberIdCache = null;
    const memberId = () => (memberIdCache ??= sb
        .ensureSession()
        .then((uid) => uid ?? myMemberId())
        .catch(() => myMemberId()));
    async function fetchMembers(tripId) {
        const res = await sb
            .from("members")
            .select("*")
            .eq("trip_id", tripId)
            .order("joined_at", { ascending: true });
        if (res.error)
            fail("members の取得", res.error);
        return (res.data ?? []).map(toMember);
    }
    async function withMembers(row) {
        if (!row)
            return null;
        return toTrip(row, await fetchMembers(row.id));
    }
    /** この端末が入っている道中の id。ログインが無いので members が身元になる */
    async function myTripIds() {
        const res = await sb.from("members").select("*").eq("id", await memberId());
        if (res.error)
            fail("参加中の道中の取得", res.error);
        return (res.data ?? []).map((r) => r.trip_id);
    }
    async function tripById(id) {
        const res = await sb.from("trips").select("*").eq("id", id).maybeSingle();
        if (res.error)
            fail("trip の取得", res.error);
        return res.data;
    }
    async function roundById(roundId) {
        const res = await sb.from("rounds").select("*").eq("id", roundId).maybeSingle();
        if (res.error)
            fail("round の取得", res.error);
        return res.data ? toRound(res.data) : null;
    }
    /** Realtime とポーリングを両掛けする。片方が死んでも止まらない */
    function watch(channelName, table, filter, tick, shouldStop) {
        let stopped = false;
        const run = () => {
            if (stopped)
                return;
            void Promise.resolve(tick()).catch(() => {
                /* 一時的な失敗は次のポーリングで拾う。購読は止めない */
            });
        };
        let channel = null;
        try {
            channel = sb
                .channel(channelName)
                .on("postgres_changes", { event: "*", schema: "public", table, filter }, run)
                .subscribe();
        }
        catch {
            channel = null; // Realtime が使えなくてもポーリングだけで動く
        }
        const timer = setInterval(() => {
            if (shouldStop?.())
                return;
            run();
        }, pollMs);
        run();
        return () => {
            stopped = true;
            clearInterval(timer);
            if (channel) {
                try {
                    sb.removeChannel(channel);
                }
                catch {
                    /* 片付けの失敗は無視してよい */
                }
            }
        };
    }
    const api = {
        async currentMemberId() {
            return memberId();
        },
        async getActiveTrip() {
            const ids = await myTripIds();
            if (ids.length === 0)
                return null;
            const res = await sb
                .from("trips")
                .select("*")
                .in("id", ids)
                .eq("status", "running")
                .eq("date", isoDate())
                .limit(1)
                .maybeSingle();
            if (res.error)
                fail("進行中の道中の取得", res.error);
            return withMembers(res.data);
        },
        async getTrip(id) {
            return withMembers(await tripById(id));
        },
        async getLastFinished() {
            const ids = await myTripIds();
            if (ids.length === 0)
                return null;
            const res = await sb
                .from("trips")
                .select("*")
                .in("id", ids)
                .eq("status", "done")
                .order("date", { ascending: false })
                .limit(1)
                .maybeSingle();
            if (res.error)
                fail("前の道中の取得", res.error);
            return withMembers(res.data);
        },
        async createTrip(mode, plan, startMin, customSpots) {
            // あいことばの採番と取り直しはサーバーの中。
            // クライアントに「何回か試して駄目なら諦める」を持たせない
            const res = await sb.rpc("create_trip", {
                p_mode: mode,
                p_plan: plan,
                p_start_min: startMin,
                p_member_id: await memberId(),
                p_label: "あなた",
                p_ttl_minutes: ROOM_TTL_MINUTES,
                p_custom_spots: (customSpots ?? {}),
            });
            if (res.error)
                fail("道中の作成", res.error);
            return (await withMembers(res.data));
        },
        async updatePlan(id, plan) {
            const res = await sb.rpc("update_plan", {
                p_trip_id: id,
                p_plan: plan,
                p_member_id: await memberId(),
            });
            if (res.error)
                fail("道程の更新", res.error);
            return (await withMembers(res.data));
        },
        async addPhoto(id, spotId, photoDataUrl) {
            const res = await sb.rpc("add_photo", {
                p_trip_id: id,
                p_spot_id: spotId,
                p_photo: photoDataUrl,
                p_member_id: await memberId(),
            });
            if (res.error)
                fail("写真の追加", res.error);
            return (await withMembers(res.data));
        },
        async consumeCall(id) {
            // 読んで足して書くとぶつかる。加算は RPC の中で原子的に行う
            const res = await sb.rpc("consume_call", {
                p_trip_id: id,
                p_member_id: await memberId(),
                p_cap: CALL_BUDGET,
            });
            if (res.error)
                fail("呼び出し回数の加算", res.error);
            return (await withMembers(res.data));
        },
        async finishTrip(id) {
            const res = await sb.rpc("finish_trip", {
                p_trip_id: id,
                p_member_id: await memberId(),
            });
            if (res.error)
                fail("道中を終える", res.error);
            return (await withMembers(res.data));
        },
        async setRoomLocked(id, locked) {
            const res = await sb.rpc("set_room_locked", {
                p_trip_id: id,
                p_member_id: await memberId(),
                p_locked: locked,
            });
            if (res.error)
                fail("待合の開け閉め", res.error);
            return (await withMembers(res.data));
        },
        async joinByCode(c, label) {
            const res = await sb.rpc("join_by_code", {
                p_code: c,
                p_label: label,
                p_member_id: await memberId(),
                p_max: ROOM_CAPACITY,
            });
            if (res.error)
                fail("合流", res.error);
            return withMembers(res.data ?? null);
        },
        subscribeMembers(id, cb) {
            return watch(`members:${id}`, "members", `trip_id=eq.${id}`, async () => {
                cb(await fetchMembers(id));
            });
        },
        async openRound(tripId, question, options, planByOption, seconds) {
            // reveal_at はサーバーが決める。開いた端末の時計を全員に配らない
            const res = await sb.rpc("open_round", {
                p_trip_id: tripId,
                p_question: question,
                p_options: options,
                p_plan_by_option: planByOption,
                p_seconds: seconds,
                p_member_id: await memberId(),
            });
            if (res.error)
                fail("せーのの開始", res.error);
            return toRound(res.data);
        },
        async getRound(roundId) {
            return roundById(roundId);
        },
        async getOpenRound(tripId) {
            const res = await sb
                .from("rounds")
                .select("*")
                .eq("trip_id", tripId)
                .eq("status", "open")
                .order("created_at", { ascending: false })
                .limit(1)
                .maybeSingle();
            if (res.error)
                fail("開いているせーのの取得", res.error);
            return res.data ? toRound(res.data) : null;
        },
        async castVetoes(roundId, memberId, optionIds) {
            const res = await sb.rpc("cast_vetoes", {
                p_round_id: roundId,
                p_member_id: memberId,
                p_option_ids: optionIds,
            });
            if (res.error)
                fail("票の送信", res.error);
        },
        async reveal(roundId) {
            const res = await sb.rpc("reveal_round", { p_round_id: roundId });
            if (res.error)
                fail("開示", res.error);
            return toRound(res.data);
        },
        subscribeRound(roundId, cb) {
            let revealed = false;
            let revealing = false;
            const stop = watch(`round:${roundId}`, "rounds", `id=eq.${roundId}`, async () => {
                let r = await roundById(roundId);
                if (!r)
                    return;
                // 開示時刻を過ぎていたら誰の端末でも開示を試みる。幹事が落ちても止まらない。
                // RPC は冪等なので、全員が同時に叩いても結果は1つ
                if (r.status === "open" && new Date(r.revealAt).getTime() <= now() && !revealing) {
                    revealing = true;
                    try {
                        r = await api.reveal(roundId);
                    }
                    finally {
                        revealing = false;
                    }
                }
                if (r.status === "revealed")
                    revealed = true;
                cb(r);
            }, () => revealed // 開示が済んだらポーリングを止める。Realtime だけ残す
            );
            return stop;
        },
    };
    return api;
}
