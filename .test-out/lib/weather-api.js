/** 実行環境のタイムゾーンに関わらず、日本時間の「いま何時」を取る */
function currentJstHour(now = new Date()) {
    const s = new Intl.DateTimeFormat("en-GB", {
        timeZone: "Asia/Tokyo",
        hour: "2-digit",
        hour12: false,
    }).format(now);
    return Number(s.replace(/\D/g, "")) % 24;
}
function classifyRain(mmPerHour) {
    if (mmPerHour >= 2)
        return "heavy";
    if (mmPerHour >= 0.1)
        return "light";
    return "none";
}
/**
 * いまの気温と降雨を取ってくる。
 * オフラインやAPI障害では null を返すだけで、呼び出し側は
 * 今の値を保ち続ければよい（会場のWi-Fiが死んでも止めない）。
 */
export async function fetchRealWeather(lat, lng, signal) {
    const url = `https://api.open-meteo.com/v1/forecast` +
        `?latitude=${lat}&longitude=${lng}` +
        `&hourly=temperature_2m,precipitation` +
        `&timezone=Asia%2FTokyo&forecast_days=1`;
    const res = await fetch(url, { signal });
    if (!res.ok)
        return null;
    const data = (await res.json());
    const h = currentJstHour();
    const temperatureC = data.hourly?.temperature_2m?.[h];
    const precip = data.hourly?.precipitation?.[h];
    if (temperatureC === undefined || precip === undefined)
        return null;
    return { temperatureC: Math.round(temperatureC), rain: classifyRain(precip) };
}
