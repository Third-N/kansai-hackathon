import { runStoreContract } from "./store.contract";
import { createSupabaseStore } from "../lib/store.supabase";
import { clearMemoryStorage } from "../lib/storage";
import { createPgliteBackend, type PgliteBackend } from "./pglite-client";
import type { TripStore } from "../lib/store-contract";

/* 本物の PostgreSQL（PGlite）に supabase/migrations を流し、
   本物の RLS と RPC を相手に、localStorage 実装と同じ契約テストを当てる。 */

let backend: PgliteBackend | null = null;
let theStore: TripStore | null = null;

runStoreContract({
  label: "TripStore / Supabase 実装（PGlite 上の本物の SQL）",
  async setup() {
    backend = await createPgliteBackend();
    // Realtime はここでは再現できない。ポーリングの保険側を通す
    theStore = createSupabaseStore(backend, { pollMs: 80 });
    return theStore;
  },
  async reset() {
    clearMemoryStorage();
    await backend!.raw.exec(`truncate trips cascade;`);
  },
  /* セッションを持たない構成なので、他人の ID を名乗って投票できる。
     本番（匿名ログイン有効）ではこの道は塞がっていて、
     各端末が自分のセッションで投票する。実機用は store.live.test.ts */
  async join(trip, label = "テスト") {
    const id = crypto.randomUUID();
    await backend!.raw.query(
      `insert into members (id, trip_id, label, is_host) values ($1,$2,$3,false)
       on conflict do nothing`,
      [id, trip.id, label] as never[]
    );
    return { id, vote: (roundId: string, opts: string[]) => theStore!.castVetoes(roundId, id, opts) };
  },
  async teardown() {
    await backend?.close();
    backend = null;
    theStore = null;
  },
});
