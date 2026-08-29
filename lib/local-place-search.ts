import type { PlaceSuggestion } from "./geoapify-search";

export type LocalPlaceCategory =
  | "temple"
  | "shrine"
  | "historic"
  | "culture"
  | "nature"
  | "station"
  | "food"
  | "shopping"
  | "other";

export interface LocalPlace {
  id: string;
  name: string;
  aliases: string[];
  category: LocalPlaceCategory;
  area: string;
  lat: number;
  lng: number;
  priority: number;
  source: "osm";
}

export interface LocalPlaceDataset {
  version: number;
  region: string;
  attribution: string;
  attributionUrl: string;
  categoryLabels: Record<LocalPlaceCategory, string>;
  places: LocalPlace[];
}

const DATA_URL = "/data/kyoto-places.json";
const MIN_QUERY_LENGTH = 2;
let datasetPromise: Promise<LocalPlaceDataset> | null = null;

/** 全角・半角、空白、記号、ひらがな・カタカナの差を検索上は同じにする。 */
export function normalizePlaceText(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("ja")
    .replace(/[ァ-ヶ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60))
    .replace(/[\p{P}\p{S}\s]/gu, "");
}

export function isLocalPlaceDataset(value: unknown): value is LocalPlaceDataset {
  if (!value || typeof value !== "object") return false;
  const data = value as Partial<LocalPlaceDataset>;
  return typeof data.version === "number"
    && typeof data.region === "string"
    && typeof data.attribution === "string"
    && typeof data.attributionUrl === "string"
    && !!data.categoryLabels
    && Array.isArray(data.places)
    && data.places.every((place) =>
      !!place
      && typeof place.id === "string"
      && typeof place.name === "string"
      && Array.isArray(place.aliases)
      && typeof place.category === "string"
      && typeof place.area === "string"
      && Number.isFinite(place.lat)
      && Number.isFinite(place.lng)
      && Number.isFinite(place.priority)
    );
}

/** 同じ画面遷移中は1回だけ読み込み、静的ファイル取得に失敗したら次回再試行できる。 */
export function loadLocalPlaceDataset(): Promise<LocalPlaceDataset> {
  if (datasetPromise) return datasetPromise;
  datasetPromise = fetch(DATA_URL, { cache: "force-cache" })
    .then(async (response) => {
      if (!response.ok) throw new Error(`場所データを読み込めませんでした (${response.status})`);
      const value: unknown = await response.json();
      if (!isLocalPlaceDataset(value)) throw new Error("場所データの形式が不正です");
      return value;
    })
    .catch((error) => {
      datasetPromise = null;
      throw error;
    });
  return datasetPromise;
}

function queryTerms(query: string): string[] {
  return query
    .normalize("NFKC")
    .trim()
    .split(/\s+/)
    .map(normalizePlaceText)
    .filter(Boolean);
}

function boundedEditDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    let rowMin = current[0];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const value = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + cost,
      );
      current.push(value);
      rowMin = Math.min(rowMin, value);
    }
    if (rowMin > max) return max + 1;
    previous = current;
  }
  return previous[b.length];
}

function textScore(candidate: string, query: string): number | null {
  if (!candidate || !query) return null;
  if (candidate === query) return 1000;
  if (candidate.startsWith(query)) return 780 - Math.min(80, candidate.length - query.length);
  const at = candidate.indexOf(query);
  if (at >= 0) return 610 - Math.min(100, at * 4);
  if (query.startsWith(candidate) && candidate.length >= 2) return 500;

  // 3文字以上だけ軽い誤字を許す。「金角寺」→「金閣寺」など。
  if (query.length >= 3 && candidate.length <= 32) {
    const max = query.length >= 7 ? 2 : 1;
    const distance = boundedEditDistance(candidate, query, max);
    if (distance <= max) return 430 - distance * 80;
  }
  return null;
}

function scorePlace(
  place: LocalPlace,
  categoryLabel: string,
  terms: string[],
): number | null {
  const name = normalizePlaceText(place.name);
  const aliases = place.aliases.map(normalizePlaceText);
  const area = normalizePlaceText(place.area);
  const category = normalizePlaceText(categoryLabel);
  let total = 0;

  for (const term of terms) {
    const nameScore = textScore(name, term);
    const aliasScore = aliases.reduce<number | null>((best, alias) => {
      const score = textScore(alias, term);
      return score !== null && (best === null || score > best) ? score : best;
    }, null);
    const areaScore = textScore(area, term);
    const categoryScore = textScore(category, term);
    const best = Math.max(
      nameScore ?? -1,
      aliasScore !== null ? aliasScore - 25 : -1,
      areaScore !== null ? areaScore - 300 : -1,
      categoryScore !== null ? categoryScore - 340 : -1,
    );
    if (best < 0) return null;
    total += best;
  }

  // 厳選スポットは一般候補より上げ、厳選内でも知名度の差を少しだけ反映する。
  const priorityBoost = place.priority >= 1000
    ? 120 + (place.priority - 1000) / 2
    : Math.min(110, place.priority / 9);
  return total + priorityBoost;
}

export function searchLocalPlaces(
  dataset: LocalPlaceDataset,
  query: string,
  limit = 8,
): PlaceSuggestion[] {
  const terms = queryTerms(query);
  if (!terms.length || normalizePlaceText(query).length < MIN_QUERY_LENGTH) return [];

  return dataset.places
    .map((place) => ({
      place,
      score: scorePlace(place, dataset.categoryLabels[place.category] ?? "場所", terms),
    }))
    .filter((item): item is { place: LocalPlace; score: number } => item.score !== null)
    .sort((a, b) => b.score - a.score || a.place.name.localeCompare(b.place.name, "ja"))
    .slice(0, Math.max(0, limit))
    .map(({ place }) => ({
      key: `local:${place.id}`,
      name: place.name,
      formatted: [place.area, dataset.categoryLabels[place.category]].filter(Boolean).join("・"),
      lat: place.lat,
      lng: place.lng,
    }));
}
