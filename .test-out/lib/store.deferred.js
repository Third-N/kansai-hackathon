"use client";
/* ============================================================
   実装の読み込みを遅らせる包み。

   Supabase を使わない構成では @supabase/supabase-js を1バイトも
   読み込ませたくない（静的 import にすると、使わない人にも 66kB 配ることになる）。
   TripStore はほぼ全部 async なので、await を1つ挟むだけで包める。
   購読の2つだけは同期で解除関数を返す約束なので、
   解決を待ってから繋ぎ、待っている間に止められたら繋がない。
   ============================================================ */
export function deferredStore(load) {
    let pending = null;
    return wrap(() => (pending ??= load()));
}
/**
 * 呼ばれるたびに実装を選び直す包み。
 * デモモードのときは Supabase を通さず localStorage に落とすために使う。
 * 会場の Wi-Fi が死んでもデモが止まらないようにするのが目的。
 */
export function routedStore(pick) {
    return wrap(async () => pick());
}
function wrap(load) {
    const get = () => load();
    const subscribe = (attach) => {
        let stop = null;
        let cancelled = false;
        get()
            .then((s) => {
            if (cancelled)
                return;
            stop = attach(s);
        })
            .catch((e) => {
            // 握り潰すと「購読しているつもりで何も起きない」になる。
            // 会場でいちばん困る壊れ方なので、必ず表に出す
            console.error("[dochu] 実装の読み込みに失敗しました。購読は始まっていません", e);
        });
        return () => {
            cancelled = true;
            stop?.();
            stop = null;
        };
    };
    return {
        async currentMemberId() { return (await get()).currentMemberId(); },
        async getActiveTrip() { return (await get()).getActiveTrip(); },
        async getTrip(id) { return (await get()).getTrip(id); },
        async getLastFinished() { return (await get()).getLastFinished(); },
        async createTrip(mode, plan, startMin, customSpots) {
            return (await get()).createTrip(mode, plan, startMin, customSpots);
        },
        async updatePlan(id, plan) { return (await get()).updatePlan(id, plan); },
        async addPhoto(id, spotId, photoDataUrl) { return (await get()).addPhoto(id, spotId, photoDataUrl); },
        async consumeCall(id) { return (await get()).consumeCall(id); },
        async finishTrip(id) { return (await get()).finishTrip(id); },
        async setRoomLocked(id, locked) { return (await get()).setRoomLocked(id, locked); },
        async joinByCode(code, label) { return (await get()).joinByCode(code, label); },
        subscribeMembers(id, cb) {
            return subscribe((s) => s.subscribeMembers(id, cb));
        },
        async openRound(tripId, question, options, planByOption, seconds) {
            return (await get()).openRound(tripId, question, options, planByOption, seconds);
        },
        async getRound(roundId) { return (await get()).getRound(roundId); },
        async getOpenRound(tripId) { return (await get()).getOpenRound(tripId); },
        async castVetoes(roundId, memberId, optionIds) {
            return (await get()).castVetoes(roundId, memberId, optionIds);
        },
        async reveal(roundId) { return (await get()).reveal(roundId); },
        subscribeRound(roundId, cb) {
            return subscribe((s) => s.subscribeRound(roundId, cb));
        },
    };
}
