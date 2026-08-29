/* ============================================================
   Supabase の設定を読むだけのモジュール。

   supabase.ts から切り出しているのは、store.ts が「設定があるか」を
   知るためだけに @supabase/supabase-js を静的に読み込んでしまわないようにするため。
   このファイルは依存を持たないので、どこから読んでも安全。
   ============================================================ */

export interface SupabaseConfig {
  url?: string;
  key?: string;
}

/*
 * 公開鍵は2つの名前で渡されうる:
 *   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY … 新しい sb_publishable_... 形式
 *   NEXT_PUBLIC_SUPABASE_ANON_KEY        … 旧来の JWT 形式
 * どちらで渡されても動くようにしておく。どちらもブラウザに出る前提のもの。
 */
export function supabaseConfig(): SupabaseConfig {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/+$/, "");
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  return { url: url || undefined, key: key || undefined };
}

export function isSupabaseConfigured(): boolean {
  const { url, key } = supabaseConfig();
  return !!url && !!key;
}
