"use client";

import { useEffect, useState, use } from "react";
import { useRouter } from "next/navigation";
import { store } from "@/lib/store";
import type { Member, Trip } from "@/lib/types";

export default function LobbyPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params);
  const router = useRouter();
  const [trip, setTrip] = useState<Trip | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [notFound, setNotFound] = useState(false);
  const [shareMsg, setShareMsg] = useState<string | null>(null);
  const [myId, setMyId] = useState<string | null>(null);

  useEffect(() => {
    let unsub: (() => void) | undefined;
    (async () => {
      const found = await store.joinByCode(decodeURIComponent(code), "旅人");
      if (!found) { setNotFound(true); return; }
      setTrip(found);
      setMembers(found.members);
      // B が Supabase Realtime に差し替える
      unsub = store.subscribeMembers(found.id, setMembers);
    })();
    store.currentMemberId().then(setMyId);
    return () => unsub?.();
  }, [code]);

  const isHost = members.find((m) => m.id === myId)?.isHost ?? false;

  const toggleLock = async () => {
    if (!trip) return;
    const updated = await store.setRoomLocked(trip.id, !trip.locked);
    setTrip(updated);
  };

  const share = async () => {
    const url = `${window.location.origin}/party/${encodeURIComponent(decodeURIComponent(code))}`;
    if (navigator.share) {
      try { await navigator.share({ title: "道中", text: "合流してください", url }); return; }
      catch { /* キャンセルは無視 */ }
    }
    await navigator.clipboard.writeText(url);
    setShareMsg("リンクをコピーしました");
    setTimeout(() => setShareMsg(null), 2400);
  };

  if (notFound) {
    return (
      <div className="view">
        <div className="lobby__head">
          <a className="back" href="/">← もどる</a>
          <span className="lobby__title">待合</span>
        </div>
        <div className="empty">
          <p>その待合は見つかりませんでした。</p>
          <p className="empty__sub">あいことばを確かめてください。</p>
        </div>
      </div>
    );
  }

  if (!trip) return <div className="loading">待合をひらいています</div>;

  const n = members.length;
  const host = members.find((m) => m.isHost);

  return (
    <div className="view">
      <div className="lobby__head">
        <a className="back" href="/">← もどる</a>
        <span className="lobby__title">待合</span>
      </div>

      <div className="code">
        <div className="code__label">あいことば</div>
        <div className="code__value">{trip.code}</div>
        <button className="join__btn" onClick={share}>リンクで招待する</button>
        {shareMsg && <p className="code__hint" style={{ marginTop: 10 }}>{shareMsg}</p>}
      </div>

      <div className="sec"><span>今いる人 <b className="dot">{n}</b></span></div>
      <ul className="members">
        {members.map((m) => (
          <li className="member" key={m.id}>
            <span className="lantern" aria-hidden />
            {m.isHost ? "あなた" : m.label}
            {m.isHost && <span className="member__tag">幹事</span>}
          </li>
        ))}
        {n < 2 && (
          <li className="member member--wait">
            <span className="lantern lantern--off" aria-hidden />
            待っています…
          </li>
        )}
      </ul>

      <p className="anon">
        道中で表示されるのは<b>パーティ全体の体力</b>だけです。<br />
        誰が疲れているか、誰が何を選んだかは、最後まで出ません。
      </p>

      {isHost && (
        <button type="button" className="lockbtn" onClick={toggleLock}>
          {trip.locked ? "待合をひらく" : "待合を閉じる"}
        </button>
      )}
      {trip.locked && <p className="code__hint">閉じています。新しい人は入れません</p>}

      <button
        className="go"
        disabled={n < 2 || !host}
        onClick={() => router.push(`/trip/${trip.id}`)}
      >
        {n < 2 ? "あと1人待っています" : `${n}人で出発する`}
      </button>
    </div>
  );
}
