-- ============================================================
-- 自アプリ利用者の位置分布による混雑補正
--
-- 企画書の「静的推定テーブル + 天候 + 利用者分布」の3つ目。
-- README「まだ無いもの」に「人数が要るので当日は効かない」と
-- 書いていた通り、人が集まらないと意味のある数字にならない。
--
-- そのため simulate() の混雑推定（未来の予測）そのものには混ぜず、
-- 「今その行き先に、あなたを含めて何人がこのアプリを開いているか」
-- という現在地のそばの参考情報にとどめている。
--
-- 個々の位置は誰にも読めない。集計（件数）だけを返すRPCしか無い。
-- trip_id には紐付けない。別のパーティ同士でも、同じ行き先に
-- いれば混雑の実感としては合算されるべきもののため。
-- ============================================================

create table if not exists spot_pings (
  spot_id    text not null,
  member_id  uuid not null,
  pinged_at  timestamptz not null default now(),
  primary key (spot_id, member_id)
);
create index if not exists spot_pings_recent_idx on spot_pings (spot_id, pinged_at);

alter table spot_pings enable row level security;
-- ポリシーを1つも作らない＝全操作を拒否。読み書きはRPCの中だけ
revoke all on spot_pings from anon, authenticated;

/** この場所にいる、という合図を送る。20分で自然に消える */
create or replace function ping_spot(p_spot_id text, p_member_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare v_id uuid := assert_identity(p_member_id);
begin
  if p_spot_id is null or length(btrim(p_spot_id)) = 0 then
    raise exception 'spot_id がありません';
  end if;

  delete from spot_pings where pinged_at < now() - interval '30 minutes';

  insert into spot_pings (spot_id, member_id, pinged_at)
  values (p_spot_id, v_id, now())
  on conflict (spot_id, member_id) do update set pinged_at = excluded.pinged_at;
end $$;

/** 直近20分にその行き先へ合図を送った、重複の無い人数だけを返す */
create or replace function nearby_crowd(p_spot_id text)
returns int
language sql stable security definer set search_path = public as $$
  select count(*)::int from spot_pings
  where spot_id = p_spot_id and pinged_at > now() - interval '20 minutes';
$$;

grant execute on function ping_spot(text, uuid)   to anon, authenticated;
grant execute on function nearby_crowd(text)      to anon, authenticated;
