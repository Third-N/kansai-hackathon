"use client";
import { createClient } from "@supabase/supabase-js";
import type { SupabaseLike } from "./supabase-like";

/* ============================================================
   Supabase クライアント。環境変数が無ければ null を返す。
   null のときは store.ts が localStorage 実装を選ぶので、
   何も設定しなくても開発は動く。
   ============================================================ */

let cached: SupabaseLike | null | undefined;

export function supabaseConfig(): { url?: string; key?: string } {
  return {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL,
    key: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  };
}

export function getSupabaseClient(): SupabaseLike | null {
  if (cached !== undefined) return cached;
  const { url, key } = supabaseConfig();
  if (!url || !key) {
    cached = null;
    return cached;
  }
  // ここが唯一のキャスト。SupabaseLike は本物のクライアントのうち
  // 実際に使うメソッドだけを写した型で、構造としては満たされている。
  // 一枚挟んでいるおかげで、テストは PGlite に同じ形をかぶせて
  // 本物の SQL を走らせられる。
  cached = createClient(url, key, {
    auth: { persistSession: false },
    realtime: { params: { eventsPerSecond: 5 } },
  }) as unknown as SupabaseLike;
  return cached;
}

/** テストや Storybook から差し替える */
export function setSupabaseClient(client: SupabaseLike | null): void {
  cached = client;
}
