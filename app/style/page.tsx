"use client";

import { useState } from "react";
import { Gauge } from "@/components/Gauge";
import { Track } from "@/components/Track";
import { Interrupt } from "@/components/Interrupt";
import { Map } from "@/components/Map";
import { SPOTS, TRAVEL_TABLE } from "@/lib/spots";
import { simulate } from "@/lib/model";
import { hhmm } from "@/lib/format";
import { CALLS_PER_DAY } from "@/lib/store";
import type { PlanItem } from "@/lib/types";

/* ============================================================
   見た目の一覧。UI をいじるときはここを開いたまま
   app/globals.css を触ると、全部の状態が一度に見える。

   このページはデータを取りに行かない。store も Supabase も使わない。
   壊れても本番の画面には影響しない。

   /style で開く。
   ============================================================ */

const PLAN: PlanItem[] = [
  { spotId: "inari", stayMin: 70 },
  { spotId: "kiyomizu", stayMin: 60 },
  { spotId: "nishiki", stayMin: 45 },
  { spotId: "nanzenji", stayMin: 50 },
];

const COLORS = [
  ["--haze", "地の色"],
  ["--panel", "紙の色"],
  ["--line", "罫"],
  ["--ink", "文字"],
  ["--ink-2", "薄い文字"],
  ["--ai", "藍。決まったもの"],
  ["--byakuroku", "白緑。体力"],
  ["--kariyasu", "刈安。気分"],
  ["--shu", "朱。危険と現在地"],
];

const GAPS = ["--gap-1", "--gap-2", "--gap-3", "--gap-4"];
const ROUNDS = ["--round-1", "--round-2", "--round-3"];

