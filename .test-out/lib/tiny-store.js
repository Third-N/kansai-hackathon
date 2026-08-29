"use client";
import { useSyncExternalStore } from "react";
import { onStorageChange, storage } from "./storage";
export function createSettings(key, initial) {
    let cache = initial;
    let raw = null;
    const listeners = new Set();
    const load = () => {
        const next = storage().getItem(key);
        if (next === raw)
            return cache; // 同じ文字列なら同じ参照を返す（再描画を無駄に起こさない）
        raw = next;
        try {
            cache = next ? { ...initial, ...JSON.parse(next) } : initial;
        }
        catch {
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
            return useSyncExternalStore((cb) => {
                listeners.add(cb);
                return () => void listeners.delete(cb);
            }, load, () => initial // サーバー描画では初期値
            );
        },
    };
}
