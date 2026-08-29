-- ============================================================
-- 道中 / B（Realtime・状態）
-- 認証は入れていない。あいことば・URL を知っている人が入れる構成。
-- 守るのは「票が誰にも読めないこと」の一点。
-- ============================================================

-- gen_random_uuid() は PostgreSQL 13 以降のコア関数。pgcrypto は要らない

-- ---------- テーブル ----------

create table if not exists trips (
  id          uuid primary key default gen_random_uuid(),
  mode        text not null check (mode in ('solo','party')),
  code        text unique,
  date        date not null,
  start_min   int  not null,
  plan        jsonb not null default '[]'::jsonb,
  calls_used  int  not null default 0,
  status      text not null default 'running' check (status in ('planning','running','done')),
  created_at  timestamptz not null default now()
);

create table if not exists members (
  id             uuid primary key,          -- 端末が持つ ID をそのまま使う
  trip_id        uuid not null references trips(id) on delete cascade,
  label          text not null,
  is_host        boolean not null default false,
  stamina_factor real not null default 1,
  joined_at      timestamptz not null default now()
);
create index if not exists members_trip_idx on members(trip_id, joined_at);

create table if not exists rounds (
  id              uuid primary key default gen_random_uuid(),
  trip_id         uuid not null references trips(id) on delete cascade,
  question        text not null,
  options         jsonb not null,
  plan_by_option  jsonb not null default '{}'::jsonb,
  reveal_at       timestamptz not null,     -- 全端末はこれを見て逆算する
  status          text not null default 'open' check (status in ('open','revealed')),
  submitted_count int  not null default 0,
  member_count    int  not null default 1,
  result          jsonb,
  created_at      timestamptz not null default now()
);
create index if not exists rounds_open_idx on rounds(trip_id, status);

-- 票。クライアントからは読めない・書けない・消せない。RPC の中だけで触る
create table if not exists vetoes (
  round_id   uuid not null references rounds(id) on delete cascade,
  member_id  uuid not null,
  option_id  text not null,
  created_at timestamptz not null default now(),
  primary key (round_id, member_id, option_id)
);

-- 「出した」という事実だけ。何を嫌がったかは入れない。
-- これが無いと、何も嫌でない人（空提出）を数えられない
create table if not exists submissions (
  round_id   uuid not null references rounds(id) on delete cascade,
  member_id  uuid not null,
  created_at timestamptz not null default now(),
  primary key (round_id, member_id)
);

-- ---------- RLS ----------

alter table trips       enable row level security;
alter table members     enable row level security;
alter table rounds      enable row level security;
alter table vetoes      enable row level security;
alter table submissions enable row level security;

drop policy if exists trips_read   on trips;
drop policy if exists trips_write  on trips;
drop policy if exists trips_update on trips;
create policy trips_read   on trips for select using (true);
create policy trips_write  on trips for insert with check (true);
create policy trips_update on trips for update using (true) with check (true);

drop policy if exists members_read  on members;
drop policy if exists members_write on members;
create policy members_read  on members for select using (true);
create policy members_write on members for insert with check (true);

drop policy if exists rounds_read  on rounds;
drop policy if exists rounds_write on rounds;
create policy rounds_read on rounds for select using (true);
-- rounds の INSERT / UPDATE ポリシーは作らない。開くのも開示するのも RPC の中だけ

-- vetoes と submissions にはポリシーを1つも作らない ＝ 全操作を拒否。
-- 触れるのは security definer の RPC だけ。
-- 「UIで隠す」のではなく、読む手段そのものを与えない。

-- ---------- 権限 ----------
-- RLS のポリシーだけでは足りない。テーブルへの GRANT が無いと
-- ポリシー以前に permission denied になる。
-- Supabase は public スキーマに既定の GRANT を持っているので通ってしまうことがあるが、
-- 環境に依存させたくないので明示する。
grant usage on schema public to anon, authenticated;
grant select, insert, update on trips   to anon, authenticated;
grant select, insert         on members to anon, authenticated;
grant select                 on rounds  to anon, authenticated;
-- rounds の INSERT と UPDATE は渡さない。
-- 開くのも開示するのも RPC の中だけ。reveal_at をサーバー時刻で決めたいので、
-- 開く側の端末の時計を混ぜない
-- vetoes と submissions には何も渡さない

-- ---------- 開示の計算 ----------

-- 決めきれないときの選び手。乱数ではなく round id から決める。
-- 冪等な RPC が二度走っても、同じ答えになる必要がある。
create or replace function round_tiebreak(p_round_id uuid)
returns double precision
language sql immutable as $$
  select (abs(hashtext(p_round_id::text)) % 1000000)::double precision / 1000000.0;
$$;

-- 問いを開く。開示時刻はサーバーの now() から決める。
-- 端末側で now() + 秒 を作ると、開いた人の時計のずれがそのまま全員に配られる
create or replace function open_round(
  p_trip_id        uuid,
  p_question       text,
  p_options        jsonb,
  p_plan_by_option jsonb,
  p_seconds        double precision   -- 秒。小数も受ける
) returns rounds
language plpgsql security definer set search_path = public as $$
declare
  r         rounds;
  v_members int;
