"use client";
import { storage } from "./storage";
import { distanceKm } from "./location";
import type { Fix } from "./location";

/* ============================================================
   実測。どこに何分いたか、どれだけ歩いたか。

   これまで「訪問済み」は時計から決めていた（予定の終了時刻を過ぎたら
   行ったことにする）。実際には遅れるし、飛ばすこともある。
   ここは位置から決める。企画書の「自動観測」の実体。

   歩数は Web では取れないので、GPS の移動距離で代える。
   ============================================================ */

export interface Visit {
  spotId: string;
  /** 0時からの分 */
  firstMin: number;
  lastMin: number;
}

export interface TripObservation {
  visits: Visit[];
  /** 実測の歩行距離（km） */
  walkedKm: number;
  lastLat?: number;
  lastLng?: number;
}

const EMPTY: TripObservation = { visits: [], walkedKm: 0 };
const key = (tripId: string) => `dochu:obs:${tripId}`;

/** 1回の更新で足し込む距離の上限（km）。GPSの飛びを歩行距離に混ぜない */
const MAX_STEP_KM = 0.3;

export function getObservation(tripId: string): TripObservation {
  try {
    const raw = storage().getItem(key(tripId));
    return raw ? { ...EMPTY, ...(JSON.parse(raw) as TripObservation) } : EMPTY;
  } catch {
    return EMPTY;
  }
}

function put(tripId: string, o: TripObservation): void {
  storage().setItem(key(tripId), JSON.stringify(o));
}

export function clearObservation(tripId: string): void {
  put(tripId, EMPTY);
}

/**
 * 位置が1つ届いたときの記録。
 * spotId が null（どのスポットの近くでもない）なら移動中として距離だけ足す。
 */
export function observe(
  tripId: string,
  fix: Fix,
  spotId: string | null
): TripObservation {
  const o = getObservation(tripId);
  const next: TripObservation = { ...o, visits: [...o.visits] };

  if (o.lastLat !== undefined && o.lastLng !== undefined) {
    const step = distanceKm({ lat: o.lastLat, lng: o.lastLng }, fix);
    if (step <= MAX_STEP_KM) next.walkedKm = o.walkedKm + step;
  }
  next.lastLat = fix.lat;
  next.lastLng = fix.lng;

  if (spotId) {
    const i = next.visits.findIndex((v) => v.spotId === spotId);
    if (i < 0) {
      next.visits.push({ spotId, firstMin: fix.atMin, lastMin: fix.atMin });
    } else {
      next.visits[i] = { ...next.visits[i], lastMin: Math.max(next.visits[i].lastMin, fix.atMin) };
    }
  }

  put(tripId, next);
  return next;
}

/** 実際にいた分。まだ記録が無ければ null */
export function dwellMin(o: TripObservation, spotId: string): number | null {
  const v = o.visits.find((x) => x.spotId === spotId);
  return v ? Math.max(0, v.lastMin - v.firstMin) : null;
}

/**
 * 「もう動かせない」予定の数。
 * 先頭から順に、すでに訪れて離れたものを数える。
 * 観測が無い場合は呼び出し側が時計から決めた値を使う。
 */
export function visitedPrefix(
  o: TripObservation,
  planSpotIds: string[],
  currentSpotId: string | null
): number {
  let n = 0;
  for (const id of planSpotIds) {
    const v = o.visits.find((x) => x.spotId === id);
    if (!v) break;
    if (id === currentSpotId) break; // いま滞在中のものは動かせるうちに入れない
    n += 1;
  }
  return n;
}
