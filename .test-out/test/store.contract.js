import { describe, it, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { CALL_BUDGET } from "../lib/store-contract";
const PLAN = [
    { spotId: "inari", stayMin: 70 },
    { spotId: "kiyomizu", stayMin: 60 },
];
const OPTIONS = [
    { id: "opt1", label: "順番を入れ替える", sub: "" },
    { id: "opt2", label: "休憩を挟む", sub: "" },
    { id: "opt3", label: "どこも短くする", sub: "" },
    { id: "opt4", label: "清水寺をあきらめる", sub: "" },
];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms = 4000) {
    const deadline = Date.now() + ms;
    for (;;) {
        const v = await fn();
        if (v)
            return v;
        if (Date.now() > deadline)
            throw new Error("待っても条件を満たさなかった");
        await sleep(50);
    }
}
export function runStoreContract(h) {
    describe(h.label, () => {
        let store;
        before(async () => {
            store = await h.setup();
        });
        beforeEach(async () => {
            await h.reset();
        });
        after(async () => {
            await h.teardown?.();
        });
        /* ---------- 道中 ---------- */
        it("作った道中を id で引ける。作った人が幹事になる", async () => {
            const t = await store.createTrip("party", PLAN, 630);
            assert.equal(t.mode, "party");
            assert.equal(t.members.length, 1);
            assert.equal(t.members[0].isHost, true);
            assert.deepEqual(t.plan, PLAN);
            const got = await store.getTrip(t.id);
            assert.ok(got);
            assert.equal(got.id, t.id);
            assert.equal(got.members.length, 1);
        });
        it("進行中の道中が引ける。無ければ null", async () => {
            assert.equal(await store.getActiveTrip(), null);
            const t = await store.createTrip("solo", PLAN, 630);
            const active = await store.getActiveTrip();
            assert.equal(active?.id, t.id);
        });
        it("道程の更新が残る", async () => {
            const t = await store.createTrip("solo", PLAN, 630);
            const next = [{ spotId: "nishiki", stayMin: 45 }];
            const updated = await store.updatePlan(t.id, next);
            assert.deepEqual(updated.plan, next);
            assert.deepEqual((await store.getTrip(t.id)).plan, next);
        });
        it("呼び出し回数は増え、上限で止まる", async () => {
            const t = await store.createTrip("solo", PLAN, 630);
            let trip = t;
            for (let i = 0; i < CALL_BUDGET + 3; i++)
                trip = await store.consumeCall(t.id);
            assert.equal(trip.callsUsed, CALL_BUDGET, "1日5回を超えて増えてはいけない");
        });
        it("終えた道中が「前の道中」として引ける", async () => {
            assert.equal(await store.getLastFinished(), null);
            const t = await store.createTrip("solo", PLAN, 630);
            await store.finishTrip(t.id);
            const last = await store.getLastFinished();
            assert.equal(last?.id, t.id);
            assert.equal(last?.status, "done");
            assert.equal(await store.getActiveTrip(), null, "終えた道中は進行中に出てはいけない");
        });
        /* ---------- 合流 ---------- */
        it("あいことばで合流できる。知らないあいことばは null", async () => {
            const t = await store.createTrip("party", PLAN, 630);
            assert.ok(t.code, "パーティにはあいことばが要る");
            assert.equal(await store.joinByCode("そんなことばはない99", "誰か"), null);
            const joined = await store.joinByCode(t.code, "ふたりめ");
            assert.ok(joined);
            assert.equal(joined.id, t.id);
        });
        it("同じ端末が二度合流しても参加者は増えない", async () => {
            const t = await store.createTrip("party", PLAN, 630);
            await store.joinByCode(t.code, "同じ人");
            await store.joinByCode(t.code, "同じ人");
            const got = await store.getTrip(t.id);
            assert.equal(got.members.length, 1, "作成者と同じ端末なので1人のまま");
        });
        it("待合を開き直しても、幹事の名前が上書きされない", async () => {
            const t = await store.createTrip("party", PLAN, 630);
            const before = t.members[0].label;
            await store.joinByCode(t.code, "旅人");
            const after = (await store.getTrip(t.id)).members.find((m) => m.isHost).label;
            assert.equal(after, before, "待合を開き直すたびに名前が変わる");
        });
        it("部屋には寿命があり、作った直後は未来にある", async () => {
            const t = await store.createTrip("party", PLAN, 630);
            assert.ok(t.expiresAt, "寿命が入っていない");
            assert.ok(new Date(t.expiresAt).getTime() > Date.now(), "作った瞬間に切れている");
            assert.equal(t.locked, false);
        });
        it("幹事は待合を閉じられる", async () => {
            const t = await store.createTrip("party", PLAN, 630);
            const locked = await store.setRoomLocked(t.id, true);
            assert.equal(locked.locked, true);
            assert.equal((await store.getTrip(t.id)).locked, true);
            assert.equal((await store.setRoomLocked(t.id, false)).locked, false);
        });
        it("この端末の参加者IDが取れて、幹事として入っている", async () => {
            const me = await store.currentMemberId();
            assert.match(me, /^[0-9a-f-]{36}$/i);
            const t = await store.createTrip("solo", PLAN, 630);
            assert.equal(t.members[0].id, me);
        });
        it("参加者の購読が現在の顔ぶれを返す", async () => {
            const t = await store.createTrip("party", PLAN, 630);
            let seen = [];
            const stop = store.subscribeMembers(t.id, (m) => { seen = m; });
            await waitFor(async () => (seen.length > 0 ? seen : null));
            assert.equal(seen[0].isHost, true);
            stop();
        });
        /* ---------- せーの ---------- */
        it("開いた問いが取り出せる。開示時刻は未来にある", async () => {
            const t = await store.createTrip("party", PLAN, 630);
            const r = await store.openRound(t.id, "どうする", OPTIONS, { opt1: PLAN }, 60);
            assert.equal(r.status, "open");
            assert.ok(new Date(r.revealAt).getTime() > Date.now(), "開示時刻が過去になっている");
            assert.equal(r.options.length, 4);
            const open = await store.getOpenRound(t.id);
            assert.equal(open?.id, r.id);
            assert.deepEqual((await store.getRound(r.id)).planByOption, { opt1: PLAN });
        });
        it("提出した人数は数えるが、誰が何を嫌がったかは返さない", async () => {
            const t = await store.createTrip("party", PLAN, 630);
            const [a, b] = [await h.join(t), await h.join(t)];
            const r = await store.openRound(t.id, "どうする", OPTIONS, {}, 60);
            await a.vote(r.id, ["opt1"]);
            assert.equal((await store.getRound(r.id)).submittedCount, 1);
            // 何も嫌でない人も「出した」に数える
            await b.vote(r.id, []);
            assert.equal((await store.getRound(r.id)).submittedCount, 2);
            // 出し直しても人数は増えない
            await a.vote(r.id, ["opt2", "opt3"]);
            assert.equal((await store.getRound(r.id)).submittedCount, 2);
            const round = (await store.getRound(r.id));
            const dump = JSON.stringify(round);
            assert.ok(!dump.includes(a.id), "誰が出したかが round に混ざっている");
            assert.equal(round.result, null, "開示前に結果が見えている");
        });
        it("開示時刻より前の開示は何もしない", async () => {
            const t = await store.createTrip("party", PLAN, 630);
            const r = await store.openRound(t.id, "どうする", OPTIONS, {}, 60);
            const after = await store.reveal(r.id);
            assert.equal(after.status, "open");
            assert.equal(after.result, null);
        });
        it("反対ゼロが1つなら、それが通る", async () => {
            const t = await store.createTrip("party", PLAN, 630);
            const [a, b, c] = [await h.join(t), await h.join(t), await h.join(t)];
            const r = await store.openRound(t.id, "どうする", OPTIONS, {}, 0.3);
            await a.vote(r.id, ["opt1"]);
            await b.vote(r.id, ["opt2"]);
            await c.vote(r.id, ["opt3"]);
            await sleep(500);
            const done = await store.reveal(r.id);
            assert.equal(done.status, "revealed");
            assert.equal(done.result?.kind, "unanimous");
            assert.equal(done.result?.winnerId, "opt4");
            assert.equal(done.result?.survivorCount, 1);
            assert.deepEqual(done.result?.tally.map((x) => x.count), [1, 1, 1, 0], "反対数は選択肢の並び順で返す");
        });
        it("全滅したら、反対の最も少ないものを妥協点として出す", async () => {
            const t = await store.createTrip("party", PLAN, 630);
            const [a, b] = [await h.join(t), await h.join(t)];
            const r = await store.openRound(t.id, "どうする", OPTIONS, {}, 0.3);
            await a.vote(r.id, ["opt1", "opt2", "opt3"]);
            await b.vote(r.id, ["opt2", "opt3", "opt4"]);
            await sleep(500);
            const done = await store.reveal(r.id);
            assert.equal(done.result?.kind, "compromise");
            assert.equal(done.result?.survivorCount, 0);
            const counts = Object.fromEntries(done.result.tally.map((x) => [x.optionId, x.count]));
            assert.equal(counts[done.result.winnerId], 1, "勝ったのは反対が最少のもの");
        });
        it("開示は冪等。二度呼んでも結果が変わらず、開示後の票も入らない", async () => {
            const t = await store.createTrip("party", PLAN, 630);
            const [a, b] = [await h.join(t), await h.join(t)];
            const r = await store.openRound(t.id, "どうする", OPTIONS, {}, 0.3);
            await a.vote(r.id, ["opt1"]);
            await sleep(500);
            const first = await store.reveal(r.id);
            await b.vote(r.id, ["opt2", "opt3", "opt4"]);
            const second = await store.reveal(r.id);
            assert.deepEqual(second.result, first.result, "二度目の開示で結果が変わった");
            assert.equal(second.status, "revealed");
        });
        it("購読していれば、誰も押さなくても開示が届く", async () => {
            const t = await store.createTrip("party", PLAN, 630);
            const a = await h.join(t);
            const r = await store.openRound(t.id, "どうする", OPTIONS, {}, 0.3);
            await a.vote(r.id, ["opt1"]);
            let latest = null;
            const stop = store.subscribeRound(r.id, (x) => { latest = x; });
            const got = await waitFor(async () => latest && latest.status === "revealed" ? latest : null);
            stop();
            assert.equal(got.status, "revealed");
            assert.ok(got.result, "開示されたのに結果が無い");
        });
    });
}
