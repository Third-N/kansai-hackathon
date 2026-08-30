import assert from "node:assert/strict";
import test from "node:test";
import { makeCustomSpot } from "../lib/custom-spot";
import { crowdAt, simulate } from "../lib/model";
import type { PlanItem, Spot } from "../lib/types";

const KYOTO = { lat: 35.0, lng: 135.75 };

test("混雑カーブは時間帯で変わる。固定30%ではない", () => {
  const spot = makeCustomSpot({ name: "テスト神社", category: "shrine", priority: 1100, ...KYOTO });
  const morning = crowdAt(spot, 8 * 60);
  const noon = crowdAt(spot, 12 * 60);
  assert.notEqual(morning, noon, "朝と昼で混雑が同じままになっている");
  assert.ok(noon > morning, "昼が朝より混んでいない（神社・寺のカーブとして不自然）");
});

test("priorityが高い（厳選スポット）ほど混雑のピークが高い", () => {
  const famous = makeCustomSpot({ name: "有名スポット", category: "temple", priority: 1100, ...KYOTO });
  const minor = makeCustomSpot({ name: "小さいお寺", category: "temple", priority: 30, ...KYOTO });
  assert.ok(crowdAt(famous, 12 * 60) > crowdAt(minor, 12 * 60));
});

test("カテゴリ無し（Geoapify経由）でも一般スポット並みの値が入る", () => {
  const spot = makeCustomSpot({ name: "適当な場所", ...KYOTO });
  assert.equal(spot.recommendedStayMin, 30);
  assert.ok(Object.keys(spot.crowdByHour).length > 0);
});

test("駅カテゴリは通勤時間帯に山がある（観光地とは違う形）", () => {
  const station = makeCustomSpot({ name: "テスト駅", category: "station", priority: 1100, ...KYOTO });
  assert.ok(crowdAt(station, 8 * 60) > crowdAt(station, 11 * 60), "朝ラッシュが昼より低い");
});

test("推奨滞在時間ぶん居ないと、気分の『満喫』ボーナスが付かない", () => {
  const spot: Spot = makeCustomSpot({ name: "テスト", category: "temple", priority: 1100, ...KYOTO });
  const spots = { [spot.id]: spot };

  const shortStay: PlanItem[] = [{ spotId: spot.id, stayMin: 5 }];
  const fullStay: PlanItem[] = [{ spotId: spot.id, stayMin: spot.recommendedStayMin! }];

  const short = simulate(shortStay, spots, 600);
  const full = simulate(fullStay, spots, 600);

  assert.ok(
    full.endMp > short.endMp,
    `じっくり滞在(${full.endMp})が素通り(${short.endMp})より気分が上がっていない`
  );
});
