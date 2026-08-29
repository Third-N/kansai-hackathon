-- ============================================================
-- 行き先を検索して自分で足せるようにする
--
-- 決まった6箇所（lib/spots.ts の SPOTS）だけでなく、Geoapifyの検索で
-- 見つけた場所も行き先に選べるようにしたい。SPOTS はアプリに焼き込まれた
-- 固定表なので、道中ごとに足した行き先はここ（trips.custom_spots）に持たせる。
--
-- 中身は SPOTS と同じ形の Spot を id -> Spot で持つ jsonb。
-- 道中を作るときに一度だけ確定させる（create_trip の中でだけ書ける）。
-- 途中で個人が勝手に足せると、他の参加者に見えている行き先の一覧が
-- 人によってずれてしまうため、update_plan では customSpots は変えられない。
-- ============================================================

alter table trips add column if not exists custom_spots jsonb not null default '{}'::jsonb;

create or replace function create_trip(
  p_mode         text,
  p_plan         jsonb,
  p_start_min    int,
  p_member_id    uuid,
  p_label        text default 'あなた',
  p_ttl_minutes  int  default 720,
  p_custom_spots jsonb default '{}'::jsonb
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
  if jsonb_typeof(p_custom_spots) <> 'object' then
    raise exception 'custom_spots はオブジェクト';
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
      insert into trips (mode, code, date, start_min, plan, custom_spots, expires_at)
      values (
        p_mode,
        case when p_mode = 'party' then make_room_code() else null end,
        current_date, p_start_min, p_plan, p_custom_spots,
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

grant execute on function create_trip(text, jsonb, int, uuid, text, int, jsonb) to anon, authenticated;

-- 引数の数が違う旧版。消しておかないと named 呼び出しが曖昧になる
drop function if exists create_trip(text, jsonb, int, uuid, text, int);
