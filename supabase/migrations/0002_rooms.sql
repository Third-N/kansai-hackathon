-- ============================================================
-- 道中 / B — 待合（ルーム）の作りなおし
--
-- 0001 で足りなかったところ:
--   1. あいことばが枯れる。終わった道中も番号を占有し続けていた
--   2. 衝突したときの取り直しがクライアント側にあった
--   3. 部屋に寿命が無く、昨日の部屋にも合流できた
--   4. 定員が無く、会場全員が1部屋に入れた
--   5. 誰でも他人の道中を書き換えられた（plan も status も）
--   6. あいことばを知らなくても、trip_id さえ分かれば参加者になれた
--   7. 名乗った member_id が本人のものか誰も確かめていなかった
--   8. 端末は一生に1つの道中にしか入れなかった（members の主キー）
-- ============================================================

-- ---------- 本人確認 ----------

/*
 * いま呼んでいる端末の ID。
 * Supabase の匿名ログインを有効にしていれば auth.uid() が返る。
 * 有効にしていない（またはテスト）場合は null で、そのときは
 * 呼び出し側が名乗った ID を信じるしかない。
 * つまり匿名ログインを入れるまでは「あいことばを知っている人だけが入れる」以上の
 * 保証は無い。README にそう書いてある。
 */
create or replace function current_member() returns uuid
language plpgsql stable as $$
declare v uuid;
begin
  begin
    v := auth.uid();
  exception when others then
    v := null;   -- auth スキーマが無い構成
  end;
  return v;
end $$;

/** 名乗った ID を検証して返す。セッションがあれば一致を強制する */
create or replace function assert_identity(p_member_id uuid) returns uuid
language plpgsql stable as $$
declare v uuid;
begin
  if p_member_id is null then
    raise exception '参加者IDがありません';
  end if;
  v := current_member();
  if v is null then
    return p_member_id;      -- セッション無しの構成
  end if;
  if v <> p_member_id then
    raise exception 'なりすましは受け付けません';
  end if;
  return v;
end $$;

-- ---------- 部屋の寿命と定員 ----------

alter table trips add column if not exists expires_at timestamptz;
alter table trips add column if not exists locked     boolean not null default false;

-- 既存行に寿命を入れておく
update trips set expires_at = (date + time '23:59')::timestamptz where expires_at is null;

/** 寿命の切れた部屋を閉じる。閉じるとあいことばが解放される */
create or replace function close_expired_rooms() returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update trips set status = 'done'
  where status <> 'done' and expires_at is not null and expires_at <= now();
  get diagnostics n = row_count;
  return n;
end $$;

-- あいことばは「まだ開いている部屋」の中だけで一意。終われば番号が返る。
-- 0001 の全期間ユニークだと、通算で語数×100 回作った時点で作成できなくなる
alter table trips drop constraint if exists trips_code_key;
drop index if exists trips_code_active_idx;
create unique index trips_code_active_idx on trips (code) where status <> 'done' and code is not null;

-- 端末は複数の道中に入れる。0001 は members の主キーが id だけだったので、
-- 一度どこかに入った端末は二度と別の部屋に入れなかった
alter table members drop constraint if exists members_pkey;
alter table members add primary key (trip_id, id);
create index if not exists members_by_device_idx on members (id);
create index if not exists rounds_recent_idx on rounds (trip_id, created_at desc);

-- ---------- 参加の判定 ----------

create or replace function is_member(p_trip_id uuid, p_member_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from members where trip_id = p_trip_id and id = p_member_id);
$$;

create or replace function is_host(p_trip_id uuid, p_member_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from members where trip_id = p_trip_id and id = p_member_id and is_host);
$$;

create or replace function assert_member(p_trip_id uuid, p_member_id uuid) returns uuid
language plpgsql stable security definer set search_path = public as $$
declare v uuid;
begin
  v := assert_identity(p_member_id);
  if not is_member(p_trip_id, v) then
    raise exception 'この道中の参加者ではありません';
  end if;
  return v;
end $$;

-- ---------- あいことば ----------

/* 語 × 3桁 で 12000 通り。声に出して伝えられる長さは保つ。
   総当たりは防げないので、部屋の寿命を短くすることで釣り合いを取っている */
create or replace function make_room_code() returns text
language sql volatile as $$
  select (array['ひがし','にし','みなみ','きた','かも','あらし','きよ','いなり',
                'おおはら','とうじ','ぎおん','うずまさ'])[floor(random() * 12) + 1]
      || lpad(floor(random() * 1000)::text, 3, '0');
$$;

-- ---------- 部屋を作る ----------

