import { runStoreContract } from "./store.contract";
import { createSupabaseStore } from "../lib/store.supabase";
import { clearMemoryStorage } from "../lib/storage";
import { createPgliteBackend, type PgliteBackend } from "./pglite-client";

/* 本物の PostgreSQL（PGlite）に supabase/migrations を流し、
   本物の RLS と RPC を相手に、localStorage 実装と同じ契約テストを当てる。 */

let backend: PgliteBackend | null = null;

runStoreContract({
  label: "TripStore / Supabase 実装（PGlite 上の本物の SQL）",
  async setup() {
    backend = await createPgliteBackend();
    // Realtime はここでは再現できない。ポーリングの保険側を通す
    return createSupabaseStore(backend, { pollMs: 80 });
  },
  async reset() {
    clearMemoryStorage();
    await backend!.raw.exec(`truncate trips cascade;`);
  },
  async teardown() {
    await backend?.close();
    backend = null;
  },
});
