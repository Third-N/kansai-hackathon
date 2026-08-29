import { runStoreContract } from "./store.contract";
import { createSupabaseStore } from "../lib/store.supabase";
import { deferredStore } from "../lib/store.deferred";
import { clearMemoryStorage } from "../lib/storage";
import { createPgliteBackend, type PgliteBackend } from "./pglite-client";

/* 遅延読み込みの包みが、包む前と同じに振る舞うことを確かめる。
   store.ts が本番で使うのはこの経路なので、ここが通らないと意味がない。 */

let backend: PgliteBackend | null = null;

runStoreContract({
  label: "TripStore / 遅延読み込みの包み越し",
  async setup() {
    return deferredStore(async () => {
      backend = await createPgliteBackend();
      return createSupabaseStore(backend, { pollMs: 80 });
    });
  },
  async reset() {
    clearMemoryStorage();
    if (backend) await backend.raw.exec(`truncate trips cascade;`);
  },
  async teardown() {
    await backend?.close();
    backend = null;
  },
});
