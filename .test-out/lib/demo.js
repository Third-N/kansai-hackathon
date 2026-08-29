"use client";
import { createSettings } from "./tiny-store";
import { minutesNow } from "./format";
/* ============================================================
   デモモード。

   企画書の「早送りシミュレーションが必須。会場で歩き回れないため」がこれ。
   実時計のかわりにこの時計を使い、スライダーで動かす。
   位置情報もこの時計から作るので、GPSが不安定でも死なない。

   入口はホームのあいことば欄。DEMO_CODE を入れると入る。
   ============================================================ */
/** ホームのあいことば欄にこれを入れるとデモモードに入る */
export const DEMO_CODE = process.env.NEXT_PUBLIC_DEMO_CODE || "みちゆき";
export const DEMO_SPEEDS = [1, 5, 15, 60];
export const demo = createSettings("dochu:demo", {
    enabled: false,
    clockMin: null,
    playing: false,
    speed: 15,
    mockLocation: true,
});
/** 入力されたあいことばがデモの合図か */
export function isDemoCode(input) {
    return input.trim().toLowerCase() === DEMO_CODE.toLowerCase();
}
export function enterDemo(startMin) {
    demo.set({ enabled: true, clockMin: startMin, playing: false, mockLocation: true });
}
export function exitDemo() {
    demo.set({ enabled: false, clockMin: null, playing: false });
}
/* ---- 早送りの心臓。playing の間だけ動く ---- */
let timer = null;
function tick() {
    const s = demo.get();
    if (!s.enabled || !s.playing)
        return;
    const next = (s.clockMin ?? minutesNow()) + s.speed;
    // 25時を超えたら止める。日をまたぐ表示は用意していない
    if (next >= 24 * 60 + 60) {
        demo.set({ clockMin: 24 * 60 + 60, playing: false });
        return;
    }
    demo.set({ clockMin: next });
}
if (typeof window !== "undefined") {
    timer ??= setInterval(tick, 1000);
}
