import { geoapifyKey } from "./geoapify-config";
/* ============================================================
   実際の地図の背景。Geoapify の Static Maps API を使う。

   緯度をそのまま線形に扱うと、実際のタイル地図（Webメルカトル）とは
   縦方向の詰まり方がずれる。mercatorY はその変換。
   経度はメルカトルでも線形なので、そのまま使ってよい。
   ============================================================ */
/** 緯度 → Webメルカトルの y（無次元）。タイル地図と同じ投影に揃える */
export function mercatorY(latDeg) {
    const rad = (latDeg * Math.PI) / 180;
    return Math.log(Math.tan(Math.PI / 4 + rad / 2));
}
/**
 * 実際の地図画像のURL。キーが無ければ null（呼び出し側は今まで通りの
 * 点と線だけの図にフォールバックする）。
 *
 * 表示側のマーカーは別の投影計算（Map.tsx の project）で置くので、
 * ここで渡す範囲は少し広め（マージン込み）にしておかないと、
 * 端のマーカーが画像の外にはみ出て見える。
 */
export function staticMapUrl(box, widthPx, heightPx) {
    const key = geoapifyKey();
    if (!key)
        return null;
    const area = `rect:${box.minLng.toFixed(6)},${box.minLat.toFixed(6)},` +
        `${box.maxLng.toFixed(6)},${box.maxLat.toFixed(6)}`;
    const params = new URLSearchParams({
        style: "osm-carto",
        width: String(Math.round(widthPx)),
        height: String(Math.round(heightPx)),
        area,
        apiKey: key,
    });
    return `https://maps.geoapify.com/v1/staticmap?${params.toString()}`;
}
