"use client";
import { useEffect, useState } from "react";
import { getSupabaseClient, isSupabaseConfigured } from "./supabase";
import { myMemberId } from "./identity";

/* ============================================================
   企画書「静的推定テーブル + 天候 + 利用者分布」の3つ目。
   supabase/migrations/0009_nearby_crowd.sql と対。

   README「まだ無いもの」に「人数が要るので当日は効かない」と
   書いていた通り、人が集まらないと意味のある数字にならない。
   そのため simulate() の混雑推定（未来の予測）そのものには混ぜず、
   現在地のそばの参考情報として、生の人数だけを返す。

   Supabase未設定（localStorage実装）では、そもそも他の端末が
   見えないので常に null。個々の位置は誰にも読めない
   （集計だけを返すRPCしか呼ばない）。
   ============================================================ */
const PING_MS = 60_000;

export function useNearbyCrowd(spotId: string | null): number | null {
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    if (!spotId || !isSupabaseConfigured()) {
      setCount(null);
      return;
    }
    const sb = getSupabaseClient();
    if (!sb) {
      setCount(null);
      return;
    }

    let stopped = false;
    const tick = async () => {
      const id = await sb.ensureSession().then((uid) => uid ?? myMemberId()).catch(() => myMemberId());
      const pinged = await sb.rpc<null>("ping_spot", { p_spot_id: spotId, p_member_id: id });
      if (pinged.error) return; // オフライン等。今の値のまま次を待つ

      const res = await sb.rpc<number>("nearby_crowd", { p_spot_id: spotId });
      if (!stopped && !res.error && typeof res.data === "number") {
        setCount(res.data);
      }
    };

    void tick();
    const timer = setInterval(tick, PING_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [spotId]);

  return count;
}
