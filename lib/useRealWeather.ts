"use client";
import { useEffect } from "react";
import { weather } from "./weather";
import { fetchRealWeather } from "./weather-api";
import { useIsDemo } from "./useClock";

/* ============================================================
   道中の天気を、実際の予報で更新し続ける。

   デモ中は操作卓の手入力を優先するので、ここでは触らない
   （lib/weather.ts のコメント通り、fetchWeather を1つ足して
   set するだけで繋がる形にしてあったので、その1つがこれ）。
   ============================================================ */

/** 京都市内。道中はだいたいこの範囲に収まる */
const KYOTO = { lat: 35.0116, lng: 135.7681 };

const REFRESH_MS = 15 * 60_000;

export function useRealWeather(): void {
  const isDemo = useIsDemo();

  useEffect(() => {
    if (isDemo) return;

    const controller = new AbortController();
    let stopped = false;

    const tick = async () => {
      try {
        const w = await fetchRealWeather(KYOTO.lat, KYOTO.lng, controller.signal);
        if (!stopped && w) {
          // hasUmbrella は本人の持ち物なので触らない
          weather.set({ temperatureC: w.temperatureC, rain: w.rain });
        }
      } catch {
        // オフライン・API障害。今の値のまま次の周期を待つ
      }
    };

    void tick();
    const id = setInterval(tick, REFRESH_MS);
    return () => {
      stopped = true;
      controller.abort();
      clearInterval(id);
    };
  }, [isDemo]);
}
