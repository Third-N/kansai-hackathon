"use client";
import { useSyncExternalStore } from "react";
import { onStorageChange, storage } from "./storage";

/* ============================================================
   画面をまたいで持ちたい小さな設定のための入れ物。
   デモモードと天候がこれを使っている。

   ライブラリを増やしたくないので useSyncExternalStore に直に載せた。
   増やしたいときは createSettings を1行呼ぶだけでよい。
   ============================================================ */

export interface Settings<T> {
  get(): T;
  set(patch: Partial<T>): void;
  reset(): void;
  subscribe(cb: () => void): () => void;
  /** React から読む */
  use(): T;
}

export function createSettings<T extends object>(key: string, initial: T): Settings<T> {
  let cache: T = initial;
  let raw: string | null = null;
  const listeners = new Set<() => void>();

  const load = (): T => {
    const next = storage().getItem(key);
    if (next === raw) return cache; // 同じ文字列なら同じ参照を返す（再描画を無駄に起こさない）
    raw = next;
    try {
      cache = next ? { ...initial, ...(JSON.parse(next) as Partial<T>) } : initial;
    } catch {
      cache = initial;
    }
    return cache;
  };

  const emit = () => listeners.forEach((l) => l());

  // 別タブでの変更も拾う
  if (typeof window !== "undefined") {
    onStorageChange((k) => {
      if (k === key) {
        load();
        emit();
      }
    });
  }

  return {
    get: load,
    set(patch) {
      const next = { ...load(), ...patch };
      raw = JSON.stringify(next);
      cache = next;
      storage().setItem(key, raw);
      emit();
    },
    reset() {
      raw = null;
      cache = initial;
      storage().setItem(key, JSON.stringify(initial));
      emit();
    },
    subscribe(cb) {
      listeners.add(cb);
      return () => void listeners.delete(cb);
    },
    use() {
      return useSyncExternalStore(
        (cb) => {
          listeners.add(cb);
          return () => void listeners.delete(cb);
        },
        load,
        () => initial // サーバー描画では初期値
      );
    },
  };
}
