"use client";
import { useMemo, useState } from "react";
import type { PlanItem, Spot } from "@/lib/types";
import type { Fix } from "@/lib/location";
import { mercatorY, staticMapUrl } from "@/lib/static-map";

/* ============================================================
   地図。企画書の「決定した瞬間に地図と所要時間を出す」。

   Geoapify のキー（NEXT_PUBLIC_GEOAPIFY_KEY）が設定されていれば、
   実際の地図画像を背面に敷く。無ければ、外部タイルを読みに行かない
   点と線だけの図のまま動く（会場のWi-Fiが死んでも出る、という
   もともとの作りを崩さないため）。

   マーカーと経路線は今まで通り自前のSVGで描く。背景画像とマーカーの
   投影を合わせるため、緯度はWebメルカトルで扱う（mercatorY）。
   京都程度の狭い範囲では歪みはごくわずかだが、実際のタイル地図と
   同じ投影式を使わないと、隅のマーカーが少しずつ画像とずれていく。

   見た目は app/globals.css の .map__* が持っている。
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

export function Map({
  plan, spots, here, visitedCount = 0, currentSpotId, height = 208,
}: MapProps) {
  // オフライン・API障害では、キー未設定のときと同じ見た目に戻す
  const [bgFailed, setBgFailed] = useState(false);

  const points = useMemo(
    () => plan.map((p) => spots[p.spotId]).filter(Boolean),
    [plan, spots]
  );

  const projection = useMemo(() => {
    const all = points.map((s) => ({ lat: s.lat, lng: s.lng }));
    if (here) all.push({ lat: here.lat, lng: here.lng });
    if (all.length === 0) return null;

    const lats = all.map((p) => p.lat);
    const lngs = all.map((p) => p.lng);
    const minLat = Math.min(...lats), maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);

    const mys = all.map((p) => mercatorY(p.lat));
    const minMy = Math.min(...mys), maxMy = Math.max(...mys);

    const lngSpan = Math.max(0.004, maxLng - minLng);
    const mySpan = Math.max(0.005, maxMy - minMy);
    const k = Math.min((W - PAD * 2) / lngSpan, (height - PAD * 2) / mySpan);
    const cLng = (maxLng + minLng) / 2;
    const cMy = (maxMy + minMy) / 2;

    const project = {
      x: (lng: number) => W / 2 + (lng - cLng) * k,
      y: (lat: number) => height / 2 - (mercatorY(lat) - cMy) * k,
    };

    // 背景画像に頼む範囲。マーカー側の余白（PAD）ぶんだけ広げないと、
    // 端のマーカーが画像の外にはみ出て見える。狭い範囲では
    // 経度・緯度どちらもほぼ線形に扱ってよい大きさの誤差でしかない
    const padFrac = PAD / (W - PAD * 2);
    const lngPad = Math.max(0.0008, lngSpan * padFrac);
    const latPad = Math.max(0.0008, (maxLat - minLat) * padFrac || 0.0008);

    return {
      project,
      box: {
        minLng: minLng - lngPad,
        maxLng: maxLng + lngPad,
        minLat: minLat - latPad,
        maxLat: maxLat + latPad,
      },
    };
  }, [points, here, height]);

  if (!projection || points.length === 0) return null;
  const { project, box } = projection;

  const bgUrl = bgFailed ? null : staticMapUrl(box, W * 2, height * 2);

  const xy = (s: { lat: number; lng: number }) =>
    `${project.x(s.lng).toFixed(1)},${project.y(s.lat).toFixed(1)}`;

  // 済んだ道と、これからの道を描き分ける
  const cut = Math.min(Math.max(visitedCount, 0), points.length - 1);
  const done = points.slice(0, cut + 1);
  const rest = points.slice(cut);

  return (
    <div className="map">
      <div className="map__frame" style={{ aspectRatio: `${W} / ${height}` }}>
        {bgUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            className="map__bg"
            src={bgUrl}
            alt=""
            aria-hidden="true"
            onError={() => setBgFailed(true)}
          />
        )}
        <svg
          className={`map__svg${bgUrl ? " has-bg" : ""}`}
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
      </div>

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
