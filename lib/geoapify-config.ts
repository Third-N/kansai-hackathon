"use client";
import { createSettings } from "./tiny-store";

/* ============================================================
   Geoapify の設定を読むだけのモジュール。
   supabase-config.ts と同じ理由で切り出している。

   キーが無ければ地図は今まで通り点と線だけの図で動く。

   キーはビルド時の環境変数（NEXT_PUBLIC_GEOAPIFY_KEY）ではなく、
   Supabase（useGeoapifyKeyFromSupabase / app_config テーブル）か、
   使う人がその場で入力するかで、この端末に保存する方式にしている。
   このアプリはリポジトリを公開している都合上、キーをコードや
   .env にコミットしたくない（誰でも取り放題になってしまう）ため。
   ============================================================ */

const stored = createSettings<{ key: string }>("dochu:geoapify-key", { key: "" });

export function geoapifyKey(): string | undefined {
  return stored.get().key || process.env.NEXT_PUBLIC_GEOAPIFY_KEY || undefined;
}

export function isGeoapifyConfigured(): boolean {
  return !!geoapifyKey();
}

/** 画面の入力欄から呼ぶ。空文字を渡すと削除扱い */
export function setGeoapifyKey(key: string): void {
  stored.set({ key: key.trim() });
}

/** コンポーネントから購読する。キーの有無で再描画したいときに使う */
export function useGeoapifyKey(): string | undefined {
  const { key } = stored.use();
  return key || process.env.NEXT_PUBLIC_GEOAPIFY_KEY || undefined;
}
