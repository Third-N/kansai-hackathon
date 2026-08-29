import { describe, it } from "node:test";
import { runStoreContract } from "./store.contract";
import { createSupabaseStore } from "../lib/store.supabase";
import { clearMemoryStorage } from "../lib/storage";
import type { SupabaseLike } from "../lib/supabase-like";

/* ============================================================
   本物の Supabase に対して、同じ契約テストを流す。

     DOCHU_LIVE_TEST=1 \
     NEXT_PUBLIC_SUPABASE_URL=... \
     NEXT_PUBLIC_SUPABASE_ANON_KEY=... \
     npm test

   既定では走らない。うっかり本番のデータに書き込まないため。
   PGlite で確かめられないのは Realtime の push だけなので、
   実機で見るべきはそこ。落ちていてもポーリングで動くが、
   一度は通しておきたい。
   ============================================================ */

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const enabled = process.env.DOCHU_LIVE_TEST === "1" && !!url && !!key;

if (!enabled) {
  describe("TripStore / 実機の Supabase", () => {
    it("環境変数が無いので飛ばす（DOCHU_LIVE_TEST=1 と URL/KEY を設定すると走る）", () => {});
  });
} else {
  const { createClient } = await import("@supabase/supabase-js");
  const client = createClient(url!, key!, {
    auth: { persistSession: false },
  }) as unknown as SupabaseLike;

  runStoreContract({
    label: "TripStore / 実機の Supabase",
    async setup() {
      // 実機は Realtime が効くので、ポーリングは既定のまま
      return createSupabaseStore(client);
    },
    async reset() {
      // anon では truncate できない。端末IDを変えて毎回まっさらな参加者として振る舞う
      clearMemoryStorage();
    },
  });
}
