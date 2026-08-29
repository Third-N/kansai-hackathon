"use client";
import type { PlanItem, Spot } from "./types";

/* ============================================================
   位置。企画書の「自動観測：現在地・時刻・歩数を、入力なしで知っている」。

   これまで現在地は時刻から逆算していた。ここで実測に置き換える。
   歩数そのものは Web では取れないので、GPS の移動距離で代える。

   源は2つあり、同じ形をしている:
     - watchDeviceLocation() … 実機の GPS
     - timelineLocation()    … デモ。時計から位置を作る
   当日 GPS が不安定でも、後者に切り替えれば止まらない。
   ============================================================ */

export interface Fix {
  lat: number;
  lng: number;
  /** メートル。分からないときは undefined */
  accuracy?: number;
  /** 0時からの分 */
  atMin: number;
  source: "gps" | "demo";
}

export interface LocationSource {
  subscribe(cb: (fix: Fix | null) => void): () => void;
}

/** 2点間の距離（km）。model.ts と同じ近似で揃える */
export function distanceKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number }
): number {
  const dx = (a.lat - b.lat) * 111;
  const dy = (a.lng - b.lng) * 91;
  return Math.sqrt(dx * dx + dy * dy);
}

/** いちばん近いスポット。radiusKm より遠ければ「どこでもない」 */
export function nearestSpot(
  fix: Fix | null,
  spots: Record<string, Spot>,
  ids: string[],
  radiusKm = 0.15
): Spot | null {
  if (!fix) return null;
  let best: Spot | null = null;
  let bestKm = Infinity;
  for (const id of ids) {
    const s = spots[id];
    if (!s) continue;
    const km = distanceKm(fix, s);
    if (km < bestKm) {
      bestKm = km;
      best = s;
    }
  }
  return best && bestKm <= radiusKm ? best : null;
}

/* ---------- 実機の GPS ---------- */

export type PermissionState = "unknown" | "granted" | "denied" | "unavailable";

export function watchDeviceLocation(
  onFix: (fix: Fix | null) => void,
  onPermission?: (p: PermissionState) => void,
  nowMin: () => number = () => new Date().getHours() * 60 + new Date().getMinutes()
): () => void {
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    onPermission?.("unavailable");
    return () => {};
  }
  const id = navigator.geolocation.watchPosition(
    (p) => {
      onPermission?.("granted");
      onFix({
        lat: p.coords.latitude,
        lng: p.coords.longitude,
        accuracy: p.coords.accuracy,
        atMin: nowMin(),
        source: "gps",
      });
    },
    (e) => {
      onPermission?.(e.code === e.PERMISSION_DENIED ? "denied" : "unavailable");
      onFix(null);
    },
    { enableHighAccuracy: true, maximumAge: 10_000, timeout: 20_000 }
  );
  return () => navigator.geolocation.clearWatch(id);
}

/* ---------- デモ。時計から位置を作る ---------- */

export interface TimelineLeg {
  spotId: string;
  startMin: number;
  endMin: number;
  type: "move" | "stay";
}

/**
 * 予定の時間割と時計から、いまいるであろう座標を作る。
 * 移動中は前のスポットから次のスポットへ直線で按分する。
 */
export function locationFromTimeline(
  legs: TimelineLeg[],
  spots: Record<string, Spot>,
  plan: PlanItem[],
  min: number
): Fix | null {
  if (legs.length === 0) return null;
  const first = spots[plan[0]?.spotId];
  if (!first) return null;

  const leg = legs.find((g) => min >= g.startMin && min < g.endMin) ?? null;
  if (!leg) {
    // 出発前か、全部終わったあと
    const last = legs[legs.length - 1];
    const s = min < legs[0].startMin ? first : spots[last.spotId];
    return s ? { lat: s.lat, lng: s.lng, accuracy: 25, atMin: min, source: "demo" } : null;
  }

  const here = spots[leg.spotId];
  if (!here) return null;
  if (leg.type === "stay") {
    return { lat: here.lat, lng: here.lng, accuracy: 20, atMin: min, source: "demo" };
  }

  // 移動中。直前の滞在先から今の行き先へ
  const i = legs.indexOf(leg);
  const prev = i > 0 ? spots[legs[i - 1].spotId] : first;
  const r = (min - leg.startMin) / Math.max(1, leg.endMin - leg.startMin);
  return {
    lat: prev.lat + (here.lat - prev.lat) * r,
    lng: prev.lng + (here.lng - prev.lng) * r,
    accuracy: 40,
    atMin: min,
    source: "demo",
  };
}
