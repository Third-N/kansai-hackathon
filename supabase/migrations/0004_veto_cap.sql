-- ============================================================
-- 道中 / B — せーのの反対上限をサーバー側でも強制する
--
-- vetoCap(選択肢の数) = max(1, floor(選択肢の数 / 3)) は
-- lib/round.ts にある。「上限が無いと全滅が通常ケースになる」ため。
-- これまで cast_vetoes RPC はこの上限をチェックしておらず、
-- UI（app/trip/[id]/decide/[roundId]/page.tsx）だけが守っていた。
-- RPC は anon に execute を渡した公開エンドポイントなので、
-- UI を経由せず直接呼べば全選択肢に反対できてしまい、
-- 「反対ゼロが通常ケース」という設計上の保証を1参加者が壊せた。
-- ============================================================

create or replace function cast_vetoes(p_round_id uuid, p_member_id uuid, p_option_ids text[])
returns int
language plpgsql security definer set search_path = public as $$
declare
  v_trip     uuid;
  v_status   text;
  v_options  jsonb;
  v_cap      int;
  v_distinct int;
  v_count    int;
begin
  select trip_id, status, options into v_trip, v_status, v_options
  from rounds where id = p_round_id for update;
  if v_trip is null then
    raise exception 'round not found: %', p_round_id;
  end if;
  perform assert_member(v_trip, p_member_id);

  if v_status = 'revealed' then
    select submitted_count into v_count from rounds where id = p_round_id;
    return v_count;
  end if;

  -- lib/round.ts の vetoCap と同じ式。整数どうしの除算は正の値なら floor と同じ
  v_cap := greatest(1, jsonb_array_length(v_options) / 3);
  select count(distinct x) into v_distinct from unnest(coalesce(p_option_ids, '{}')) x;
  if v_distinct > v_cap then
    raise exception '反対は%つまでです', v_cap;
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
