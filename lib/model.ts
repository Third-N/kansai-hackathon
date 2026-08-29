import type { DayType, PlanItem, Revision, Segment, SimResult, Spot } from "./types";

/* ============================================================
   体力・気分モデルと、旅程の再構成
   ------------------------------------------------------------
   C 担当。simulate と proposeRevision の入出力の形を保てば
   中身は丸ごと差し替えてよい。UI 側はこの2つしか呼ばない。
   ============================================================ */

/** 係数。実測に合わせて調整する */
export const K = {
  walkHpPerKm: 8,
  heatPerDegreeOver25: 0.04,
  fatiguePerElapsedHour: 0.05,
  queueHpPerMin: 0.30,
  stayHpPerMin: 0.10,
  crowdMp: 25,
  rainMpPerHourWithUmbrella: 8,
  rainMpPerHourWithoutUmbrella: 14,
  continuousMoveMpPerMin: 0.15,
  mealHpRecovery: 15,
  mealMpRecovery: 10,
  idleHpRecovery: 10,
  fulfilledStayMpRecovery: 12,
  maxEstimatedQueueMin: 40,
};

export const INITIAL_HP = 100;
/** 再構成案に求める着地の余裕。予測が外れる分を残す */
export const MIN_END_HP = 15;
export const MIN_TROUGH_HP = 8;
export const INITIAL_MP = 70;
export const BREAKDOWN_HP = 15;
export const BREAKDOWN_MP = 15;

export interface SimulationEnvironment {
  temperatureC?: number;
  rain?: boolean;
  hasUmbrella?: boolean;
  dayType?: DayType;
}

/** YYYY-MM-DD を混雑テーブルの3区分へ変換する（日祝の祝日判定は将来APIで補う）。 */
export function dayTypeForDate(date: string): DayType {
  const day = new Date(`${date}T12:00:00`).getDay();
  return day === 0 ? "holiday" : day === 6 ? "saturday" : "weekday";
}

/** 徒歩・公共交通の所要分。実運用では経路APIに置き換える */
export function travelMinutes(
  a: Spot,
  b: Spot,
  table?: Record<string, number>
): number {
  const key = [a.id, b.id].sort().join("|");
  if (table && key in table) return table[key];
  // 直線距離からの粗い近似（1km ≒ 徒歩14分 + 待ち5分）
  const dx = (a.lat - b.lat) * 111;
  const dy = (a.lng - b.lng) * 91;
  const km = Math.sqrt(dx * dx + dy * dy);
  return Math.max(6, Math.round(km * 14 + 5));
}

export function buildSegments(
  plan: PlanItem[],
  spots: Record<string, Spot>,
  startMin: number,
  travelTable?: Record<string, number>
): Omit<Segment, "hpIn" | "hpOut" | "mpIn" | "mpOut" | "crowd">[] {
  let t = startMin;
  const out: Omit<Segment, "hpIn" | "hpOut" | "mpIn" | "mpOut" | "crowd">[] = [];
  plan.forEach((item, i) => {
    if (i > 0) {
      const m = travelMinutes(spots[plan[i - 1].spotId], spots[item.spotId], travelTable);
      const from = spots[plan[i - 1].spotId];
      const to = spots[item.spotId];
      const aerialKm = distanceKm(from, to);
      // 所要時間表は公共交通を含むため、全距離を徒歩として数えない。
      const walkingKm = Math.min(aerialKm * 1.2, m / 14);
      out.push({ type: "move", spotId: item.spotId, startMin: t, endMin: t + m, distanceKm: walkingKm });
      t += m;
    }
    out.push({ type: "stay", spotId: item.spotId, startMin: t, endMin: t + item.stayMin });
    t += item.stayMin;
  });
  return out;
}