/**
 * 道中を作り、作った人を幹事として入れる。
 * あいことばの採番と取り直しはサーバーの中で完結する。
 * クライアントに「8回試して駄目なら諦める」を書かせない。
 */
create or replace function create_trip(
  p_mode        text,
  p_plan        jsonb,
  p_start_min   int,
  p_member_id   uuid,
  p_label       text default 'あなた',
  p_ttl_minutes int  default 720
) returns trips
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid := assert_identity(p_member_id);
  t    trips;
begin
  if p_mode not in ('solo', 'party') then
    raise exception 'mode は solo か party';
  end if;
  if jsonb_typeof(p_plan) <> 'array' then
    raise exception 'plan は配列';
  end if;
  if p_start_min < 0 or p_start_min >= 1440 then
    raise exception '出発時刻が範囲外';
  end if;
  if p_ttl_minutes < 1 or p_ttl_minutes > 2880 then
    raise exception '寿命が範囲外';
  end if;

  perform close_expired_rooms();   -- 先に番号を返させる

  for i in 1..25 loop
    begin
      insert into trips (mode, code, date, start_min, plan, expires_at)
      values (
        p_mode,
        case when p_mode = 'party' then make_room_code() else null end,
        current_date, p_start_min, p_plan,
        now() + make_interval(mins => p_ttl_minutes)
      )
      returning * into t;
      exit;
    exception when unique_violation then
      t := null;   -- あいことばがぶつかった。取り直す
    end;
  end loop;

  if t.id is null then
    raise exception 'あいことばが取れませんでした';
  end if;

  insert into members (id, trip_id, label, is_host)
  values (v_id, t.id, coalesce(nullif(btrim(p_label), ''), 'あなた'), true);

  return t;
end $$;

-- ---------- 合流 ----------

create or replace function join_by_code(
  p_code      text,
  p_label     text,
  p_member_id uuid,
  p_max       int default 12
) returns trips
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid := assert_identity(p_member_id);
  t    trips;
  n    int;
begin
  perform close_expired_rooms();

  select * into t from trips
   where code = p_code
     and mode = 'party'
     and status <> 'done'
     and (expires_at is null or expires_at > now())
   limit 1;

  if t.id is null then return null; end if;

  -- すでに入っている端末。開き直しただけなので名前は触らない。
  -- （0001 は on conflict で上書きしていて、幹事の名前が毎回「旅人」になっていた）
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

-- ---------- 書き込みは全部ここを通す ----------

create or replace function update_plan(p_trip_id uuid, p_plan jsonb, p_member_id uuid)
returns trips
language plpgsql security definer set search_path = public as $$
declare t trips;
begin
  perform assert_member(p_trip_id, p_member_id);
  if jsonb_typeof(p_plan) <> 'array' then raise exception 'plan は配列'; end if;
  update trips set plan = p_plan where id = p_trip_id returning * into t;
  return t;
end $$;

create or replace function consume_call(p_trip_id uuid, p_member_id uuid, p_cap int default 5)
returns trips
language plpgsql security definer set search_path = public as $$
declare t trips;
begin
  perform assert_member(p_trip_id, p_member_id);
  update trips set calls_used = least(p_cap, calls_used + 1)
  where id = p_trip_id returning * into t;
  return t;
end $$;

create or replace function finish_trip(p_trip_id uuid, p_member_id uuid)
returns trips
language plpgsql security definer set search_path = public as $$
declare v uuid; t trips;
begin
  v := assert_identity(p_member_id);
  if not is_host(p_trip_id, v) then
    raise exception '道中を終えられるのは幹事だけです';
  end if;
  update trips set status = 'done' where id = p_trip_id returning * into t;
  return t;
end $$;

create or replace function set_room_locked(p_trip_id uuid, p_member_id uuid, p_locked boolean)
returns trips
language plpgsql security definer set search_path = public as $$
declare v uuid; t trips;
begin
  v := assert_identity(p_member_id);
  if not is_host(p_trip_id, v) then
    raise exception '待合を閉じられるのは幹事だけです';
  end if;
  update trips set locked = p_locked where id = p_trip_id returning * into t;
  return t;
end $$;

