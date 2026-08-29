import { geoapifyKey } from "./geoapify-config";
const KYOTO = { lat: 35.0116, lng: 135.7681 };
const RADIUS_M = 40_000;
/**
 * 未設定・オフライン・API障害では空配列を返すだけ。
 * 呼び出し側は「候補が無い」と同じ扱いにすればよい。
 */
export async function searchPlaces(query, signal) {
    const key = geoapifyKey();
    const text = query.trim();
    if (!key || text.length < 2)
        return [];
    const params = new URLSearchParams({
        text,
        apiKey: key,
        lang: "ja",
        limit: "6",
        bias: `proximity:${KYOTO.lng},${KYOTO.lat}`,
        filter: `circle:${KYOTO.lng},${KYOTO.lat},${RADIUS_M}`,
    });
    const res = await fetch(`https://api.geoapify.com/v1/geocode/autocomplete?${params}`, { signal });
    if (!res.ok)
        return [];
    const data = (await res.json());
    const out = [];
    (data.features ?? []).forEach((f, i) => {
        const [lng, lat] = f.geometry?.coordinates ?? [];
        const name = f.properties?.name || f.properties?.address_line1;
        if (lat == null || lng == null || !name)
            return;
        out.push({ key: `${i}:${lat}:${lng}`, name, formatted: f.properties?.formatted ?? name, lat, lng });
    });
    return out;
}