export function simulate(
  plan: PlanItem[],
  spots: Record<string, Spot>,
  startMin: number,
  opts: {
    staminaFactor?: number;
    travelTable?: Record<string, number>;
    environment?: SimulationEnvironment;
  } = {}
): SimResult {
  const factor = opts.staminaFactor ?? 1;
  const raw = buildSegments(plan, spots, startMin, opts.travelTable);

  let hp = INITIAL_HP;
  let mp = INITIAL_MP;
  let collapseMin: number | null = null;
  let lowHpMin: number | null = null;
  let lowMpMin: number | null = null;
  const lateArrivals: { spotId: string; arriveMin: number }[] = [];
  let continuousMoveMin = 0;
  const env = opts.environment ?? {};
  const temperatureC = env.temperatureC ?? 25;
  const heatFactor = 1 + Math.max(0, temperatureC - 25) * K.heatPerDegreeOver25;

  const timeline: Segment[] = raw.map((g) => {
    const d = g.endMin - g.startMin;
    const hpIn = hp;
    const mpIn = mp;
    let crowd: number | null = null;
    let queueMin = 0;

    if (g.type === "move") {
      const elapsedHours = Math.max(0, g.startMin - startMin) / 60;
      const fatigueFactor = 1 + elapsedHours * K.fatiguePerElapsedHour;
      hp -= K.walkHpPerKm * (g.distanceKm ?? d / 14) * heatFactor * fatigueFactor * factor;

      const before = Math.max(0, continuousMoveMin - 60);
      continuousMoveMin += d;
      const after = Math.max(0, continuousMoveMin - 60);
      mp -= (after - before) * K.continuousMoveMpPerMin;
      if (env.rain) {
        const rainRate = env.hasUmbrella === false
          ? K.rainMpPerHourWithoutUmbrella
          : K.rainMpPerHourWithUmbrella;
        mp -= rainRate * d / 60;
      }
    } else {
      const s = spots[g.spotId];
      crowd = crowdAt(s, g.startMin, env.dayType);
      queueMin = s.kind === "spot" ? Math.round(crowd * K.maxEstimatedQueueMin) : 0;
      if (g.startMin > s.closeMin - d) lateArrivals.push({ spotId: s.id, arriveMin: g.startMin });
      continuousMoveMin = 0;

      if (s.kind === "meal") {
        if (d >= 15) {
          hp += K.mealHpRecovery;
          mp += K.mealMpRecovery;
        }
      } else if (s.kind === "rest") {
        if (d >= 20) hp += K.idleHpRecovery;
      } else {
        hp -= (K.queueHpPerMin * queueMin + K.stayHpPerMin * d * s.burn) * factor;
        mp -= K.crowdMp * crowd;
      }
      const recommended = s.recommendedStayMin ?? d;
      if (d >= recommended * 0.8) {
        mp += K.fulfilledStayMpRecovery;
      }
    }

    hp = Math.max(0, Math.min(100, hp));
    mp = Math.max(0, Math.min(100, mp));
    if (hp <= 0 && collapseMin === null) collapseMin = g.startMin + d / 2;
    if (hp < BREAKDOWN_HP && lowHpMin === null) lowHpMin = g.endMin;
    if (mp < BREAKDOWN_MP && lowMpMin === null) lowMpMin = g.endMin;

    return { ...g, hpIn, hpOut: hp, mpIn, mpOut: mp, crowd, queueMin };
  });

  return { timeline, collapseMin, lateArrivals, lowHpMin, lowMpMin, endHp: hp, endMp: mp };
}

export function crowdAt(spot: Spot, min: number, dayType: DayType = "weekday"): number {
  const h = Math.floor(min / 60);
  const table = spot.crowdByDay?.[dayType] ?? spot.crowdByHour;
  if (h in table) return table[h];
  const hours = Object.keys(table).map(Number).sort((a, b) => a - b);
  if (!hours.length) return 0.3;
  const nearest = hours.reduce((p, c) => (Math.abs(c - h) < Math.abs(p - h) ? c : p), hours[0]);
  return table[nearest];
}

function distanceKm(a: Spot, b: Spot): number {
  const dx = (a.lat - b.lat) * 111;
  const dy = (a.lng - b.lng) * 91;
  return Math.sqrt(dx * dx + dy * dy);
}

/** 現在時刻での体力・気分。区間の途中は線形に按分する */
export function stateAt(timeline: Segment[], min: number): { hp: number; mp: number } {
  let hp = INITIAL_HP;
  let mp = INITIAL_MP;
  for (const g of timeline) {
    if (min >= g.endMin) {
      hp = g.hpOut;
      mp = g.mpOut;
    } else if (min > g.startMin) {
      const r = (min - g.startMin) / (g.endMin - g.startMin);
      hp = g.hpIn + (g.hpOut - g.hpIn) * r;
      mp = g.mpIn + (g.mpOut - g.mpIn) * r;
      break;
    } else break;
  }
  return { hp: Math.max(0, hp), mp: Math.max(0, mp) };
}

/* ---------- 旅程の再構成 ---------- */

function permutations<T>(items: T[]): T[][] {
  if (items.length <= 1) return [items];
  const out: T[][] = [];
  items.forEach((item, i) => {
    const rest = [...items.slice(0, i), ...items.slice(i + 1)];
    for (const p of permutations(rest)) out.push([item, ...p]);
  });
  return out;
}

/**
 * 今の予定が破綻しているとき、成立する順路を探す。
 * 訪問済みの分は固定し、これからの分だけを対象にする。
 * 候補は 並べ替え × 休憩の挿入 × 滞在の短縮 × 1件落とす。
 * 変更が少ない案ほど高く評価する。
 */
