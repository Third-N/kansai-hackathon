"use client";
import type { StoreKind, TripStore } from "./store-contract";
import { CALL_BUDGET } from "./store-contract";
import { localStore } from "./store.local";
import { deferredStore, routedStore } from "./store.deferred";
import { demo } from "./demo";
import { supabaseConfig } from "./supabase-config";

/* ============================================================
   UI が触る唯一の入口。中で実装を選ぶ。

     NEXT_PUBLIC_SUPABASE_URL と NEXT_PUBLIC_SUPABASE_ANON_KEY があれば Supabase、
     無ければ localStorage。

   Supabase 側は動的 import。設定していない人のバンドルに
   @supabase/supabase-js を入れないため。

   実装を足したいときは TripStore を実装して、ここで選ぶだけ。
   契約は lib/store-contract.ts、契約テストは test/store.contract.ts。
   UI 側は一行も変わらない。
   ============================================================ */

export type { TripStore, StoreKind } from "./store-contract";
export { CALL_BUDGET } from "./store-contract";

// 環境変数はビルド時に埋め込まれる。ここで分岐すると使わない側は束ねられない
const { url: SUPABASE_URL, key: SUPABASE_KEY } = supabaseConfig();
const configured = !!SUPABASE_URL && !!SUPABASE_KEY;

/** いまどちらの実装が動いているか。診断表示に使う */
export const storeKind: StoreKind = configured ? "supabase" : "local";

const remote: TripStore | null = configured
  ? deferredStore(async () => {
      const [{ createSupabaseStore }, { getSupabaseClient }] = await Promise.all([
        import("./store.supabase"),
        import("./supabase"),
      ]);
      const client = getSupabaseClient();
      if (!client) throw new Error("Supabase の設定を読み込めませんでした");
      return createSupabaseStore(client);
    })
  : null;

/*
 * デモモードは必ず localStorage で動かす。
 * 早送りは1台で完結する話で、Realtime も待合も要らない。
 * 会場の回線が死んでも、審査の場でだけは確実に動いてほしい。
 */
export const store: TripStore = routedStore(() =>
  demo.get().enabled || !remote ? localStore : remote
);

export const CALLS_PER_DAY = CALL_BUDGET;
