"use client";
import { createSettings } from "./tiny-store";
export const weather = createSettings("dochu:weather", {
    rain: "none",
    temperatureC: 25,
    hasUmbrella: true,
});
export const RAIN_LABEL = {
    none: "降っていない",
    light: "小雨",
    heavy: "本降り",
};
/** simulate に渡す形にする */
export function toEnvironment(w, dayType) {
    return {
        dayType,
        rain: w.rain !== "none",
        // 本降りは傘があっても濡れる扱いにする
        hasUmbrella: w.rain === "heavy" ? false : w.hasUmbrella,
        temperatureC: w.temperatureC,
    };
}
