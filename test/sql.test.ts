import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createPgliteBackend, type PgliteBackend } from "./pglite-client";

/* ============================================================
   スキーマと権限そのものへのテスト。
   store の契約テストは「アプリから見た振る舞い」を見るが、
   ここは「アプリを通さずに何ができてしまうか」を見る。
   票が読めないことは、UI では確かめようがない。
   ============================================================ */

let b: PgliteBackend;
const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const OPTIONS = JSON.stringify([
  { id: "opt1", label: "A", sub: "" },
  { id: "opt2", label: "B", sub: "" },
  { id: "opt3", label: "C", sub: "" },
  { id: "opt4", label: "D", sub: "" },
]);

async function newRound(seconds: number): Promise<{ tripId: string; roundId: string }> {
  const t = await b.raw.query<{ id: string }>(
    `insert into trips (mode, code, date, start_min, plan)
     values ('party', $1, current_date, 630, '[]') returning id`,
    [`c${Math.random().toString(36).slice(2, 8)}`]
  );
  const tripId = t.rows[0].id;
  const r = await b.raw.query<{ id: string }>(
    `select (open_round($1, 'どうする', $2::jsonb, '{}'::jsonb, $3)).id as id`,
    [tripId, OPTIONS, seconds]
  );
  return { tripId, roundId: r.rows[0].id };
}

/** anon になって何かする。できたら true */
async function asAnon(sql: string, params: unknown[] = []): Promise<boolean> {
  await b.raw.exec("set role anon");
  try {
    await b.raw.query(sql, params as never[]);
    return true;
  } catch {
    return false;
  } finally {
    await b.raw.exec("reset role");
  }
}

describe("スキーマと権限", () => {
  before(async () => { b = await createPgliteBackend(); });
  after(async () => { await b.close(); });
  beforeEach(async () => { await b.raw.exec("truncate trips cascade;"); });

  it("anon は道中・参加者・問いを読める", async () => {
    await newRound(60);
    assert.ok(await asAnon("select * from trips"), "trips が読めない");
    assert.ok(await asAnon("select * from members"), "members が読めない");
    assert.ok(await asAnon("select * from rounds"), "rounds が読めない");
  });

  it("anon は票を読めない・書けない・消せない", async () => {
    const { roundId } = await newRound(60);
    await b.raw.query("select cast_vetoes($1,$2,$3)", [roundId, uid(1), ["opt1"]] as never[]);

    assert.equal(await asAnon("select * from vetoes"), false, "票が読めてしまう");
    assert.equal(await asAnon("select * from submissions"), false, "提出者が読めてしまう");
    assert.equal(
      await asAnon("insert into vetoes (round_id, member_id, option_id) values ($1,$2,'opt2')", [roundId, uid(2)]),
      false,
      "票を直に書けてしまう"
    );
    assert.equal(await asAnon("delete from vetoes"), false, "票を消せてしまう");
  });

  it("anon は問いを直に開けない・開示できない", async () => {
    const { tripId, roundId } = await newRound(60);
    assert.equal(
      await asAnon(
        `insert into rounds (trip_id, question, options, reveal_at) values ($1,'x','[]'::jsonb, now())`,
        [tripId]
      ),
      false,
      "rounds を直に作れてしまう（reveal_at を自分で決められてしまう）"
    );
    assert.equal(
      await asAnon("update rounds set status='revealed' where id=$1", [roundId]),
      false,
      "開示を自分で書き込めてしまう"
    );
  });

  it("開示時刻はサーバーが決める。開いた端末の時計は混ざらない", async () => {
    const { roundId } = await newRound(30);
    const r = await b.raw.query<{ reveal_at: Date; now: Date }>(
      "select reveal_at, now() as now from rounds where id=$1",
      [roundId]
    );
    const diff = (new Date(r.rows[0].reveal_at).getTime() - new Date(r.rows[0].now).getTime()) / 1000;
    assert.ok(diff > 28 && diff <= 30.5, `開示まで ${diff} 秒になっている`);
  });

  it("開示は冪等。二度目も同じ結果を返す", async () => {
    const { roundId } = await newRound(-1);
    await b.raw.query("select cast_vetoes($1,$2,$3)", [roundId, uid(1), ["opt1"]] as never[]);
    const a = await b.raw.query<{ r: unknown }>("select to_jsonb(reveal_round($1)) as r", [roundId]);
    const c = await b.raw.query<{ r: unknown }>("select to_jsonb(reveal_round($1)) as r", [roundId]);
    assert.deepEqual(c.rows[0].r, a.rows[0].r);
  });

  it("開示時刻より前は何もしない", async () => {
    const { roundId } = await newRound(60);
    const r = await b.raw.query<{ r: { status: string; result: unknown } }>(
      "select to_jsonb(reveal_round($1)) as r", [roundId]
    );
    assert.equal(r.rows[0].r.status, "open");
    assert.equal(r.rows[0].r.result, null);
  });

  it("反対数は選択肢の並び順で返る", async () => {
    const { roundId } = await newRound(-1);
    await b.raw.query("select cast_vetoes($1,$2,$3)", [roundId, uid(1), ["opt2"]] as never[]);
    await b.raw.query("select cast_vetoes($1,$2,$3)", [roundId, uid(2), ["opt2", "opt3"]] as never[]);
    const r = await b.raw.query<{ r: { result: { tally: { optionId: string; count: number }[] } } }>(
      "select to_jsonb(reveal_round($1)) as r", [roundId]
    );
    assert.deepEqual(r.rows[0].r.result.tally, [
      { optionId: "opt1", count: 0 },
      { optionId: "opt2", count: 2 },
      { optionId: "opt3", count: 1 },
      { optionId: "opt4", count: 0 },
    ]);
  });

  it("あいことばは重複できない", async () => {
    await b.raw.query(
      `insert into trips (mode, code, date, start_min) values ('party','かも42',current_date,630)`
    );
    let ok = true;
    try {
      await b.raw.query(
        `insert into trips (mode, code, date, start_min) values ('party','かも42',current_date,630)`
      );
    } catch {
      ok = false;
    }
    assert.equal(ok, false, "同じあいことばが2つ作れてしまう");
  });

  it("呼び出し回数は上限で止まる", async () => {
    const t = await b.raw.query<{ id: string }>(
      `insert into trips (mode, date, start_min) values ('solo', current_date, 630) returning id`
    );
    const id = t.rows[0].id;
    for (let i = 0; i < 9; i++) await b.raw.query("select consume_call($1, 5)", [id]);
    const r = await b.raw.query<{ calls_used: number }>("select calls_used from trips where id=$1", [id]);
    assert.equal(r.rows[0].calls_used, 5);
  });
});
