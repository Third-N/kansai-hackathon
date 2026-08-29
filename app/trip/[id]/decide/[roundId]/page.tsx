"use client";

import { useEffect, useMemo, useRef, useState, use } from "react";
import { useRouter } from "next/navigation";
import { store } from "@/lib/store";
import { secondsUntil, vetoCap } from "@/lib/round";
import type { Round } from "@/lib/types";

export default function DecidePage({
  params,
}: {
  params: Promise<{ id: string; roundId: string }>;
}) {
  const { id, roundId } = use(params);
  const router = useRouter();
  const [round, setRound] = useState<Round | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [submitted, setSubmitted] = useState(false);
  const [left, setLeft] = useState<number>(999);
  const applied = useRef(false);

  useEffect(() => store.subscribeRound(roundId, setRound), [roundId]);

  /* 残り秒はサーバー時刻から毎フレーム逆算する。端末のカウンタは持たない */
  useEffect(() => {
    if (!round) return;
    let raf = 0;
    const tick = () => {
      setLeft(secondsUntil(round.revealAt));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [round]);

  /* 開示されたら、選ばれた案を適用する。適用は1回だけ */
  useEffect(() => {
    if (!round?.result || applied.current) return;
    applied.current = true;
    const plan = round.planByOption[round.result.winnerId];
    if (plan) store.updatePlan(id, plan);
  }, [round, id]);

  const cap = useMemo(() => (round ? vetoCap(round.options.length) : 1), [round]);

  if (!round) return <div className="loading">読み込んでいます</div>;

  const revealed = round.status === "revealed" && !!round.result;
  const toggle = (optId: string) => {
    if (submitted || revealed) return;
    setPicked((p) =>
      p.includes(optId) ? p.filter((x) => x !== optId) : p.length >= cap ? p : [...p, optId]
    );
  };

  const submit = async () => {
    await store.castVetoes(roundId, await store.currentMemberId(), picked);
    setSubmitted(true);
  };

  /* ---- 開示後 ---- */
  if (revealed) {
    const result = round.result!;
    const winner = round.options.find((o) => o.id === result.winnerId)!;
    return (
      <div className="view">
        {/* 開示の合図。この return がマウントされる瞬間に一度だけ光って消える */}
        <div className="seenoflash" aria-hidden />

        <div className="seeno__head">
          <span className="seeno__title">せーの</span>
          <span className="seeno__note">
            {result.kind === "unanimous" && "反対はゼロでした"}
            {result.kind === "tied" && `残ったのは${result.survivorCount}つ。1つ選びました`}
            {result.kind === "compromise" && "全部に誰かが反対しました"}
          </span>
        </div>

        <ul className="opts opts--revealed">
          {round.options.map((o, i) => {
            const count = result.tally.find((t) => t.optionId === o.id)?.count ?? 0;
            const isWinner = o.id === result.winnerId;
            return (
              <li
                key={o.id}
                className={`opt ${isWinner ? "is-winner" : count > 0 ? "is-struck" : "is-clear"}`}
                style={{ animationDelay: `${i * 90}ms` }}
              >
                <div className="opt__body">
                  <b className="opt__label">{o.label}</b>
                  <i className="opt__sub">{o.sub}</i>
                </div>
                <span className="opt__count">
                  {count === 0 ? "反対なし" : `嫌 ${count}`}
                </span>
              </li>
            );
          })}
        </ul>

        <div
          className={`verdict verdict--${result.kind}`}
          style={{ animationDelay: `${round.options.length * 90 + 120}ms` }}
        >
          <div className="verdict__eyebrow">
            {result.kind === "compromise" ? "妥協点" : "決まりました"}
          </div>
          <p className="verdict__label">{winner.label}</p>
          <p className="verdict__sub">{winner.sub}</p>
        </div>

        <button className="go" onClick={() => router.push(`/trip/${id}`)}>
          道中にもどる
        </button>
      </div>
    );
  }

  /* ---- 開示前 ---- */
  const counting = left <= 3.999;
  return (
    <div className="view">
      <div className="seeno__head">
        <span className="seeno__title">せーの</span>
        <span className="seeno__note">嫌なものだけ、{cap}つまで</span>
      </div>

      <p className="seeno__q">{round.question}</p>

      <ul className="opts">
        {round.options.map((o) => (
          <li key={o.id}>
            <button
              className={`opt opt--btn ${picked.includes(o.id) ? "is-picked" : ""}`}
              onClick={() => toggle(o.id)}
              disabled={submitted}
              aria-pressed={picked.includes(o.id)}
            >
              <div className="opt__body">
                <b className="opt__label">{o.label}</b>
                <i className="opt__sub">{o.sub}</i>
              </div>
              <span className="opt__mark">{picked.includes(o.id) ? "嫌" : ""}</span>
            </button>
          </li>
        ))}
      </ul>

      {submitted ? (
        <div className="waiting">
          <p className="waiting__text">伏せました。全員がそろうまで開きません。</p>
          <p className="waiting__count">
            {round.submittedCount} / {round.memberCount} 人
          </p>
        </div>
      ) : (
        <button className="go" onClick={submit}>
          {picked.length === 0 ? "嫌なものはない、で出す" : `${picked.length}つ出して伏せる`}
        </button>
      )}

      <div className={`count ${counting ? "is-hot" : ""}`} aria-live="off">
        <span className="count__n">{Math.ceil(left)}</span>
        <span className="count__u">秒後にひらきます</span>
      </div>

      <p className="anon" style={{ marginTop: 18 }}>
        誰が何を選んだかは、開いたあとも出ません。<br />
        出てくるのは、選択肢ごとの反対の数だけです。
      </p>
    </div>
  );
}
