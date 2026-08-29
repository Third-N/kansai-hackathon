"use client";
import { createClient } from "@supabase/supabase-js";
import { supabaseConfig } from "./supabase-config";
export { supabaseConfig, isSupabaseConfigured } from "./supabase-config";
/* ============================================================
   Supabase クライアント。環境変数が無ければ null を返す。
   null のときは store.ts が localStorage 実装を選ぶので、
   何も設定しなくても開発は動く。
   ============================================================ */
let cached;
/* 匿名ログインを試すかどうか。
   NEXT_PUBLIC_SUPABASE_ANON_AUTH=off で完全に切れる（422 も出なくなる）。
   既定は試す。無効なプロジェクトでも1回で諦めるので、赤いエラーが並び続けることはない。 */
const ANON_AUTH_ON = (process.env.NEXT_PUBLIC_SUPABASE_ANON_AUTH ?? "on") !== "off";
const GAVE_UP_KEY = "dochu:anon-auth-unavailable";
function gaveUp() {
    try {
        return typeof sessionStorage !== "undefined" && sessionStorage.getItem(GAVE_UP_KEY) === "1";
    }
    catch {
        return false;
    }
}
function rememberGaveUp() {
    try {
        sessionStorage?.setItem(GAVE_UP_KEY, "1");
    }
    catch {
        /* プライベートウィンドウなど。覚えられなくても動く */
    }
}
export function getSupabaseClient() {
    if (cached !== undefined)
        return cached;
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
    let session = null;
    const signIn = async () => {
        const { data } = await client.auth.getUser();
        if (data.user)
            return data.user.id;
        // 切られている、または前に断られた。もう叩かない（422 を出さない）
        if (!ANON_AUTH_ON || gaveUp())
            return null;
        const { data: signed, error } = await client.auth.signInAnonymously();
        if (error || !signed.user) {
            // 匿名ログインが無効なプロジェクト。名乗った ID で動く構成に落ちる。
            // 「あいことばを知っている人だけが入れる」以上の保証は無くなる。
            // このタブでは二度と試さないので、繰り返し 422 が出ることはない
            rememberGaveUp();
            console.info("[dochu] 匿名ログインが無効です。いまは端末が名乗るIDで動いています" +
                "（なりすまし防止と「自分の道中しか読めない」は効きません）。\n" +
                "有効にする: Supabase → Authentication → Providers → Anonymous sign-ins\n" +
                "試させたくない場合: .env.local に NEXT_PUBLIC_SUPABASE_ANON_AUTH=off");
            return null;
        }
        return signed.user.id;
    };
    // ここが唯一のキャスト。SupabaseLike は本物のクライアントのうち
    // 実際に使うメソッドだけを写した型で、構造としては満たされている。
    // 一枚挟んでいるおかげで、テストは PGlite に同じ形をかぶせて
    // 本物の SQL を走らせられる。
    cached = Object.assign(client, {
        ensureSession: () => (session ??= signIn()),
    });
    return cached;
}
/** テストや Storybook から差し替える */
export function setSupabaseClient(client) {
    cached = client;
}
