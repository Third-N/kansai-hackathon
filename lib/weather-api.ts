import type { Rain } from "./weather";

/* ============================================================
   実際の天気。Open-Meteo を使う。APIキー不要・無料枠が大きい
   （非商用で1日1万リクエストまで）。https://open-meteo.com/

   降雨量(mm/h)を none/light/heavy の3段階に丸める。しきい値は
   model.ts 側の「小雨・本降り」の感覚に合わせた大まかな近似で、
   気象台の定義そのものではない。
   ============================================================ */

export interface RealWeather {
  temperatureC: number;
  rain: Rain;
}

interface OpenMeteoHourly {
  temperature_2m?: number[];
  precipitation?: number[];
}

interface OpenMeteoResponse {
  hourly?: OpenMeteoHourly;
}

/** 実行環境のタイムゾーンに関わらず、日本時間の「いま何時」を取る */
function currentJstHour(now: Date = new Date()): number {
  const s = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Tokyo",
    hour: "2-digit",
    hour12: false,
  }).format(now);
  return Number(s.replace(/\D/g, "")) % 24;
}

function classifyRain(mmPerHour: number): Rain {
  if (mmPerHour >= 2) return "heavy";
  if (mmPerHour >= 0.1) return "light";
  return "none";
}

/**
 * いまの気温と降雨を取ってくる。
 * オフラインやAPI障害では null を返すだけで、呼び出し側は
 * 今の値を保ち続ければよい（会場のWi-Fiが死んでも止めない）。
 */
export async function fetchRealWeather(
  lat: number,
  lng: number,
  signal?: AbortSignal
): Promise<RealWeather | null> {
  const url =
    `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${lat}&longitude=${lng}` +
    `&hourly=temperature_2m,precipitation` +
    `&timezone=Asia%2FTokyo&forecast_days=1`;

  const res = await fetch(url, { signal });
  if (!res.ok) return null;

  const data = (await res.json()) as OpenMeteoResponse;
  const h = currentJstHour();
  const temperatureC = data.hourly?.temperature_2m?.[h];
  const precip = data.hourly?.precipitation?.[h];
  if (temperatureC === undefined || precip === undefined) return null;

  return { temperatureC: Math.round(temperatureC), rain: classifyRain(precip) };
}
