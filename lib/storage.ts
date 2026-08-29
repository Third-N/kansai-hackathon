"use client";

/* ============================================================
   キー・バリューの置き場。ブラウザでは localStorage、
   それ以外（SSR・テスト）ではメモリ。

   window を直に触らないのは、サーバー描画で落ちないようにするためと、
   テストで差し替えられるようにするため。
   （テストで globalThis.window を生やすと、同居する他のライブラリが
     ブラウザだと誤認して壊れる。実際 PGlite がそれで動かなかった）
   ============================================================ */

export interface KeyValue {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

type Listener = (key: string) => void;

const memory = new Map<string, string>();
const listeners = new Set<Listener>();

const memoryStorage: KeyValue = {
  getItem: (k) => memory.get(k) ?? null,
  setItem: (k, v) => {
    memory.set(k, v);
    for (const l of listeners) l(k);
  },
  removeItem: (k) => void memory.delete(k),
};

let override: KeyValue | null = null;

/** テストから差し替える。null で既定に戻す */
export function setStorage(kv: KeyValue | null): void {
  override = kv;
}

/** テストの間だけメモリを白紙に戻す */
export function clearMemoryStorage(): void {
  memory.clear();
}

function browserStorage(): KeyValue | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage ?? null;
  } catch {
    return null; // プライベートウィンドウなどで例外になることがある
  }
}

export function storage(): KeyValue {
  return override ?? browserStorage() ?? memoryStorage;
}

/** 他のタブ（またはテスト内の別処理）での書き換えを拾う */
export function onStorageChange(cb: Listener): () => void {
  const browser = browserStorage();
  if (browser && typeof window !== "undefined") {
    const handler = (e: StorageEvent) => {
      if (e.key) cb(e.key);
    };
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  }
  listeners.add(cb);
  return () => void listeners.delete(cb);
}
