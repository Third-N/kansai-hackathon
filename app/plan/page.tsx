"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { store } from "@/lib/store";
import { SPOTS } from "@/lib/spots";
import { DEFAULT_START_MIN } from "@/lib/defaults";
import type { PlanItem, TripMode } from "@/lib/types";

const DEFAULT_STAY: Record<string, number> = {
  inari: 70, kiyomizu: 60, nishiki: 50, nanzenji: 50, ginkakuji: 45, arashiyama: 50,
};

function PlanInner() {
  const router = useRouter();
  const search = useSearchParams();
  const mode = (search.get("mode") as TripMode) ?? "solo";
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const choices = Object.values(SPOTS).filter((s) => s.kind !== "rest");

  const toggle = (id: string) =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  const start = async () => {
    setBusy(true);
    const plan: PlanItem[] = picked.map((id) => ({
      spotId: id,
      stayMin: DEFAULT_STAY[id] ?? 50,
    }));
    const trip = await store.createTrip(mode, plan, DEFAULT_START_MIN);
    router.push(mode === "party" ? `/party/${trip.code}` : `/trip/${trip.id}`);
  };

  return (
    <div className="view">
      <div className="lobby__head">
        <a className="back" href="/">← もどる</a>
        <span className="lobby__title">行き先</span>
      </div>

      <p className="seeno__q" style={{ marginBottom: 18 }}>
        今日まわりたいところを選んでください。<br />
        順番と時間は、道中で組み直します。
      </p>

      <ul className="picks">
        {choices.map((s) => (
          <li key={s.id}>
            <button
              className={`pick ${picked.includes(s.id) ? "is-on" : ""}`}
              onClick={() => toggle(s.id)}
              aria-pressed={picked.includes(s.id)}
            >
              <span className="pick__body">
                <b>{s.name}</b>
                <i>{s.sub}</i>
              </span>
              <span className="pick__order">
                {picked.includes(s.id) ? picked.indexOf(s.id) + 1 : ""}
              </span>
            </button>
          </li>
        ))}
      </ul>

      {picked.length >= 4 && (
        <p className="warnline">
          京都で1日4件を超えると、歩く距離が体力に対して過剰になりがちです。
          入れておいて構いませんが、道中で削ることになります。
        </p>
      )}

      <button className="go" disabled={picked.length < 2 || busy} onClick={start}>
        {picked.length < 2 ? "2件以上えらんでください" : `${picked.length}件で出発する`}
      </button>
    </div>
  );
}

export default function PlanPage() {
  return (
    <Suspense fallback={<div className="loading">読み込んでいます</div>}>
      <PlanInner />
    </Suspense>
  );
}
