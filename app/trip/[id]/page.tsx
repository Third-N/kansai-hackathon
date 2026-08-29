"use client";

import { useEffect, useMemo, useState, use } from "react";
import { Gauge } from "@/components/Gauge";
import { Track } from "@/components/Track";
import { Interrupt } from "@/components/Interrupt";
import { store, CALLS_PER_DAY } from "@/lib/store";
import { SPOTS, TRAVEL_TABLE, REST_CANDIDATES } from "@/lib/spots";
import { dayTypeForDate, proposeRevisions, simulate, stateAt } from "@/lib/model";
import { interruptCopy } from "@/lib/copy";
import { optionsFromRevisions } from "@/lib/round";
import { useRouter } from "next/navigation";
import { useClock } from "@/lib/useClock";
import { useLocation } from "@/lib/useLocation";
import { weather, toEnvironment } from "@/lib/weather";
import { useRealWeather } from "@/lib/useRealWeather";
import { useGeoapifyKeyFromSupabase } from "@/lib/useGeoapifyKeyFromSupabase";
import { Map } from "@/components/Map";
import { hhmm, jpDate } from "@/lib/format";
import type { Trip } from "@/lib/types";

export default function TripPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const nowMin = useClock();
  useRealWeather();
  useGeoapifyKeyFromSupabase();
  const w = weather.use();
  const [trip, setTrip] = useState<Trip | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setTrip(await store.getTrip(id));
      setLoaded(true);
    })();
  }, [id]);

  /* パーティは一番きつい人に合わせる。誰かは出さない */
  const staminaFactor = useMemo(() => {
    if (!trip) return 1;
    return Math.max(...trip.members.map((m) => m.staminaFactor));
  }, [trip]);

  const environment = useMemo(
    () => (trip ? toEnvironment(w, dayTypeForDate(trip.date)) : null),
    [trip, w]
  );

  const sim = useMemo(() => {
    if (!trip || !environment) return null;
    return simulate(trip.plan, SPOTS, trip.startMin, {
      staminaFactor,
      travelTable: TRAVEL_TABLE,
      environment,
    });
  }, [trip, staminaFactor, environment]);

  /* 位置。デモなら時計から、そうでなければ実機のGPS */
  const here = useLocation(trip?.id ?? null, trip?.plan ?? [], SPOTS, sim?.timeline ?? [], nowMin);

  /* 訪問済みの分は動かさない。
     位置が取れているならそちらを優先する（実際に行ったかどうかで決める）。
     取れていなければ時計から推す。 */
  const fixedCount = useMemo(() => {
    if (!sim || !trip) return 0;
    if (here.observing) return here.visitedCount;
    return trip.plan.filter((_, i) => {
      const seg = sim.timeline.find((g) => g.type === "stay" && g.spotId === trip.plan[i].spotId);
      return seg ? nowMin >= seg.endMin : false;
    }).length;
  }, [sim, trip, nowMin, here.observing, here.visitedCount]);

  const revisions = useMemo(() => {
    if (!trip || !sim) return [];
    if (
      sim.collapseMin === null &&
      sim.lowHpMin === null &&
      sim.lowMpMin === null &&
      sim.lateArrivals.length === 0
    ) return [];
    return proposeRevisions(trip.plan, SPOTS, trip.startMin, {
      nowMin,
      fixedCount,
      restCandidates: REST_CANDIDATES,
      staminaFactor,
      travelTable: TRAVEL_TABLE,
      environment: environment ?? undefined,
    });
  }, [trip, sim, nowMin, fixedCount, staminaFactor, environment]);

  const revision = revisions[0] ?? null;

  const copy = useMemo(() => {
    if (!trip || !sim) return null;
    return interruptCopy(sim, revision, SPOTS, trip.mode);
  }, [trip, sim, revision]);

  const showInterrupt =
    !!copy && !dismissed && !!trip && trip.callsUsed < CALLS_PER_DAY;

  const accept = async () => {
    if (!trip || !revision) return;

    // パーティは1人で決めない。全員に「せーの」で聞く
    if (trip.mode === "party" && trip.members.length > 1) {
      const options = optionsFromRevisions(revisions, SPOTS, 4);
      const planByOption = Object.fromEntries(
        options.map((o, i) => [o.id, revisions[i].plan])
      );
      const round = await store.openRound(
        trip.id,
        "この先どうしますか。嫌なものだけ出してください",
        options,
        planByOption,
        20
      );
      await store.consumeCall(trip.id);
      router.push(`/trip/${trip.id}/decide/${round.id}`);
      return;
    }

    const updated = await store.updatePlan(trip.id, revision.plan);
    const withCall = await store.consumeCall(updated.id);
    setTrip(withCall);
    setDismissed(false);
    setToast("入れ替えました");
    setTimeout(() => setToast(null), 2600);
  };

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

  const { hp, mp } = stateAt(sim.timeline, nowMin);
  const someoneLow = trip.mode === "party" && hp < 30;

  return (
    <div className="view">
      <header className="triphead">
        <div>
          <div className="triphead__eyebrow">{jpDate()}</div>
          <div className="triphead__clock">{hhmm(nowMin)}</div>
        </div>
        <div className="triphead__right">
          <div className="triphead__calls">
            {trip.callsUsed}<span>/{CALLS_PER_DAY}</span>
          </div>
          <div className="triphead__callslabel">今日の呼び出し</div>
        </div>
      </header>

      <section>
        <Gauge label={trip.mode === "party" ? "パーティの体力" : "体力"} value={hp} color="var(--byakuroku)" />
        <Gauge label="気分" value={mp} color="var(--kariyasu)" />
      </section>

      {someoneLow && (
        <p className="partynote">パーティに1人、限界が近い人がいます。</p>
      )}

      <div className="trackhead" style={{ marginTop: 20 }}>
        <span className="trackhead__title">道中</span>
        <span className="trackhead__note">
          {sim.collapseMin !== null || sim.lowHpMin !== null || sim.lowMpMin !== null
            ? "このあとの消耗を先に表示しています"
            : "最後までまわれます"}
        </span>
      </div>

      <Track timeline={sim.timeline} spots={SPOTS} nowMin={nowMin} collapseMin={sim.collapseMin} />

      <div className="trackhead" style={{ marginTop: 22 }}>
        <span className="trackhead__title">現在地</span>
        <span className="trackhead__note">
          {here.spot ? here.spot.name : here.fix ? "移動中" : "位置なし"}
          {here.observation.walkedKm > 0.05 && ` ・ 歩いた距離 ${here.observation.walkedKm.toFixed(1)}km`}
        </span>
      </div>

      <Map
        plan={trip.plan}
        spots={SPOTS}
        here={here.fix}
        visitedCount={fixedCount}
        currentSpotId={here.spot?.id ?? null}
      />

      {here.permission === "denied" && (
        <p className="partynote">
          位置情報が使えないので、時刻から現在地を推しています。
        </p>
      )}

      {toast && <div className="toast">{toast}</div>}

      {showInterrupt && copy && (
        <Interrupt
          copy={copy}
          onPrimary={accept}
          onSecondary={() => setDismissed(true)}
          /* iOS では Push が鳴らないので、ロック画面風のバナーを画面の中に描く（企画書の保険2）。
             ふつうのカードに戻すなら variant="card" */
          variant="lock"
          at={hhmm(nowMin)}
        />
      )}
    </div>
  );
}
