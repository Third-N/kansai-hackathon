import { geoapifyKey } from "./geoapify-config";

/* ============================================================
   行き先の検索。Geoapify の Geocoding Autocomplete を使う。
   lib/static-map.ts と同じキーを使い回す（画面か Supabase から
   もらったもの。地図の背景画像と検索は同じキーで両方効く）。

   京都市街のだいたいの範囲に絞って探す（bias/filter）。
   全国どこでも拾える必要はなく、むしろ関係ない同名地名が
   混ざるほうが困る。
   ============================================================ */

export interface PlaceSuggestion {
  /** 選ばれたときに Spot の id 生成に使う一時キー（配列内で一意なら足りる） */
  key: string;
  name: string;
  /** 候補一覧に出す補足（住所など） */
  formatted: string;
  lat: number;
  lng: number;
  /**
   * 端末内900件からの候補だけが持つ、混雑・気分カーブの手がかり。
   * lib/local-place-search.ts の LocalPlaceCategory と同じ値の文字列。
   * Geoapifyのオンライン検索には無いので undefined のまま
   * （custom-spot.ts 側で「その他・並」として扱う）。
   */
  category?: string;
  priority?: number;
}

const KYOTO = { lat: 35.0116, lng: 135.7681 };
const RADIUS_M = 40_000;

interface GeoapifyFeatureProperties {
  name?: string;
  address_line1?: string;
  formatted?: string;
}

interface GeoapifyFeature {
  properties?: GeoapifyFeatureProperties;
  geometry?: { coordinates?: [number, number] };
}

interface GeoapifyAutocompleteResponse {
  features?: GeoapifyFeature[];
}

/**
 * 未設定・オフライン・API障害では空配列を返すだけ。
 * 呼び出し側は「候補が無い」と同じ扱いにすればよい。
 */
export async function searchPlaces(query: string, signal?: AbortSignal): Promise<PlaceSuggestion[]> {
  const key = geoapifyKey();
  const text = query.trim();
  if (!key || text.length < 2) return [];

  const params = new URLSearchParams({
    text,
    apiKey: key,
    lang: "ja",
    limit: "6",
    bias: `proximity:${KYOTO.lng},${KYOTO.lat}`,
    filter: `circle:${KYOTO.lng},${KYOTO.lat},${RADIUS_M}`,
  });

  const res = await fetch(`https://api.geoapify.com/v1/geocode/autocomplete?${params}`, { signal });
  if (!res.ok) return [];

  const data = (await res.json()) as GeoapifyAutocompleteResponse;
  const out: PlaceSuggestion[] = [];
  (data.features ?? []).forEach((f, i) => {
    const [lng, lat] = f.geometry?.coordinates ?? [];
    const name = f.properties?.name || f.properties?.address_line1;
    if (lat == null || lng == null || !name) return;
    out.push({ key: `${i}:${lat}:${lng}`, name, formatted: f.properties?.formatted ?? name, lat, lng });
  });
  return out;
}
