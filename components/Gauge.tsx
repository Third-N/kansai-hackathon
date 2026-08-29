"use client";

import { useEffect, useRef, useState } from "react";

const LOW = 25;

/**
 * ゲージ。値が下がったときだけ、減った量を数字で飛ばす。
 * 上がったときは静かにする — 回復は自動判定なので、いちいち褒めない。
 */
export function Gauge({
  label, value, color, tone = "light", animate = true,
}: {
  label: string;
  value: number;
  color: string;
  tone?: "light" | "dark";
  animate?: boolean;
}) {
  const v = Math.max(0, Math.min(100, value));
  const low = v < LOW;
  const prev = useRef<number | null>(null);
  const [hit, setHit] = useState(false);
  const [damage, setDamage] = useState<{ key: number; n: number } | null>(null);

  useEffect(() => {
    if (!animate) { prev.current = v; return; }
    const before = prev.current;
    prev.current = v;
    if (before === null) return;

    const delta = v - before;
    // 小さすぎる変化で光らせない。実時計だと毎分わずかに減るため
    if (delta > -1.5) return;

    setDamage({ key: Date.now(), n: Math.round(delta) });
    setHit(true);
    const t1 = setTimeout(() => setHit(false), 520);
    const t2 = setTimeout(() => setDamage(null), 1150);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [v, animate]);

  return (
    <div className={`gauge gauge--${tone} gaugewrap`}>
      {damage && <span className="damage" key={damage.key}>{damage.n}</span>}
      <div className="gauge__top">
        <span className="gauge__label">{label}</span>
        <span
          className={`gauge__value ${hit ? "is-hit" : ""}`}
          style={low ? { color: "var(--shu)" } : undefined}
        >
          {Math.round(v)}
        </span>
      </div>
      <div className="gauge__rail">
        <div
          className={`gauge__fill ${hit ? "is-hit" : ""}`}
          style={{ width: `${v}%`, background: low ? "var(--shu)" : color }}
          role="progressbar"
          aria-label={label}
          aria-valuenow={Math.round(v)}
          aria-valuemin={0}
          aria-valuemax={100}
        />
      </div>
    </div>
  );
}
