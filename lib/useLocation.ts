"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Segment, Spot, PlanItem } from "./types";
import {
  locationFromTimeline, nearestSpot, watchDeviceLocation,
  type Fix, type PermissionState, type TimelineLeg,
} from "./location";
import { demo } from "./demo";
import { observe, getObservation, visitedPrefix, type TripObservation } from "./visits";

/* ============================================================
   位置を1つのフックにまとめる。

   デモモードなら時計から作り、そうでなければ実機の GPS を見る。
   画面はどちらか知らなくてよい。
   ============================================================ */

export interface LocationView {
  fix: Fix | null;
  permission: PermissionState;
  /** いま近くにいるスポット。どこでもなければ null */
  spot: Spot | null;
  observation: TripObservation;
  /** 位置から決めた「もう動かせない予定」の数 */
  visitedCount: number;
  /** 実測がまだ無い（GPS拒否など） */
  observing: boolean;
}

export function useLocation(
  tripId: string | null,
  plan: PlanItem[],
  spots: Record<string, Spot>,
  timeline: Segment[],
  nowMin: number
): LocationView {
  const d = demo.use();
  const [fix, setFix] = useState<Fix | null>(null);
  const [permission, setPermission] = useState<PermissionState>("unknown");
  const [observation, setObservation] = useState<TripObservation>(() =>
    tripId ? getObservation(tripId) : { visits: [], walkedKm: 0 }
  );
  const nowRef = useRef(nowMin);
  nowRef.current = nowMin;

  const legs: TimelineLeg[] = useMemo(
    () => timeline.map((g) => ({ spotId: g.spotId, startMin: g.startMin, endMin: g.endMin, type: g.type })),
    [timeline]
  );

  const planIds = useMemo(() => plan.map((p) => p.spotId), [plan]);

  /* デモ：時計から位置を作る */
  useEffect(() => {
    if (!d.enabled || !d.mockLocation) return;
    setPermission("granted");
    setFix(locationFromTimeline(legs, spots, plan, nowMin));
  }, [d.enabled, d.mockLocation, legs, spots, plan, nowMin]);

  /* 実機：GPS を見る */
  useEffect(() => {
    if (d.enabled && d.mockLocation) return;
    return watchDeviceLocation(setFix, setPermission, () => nowRef.current);
  }, [d.enabled, d.mockLocation]);

  /* 届いた位置を記録する */
  useEffect(() => {
    if (!tripId || !fix) return;
    const near = nearestSpot(fix, spots, planIds);
    setObservation(observe(tripId, fix, near?.id ?? null));
  }, [tripId, fix, spots, planIds]);

  const spot = useMemo(() => nearestSpot(fix, spots, planIds), [fix, spots, planIds]);

  return {
    fix,
    permission,
    spot,
    observation,
    visitedCount: visitedPrefix(observation, planIds, spot?.id ?? null),
    observing: observation.visits.length > 0 || observation.walkedKm > 0,
  };
}
