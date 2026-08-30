"use client";

import { useEffect, useMemo, useState, use } from "react";
import { store } from "@/lib/store";
import { SPOTS, TRAVEL_TABLE, spotsFor } from "@/lib/spots";
import { simulate } from "@/lib/model";
import { hhmm, signed } from "@/lib/format";
import type { Trip } from "@/lib/types";

/** 道中記。旅の途中では開かせない。終わってから見るもの */
export default function LogPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [trip, setTrip] = useState<Trip | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      setTrip(await store.getTrip(id));
      setLoaded(true);
    })();
  }, [id]);

  const spots = trip ? spotsFor(trip) : SPOTS;

  const sim = useMemo(
    () => (trip ? simulate(trip.plan, spots, trip.startMin, { travelTable: TRAVEL_TABLE }) : null),
    [trip]
  );

  if (!loaded) return <div className="loading">読み込んでいます</div>;
  if (!trip || !sim) {
    return (
      <div className="view">
        <div className="empty">
          <p>その道中は見つかりませんでした。</p>
          <p className="empty__sub"><a className="back" href="/">ホームにもどる</a></p>
        </div>
      </div>
    );
  }

  const stays = sim.timeline.filter((g) => g.type === "stay");
  const walkMin = sim.timeline
    .filter((g) => g.type === "move")
    .reduce((a, g) => a + (g.endMin - g.startMin), 0);
  const best = [...stays].sort((a, b) => b.mpOut - b.mpIn - (a.mpOut - a.mpIn))[0];

  return (
    <div className="view">
      <div className="lobby__head">
        <a className="back" href="/">← もどる</a>
        <span className="lobby__title">道中記</span>
      </div>

      <div className="tally">
        <Stat n={stays.filter((g) => spots[g.spotId].kind !== "rest").length} unit="件" label="まわった" />
        <Stat n={walkMin} unit="分" label="移動した" />
        <Stat n={Math.round(sim.endMp)} unit="" label="気分の着地" />
      </div>

      {best && (
        <p className="highlight">
          いちばん気分が上がったのは <b>{spots[best.spotId].name}</b> でした。
        </p>
      )}

      <div className="sec" style={{ marginTop: 24 }}><span>通った順</span></div>
      <ol className="track">
        {stays.map((g, i) => (
          <li className="stop is-past" key={i}>
            <span className="stop__node" aria-hidden />
            <div className="stop__body">
              <div className="stop__time">{hhmm(g.startMin)}–{hhmm(g.endMin)}</div>
              <div className="stop__name">{spots[g.spotId].name}</div>
              <div className="chips">
                <span className="chip chip--plus">気分<b>{signed(g.mpOut - g.mpIn)}</b></span>
              </div>
              {trip.photos?.[g.spotId] && (
                // eslint-disable-next-line @next/next/no-img-element
                <img className="stop__photo" src={trip.photos[g.spotId]} alt="" />
              )}
            </div>
          </li>
        ))}
      </ol>

      {!trip.photos || Object.keys(trip.photos).length === 0 ? (
        <p className="anon" style={{ marginTop: 20 }}>
          写真はまだありません。道中の画面の「現在地」から、その場で足せます。
        </p>
      ) : null}
    </div>
  );
}

function Stat({ n, unit, label }: { n: number; unit: string; label: string }) {
  return (
    <div className="tally__cell">
      <div className="tally__n">{n}<span>{unit}</span></div>
      <div className="tally__label">{label}</div>
    </div>
  );
}
