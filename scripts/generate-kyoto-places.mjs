import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OVERRIDES_PATH = path.join(ROOT, "data", "curated-place-overrides.json");
const OUTPUT_PATH = path.join(ROOT, "public", "data", "kyoto-places.json");

// 京都市を中心に、宇治・大津・亀岡の主要部までを含む。
const BBOX = "34.85,135.55,35.15,135.90";
const MIN_PLACES = 500;
const MAX_PLACES = 900;

const OVERPASS_ENDPOINTS = [
  process.env.OVERPASS_URL,
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
].filter(Boolean);

const QUERY = `[out:json][timeout:180];
(
  nwr["name"]["tourism"](${BBOX});
  nwr["name"]["historic"](${BBOX});
  nwr["name"]["amenity"="place_of_worship"](${BBOX});
  nwr["name"]["amenity"~"museum|arts_centre|theatre|marketplace"](${BBOX});
  nwr["name"]["leisure"~"park|garden|nature_reserve"](${BBOX});
  nwr["name"]["natural"~"peak|waterfall|spring|cave_entrance"](${BBOX});
  nwr["name"]["railway"="station"](${BBOX});
  nwr["name"]["public_transport"="station"](${BBOX});
  nwr["name"]["shop"~"department_store|mall"](${BBOX});
  nwr["name"]["amenity"~"restaurant|cafe"]["wikidata"](${BBOX});
);
out center tags;`;

const CATEGORY_LABELS = {
  temple: "寺院",
  shrine: "神社",
  historic: "史跡",
  culture: "文化施設",
  nature: "公園・自然",
  station: "駅・交通",
  food: "飲食・市場",
  shopping: "商業施設",
  other: "観光スポット",
};

const CATEGORY_QUOTAS = {
  temple: 210,
  shrine: 150,
  historic: 125,
  culture: 100,
  nature: 95,
  station: 100,
  food: 55,
  shopping: 45,
  other: 120,
};

function normalize(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLocaleLowerCase("ja")
    .replace(/[ァ-ヶ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60))
    .replace(/[\p{P}\p{S}\s]/gu, "");
}