export default function StylePage() {
  const [hp, setHp] = useState(62);
  const [mp, setMp] = useState(44);
  const [nowMin, setNowMin] = useState(12 * 60 + 30);
  const sim = simulate(PLAN, SPOTS, 10 * 60 + 30, { travelTable: TRAVEL_TABLE });

  return (
    <div className="view">
      <div className="lobby__head">
        <a className="back" href="/">← もどる</a>
        <span className="lobby__title">見た目の一覧</span>
      </div>

      <p className="empty__sub" style={{ marginBottom: "var(--gap-4)" }}>
        app/globals.css を書き換えると、このページの全部が同時に変わります。
      </p>

      {/* ---------- 色 ---------- */}
      <div className="sec"><span>色</span></div>
      <ul className="sg__swatches">
        {COLORS.map(([token, name]) => (
          <li key={token} className="sg__swatch">
            <i style={{ background: `var(${token})` }} />
            <b>{token}</b>
            <span>{name}</span>
          </li>
        ))}
      </ul>

      {/* ---------- 文字 ---------- */}
      <div className="sec"><span>文字</span></div>
      <div className="sg__type">
        <p style={{ fontFamily: "var(--serif)", fontSize: 22, fontWeight: 600 }}>
          道中　—— 明朝（--serif）
        </p>
        <p style={{ fontFamily: "var(--sans)", fontSize: 15 }}>
          このまま行くと、清水寺で体力が15を下回ります。—— ゴシック（--sans）
        </p>
        <p style={{ fontFamily: "var(--dot)", fontSize: 15 }}>
          12:48　0/5　—— ドット（--dot）。数字と時刻に使う
        </p>
      </div>

      {/* ---------- 余白と角 ---------- */}
      <div className="sec"><span>余白と角</span></div>
      <div className="sg__scale">
        {GAPS.map((g) => (
          <div key={g} className="sg__scaleitem">
            <i style={{ width: `var(${g})`, height: `var(${g})` }} />
            <b>{g}</b>
          </div>
        ))}
        {ROUNDS.map((r) => (
          <div key={r} className="sg__scaleitem">
            <i style={{ width: 26, height: 26, borderRadius: `var(${r})`, background: "var(--ai)" }} />
            <b>{r}</b>
          </div>
        ))}
      </div>

      {/* ---------- ゲージ ---------- */}
      <div className="sec"><span>ゲージ</span></div>
      <label className="sg__knob">
        体力 {Math.round(hp)}
        <input type="range" min={0} max={100} value={hp} onChange={(e) => setHp(+e.target.value)} />
      </label>
      <label className="sg__knob">
        気分 {Math.round(mp)}
        <input type="range" min={0} max={100} value={mp} onChange={(e) => setMp(+e.target.value)} />
      </label>
      <Gauge label="パーティの体力" value={hp} color="var(--byakuroku)" />
      <Gauge label="気分" value={mp} color="var(--kariyasu)" />
      <div style={{ background: "var(--ink)", padding: "var(--gap-3)", borderRadius: "var(--round-2)", marginTop: "var(--gap-2)" }}>
        <Gauge label="濃い地の上（tone=dark）" value={hp} color="var(--byakuroku)" tone="dark" />
      </div>

      {/* ---------- 双六 ---------- */}
      <div className="sec"><span>道程（Track）</span></div>
      <label className="sg__knob">
        いま {hhmm(nowMin)}
        <input type="range" min={9 * 60} max={19 * 60} value={nowMin} onChange={(e) => setNowMin(+e.target.value)} />
      </label>
      <Track timeline={sim.timeline} spots={SPOTS} nowMin={nowMin} collapseMin={sim.collapseMin} />

      {/* ---------- 地図 ---------- */}
      <div className="sec"><span>地図</span></div>
      <Map
        plan={PLAN}
        spots={SPOTS}
        here={{ lat: 34.9948, lng: 135.785, accuracy: 40, atMin: nowMin, source: "demo" }}
        visitedCount={1}
        currentSpotId="kiyomizu"
      />

      {/* ---------- 割り込み ---------- */}
      <div className="sec"><span>割り込み（カード）</span></div>
      <Interrupt
        copy={{
          title: "このまま行くと、南禅寺で体力が15を下回ります。",
          body: "錦市場で休憩を挟みます。清水寺を15:10にまわします。最後まで体力が残ります（着地 体力34）。",
          primary: "入れ替える",
          secondary: "このまま行く",
        }}
        onPrimary={() => {}}
        onSecondary={() => {}}
      />

      <div className="sec"><span>割り込み（ロック画面風・保険2）</span></div>
      <Interrupt
        variant="lock"
        at={hhmm(nowMin)}
        copy={{
          title: "銀閣寺は、着く頃には閉まっています。",
          body: "順番を入れ替えると間に合います。",
          primary: "みんなで決める",
          secondary: "このまま行く",
        }}
        onPrimary={() => {}}
        onSecondary={() => {}}
      />

      {/* ---------- ボタン ---------- */}
      <div className="sec"><span>ボタン</span></div>
      <div className="sg__row">
        <button className="btn btn--primary">主</button>
        <button className="btn btn--ghost">副</button>
      </div>
      <button className="go" style={{ marginTop: "var(--gap-2)" }}>大きいボタン</button>
      <button className="go" disabled style={{ marginTop: "var(--gap-1)" }}>押せないとき</button>

      {/* ---------- せーのの選択肢 ---------- */}
      <div className="sec"><span>せーのの選択肢</span></div>
      <ul className="opts">
        <li className="opt">
          <span className="opt__label">順番を入れ替える</span>
          <span className="opt__sub">着地 体力42 ・ 気分51</span>
        </li>
        <li className="opt is-picked">
          <span className="opt__label">清水寺をあきらめる</span>
          <span className="opt__sub">着地 体力58 ・ 気分52</span>
        </li>
      </ul>

      {/* ---------- せーの：開示後（3つの結果） ---------- */}
      <div className="sec"><span>せーの：開示後</span></div>
      <ul className="opts">
        <li className="opt is-winner">
          <div className="opt__body">
            <b className="opt__label">順番を入れ替える</b>
            <i className="opt__sub">着地 体力42 ・ 気分51</i>
          </div>
          <span className="opt__count">反対なし</span>
        </li>
        <li className="opt is-struck">
          <div className="opt__body">
            <b className="opt__label">清水寺をあきらめる</b>
            <i className="opt__sub">着地 体力58 ・ 気分52</i>
          </div>
          <span className="opt__count">嫌 2</span>
        </li>
        <li className="opt is-clear">
          <div className="opt__body">
            <b className="opt__label">休憩を挟む</b>
            <i className="opt__sub">着地 体力49 ・ 気分60</i>
          </div>
          <span className="opt__count">反対なし</span>
        </li>
      </ul>

      <div className="sg__row" style={{ marginTop: "var(--gap-3)", flexWrap: "wrap" }}>
        <div className="verdict verdict--unanimous" style={{ flex: "1 1 160px" }}>
          <div className="verdict__eyebrow">決まりました</div>
          <p className="verdict__label">反対ゼロ</p>
          <p className="verdict__sub">unanimous</p>
        </div>
        <div className="verdict" style={{ flex: "1 1 160px" }}>
          <div className="verdict__eyebrow">決まりました</div>
          <p className="verdict__label">1つに絞れた</p>
          <p className="verdict__sub">tied</p>
        </div>
        <div className="verdict verdict--compromise" style={{ flex: "1 1 160px" }}>
          <div className="verdict__eyebrow">妥協点</div>
          <p className="verdict__label">全滅した</p>
          <p className="verdict__sub">compromise</p>
        </div>
      </div>

      {/* ---------- 約束（1日5回） ---------- */}
      <div className="sec" style={{ marginTop: "var(--gap-4)" }}><span>約束（1日5回）</span></div>
      <div className="promise">
        <span className="promise__stamp" aria-hidden>
          <span className="promise__stampn">{CALLS_PER_DAY}</span>
          <span className="promise__stampu">回まで</span>
        </span>
        <p className="promise__text">
          このアプリが<br />あなたを呼ぶのは<br /><b>1日に{CALLS_PER_DAY}回</b>だけです。
        </p>
      </div>

      <p className="anon" style={{ marginTop: "var(--gap-4)" }}>
        ここに無い状態を足したくなったら、このファイルに1ブロック書き足してください。
        データを取りに行かないページなので、壊れても本番には影響しません。
      </p>
    </div>
  );
}
