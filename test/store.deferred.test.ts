import { runStoreContract } from "./store.contract";
import { createSupabaseStore } from "../lib/store.supabase";
import { deferredStore } from "../lib/store.deferred";
import { clearMemoryStorage } from "../lib/storage";
import { createPgliteBackend, type PgliteBackend } from "./pglite-client";
import type { TripStore } from "../lib/store-contract";

/* 遅延読み込みの包みが、包む前と同じに振る舞うことを確かめる。
   store.ts が本番で使うのはこの経路なので、ここが通らないと意味がない。 */

let backend: PgliteBackend | null = null;

const wrapped: TripStore = deferredStore(async () => {
  backend = await createPgliteBackend();
  return createSupabaseStore(backend, { pollMs: 80 });
});

runStoreContract({
  label: "TripStore / 遅延読み込みの包み越し",
  async setup() {
    await wrapped.currentMemberId(); // ここで中身を起こす
    return wrapped;
  },
  async reset() {
    clearMemoryStorage();
    if (backend) await backend.raw.exec(`truncate trips cascade;`);
  },
  /* セッションを持たない構成なので、他人の ID を名乗って投票できる。
     本番（匿名ログイン有効）ではこの道は塞がっていて、各端末が自分のセッションで投票する */
  async join(trip, label = "テスト") {
    const id = crypto.randomUUID();
    await backend!.raw.query(
      `insert into members (id, trip_id, label, is_host) values ($1,$2,$3,false)
       on conflict do nothing`,
      [id, trip.id, label] as never[]
    );
    return { id, vote: (roundId: string, opts: string[]) => wrapped.castVetoes(roundId, id, opts) };
  },
  async teardown() {
    await backend?.close();
    backend = null;
  },
});
