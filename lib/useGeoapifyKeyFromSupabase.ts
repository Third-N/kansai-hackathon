"use client";
import { useEffect } from "react";
import { getSupabaseClient, isSupabaseConfigured } from "./supabase";
import { setGeoapifyKey } from "./geoapify-config";

interface AppConfigRow {
  key: string;
  value: string;
}

/* ============================================================
   地図APIキーを Supabase（app_config テーブル）から取ってきて、
   この端末のキャッシュ（geoapify-config.ts の localStorage）に入れる。
   supabase/migrations/0005_app_config.sql と対。

   Supabase 未設定・オフライン・キー未登録では何もしない。
   その場合は今まで通り、画面の入力欄か点と線だけの図で動く。
   ============================================================ */
export function useGeoapifyKeyFromSupabase(): void {
  useEffect(() => {
    if (!isSupabaseConfigured()) return;
    const sb = getSupabaseClient();
    if (!sb) return;

    let stopped = false;
    void (async () => {
      const res = await sb
        .from<AppConfigRow>("app_config")
        .select("*")
        .eq("key", "geoapify_key")
        .maybeSingle();
      if (!stopped && !res.error && res.data?.value) {
        setGeoapifyKey(res.data.value);
      }
    })();

    return () => {
      stopped = true;
    };
  }, []);
}
