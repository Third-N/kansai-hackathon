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

/** 幹事と、指定した人数の参加者がいる部屋を1つ作る */
async function newRoom(members = 1): Promise<string> {
  const t = await b.raw.query<{ id: string }>(
    `select (create_trip('party','[]'::jsonb,630,$1,'あなた',720)).id as id`,
    [uid(1)]
  );
  const tripId = t.rows[0].id;
  for (let i = 2; i <= members; i++) {
    await b.raw.query(`select join_by_code((select code from trips where id=$1), 'x', $2, 12)`,
      [tripId, uid(i)] as never[]);
  }
  return tripId;
}

async function newRound(seconds: number, members = 4): Promise<{ tripId: string; roundId: string }> {
  const tripId = await newRoom(members);
  const r = await b.raw.query<{ id: string }>(
    `select (open_round($1, 'どうする', $2::jsonb, '{}'::jsonb, $3, $4)).id as id`,
    [tripId, OPTIONS, seconds, uid(1)]
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

  it("anon は app_config を読めるが書けない", async () => {
    assert.ok(await asAnon("select * from app_config"), "app_config が読めない");
    assert.equal(
      await asAnon("update app_config set value='x' where key='geoapify_key'"),
      false,
      "app_config を書き換えられてしまう"
    );
    assert.equal(
      await asAnon("insert into app_config (key, value) values ('x','x')"),
      false,
      "app_config に行を足せてしまう"
    );
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
      await asAnon(`insert into members (id, trip_id, label) values ($1,$2,'侵入')`, [uid(77), tripId]),
      false,
      "あいことばを知らずに参加者になれてしまう"
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
    // 4択の上限（vetoCap）は1人1つ。opt2に2票、opt3に1票は2人に分けてつける
    await b.raw.query("select cast_vetoes($1,$2,$3)", [roundId, uid(1), ["opt2"]] as never[]);
    await b.raw.query("select cast_vetoes($1,$2,$3)", [roundId, uid(2), ["opt2"]] as never[]);
    await b.raw.query("select cast_vetoes($1,$2,$3)", [roundId, uid(3), ["opt3"]] as never[]);
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

  it("反対の上限（vetoCap）を超える投票は拒む", async () => {
    // 4択なので上限は1人1つ。UIだけでなく cast_vetoes 自身が守る
    const { roundId } = await newRound(60);
    let ok = true;
    try {
      await b.raw.query("select cast_vetoes($1,$2,$3)", [roundId, uid(1), ["opt1", "opt2"]] as never[]);
    } catch { ok = false; }
    assert.equal(ok, false, "上限を超えた投票が通ってしまう");

    // 上限内なら通り、提出者としては数えられる
    await b.raw.query("select cast_vetoes($1,$2,$3)", [roundId, uid(1), ["opt1"]] as never[]);
    const r = await b.raw.query<{ submitted_count: number }>(
      "select submitted_count from rounds where id=$1", [roundId]
    );
    assert.equal(r.rows[0].submitted_count, 1);
  });

  it("開いている部屋どうしでは、あいことばは重複できない", async () => {
    const mk = () =>
      b.raw.query(
        `insert into trips (mode, code, date, start_min, expires_at)
         values ('party','かも042',current_date,630, now() + interval '1 hour')`
      );
    await mk();
    let ok = true;
    try { await mk(); } catch { ok = false; }
    assert.equal(ok, false, "同じあいことばの部屋が2つ開いてしまう");
  });

  it("終わった部屋のあいことばは次の組に回る", async () => {
    const tripId = await newRoom();
    const code = (await b.raw.query<{ code: string }>("select code from trips where id=$1", [tripId]))
      .rows[0].code;
    await b.raw.query("select finish_trip($1,$2)", [tripId, uid(1)] as never[]);
    let ok = true;
    try {
      await b.raw.query(
        `insert into trips (mode, code, date, start_min, expires_at)
         values ('party',$1,current_date,630, now() + interval '1 hour')`,
        [code]
      );
    } catch { ok = false; }
    assert.equal(ok, true, "終わった部屋が番号を占有し続けている");
  });

  it("寿命の切れた部屋は閉じられ、合流できない", async () => {
    const tripId = await newRoom();
    const code = (await b.raw.query<{ code: string }>("select code from trips where id=$1", [tripId]))
      .rows[0].code;
    await b.raw.query("update trips set expires_at = now() - interval '1 minute' where id=$1", [tripId]);
    const r = await b.raw.query<{ t: unknown }>(
      "select to_jsonb(join_by_code($1,'あと',$2,12)) as t", [code, uid(50)] as never[]
    );
    assert.equal(r.rows[0].t, null, "寿命の切れた部屋に入れてしまう");
    const st = await b.raw.query<{ status: string }>("select status from trips where id=$1", [tripId]);
    assert.equal(st.rows[0].status, "done");
  });

  it("定員を超えては入れない", async () => {
    const tripId = await newRoom(12);
    const code = (await b.raw.query<{ code: string }>("select code from trips where id=$1", [tripId]))
      .rows[0].code;
    let ok = true;
    try {
      await b.raw.query("select join_by_code($1,'13人目',$2,12)", [code, uid(90)] as never[]);
    } catch { ok = false; }
    assert.equal(ok, false, "定員を超えて入れてしまう");
  });

  it("閉じた待合には入れない", async () => {
    const tripId = await newRoom();
    const code = (await b.raw.query<{ code: string }>("select code from trips where id=$1", [tripId]))
      .rows[0].code;
    await b.raw.query("select set_room_locked($1,$2,true)", [tripId, uid(1)] as never[]);
    let ok = true;
    try {
      await b.raw.query("select join_by_code($1,'あと',$2,12)", [code, uid(51)] as never[]);
    } catch { ok = false; }
    assert.equal(ok, false, "閉じた待合に入れてしまう");
  });

  it("開き直しても幹事の名前が変わらない", async () => {
    const tripId = await newRoom();
    const code = (await b.raw.query<{ code: string }>("select code from trips where id=$1", [tripId]))
      .rows[0].code;
    await b.raw.query("select join_by_code($1,'旅人',$2,12)", [code, uid(1)] as never[]);
    const m = await b.raw.query<{ label: string }>(
      "select label from members where trip_id=$1 and id=$2", [tripId, uid(1)]
    );
    assert.equal(m.rows[0].label, "あなた", "待合を開き直すたびに名前が上書きされる");
  });

  it("端末は複数の道中に入れる", async () => {
    const a = await newRoom();
    const b2 = await b.raw.query<{ id: string }>(
      `select (create_trip('party','[]'::jsonb,630,$1,'べつの人',720)).id as id`, [uid(2)]
    );
    const code = (await b.raw.query<{ code: string }>("select code from trips where id=$1", [b2.rows[0].id]))
      .rows[0].code;
    await b.raw.query("select join_by_code($1,'x',$2,12)", [code, uid(1)] as never[]);
    const n = await b.raw.query<{ c: number }>(
      "select count(*)::int as c from members where id=$1", [uid(1)]
    );
    assert.equal(n.rows[0].c, 2, "端末が1つの道中にしか入れない");
    assert.ok(a);
  });

  it("幹事以外は道中を終えられない・待合を閉じられない", async () => {
    const tripId = await newRoom(2);
    for (const [fn, arg] of [["finish_trip", ""], ["set_room_locked", ", true"]] as const) {
      let ok = true;
      try {
        await b.raw.query(`select ${fn}($1,$2${arg})`, [tripId, uid(2)] as never[]);
      } catch { ok = false; }
      assert.equal(ok, false, `${fn} を幹事以外が呼べてしまう`);
    }
  });

  it("参加者でなければ道程も呼び出し回数も書き換えられない", async () => {
    const tripId = await newRoom();
    for (const sql of [
      "select update_plan($1,'[]'::jsonb,$2)",
      "select consume_call($1,$2,5)",
    ]) {
      let ok = true;
      try { await b.raw.query(sql, [tripId, uid(404)] as never[]); } catch { ok = false; }
      assert.equal(ok, false, "非参加者が書き込めてしまう");
    }
  });

  it("セッションがあるときは、他人を名乗れない", async () => {
    await b.actAs(uid(1));
    let ok = true;
    try {
      await b.raw.query(`select create_trip('solo','[]'::jsonb,630,$1,'x',60)`, [uid(2)] as never[]);
    } catch { ok = false; }
    await b.actAs(null);
    assert.equal(ok, false, "別の参加者IDを名乗れてしまう");
  });

  it("呼び出し回数は上限で止まる", async () => {
    const tripId = await newRoom();
    for (let i = 0; i < 9; i++) {
      await b.raw.query("select consume_call($1,$2,5)", [tripId, uid(1)] as never[]);
    }
    const r = await b.raw.query<{ calls_used: number }>(
      "select calls_used from trips where id=$1", [tripId]
    );
    assert.equal(r.rows[0].calls_used, 5);
  });
});
