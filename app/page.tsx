"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Gauge } from "@/components/Gauge";
import { store, CALLS_PER_DAY } from "@/lib/store";
import { SPOTS, TRAVEL_TABLE } from "@/lib/spots";
import { simulate, stateAt } from "@/lib/model";
import { useClock } from "@/lib/useClock";
import { DEFAULT_PLAN, DEFAULT_START_MIN } from "@/lib/defaults";
import { enterDemo, isDemoCode } from "@/lib/demo";
import { hhmm, jpDate } from "@/lib/format";
import type { Trip, TripMode } from "@/lib/types";

export default function HomePage() {
  const router = useRouter();
  const nowMin = useClock();
  const [active, setActive] = useState<Trip | null>(null);
  const [last, setLast] = useState<Trip | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [code, setCode] = useState("");
  const [joinError, setJoinError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      setActive(await store.getActiveTrip());
      setLast(await store.getLastFinished());
      setLoaded(true);
    })();
  }, []);

  const depart = (mode: TripMode) => {
    setBusy(true);
    router.push(`/plan?mode=${mode}`);
  };

  const join = async () => {
    const c = code.trim();
    if (!c) return;
    setBusy(true);
    setJoinError(null);

    // デモの合図。待合ではなく、早送りできる道中に入る。
    // 先にデモモードへ入れてから作る。store がローカル実装に切り替わり、
    // 回線や Supabase の状態に関係なく動く
    if (isDemoCode(c)) {
      try {
        enterDemo(DEFAULT_START_MIN);
        const trip = await store.createTrip("solo", DEFAULT_PLAN, DEFAULT_START_MIN);
        router.push(`/trip/${trip.id}`);
      } catch (e) {
        setBusy(false);
        setJoinError(e instanceof Error ? e.message : "デモに入れませんでした。");
      }
      return;
    }

    try {
      const trip = await store.joinByCode(c, "旅人");
      setBusy(false);
      if (!trip) {
        setJoinError("そのあいことばの待合は見つかりませんでした。");
        return;
      }
      router.push(`/party/${trip.code}`);
    } catch (e) {
      // 定員・施錠・寿命切れはサーバーが理由を返す
      setBusy(false);
      setJoinError(e instanceof Error ? e.message.replace(/^.*?: /, "") : "合流できませんでした。");
    }
  };

  if (!loaded) return <div className="loading">読み込んでいます</div>;

  return (
    <div className="view">
      <header className="masthead">
        <h1 className="masthead__title">道中</h1>
        <div className="masthead__meta">
          <div className="masthead__line">京都</div>
          <div className="masthead__line">{jpDate()}</div>
          <div className="masthead__rule" />
          <div className="promise">
            <span className="promise__stamp" aria-hidden>
              <span className="promise__stampn">{CALLS_PER_DAY}</span>
              <span className="promise__stampu">回まで</span>
            </span>
            <p className="promise__text">
              このアプリが<br />あなたを呼ぶのは<br /><b>1日に{CALLS_PER_DAY}回</b>だけです。
            </p>
          </div>
        </div>
      </header>

      {active ? <ResumeCard trip={active} nowMin={nowMin} /> : (
        <div className="empty">
          <p>まだ今日の道中はありません。</p>
          <p className="empty__sub">行き先を決めるところから始められます。</p>
        </div>
      )}

      <section className="depart">
        <div className="sec"><span>出立</span></div>
        <button className="door" onClick={() => depart("solo")} disabled={busy}>
          <span className="door__n">一</span>
          <span className="door__body">
            <b>一人で出る</b>
            <i>疲れたら止めます。同行者のかわりです。</i>
          </span>
        </button>
        <button className="door" onClick={() => depart("party")} disabled={busy}>
          <span className="door__n">二</span>
          <span className="door__body">
            <b>みんなで出る</b>
            <i>言い出しにくいことを、匿名で集めます。</i>
          </span>
        </button>
      </section>

      <section className="join">
        <label className="join__label" htmlFor="code">合流する</label>
        <div className="join__row">
          <input
            id="code" className="join__input" value={code} maxLength={12}
            placeholder="あいことば"
            onChange={(e) => { setCode(e.target.value); setJoinError(null); }}
            onKeyDown={(e) => e.key === "Enter" && join()}
          />
          <button className="join__btn" onClick={join} disabled={busy || !code.trim()}>合流</button>
        </div>
        {joinError && <p className="join__error">{joinError}</p>}
      </section>

      {last && (
        <section>
          <div className="sec"><span>前の道中</span></div>
          <LastTrip trip={last} />
        </section>
      )}
    </div>
  );
}

function ResumeCard({ trip, nowMin }: { trip: Trip; nowMin: number }) {
  const sim = simulate(trip.plan, SPOTS, trip.startMin, { travelTable: TRAVEL_TABLE });
  const { hp, mp } = stateAt(sim.timeline, nowMin);
  const current = sim.timeline.find((g) => nowMin >= g.startMin && nowMin < g.endMin);
  const remaining = sim.timeline.filter((g) => g.type === "stay" && g.startMin > nowMin).length;
  const place = current ? SPOTS[current.spotId].name : "移動中";

  return (
    <a className="resume" href={`/trip/${trip.id}`}>
      <div className="resume__eyebrow">道中のとちゅう</div>
      <div className="resume__place">{place}</div>
      <div className="resume__sub">
        {hhmm(nowMin)} 現在 ・ 残り{remaining}件
      </div>
      <div className="resume__gauges">
        <Gauge label="体力" value={hp} color="var(--byakuroku)" tone="dark" />
        <Gauge label="気分" value={mp} color="var(--kariyasu)" tone="dark" />
      </div>
      <div className="resume__cta">道中にもどる →</div>
    </a>
  );
}

function LastTrip({ trip }: { trip: Trip }) {
  const sim = simulate(trip.plan, SPOTS, trip.startMin, { travelTable: TRAVEL_TABLE });
  const spots = trip.plan.filter((p) => SPOTS[p.spotId].kind !== "rest").length;
  const names = trip.plan.map((p) => SPOTS[p.spotId].name);
  const [m, d] = trip.date.split("-").slice(1);

  return (
    <a className="log" href={`/trip/${trip.id}/log`}>
      <span className="log__date">{Number(m)}月{Number(d)}日</span>
      <span className="log__place">{names[0]} ほか</span>
      <span className="log__stats">
        {spots}件 ・ 気分{Math.round(sim.endMp)} ・ 体力{Math.round(sim.endHp)}
      </span>
    </a>
  );
}
