import assert from "node:assert/strict";
import test from "node:test";
import { isLocalPlaceDataset, normalizePlaceText, searchLocalPlaces, } from "../lib/local-place-search";
const dataset = {
    version: 1,
    region: "京都市と近郊",
    attribution: "© OpenStreetMap contributors",
    attributionUrl: "https://www.openstreetmap.org/copyright",
    categoryLabels: {
        temple: "寺院",
        shrine: "神社",
        historic: "史跡",
        culture: "文化施設",
        nature: "公園・自然",
        station: "駅・交通",
        food: "飲食・市場",
        shopping: "商業施設",
        other: "観光スポット",
    },
    places: [
        {
            id: "osm:way:1",
            name: "金閣寺",
            aliases: ["鹿苑寺", "きんかくじ", "Kinkakuji"],
            category: "temple",
            area: "北区",
            lat: 35.0394,
            lng: 135.7292,
            priority: 1100,
            source: "osm",
        },
        {
            id: "osm:node:2",
            name: "京都駅",
            aliases: ["きょうとえき", "Kyoto Station"],
            category: "station",
            area: "下京区",
            lat: 34.9858,
            lng: 135.7588,
            priority: 1100,
            source: "osm",
        },
        {
            id: "osm:way:3",
            name: "清水寺",
            aliases: ["きよみずでら"],
            category: "temple",
            area: "東山区",
            lat: 34.9948,
            lng: 135.785,
            priority: 1100,
            source: "osm",
        },
        {
            id: "osm:relation:4",
            name: "伏見稲荷大社",
            aliases: ["伏見稲荷", "ふしみいなり"],
            category: "shrine",
            area: "伏見区",
            lat: 34.9671,
            lng: 135.7727,
            priority: 1100,
            source: "osm",
        },
        {
            id: "osm:node:5",
            name: "伏見稲荷駅",
            aliases: ["ふしみいなりえき"],
            category: "station",
            area: "伏見区",
            lat: 34.9689,
            lng: 135.7693,
            priority: 1093,
            source: "osm",
        },
    ],
};
test("normalizes width, case, spaces, and kana", () => {
    assert.equal(normalizePlaceText("Ｋｙｏｔｏ　ＳＴＡＴＩＯＮ"), "kyotostation");
    assert.equal(normalizePlaceText("キンカクジ"), "きんかくじ");
});
test("finds aliases and prefix matches", () => {
    assert.equal(searchLocalPlaces(dataset, "鹿苑寺")[0]?.name, "金閣寺");
    assert.equal(searchLocalPlaces(dataset, "きょうと")[0]?.name, "京都駅");
});
test("allows a small typo for Japanese names", () => {
    assert.equal(searchLocalPlaces(dataset, "金角寺")[0]?.name, "金閣寺");
});
test("supports multiple search terms", () => {
    assert.equal(searchLocalPlaces(dataset, "北区 金閣")[0]?.name, "金閣寺");
    assert.equal(searchLocalPlaces(dataset, "伏見 稲荷")[0]?.name, "伏見稲荷大社");
});
test("rejects malformed datasets", () => {
    assert.equal(isLocalPlaceDataset({ places: [] }), false);
    assert.equal(isLocalPlaceDataset(dataset), true);
});
