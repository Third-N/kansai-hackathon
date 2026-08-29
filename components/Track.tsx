"use client";
import type { Segment, Spot } from "@/lib/types";
import { hhmm, signed } from "@/lib/format";

export function Track({
  timeline, spots, nowMin, collapseMin,
}: {
  timeline: Segment[];
  spots: Record<string, Spot>;
  nowMin: number;
  collapseMin: number | null;
}) {
  return (
    <ol className="track">
      {timeline.map((g, i) => {
        const spot = spots[g.spotId];
        const past = nowMin >= g.endMin;
        const active = nowMin >= g.startMin && nowMin < g.endMin;
        const unreachable = collapseMin !== null && g.startMin >= collapseMin;
        const isBreak =
          collapseMin !== null && collapseMin >= g.startMin && collapseMin <= g.endMin;

        if (g.type === "move") {
          return (
            <li key={i} className={cx("leg", past && "is-past", unreachable && "is-unreachable")}>
              <span className="leg__rail" aria-hidden />
              <span className="leg__text">
                移動 {g.endMin - g.startMin}分
                <b className="leg__delta">{signed(g.hpOut - g.hpIn)}</b>
              </span>
            </li>
          );
        }

        return (
          <li
            key={i}
            className={cx(
              "stop",
              past && "is-past",
              active && "is-now",
              unreachable && "is-unreachable",
              isBreak && "is-break"
            )}
          >
            <span className="stop__node" aria-hidden />
            <div className="stop__body">
              <div className="stop__time">{hhmm(g.startMin)}–{hhmm(g.endMin)}</div>
              <div className="stop__name">
                {spot.name}
                {active && <span className="stop__badge">いまここ</span>}
              </div>
              <div className="stop__sub">{spot.sub}</div>
              <div className="chips">
                <Chip unit="体力" v={g.hpOut - g.hpIn} />
                <Chip unit="気分" v={g.mpOut - g.mpIn} />
                {g.crowd !== null && spot.kind === "spot" && (
                  <span className="chip chip--crowd">混雑 {Math.round(g.crowd * 100)}%</span>
                )}
              </div>
              {isBreak && (
                <p className="stop__break">ここで体力が尽きます（{hhmm(collapseMin!)} 頃）</p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function Chip({ unit, v }: { unit: string; v: number }) {
  const n = Math.round(v);
  if (n === 0) return null;
  return (
    <span className={cx("chip", n < 0 ? "chip--minus" : "chip--plus")}>
      {unit}<b>{signed(n)}</b>
    </span>
  );
}

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");
