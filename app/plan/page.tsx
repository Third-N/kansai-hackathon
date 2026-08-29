"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { store } from "@/lib/store";
import { SPOTS } from "@/lib/spots";
import { DEFAULT_START_MIN } from "@/lib/defaults";
import { useGeoapifyKey } from "@/lib/geoapify-config";
import { searchPlaces, type PlaceSuggestion } from "@/lib/geoapify-search";
import { makeCustomSpot } from "@/lib/custom-spot";
import type { PlanItem, Spot, TripMode } from "@/lib/types";

const DEFAULT_STAY: Record<string, number> = {
  inari: 70, kiyomizu: 60, nishiki: 50, nanzenji: 50, ginkakuji: 45, arashiyama: 50,
};

function PlanInner() {
  const router = useRouter();
  const search = useSearchParams();
  const mode = (search.get("mode") as TripMode) ?? "solo";
  const [picked, setPicked] = useState<string[]>([]);
  const [customSpots, setCustomSpots] = useState<Record<string, Spot>>({});
  const [busy, setBusy] = useState(false);

  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [searching, setSearching] = useState(false);
  const hasGeoapifyKey = !!useGeoapifyKey();

  const choices = [...Object.values(SPOTS).filter((s) => s.kind !== "rest"), ...Object.values(customSpots)];

  const toggle = (id: string) =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  /* 検索は入力が止まってから投げる。1文字ごとに叩くと会場の回線がもたない */
  const searchSeq = useRef(0);
  useEffect(() => {
    if (query.trim().length < 2) {
      setSuggestions([]);
      setSearching(false);
      return;
    }
    const seq = ++searchSeq.current;
    setSearching(true);
    const timer = setTimeout(() => {
      void searchPlaces(query).then((found) => {
        if (searchSeq.current === seq) {
          setSuggestions(found);
          setSearching(false);
        }
      });
    }, 350);
    return () => clearTimeout(timer);
  }, [query]);

  const addCustom = (s: PlaceSuggestion) => {
    const spot = makeCustomSpot({ name: s.name, sub: s.formatted, lat: s.lat, lng: s.lng });
    setCustomSpots((c) => ({ ...c, [spot.id]: spot }));
    setPicked((p) => [...p, spot.id]);
    setQuery("");
    setSuggestions([]);
  };

  const start = async () => {
    setBusy(true);
    const plan: PlanItem[] = picked.map((id) => ({
      spotId: id,
      stayMin: DEFAULT_STAY[id] ?? 50,
    }));
    const trip = await store.createTrip(mode, plan, DEFAULT_START_MIN, customSpots);
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

      <div className="spotsearch">
        <label className="join__label" htmlFor="spotsearch-input">ほかの行き先をさがす</label>
        {hasGeoapifyKey ? (
          <>
            <input
              id="spotsearch-input"
              className="spotsearch__input"
              type="text"
              placeholder="場所の名前で検索"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {searching && <p className="spotsearch__hint">さがしています…</p>}
            {!searching && query.trim().length >= 2 && suggestions.length === 0 && (
              <p className="spotsearch__hint">見つかりませんでした</p>
            )}
            {suggestions.length > 0 && (
              <ul className="spotsearch__list">
                {suggestions.map((s) => (
                  <li key={s.key}>
                    <button type="button" className="spotsearch__item" onClick={() => addCustom(s)}>
                      <b>{s.name}</b>
                      <i>{s.formatted}</i>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <p className="spotsearch__hint">
            検索には地図APIキーが要ります。道中の画面の「現在地」から設定できます。
          </p>
        )}
      </div>

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
