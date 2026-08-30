"use client";
import { createSettings } from "./tiny-store";

/* ============================================================
   Geoapify の設定を読むだけのモジュール。
   supabase-config.ts と同じ理由で切り出している。

   キーが無ければ地図は今まで通り点と線だけの図で動く。

   優先順位: 画面で入力したもの → Supabase（app_config）→ 環境変数
   → ここに直書きした既定値。直書きはこの用途専用のキーであることを
   前提にしている（他で使い回さない）。
   ============================================================ */

const DEFAULT_KEY = "518bfe6cf8fd4e8db4178121faaff9ac";

const stored = createSettings<{ key: string }>("dochu:geoapify-key", { key: "" });

export function geoapifyKey(): string | undefined {
  return stored.get().key || process.env.NEXT_PUBLIC_GEOAPIFY_KEY || DEFAULT_KEY || undefined;
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
  return key || process.env.NEXT_PUBLIC_GEOAPIFY_KEY || DEFAULT_KEY || undefined;
}
