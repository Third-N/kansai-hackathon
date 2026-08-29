/* ============================================================
   Geoapify の設定を読むだけのモジュール。
   supabase-config.ts と同じ理由で切り出している。

   キーが無ければ地図は今まで通り点と線だけの図で動く。
   ============================================================ */

export function geoapifyKey(): string | undefined {
  return process.env.NEXT_PUBLIC_GEOAPIFY_KEY || undefined;
}

export function isGeoapifyConfigured(): boolean {
  return !!geoapifyKey();
}