function splitAliases(value) {
  return String(value ?? "")
    .split(/[;；|｜]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function categoryFor(tags) {
  if (tags.amenity === "place_of_worship") {
    const religion = `${tags.religion ?? ""} ${tags.denomination ?? ""}`.toLowerCase();
    return /shinto|神道/.test(religion) ? "shrine" : "temple";
  }
  if (tags.railway === "station" || tags.public_transport === "station") return "station";
  if (tags.tourism === "museum" || /museum|arts_centre|theatre/.test(tags.amenity ?? "")) return "culture";
  if (tags.leisure || tags.natural) return "nature";
  if (/restaurant|cafe|marketplace/.test(tags.amenity ?? "")) return "food";
  if (tags.shop) return "shopping";
  if (tags.historic) return "historic";
  return "other";
}

function aliasesFor(tags, name) {
  const values = [
    ...splitAliases(tags.alt_name),
    ...splitAliases(tags["alt_name:ja"]),
    ...splitAliases(tags.short_name),
    ...splitAliases(tags.official_name),
    ...splitAliases(tags.loc_name),
    ...splitAliases(tags.old_name),
    ...splitAliases(tags["name:en"]),
  ];
  const seen = new Set([normalize(name)]);
  return values.filter((value) => {
    const key = normalize(value);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 8);
}

function areaFor(tags) {
  return tags["addr:suburb"]
    || tags["addr:district"]
    || tags["addr:quarter"]
    || tags["is_in:suburb"]
    || tags["addr:city"]
    || tags["is_in:city"]
    || "京都市周辺";
}

function basePriority(tags, category) {
  let score = {
    temple: 30,
    shrine: 30,
    historic: 35,
    culture: 30,
    nature: 25,
    station: 28,
    food: 20,
    shopping: 20,
    other: 24,
  }[category];
  if (tags.wikidata) score += 35;
  if (tags.wikipedia) score += 35;
  if (tags.image || tags.wikimedia_commons) score += 12;
  if (tags.website || tags["contact:website"]) score += 6;
  if (tags.heritage || tags["heritage:operator"]) score += 10;
  if (tags.tourism === "attraction") score += 15;
  if (tags.unesco === "yes") score += 35;
  return score;
}

function findOverride(place, overrides) {
  const candidates = [place.name, ...place.aliases].map(normalize);
  return overrides.find((override) => {
    if (override.categories && !override.categories.includes(place.category)) return false;
    return override.match.some((match) => {
      const key = normalize(match);
      if (place.category === "station" && !match.endsWith("駅") && /寺|神社|城|御所|市場|公園|美術館|博物館|水族館|動物園|離宮|神宮|八幡宮|院$/.test(match)) {
        return false;
      }
      return candidates.some((candidate) => candidate === key);
    });
  });
}

function isEligible(tags) {
  const accommodation = new Set([
    "hotel", "hostel", "guest_house", "apartment", "motel", "chalet", "camp_site", "caravan_site",
  ]);
  if (accommodation.has(tags.tourism)) return false;
  if (tags.tourism === "information") return false;
  if (tags.tourism === "artwork" && !tags.wikidata && !tags.wikipedia) return false;
  if (["boundary_stone", "milestone", "wayside_cross"].includes(tags.historic)) return false;
  if (tags.historic === "memorial" && !tags.wikidata && !tags.wikipedia) return false;
  return true;
}

function toPlace(element, overrides) {
  const tags = element.tags ?? {};
  if (!isEligible(tags)) return null;
  const name = tags["name:ja"] || tags.name;
  const lat = element.lat ?? element.center?.lat;
  const lng = element.lon ?? element.center?.lon;
  if (!name || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  const category = categoryFor(tags);
  const place = {
    id: `osm:${element.type}:${element.id}`,
    name,
    aliases: aliasesFor(tags, name),
    category,
    area: areaFor(tags),
    lat: Number(lat.toFixed(6)),
    lng: Number(lng.toFixed(6)),
    priority: basePriority(tags, category),
    source: "osm",
  };

  const override = findOverride(place, overrides);
  if (override) {
    const originalName = place.name;
    if (override.displayName) place.name = override.displayName;
    if (override.category) place.category = override.category;
    place.priority = 1000 + override.priority;
    place.aliases = [...new Set([
      ...override.aliases,
      ...(normalize(originalName) === normalize(place.name) ? [] : [originalName]),
      ...place.aliases,
    ])].slice(0, 12);
  }
  return place;
}

function withFallbackPlaces(places, overrides) {
  const result = [...places];
  for (const override of overrides) {
    if (!override.fallback || result.some((place) => findOverride(place, [override]))) continue;
    result.push({
      ...override.fallback,
      aliases: override.aliases,
      priority: 1000 + override.priority,
      source: "osm",
    });
  }
  return result;
}

function quality(place) {
  return place.priority + place.aliases.length * 2 + (place.area === "京都市周辺" ? 0 : 3);
}

function distanceKm(a, b) {
  const dx = (a.lat - b.lat) * 111;
  const dy = (a.lng - b.lng) * 91;
  return Math.sqrt(dx * dx + dy * dy);
}

function dedupe(places) {
  const sorted = [...places].sort((a, b) => quality(b) - quality(a));
  const byName = new Map();
  return sorted.filter((place) => {
    const key = normalize(place.name);
    const existing = byName.get(key) ?? [];
    const isCurated = place.priority >= 1000 || existing.some((item) => item.priority >= 1000);
    if (existing.some((item) => isCurated || distanceKm(item, place) <= 0.35)) return false;
    existing.push(place);
    byName.set(key, existing);
    return true;
  });
}

function selectPlaces(places) {
  const sorted = [...places].sort((a, b) =>
    b.priority - a.priority
    || a.name.localeCompare(b.name, "ja")
    || a.id.localeCompare(b.id)
  );
  const counts = Object.fromEntries(Object.keys(CATEGORY_QUOTAS).map((key) => [key, 0]));
  const selected = [];
  const selectedIds = new Set();

  for (const place of sorted) {
    if (selected.length >= MAX_PLACES) break;
    if (counts[place.category] >= CATEGORY_QUOTAS[place.category]) continue;
    selected.push(place);
    selectedIds.add(place.id);
    counts[place.category] += 1;
  }

  // カテゴリごとの件数が少ない地域でも、最低件数までは有力候補で補う。
  for (const place of sorted) {
    if (selected.length >= Math.min(MAX_PLACES, Math.max(MIN_PLACES, places.length))) break;
    if (selectedIds.has(place.id)) continue;
    selected.push(place);
    selectedIds.add(place.id);
  }

  return selected.sort((a, b) =>
    b.priority - a.priority
    || a.name.localeCompare(b.name, "ja")
    || a.id.localeCompare(b.id)
  );
}

async function fetchOverpass() {
  let lastError;
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
          "user-agent": "Third-N-kansai-hackathon-place-builder/1.0",
        },
        body: new URLSearchParams({ data: QUERY }),
        signal: AbortSignal.timeout(210_000),
      });
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      return response.json();
    } catch (error) {
      lastError = error;
      console.warn(`Overpass request failed (${endpoint}): ${error.message}`);
    }
  }
  throw lastError ?? new Error("Overpass API request failed");
}

const overrides = JSON.parse(await readFile(OVERRIDES_PATH, "utf8"));
const response = await fetchOverpass();
const mappedPlaces = response.elements.map((element) => toPlace(element, overrides)).filter(Boolean);
const places = selectPlaces(dedupe(withFallbackPlaces(mappedPlaces, overrides)));

if (places.length < MIN_PLACES || places.length > 1000) {
  throw new Error(`Expected ${MIN_PLACES}-1000 places, generated ${places.length}`);
}

const output = {
  version: 1,
  region: "京都市と近郊",
  attribution: "© OpenStreetMap contributors",
  attributionUrl: "https://www.openstreetmap.org/copyright",
  categoryLabels: CATEGORY_LABELS,
  places,
};

await writeFile(OUTPUT_PATH, `${JSON.stringify(output)}\n`, "utf8");
console.log(`Wrote ${places.length} places to ${path.relative(ROOT, OUTPUT_PATH)}`);