-- 0001 の版を置き換える。参加者かどうかを見るようにした
create or replace function open_round(
  p_trip_id        uuid,
  p_question       text,
  p_options        jsonb,
  p_plan_by_option jsonb,
  p_seconds        double precision,
  p_member_id      uuid
) returns rounds
language plpgsql security definer set search_path = public as $$
declare r rounds; v_members int;
begin
  perform assert_member(p_trip_id, p_member_id);
  if jsonb_typeof(p_options) <> 'array' or jsonb_array_length(p_options) = 0 then
    raise exception '選択肢がありません';
  end if;
  if p_seconds < -60 or p_seconds > 600 then
    raise exception '開示までの秒数が範囲外';
  end if;

  select count(*)::int into v_members from members where trip_id = p_trip_id;
  insert into rounds (trip_id, question, options, plan_by_option, reveal_at, member_count)
  values (p_trip_id, p_question, p_options, p_plan_by_option,
          now() + make_interval(secs => p_seconds), greatest(v_members, 1))
  returning * into r;
  return r;
end $$;

create or replace function cast_vetoes(p_round_id uuid, p_member_id uuid, p_option_ids text[])
returns int
language plpgsql security definer set search_path = public as $$
declare
  v_trip   uuid;
  v_status text;
  v_count  int;
begin
  select trip_id, status into v_trip, v_status from rounds where id = p_round_id for update;
  if v_trip is null then
    raise exception 'round not found: %', p_round_id;
  end if;
  perform assert_member(v_trip, p_member_id);

  if v_status = 'revealed' then
    select submitted_count into v_count from rounds where id = p_round_id;
    return v_count;
  end if;

  delete from vetoes where round_id = p_round_id and member_id = p_member_id;
  if array_length(p_option_ids, 1) is not null then
    insert into vetoes (round_id, member_id, option_id)
    select p_round_id, p_member_id, unnest(p_option_ids)
    on conflict do nothing;
  end if;

  insert into submissions (round_id, member_id)
  values (p_round_id, p_member_id)
  on conflict do nothing;

  select count(*) into v_count from submissions where round_id = p_round_id;
  update rounds set submitted_count = v_count where id = p_round_id;
  return v_count;
end $$;

-- ---------- 読み取りの範囲 ----------

-- 匿名ログインを有効にしていれば、自分が入っている道中しか読めない。
-- 有効にしていない構成では current_member() が null になり、
-- 0001 と同じ「anon キーを持っていれば読める」に落ちる。
drop policy if exists trips_read   on trips;
drop policy if exists trips_write  on trips;
drop policy if exists trips_update on trips;
create policy trips_read on trips for select using (
  current_member() is null or is_member(trips.id, current_member())
);
-- trips の INSERT / UPDATE ポリシーは作らない。作成も更新も RPC の中だけ

drop policy if exists members_read  on members;
drop policy if exists members_write on members;
create policy members_read on members for select using (
  current_member() is null or is_member(members.trip_id, current_member())
);
-- members の INSERT ポリシーは作らない。参加は join_by_code / create_trip の中だけ。
-- あいことばを知らずに参加者になる道を塞ぐ

drop policy if exists rounds_read on rounds;
create policy rounds_read on rounds for select using (
  current_member() is null or is_member(rounds.trip_id, current_member())
);

-- ---------- 権限 ----------

revoke insert, update, delete on trips   from anon, authenticated;
revoke insert, update, delete on members from anon, authenticated;
grant  select on trips   to anon, authenticated;
grant  select on members to anon, authenticated;
grant  select on rounds  to anon, authenticated;

grant execute on function create_trip(text, jsonb, int, uuid, text, int)                to anon, authenticated;
grant execute on function join_by_code(text, text, uuid, int)                           to anon, authenticated;
grant execute on function update_plan(uuid, jsonb, uuid)                                to anon, authenticated;
grant execute on function consume_call(uuid, uuid, int)                                 to anon, authenticated;
grant execute on function finish_trip(uuid, uuid)                                       to anon, authenticated;
grant execute on function set_room_locked(uuid, uuid, boolean)                          to anon, authenticated;
grant execute on function open_round(uuid, text, jsonb, jsonb, double precision, uuid)  to anon, authenticated;
grant execute on function cast_vetoes(uuid, uuid, text[])                               to anon, authenticated;
grant execute on function current_member()                                              to anon, authenticated;

-- 0001 の版は引数が違うので残っている。消しておかないと呼び分けが曖昧になる
drop function if exists open_round(uuid, text, jsonb, jsonb, double precision);
drop function if exists consume_call(uuid, int);
drop function if exists join_by_code(text, text, uuid);

-- ---------- Realtime ----------
-- 手作業に頼らない。ダッシュボードで有効にし忘れると購読が静かに届かなくなる
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin execute 'alter publication supabase_realtime add table rounds';  exception when duplicate_object then null; end;
    begin execute 'alter publication supabase_realtime add table members'; exception when duplicate_object then null; end;
    begin execute 'alter publication supabase_realtime add table trips';   exception when duplicate_object then null; end;
  end if;
end $$;
