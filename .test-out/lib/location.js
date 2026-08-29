"use client";
/** 2点間の距離（km）。model.ts と同じ近似で揃える */
export function distanceKm(a, b) {
    const dx = (a.lat - b.lat) * 111;
    const dy = (a.lng - b.lng) * 91;
    return Math.sqrt(dx * dx + dy * dy);
}
/** いちばん近いスポット。radiusKm より遠ければ「どこでもない」 */
export function nearestSpot(fix, spots, ids, radiusKm = 0.15) {
    if (!fix)
        return null;
    let best = null;
    let bestKm = Infinity;
    for (const id of ids) {
        const s = spots[id];
        if (!s)
            continue;
        const km = distanceKm(fix, s);
        if (km < bestKm) {
            bestKm = km;
            best = s;
        }
    }
    return best && bestKm <= radiusKm ? best : null;
}
export function watchDeviceLocation(onFix, onPermission, nowMin = () => new Date().getHours() * 60 + new Date().getMinutes()) {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
        onPermission?.("unavailable");
        return () => { };
    }
    const id = navigator.geolocation.watchPosition((p) => {
        onPermission?.("granted");
        onFix({
            lat: p.coords.latitude,
            lng: p.coords.longitude,
            accuracy: p.coords.accuracy,
            atMin: nowMin(),
            source: "gps",
        });
    }, (e) => {
        onPermission?.(e.code === e.PERMISSION_DENIED ? "denied" : "unavailable");
        onFix(null);
    }, { enableHighAccuracy: true, maximumAge: 10_000, timeout: 20_000 });
    return () => navigator.geolocation.clearWatch(id);
}
/**
 * 予定の時間割と時計から、いまいるであろう座標を作る。
 * 移動中は前のスポットから次のスポットへ直線で按分する。
 */
export function locationFromTimeline(legs, spots, plan, min) {
    if (legs.length === 0)
        return null;
    const first = spots[plan[0]?.spotId];
    if (!first)
        return null;
    const leg = legs.find((g) => min >= g.startMin && min < g.endMin) ?? null;
    if (!leg) {
        // 出発前か、全部終わったあと
        const last = legs[legs.length - 1];
        const s = min < legs[0].startMin ? first : spots[last.spotId];
        return s ? { lat: s.lat, lng: s.lng, accuracy: 25, atMin: min, source: "demo" } : null;
    }
    const here = spots[leg.spotId];
    if (!here)
        return null;
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
