"use client";
import { storage } from "./storage";
import { distanceKm } from "./location";
const EMPTY = { visits: [], walkedKm: 0 };
const key = (tripId) => `dochu:obs:${tripId}`;
/** 1回の更新で足し込む距離の上限（km）。GPSの飛びを歩行距離に混ぜない */
const MAX_STEP_KM = 0.3;
export function getObservation(tripId) {
    try {
        const raw = storage().getItem(key(tripId));
        return raw ? { ...EMPTY, ...JSON.parse(raw) } : EMPTY;
    }
    catch {
        return EMPTY;
    }
}
function put(tripId, o) {
    storage().setItem(key(tripId), JSON.stringify(o));
}
export function clearObservation(tripId) {
    put(tripId, EMPTY);
}
/**
 * 位置が1つ届いたときの記録。
 * spotId が null（どのスポットの近くでもない）なら移動中として距離だけ足す。
 */
export function observe(tripId, fix, spotId) {
    const o = getObservation(tripId);
    const next = { ...o, visits: [...o.visits] };
    if (o.lastLat !== undefined && o.lastLng !== undefined) {
        const step = distanceKm({ lat: o.lastLat, lng: o.lastLng }, fix);
        if (step <= MAX_STEP_KM)
            next.walkedKm = o.walkedKm + step;
    }
    next.lastLat = fix.lat;
    next.lastLng = fix.lng;
    if (spotId) {
        const i = next.visits.findIndex((v) => v.spotId === spotId);
        if (i < 0) {
            next.visits.push({ spotId, firstMin: fix.atMin, lastMin: fix.atMin });
        }
        else {
            next.visits[i] = { ...next.visits[i], lastMin: Math.max(next.visits[i].lastMin, fix.atMin) };
        }
    }
    put(tripId, next);
    return next;
}
/** 実際にいた分。まだ記録が無ければ null */
export function dwellMin(o, spotId) {
    const v = o.visits.find((x) => x.spotId === spotId);
    return v ? Math.max(0, v.lastMin - v.firstMin) : null;
}
/**
 * 「もう動かせない」予定の数。
 * 先頭から順に、すでに訪れて離れたものを数える。
 * 観測が無い場合は呼び出し側が時計から決めた値を使う。
 */
export function visitedPrefix(o, planSpotIds, currentSpotId) {
    let n = 0;
    for (const id of planSpotIds) {
        const v = o.visits.find((x) => x.spotId === id);
        if (!v)
            break;
        if (id === currentSpotId)
            break; // いま滞在中のものは動かせるうちに入れない
        n += 1;
    }
    return n;
}
