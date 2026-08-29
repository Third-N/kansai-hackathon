"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { locationFromTimeline, nearestSpot, watchDeviceLocation, } from "./location";
import { demo } from "./demo";
import { observe, getObservation, visitedPrefix } from "./visits";
export function useLocation(tripId, plan, spots, timeline, nowMin) {
    const d = demo.use();
    const [fix, setFix] = useState(null);
    const [permission, setPermission] = useState("unknown");
    const [observation, setObservation] = useState(() => tripId ? getObservation(tripId) : { visits: [], walkedKm: 0 });
    const nowRef = useRef(nowMin);
    nowRef.current = nowMin;
    const legs = useMemo(() => timeline.map((g) => ({ spotId: g.spotId, startMin: g.startMin, endMin: g.endMin, type: g.type })), [timeline]);
    const planIds = useMemo(() => plan.map((p) => p.spotId), [plan]);
    /* デモ：時計から位置を作る */
    useEffect(() => {
        if (!d.enabled || !d.mockLocation)
            return;
        setPermission("granted");
        setFix(locationFromTimeline(legs, spots, plan, nowMin));
    }, [d.enabled, d.mockLocation, legs, spots, plan, nowMin]);
    /* 実機：GPS を見る */
    useEffect(() => {
        if (d.enabled && d.mockLocation)
            return;
        return watchDeviceLocation(setFix, setPermission, () => nowRef.current);
    }, [d.enabled, d.mockLocation]);
    /* 届いた位置を記録する */
    useEffect(() => {
        if (!tripId || !fix)
            return;
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
