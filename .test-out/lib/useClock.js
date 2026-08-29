"use client";
import { minutesNow } from "./format";
import { useNow } from "./useNow";
import { demo } from "./demo";
/* ============================================================
   画面が見る「いまの分」。

   実時計か、デモの時計か。呼ぶ側はどちらか知らなくてよい。
   企画書の「時刻スライダーを動かす → 体力が減る」は、
   このフックが1つあることで全画面に効く。
   ============================================================ */
export function useClock(intervalMs = 30_000) {
    const real = useNow(intervalMs);
    const d = demo.use();
    return d.enabled && d.clockMin !== null ? d.clockMin : real;
}
/** フックの外から今の分が要るとき */
export function clockNow() {
    const d = demo.get();
    return d.enabled && d.clockMin !== null ? d.clockMin : minutesNow();
}
/** いまデモモードか */
export function useIsDemo() {
    return demo.use().enabled;
}
