"use client";
import { DEMO_SPEEDS, demo, exitDemo } from "@/lib/demo";
import { weather, RAIN_LABEL, type Rain } from "@/lib/weather";
import { hhmm } from "@/lib/format";
import { fireInterruptNotification } from "@/lib/useInterruptNotify";
import { useEffect, useRef } from "react";

/* ============================================================
   デモの操作卓。デモモードのときだけ全画面の下に出る。

   企画書の「早送りシミュレーションが必須。時刻スライダーを動かす →
   体力が減る → 混雑ゾーンで警告 → 予定が組み替わる」がこれ。

   ここは審査員に見せる面ではないので、素っ気なくしてある。
   ============================================================ */

const MIN_MIN = 5 * 60;
const MAX_MIN = 25 * 60;

export function DemoBar() {
  const d = demo.use();
  const w = weather.use();
  const ref = useRef<HTMLDivElement>(null);

  /* 操作卓の高さは、チップの折り返しで変わる。
     実測して --demobar-h に入れ、本文の下余白をそれに合わせる。
     決め打ちにすると、狭い画面で割り込みが操作卓の裏に隠れる。 */
  useEffect(() => {
    const el = ref.current;
    const root = document.documentElement;
    if (!el || !d.enabled) {
      root.style.setProperty("--demobar-h", "0px");
      return;
    }
    const apply = () => root.style.setProperty("--demobar-h", `${Math.ceil(el.getBoundingClientRect().height) + 12}px`);
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => {
      ro.disconnect();
      root.style.setProperty("--demobar-h", "0px");
    };
  }, [d.enabled]);

  if (!d.enabled) return null;

  const clock = d.clockMin ?? MIN_MIN;

  return (
    <div className="demobar" role="region" aria-label="デモ操作" ref={ref}>
      <div className="demobar__row">
        <button
          className="demobar__play"
          onClick={() => demo.set({ playing: !d.playing })}
          aria-label={d.playing ? "止める" : "進める"}
        >
          {d.playing ? "■" : "▶"}
        </button>
        <input
          className="demobar__slider"
          type="range"
          min={MIN_MIN}
          max={MAX_MIN}
          step={5}
          value={clock}
          aria-label="時刻"
          onChange={(e) => demo.set({ clockMin: Number(e.target.value), playing: false })}
        />
        <span className="demobar__clock">{hhmm(clock)}</span>
      </div>

      <div className="demobar__row demobar__row--wrap">
        <span className="demobar__label">速さ</span>
        {DEMO_SPEEDS.map((s) => (
          <button
            key={s}
            className={`demobar__chip ${d.speed === s ? "is-on" : ""}`}
            onClick={() => demo.set({ speed: s })}
          >
            ×{s}
          </button>
        ))}

        <span className="demobar__label">天気</span>
        {(["none", "light", "heavy"] as Rain[]).map((r) => (
          <button
            key={r}
            className={`demobar__chip ${w.rain === r ? "is-on" : ""}`}
            onClick={() => weather.set({ rain: r })}
          >
            {RAIN_LABEL[r]}
          </button>
        ))}

        <span className="demobar__label">気温</span>
        <input
          className="demobar__temp"
          type="number"
          min={-5}
          max={45}
          value={w.temperatureC}
          aria-label="気温"
          onChange={(e) => weather.set({ temperatureC: Number(e.target.value) })}
        />
        <span className="demobar__unit">℃</span>

        <button
          className={`demobar__chip ${d.mockLocation ? "is-on" : ""}`}
          onClick={() => demo.set({ mockLocation: !d.mockLocation })}
          title="位置を時計から作る。切ると実機のGPSを見る"
        >
          位置はモック
        </button>

        <button
          className="demobar__chip"
          onClick={() => fireInterruptNotification("道中から呼び出し", "審査員向け: 通知はこんな感じで出ます")}
          title="実際の割り込み条件を待たずに、通知（と振動）を試せる"
        >
          通知を試す
        </button>

        <button className="demobar__exit" onClick={exitDemo}>デモを出る</button>
      </div>
    </div>
  );
}