begin
  select count(*)::int into v_members from members where trip_id = p_trip_id;
  insert into rounds (trip_id, question, options, plan_by_option, reveal_at, member_count)
  values (p_trip_id, p_question, p_options, p_plan_by_option,
          now() + make_interval(secs => p_seconds), greatest(v_members, 1))
  returning * into r;
  return r;
end $$;

-- 票を出す。書き込み専用。戻すのは「出した人数」だけで、中身は返さない
create or replace function cast_vetoes(p_round_id uuid, p_member_id uuid, p_option_ids text[])
returns int
language plpgsql security definer set search_path = public as $$
declare
  v_status text;
  v_count  int;
begin
  select status into v_status from rounds where id = p_round_id for update;
  if v_status is null then
    raise exception 'round not found: %', p_round_id;
  end if;

  -- 開示後の投票は受け付けない。現在の人数だけ返す
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

-- 開示。冪等。開示時刻より前なら何もしない。誰が呼んでもよい
create or replace function reveal_round(p_round_id uuid)
returns rounds
language plpgsql security definer set search_path = public as $$
declare
  r          rounds;
  v_ids      text[];
  v_cnts     int[];
  v_tally    jsonb;
  v_tiebreak double precision;
  v_pick     int[];
  v_n        int;
  v_min      int;
  v_zero     int;
  v_winner   text;
  v_kind     text;
begin
  select * into r from rounds where id = p_round_id for update;
  if r.id is null then
    raise exception 'round not found: %', p_round_id;
  end if;
  if r.status = 'revealed' then return r; end if;   -- 冪等
  if r.reveal_at > now()   then return r; end if;   -- 時刻前は何もしない

  -- 選択肢ごとの反対数。選択肢の並び順は options の並びをそのまま保つ
  with opts as (
    select value->>'id' as option_id, ordinality::int as ord
    from jsonb_array_elements(r.options) with ordinality
  ),
  tallied as (
    select o.option_id, o.ord, coalesce(v.cnt, 0) as cnt
    from opts o
    left join (
      select option_id, count(*)::int as cnt
      from vetoes where round_id = p_round_id group by option_id
    ) v on v.option_id = o.option_id
  )
  select array_agg(option_id order by ord),
         array_agg(cnt order by ord),
         jsonb_agg(jsonb_build_object('optionId', option_id, 'count', cnt) order by ord)
  into v_ids, v_cnts, v_tally
  from tallied;

  v_tiebreak := round_tiebreak(p_round_id);
  select count(*)::int into v_zero from unnest(v_cnts) c where c = 0;

  if v_zero > 0 then
    -- 反対ゼロが残った。その中から1つ選ぶ
    select array_agg(i order by i) into v_pick
    from generate_subscripts(v_cnts, 1) i where v_cnts[i] = 0;
    v_kind := case when v_zero = 1 then 'unanimous' else 'tied' end;
  else
    -- 全滅。反対が最も少ないものを妥協点として出す
    select min(c) into v_min from unnest(v_cnts) c;
    select array_agg(i order by i) into v_pick
    from generate_subscripts(v_cnts, 1) i where v_cnts[i] = v_min;
    v_kind := 'compromise';
  end if;

  v_n := array_length(v_pick, 1);
  -- lib/round.ts の resolveRound と同じ式:
  --   floor(tiebreak * n) % n   （配列は1始まりなので +1）
  v_winner := v_ids[ v_pick[ (floor(v_tiebreak * v_n)::int % v_n) + 1 ] ];

  update rounds set
    status = 'revealed',
    result = jsonb_build_object(
      'tally', v_tally,
      'winnerId', v_winner,
      'kind', v_kind,
      'survivorCount', v_zero
    )
  where id = p_round_id
  returning * into r;

  return r;
end $$;

-- 呼び出し回数。上限つきの原子的な加算
create or replace function consume_call(p_trip_id uuid, p_cap int default 5)
returns trips
language plpgsql security definer set search_path = public as $$
declare t trips;
begin
  update trips set calls_used = least(p_cap, calls_used + 1)
  where id = p_trip_id returning * into t;
  if t.id is null then raise exception 'trip not found: %', p_trip_id; end if;
  return t;
end $$;

-- あいことばで合流する。道中を1件返す。既に入っている端末なら二重に増やさない
create or replace function join_by_code(p_code text, p_label text, p_member_id uuid)
returns trips
language plpgsql security definer set search_path = public as $$
declare t trips;
begin
  select * into t from trips where code = p_code and status <> 'done' limit 1;
  if t.id is null then return null; end if;
  insert into members (id, trip_id, label, is_host, stamina_factor)
  values (p_member_id, t.id, p_label, false, 1)
  on conflict (id) do update set label = excluded.label;
  return t;
end $$;

grant execute on function open_round(uuid, text, jsonb, jsonb, double precision) to anon, authenticated;
grant execute on function cast_vetoes(uuid, uuid, text[]) to anon, authenticated;
grant execute on function reveal_round(uuid)              to anon, authenticated;
grant execute on function consume_call(uuid, int)         to anon, authenticated;
grant execute on function join_by_code(text, text, uuid)  to anon, authenticated;
