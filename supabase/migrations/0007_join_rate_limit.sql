-- ============================================================
-- あいことばの総当たり対策
--
-- README「まだ無いもの」に挙げていた穴。あいことばは 語×3桁 で
-- 12000通りしか無いので、機械的に試行を繰り返されれば当たる。
-- IPは security definer の RPC からは見えないので、端末ごとの
-- 制限は member_id を変えられるだけで回避されてしまう
-- （member_id はクライアントが選べる値のため）。
--
-- ここでは「誰が」ではなく「どれだけ短時間に集中しているか」だけを見る、
-- システム全体でのゆるいレート制限にした。会場での正規の合流
-- （5〜7人が数十秒の間に入ってくる程度）は妨げず、
-- スクリプトによる連続試行だけを遅らせる。
--
-- 分散・低速な総当たりまでは防げない。それには本来IPベースの制限が
-- 要るが、この構成（PostgRESTのRPC）には無い情報のため、
-- 完全な対策ではなく「実行コストを上げる」ところまでにしている。
-- ============================================================

create table if not exists join_attempts (
  attempted_at timestamptz not null default now()
);

alter table join_attempts enable row level security;
-- ポリシーを1つも作らない＝全操作を拒否。RPCの中だけで触る
revoke all on join_attempts from anon, authenticated;

create or replace function join_by_code(
  p_code      text,
  p_label     text,
  p_member_id uuid,
  p_max       int default 12
) returns trips
language plpgsql security definer set search_path = public as $$
declare
  v_id     uuid := assert_identity(p_member_id);
  t        trips;
  n        int;
  v_recent int;
begin
  perform close_expired_rooms();

  delete from join_attempts where attempted_at < now() - interval '1 minute';
  select count(*) into v_recent from join_attempts where attempted_at > now() - interval '10 seconds';
  if v_recent >= 20 then
    raise exception '試行が多すぎます。少し待ってからもう一度試してください';
  end if;
  insert into join_attempts default values;

  select * into t from trips
   where code = p_code
     and mode = 'party'
     and status <> 'done'
     and (expires_at is null or expires_at > now())
   limit 1;

  if t.id is null then return null; end if;

  -- すでに入っている端末。開き直しただけなので名前は触らない。
  if is_member(t.id, v_id) then return t; end if;

  if t.locked then
    raise exception 'この待合はもう閉じています';
  end if;

  select count(*) into n from members where trip_id = t.id;
  if n >= p_max then
    raise exception 'この待合はいっぱいです';
  end if;

  insert into members (id, trip_id, label, is_host)
  values (v_id, t.id, left(coalesce(nullif(btrim(p_label), ''), '旅人'), 24), false);

  return t;
end $$;
