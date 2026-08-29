"use client";

import { useEffect, useMemo, useState, use } from "react";
import { store } from "@/lib/store";
import { SPOTS, TRAVEL_TABLE, spotsFor } from "@/lib/spots";
import { dayTypeForDate, simulate, stateAt } from "@/lib/model";
import { secondsUntil } from "@/lib/round";
import { hhmm } from "@/lib/format";
import { useClock } from "@/lib/useClock";
import { weather, toEnvironment } from "@/lib/weather";
import { useRealWeather } from "@/lib/useRealWeather";
import { proposeRevision } from "@/lib/model";
import { interruptCopy } from "@/lib/copy";
import { REST_CANDIDATES } from "@/lib/spots";
import type { Round, Trip } from "@/lib/types";

/* ============================================================
   ホスト画面。大画面か幹事の1台に出す。
   ここには個人が出ない。数と結果だけ。
   ============================================================ */

export default function HostPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const nowMin = useClock(10_000);
  useRealWeather();
  const w = weather.use();
  const [trip, setTrip] = useState<Trip | null>(null);
  const [round, setRound] = useState<Round | null>(null);
  const [left, setLeft] = useState(999);

  useEffect(() => {
    let unsubRound: (() => void) | undefined;
    let alive = true;
    const poll = async () => {
      const t = await store.getTrip(id);
      if (!alive) return;
      setTrip(t);
      const r = await store.getOpenRound(id);
      if (r && !unsubRound) unsubRound = store.subscribeRound(r.id, setRound);
    };
    poll();
    const iv = setInterval(poll, 1500);
    return () => { alive = false; clearInterval(iv); unsubRound?.(); };
  }, [id]);

  useEffect(() => {
    if (!round) return;
    let raf = 0;
    const tick = () => { setLeft(secondsUntil(round.revealAt)); raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [round]);

  const spots = trip ? spotsFor(trip) : SPOTS;

  const sim = useMemo(
    () => (trip ? simulate(trip.plan, spots, trip.startMin, {
      travelTable: TRAVEL_TABLE,
      environment: toEnvironment(w, dayTypeForDate(trip.date)),
    }) : null),
    [trip]
  );

  if (!trip || !sim) return <div className="host host--empty">道中を待っています</div>;

  const { hp, mp } = stateAt(sim.timeline, nowMin);
  const revealed = round?.status === "revealed" && !!round.result;

  /* 企画書の保険1。iOS で Push が鳴らない当日、幹事のこの1台に割り込みを出す。
     押す操作は各自の端末でやるので、ここは読み上げるだけ */
  const alert = useMemo(() => {
    if (!trip || !sim) return null;
    if (sim.collapseMin === null && sim.lowHpMin === null && sim.lowMpMin === null && sim.lateArrivals.length === 0) {
      return null;
    }
    const rev = proposeRevision(trip.plan, spots, trip.startMin, {
      nowMin,
      restCandidates: REST_CANDIDATES,
      travelTable: TRAVEL_TABLE,
      environment: toEnvironment(w, dayTypeForDate(trip.date)),
    });
    return interruptCopy(sim, rev, spots, trip.mode);
  }, [trip, sim, nowMin, w]);

  return (
    <div className="host">
      <header className="host__head">
        <div>
          <div className="host__eyebrow">道中</div>
          <div className="host__clock">{hhmm(nowMin)}</div>
        </div>
        <div className="host__party">
          <span className="host__lanterns">
            {trip.members.map((m) => <i className="lantern" key={m.id} aria-hidden />)}
          </span>
          <span className="host__count">{trip.members.length}人</span>
        </div>
      </header>

      <section className="host__gauges">
        <HostGauge label="パーティの体力" value={hp} color="var(--byakuroku)" />
        <HostGauge label="気分" value={mp} color="var(--kariyasu)" />
      </section>

      {!round && !alert && (
        <div className="host__idle">
          <p className="host__idlemain">このまま行けます</p>
          <p className="host__idlesub">
            残り{sim.timeline.filter((g) => g.type === "stay" && g.startMin > nowMin).length}件
          </p>
        </div>
      )}

      {!round && alert && (
        <div className="host__alert">
          <div className="host__alerteyebrow">呼び出し</div>
          <p className="host__alerttitle">{alert.title}</p>
          <p className="host__alertbody">{alert.body}</p>
          <p className="host__alertfoot">手元の端末に同じものが出ています</p>
        </div>
      )}

      {round && !revealed && (
        <section className="host__round">
          <p className="host__q">{round.question}</p>
          <div className={`host__count-big ${left <= 3.999 ? "is-hot" : ""}`}>
            <span className="host__secs">{Math.ceil(left)}</span>
          </div>
          <p className="host__submitted">
            伏せた人 <b>{round.submittedCount}</b> / {round.memberCount}
          </p>
          <ul className="host__opts">
            {round.options.map((o) => (
              <li className="host__opt" key={o.id}>
                <b>{o.label}</b>
                <i>{o.sub}</i>
              </li>
            ))}
          </ul>
          <p className="host__hint">開くまで、誰の選択も表示されません</p>
        </section>
      )}

      {round && revealed && (
        <section className="host__round">
          <p className="host__q">{round.question}</p>
          <ul className="host__opts host__opts--revealed">
            {round.options.map((o, i) => {
              const count = round.result!.tally.find((t) => t.optionId === o.id)?.count ?? 0;
              const winner = o.id === round.result!.winnerId;
              return (
                <li
                  key={o.id}
                  className={`host__opt ${winner ? "is-winner" : count > 0 ? "is-struck" : "is-clear"}`}
                  style={{ animationDelay: `${i * 220}ms` }}
                >
                  <b>{o.label}</b>
                  <i>{count === 0 ? "反対なし" : `嫌 ${count}`}</i>
                </li>
              );
            })}
          </ul>
          <p className={`host__verdict host__verdict--${round.result!.kind}`}>
            {round.result!.kind === "compromise"
              ? "全部に誰かが反対しました。いちばん反対が少ないものにします"
              : round.result!.kind === "tied"
                ? `残ったのは${round.result!.survivorCount}つ。そこから1つ選びました`
                : "反対ゼロ。全員が受け入れられる答えです"}
          </p>
        </section>
      )}
    </div>
  );
}

function HostGauge({ label, value, color }: { label: string; value: number; color: string }) {
  const v = Math.max(0, Math.min(100, value));
  const low = v < 25;
  return (
    <div className="hostgauge">
      <div className="hostgauge__top">
        <span>{label}</span>
        <b style={low ? { color: "var(--shu)" } : undefined}>{Math.round(v)}</b>
      </div>
      <div className="hostgauge__rail">
        <div
          className="hostgauge__fill"
          style={{ width: `${v}%`, background: low ? "var(--shu)" : color }}
        />
      </div>
    </div>
  );
}
