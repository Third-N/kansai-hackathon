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
  const client = createClient(url, key, {
    // 端末ごとに1つのセッションを持ち続ける。member_id がこれになる
    auth: { persistSession: true, autoRefreshToken: true },
    realtime: { params: { eventsPerSecond: 5 } },
  });

  let session: Promise<string | null> | null = null;

  const ensureSession = async (): Promise<string | null> => {
    const { data } = await client.auth.getUser();
    if (data.user) return data.user.id;
    const { data: signed, error } = await client.auth.signInAnonymously();
    if (error || !signed.user) {
      // 匿名ログインが無効なプロジェクト。名乗った ID で動く構成に落ちる。
      // あいことばを知っている人だけが入れる、以上の保証は無くなる
      console.warn("[dochu] 匿名ログインが使えません。なりすまし防止は効きません:", error?.message);
      return null;
    }
    return signed.user.id;
  };

  // ここが唯一のキャスト。SupabaseLike は本物のクライアントのうち
  // 実際に使うメソッドだけを写した型で、構造としては満たされている。
  // 一枚挟んでいるおかげで、テストは PGlite に同じ形をかぶせて
  // 本物の SQL を走らせられる。
  cached = Object.assign(client as unknown as SupabaseLike, {
    ensureSession: () => (session ??= ensureSession()),
  });
  return cached;
}

/** テストや Storybook から差し替える */
export function setSupabaseClient(client: SupabaseLike | null): void {
  cached = client;
}
