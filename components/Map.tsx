"use client";
import { useMemo } from "react";
import type { PlanItem, Spot } from "@/lib/types";
import type { Fix } from "@/lib/location";

/* ============================================================
   地図。企画書の「決定した瞬間に地図と所要時間を出す」。

   外部のタイルを読みに行かない。実在の座標をそのまま投影して描く。
   会場のWi-Fiが死んでも出る、というのがこの作りの理由。
   タイル地図に差し替えるときは、このファイルの中だけで済む
   （背面にタイルを敷いて、下の project() を合わせる）。

   見た目は app/globals.css の .map__* が全部持っている。
   色も線の太さもそちらにあるので、ここを触らずにいじれる。
   ============================================================ */

export interface MapProps {
  plan: PlanItem[];
  spots: Record<string, Spot>;
  here?: Fix | null;
  /** 何件目までを「済」として描くか */
  visitedCount?: number;
  /** いま近くにいるスポット */
  currentSpotId?: string | null;
  /** 描画の高さ（px相当） */
  height?: number;
}

const W = 340;
const PAD = 30;
/** 京都あたりでの 緯度1度 : 経度1度 の長さの比 */
const LAT_STRETCH = 1.22;

export function Map({
  plan, spots, here, visitedCount = 0, currentSpotId, height = 208,
}: MapProps) {
  const points = useMemo(
    () => plan.map((p) => spots[p.spotId]).filter(Boolean),
    [plan, spots]
  );

  const project = useMemo(() => {
    const all = points.map((s) => ({ lat: s.lat, lng: s.lng }));
    if (here) all.push({ lat: here.lat, lng: here.lng });
    if (all.length === 0) return null;

    const lats = all.map((p) => p.lat);
    const lngs = all.map((p) => p.lng);
    const latSpan = Math.max(0.004, Math.max(...lats) - Math.min(...lats));
    const lngSpan = Math.max(0.004, Math.max(...lngs) - Math.min(...lngs));
    const k = Math.min((W - PAD * 2) / lngSpan, (height - PAD * 2) / (latSpan * LAT_STRETCH));
    const cLng = (Math.max(...lngs) + Math.min(...lngs)) / 2;
    const cLat = (Math.max(...lats) + Math.min(...lats)) / 2;
    return {
      x: (lng: number) => W / 2 + (lng - cLng) * k,
      y: (lat: number) => height / 2 - (lat - cLat) * k * LAT_STRETCH,
    };
  }, [points, here, height]);

  if (!project || points.length === 0) return null;

  const xy = (s: { lat: number; lng: number }) =>
    `${project.x(s.lng).toFixed(1)},${project.y(s.lat).toFixed(1)}`;

  // 済んだ道と、これからの道を描き分ける
  const cut = Math.min(Math.max(visitedCount, 0), points.length - 1);
  const done = points.slice(0, cut + 1);
  const rest = points.slice(cut);

  return (
    <div className="map">
      <svg
        viewBox={`0 0 ${W} ${height}`}
        role="img"
        aria-label={`道程の地図。${points.map((s) => s.name).join("、")}`}
      >
        {rest.length >= 2 && (
          <polyline className="map__routerest" points={rest.map(xy).join(" ")} />
        )}
        {done.length >= 2 && (
          <polyline className="map__routedone" points={done.map(xy).join(" ")} />
        )}

        {points.map((s, i) => {
          const isDone = i < visitedCount;
          const isHere = s.id === currentSpotId;
          const cx = project.x(s.lng);
          const cy = project.y(s.lat);
          return (
            <g
              key={s.id}
              className={`map__spot${isDone ? " is-done" : ""}${isHere ? " is-here" : ""}`}
            >
              <circle className="map__dot" cx={cx} cy={cy} r={9} />
              <text className="map__num" x={cx} y={cy + 3.2}>{i + 1}</text>
              <text className="map__name" x={cx} y={cy + 22}>{s.name}</text>
            </g>
          );
        })}

        {here && (
          <g className={`map__here${here.source === "demo" ? " is-demo" : ""}`}>
            <circle
              className="map__acc"
              cx={project.x(here.lng)}
              cy={project.y(here.lat)}
              r={Math.min(40, Math.max(10, (here.accuracy ?? 30) / 8))}
            />
            <circle className="map__pin" cx={project.x(here.lng)} cy={project.y(here.lat)} r={5.5} />
          </g>
        )}
      </svg>

      <div className="map__legend">
        {here
          ? here.source === "demo"
            ? "現在地はデモの時計から作っています"
            : `現在地は位置情報から${here.accuracy ? `（誤差およそ${Math.round(here.accuracy)}m）` : ""}`
          : "現在地はまだ取れていません"}
      </div>
    </div>
  );
}
