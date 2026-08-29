"use client";
import { createSettings } from "./tiny-store";
import type { SimulationEnvironment } from "./model";
import type { DayType } from "./types";

/* ============================================================
   天候。企画書の「静的推定テーブル + 天候 + 利用者分布」の天候ぶん。

   model.ts は最初から雨と気温を受け取れたのに、画面から一度も
   渡していなかった。ここが入口。

   通常の道中では lib/useRealWeather.ts が Open-Meteo（キー不要）から
   実際の予報を取ってきて、ここに set する。デモ中は操作卓の手入力を
   優先し、実測では上書きしない。
   ============================================================ */

export type Rain = "none" | "light" | "heavy";

export interface WeatherState {
  rain: Rain;
  temperatureC: number;
  hasUmbrella: boolean;
}

export const weather = createSettings<WeatherState>("dochu:weather", {
  rain: "none",
  temperatureC: 25,
  hasUmbrella: true,
});

export const RAIN_LABEL: Record<Rain, string> = {
  none: "降っていない",
  light: "小雨",
  heavy: "本降り",
};

/** simulate に渡す形にする */
export function toEnvironment(w: WeatherState, dayType: DayType): SimulationEnvironment {
  return {
    dayType,
    rain: w.rain !== "none",
    // 本降りは傘があっても濡れる扱いにする
    hasUmbrella: w.rain === "heavy" ? false : w.hasUmbrella,
    temperatureC: w.temperatureC,
  };
}