export function proposeRevisions(
  plan: PlanItem[],
  spots: Record<string, Spot>,
  startMin: number,
  opts: {
    nowMin: number;
    fixedCount?: number;
    restCandidates?: string[];
    staminaFactor?: number;
    travelTable?: Record<string, number>;
    environment?: SimulationEnvironment;
  }
): Revision[] {
  const fixedCount = opts.fixedCount ?? 0;
  const fixed = plan.slice(0, fixedCount);
  const movable = plan.slice(fixedCount);
  if (movable.length === 0) return [];

  const rests = opts.restCandidates ?? [];
  const originalIndex = new Map(plan.map((p, i) => [p.spotId, i]));

  type Candidate = {
    plan: PlanItem[];
    insertedRestId: string | null;
    droppedId: string | null;
    stayScale: number;
  };

  const candidates: Candidate[] = [];

  // 落とす候補は食事以外の見学スポットだけ
  const dropOptions: (string | null)[] = [
    null,
    ...movable.filter((i) => spots[i.spotId].kind === "spot").map((i) => i.spotId),
  ];

  for (const droppedId of dropOptions) {
    const base = movable.filter((i) => i.spotId !== droppedId);
    if (base.length === 0) continue;
    const orders = base.length <= 6 ? permutations(base) : [base];

    for (const order of orders) {
      for (const stayScale of [1, 0.85, 0.7]) {
        const scaled = order.map((i) => ({
          spotId: i.spotId,
          stayMin: Math.round(i.stayMin * stayScale),
        }));

        candidates.push({ plan: [...fixed, ...scaled], insertedRestId: null, droppedId, stayScale });

        for (const restId of rests) {
          if (scaled.some((i) => i.spotId === restId)) continue;
          const rest: PlanItem = { spotId: restId, stayMin: 20 };
          for (let at = 1; at <= scaled.length - 1; at++) {
            candidates.push({
              plan: [...fixed, ...scaled.slice(0, at), rest, ...scaled.slice(at)],
              insertedRestId: restId,
              droppedId,
              stayScale,
            });
          }
        }
      }
    }
  }

  const scored: { rev: Revision; score: number }[] = [];

  for (const c of candidates) {
    const result = simulate(c.plan, spots, startMin, {
      staminaFactor: opts.staminaFactor,
      travelTable: opts.travelTable,
      environment: opts.environment,
    });
    if (result.collapseMin !== null) continue;
    if (result.lateArrivals.length > 0) continue;
    if (result.lowHpMin !== null || result.lowMpMin !== null) continue;
    // ぎりぎりの案は勧めない。予測が外れる余地を残す
    if (result.endHp < MIN_END_HP) continue;
    const trough = Math.min(...result.timeline.map((g) => g.hpOut));
    if (trough < MIN_TROUGH_HP) continue;

    let moves = 0;
    c.plan.forEach((item, i) => {
      const orig = originalIndex.get(item.spotId);
      if (orig !== undefined && orig !== i) moves += 1;
    });
    const changeCost =
      moves * 3 +
      (c.insertedRestId ? 2 : 0) +
      (c.stayScale < 1 ? 4 : 0) +
      // 行き先を落とすのは最後の手段。並べ替えや短縮で足りるならそちらを選ぶ
      (c.droppedId ? 60 : 0);

    // 余裕は一定以上あっても加点しない。安全側に倒しすぎる案を防ぐ
    const score = result.endMp * 1.0 + Math.min(result.endHp, 45) * 1.2 - changeCost;
    const originalOrder = plan.map((i) => i.spotId).join(">");
    const newOrder = c.plan
      .filter((i) => i.spotId !== c.insertedRestId)
      .map((i) => i.spotId)
      .join(">");
    scored.push({
      score,
      rev: {
        plan: c.plan,
        result,
        changes: {
          reordered: originalOrder !== newOrder && !c.droppedId,
          insertedRestId: c.insertedRestId,
          movedLater: findMovedLater(plan, c.plan),
          droppedId: c.droppedId,
          shortened: c.stayScale < 1,
        },
      },
    });
  }

  scored.sort((a, b) => b.score - a.score);
  return dedupe(scored.map((x) => x.rev));
}

/** 見た目が同じ案を落とす。選択肢に並べたとき区別できないものは要らない */
function dedupe(revs: Revision[]): Revision[] {
  const seen = new Set<string>();
  const out: Revision[] = [];
  for (const r of revs) {
    const key = [
      r.changes.droppedId ?? "-",
      r.changes.insertedRestId ?? "-",
      r.changes.shortened ? "s" : "-",
      r.plan.map((p) => p.spotId).join(">"),
    ].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

/** 最善の1案だけ要るとき */
export function proposeRevision(
  plan: PlanItem[],
  spots: Record<string, Spot>,
  startMin: number,
  opts: Parameters<typeof proposeRevisions>[3]
): Revision | null {
  return proposeRevisions(plan, spots, startMin, opts)[0] ?? null;
}

function findMovedLater(before: PlanItem[], after: PlanItem[]): string | null {
  let moved: string | null = null;
  let maxShift = 0;
  before.forEach((item, i) => {
    const j = after.findIndex((x) => x.spotId === item.spotId);
    if (j > i && j - i > maxShift) {
      maxShift = j - i;
      moved = item.spotId;
    }
  });
  return moved;
}
