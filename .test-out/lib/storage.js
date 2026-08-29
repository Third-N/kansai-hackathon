"use client";
const memory = new Map();
const listeners = new Set();
const memoryStorage = {
    getItem: (k) => memory.get(k) ?? null,
    setItem: (k, v) => {
        memory.set(k, v);
        for (const l of listeners)
            l(k);
    },
    removeItem: (k) => void memory.delete(k),
};
let override = null;
/** テストから差し替える。null で既定に戻す */
export function setStorage(kv) {
    override = kv;
}
/** テストの間だけメモリを白紙に戻す */
export function clearMemoryStorage() {
    memory.clear();
}
function browserStorage() {
    try {
        if (typeof window === "undefined")
            return null;
        return window.localStorage ?? null;
    }
    catch {
        return null; // プライベートウィンドウなどで例外になることがある
    }
}
export function storage() {
    return override ?? browserStorage() ?? memoryStorage;
}
/** 他のタブ（またはテスト内の別処理）での書き換えを拾う */
export function onStorageChange(cb) {
    const browser = browserStorage();
    if (browser && typeof window !== "undefined") {
        const handler = (e) => {
            if (e.key)
                cb(e.key);
        };
        window.addEventListener("storage", handler);
        return () => window.removeEventListener("storage", handler);
    }
    listeners.add(cb);
    return () => void listeners.delete(cb);
}
