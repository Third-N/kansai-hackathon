-- ============================================================
-- 道中記の写真
--
-- README「まだ無いもの」に挙げていた置き場だけの機能。
-- Storageバケットを新設する代わりに、端末側で十分小さく縮小した
-- （lib/photo.ts、長辺480px・JPEG）画像をそのまま trips.photos
-- （spotId -> data URL の jsonb）に持たせる。custom_spots と同じ発想。
--
-- 参加者なら誰でも足せる（幹事限定にしていない。道中の思い出を
-- 足すだけの操作で、道中の制御ではないため）。
-- ============================================================

alter table trips add column if not exists photos jsonb not null default '{}'::jsonb;

create or replace function add_photo(
  p_trip_id   uuid,
  p_spot_id   text,
  p_photo     text,
  p_member_id uuid
) returns trips
language plpgsql security definer set search_path = public as $$
declare t trips;
begin
  perform assert_member(p_trip_id, p_member_id);
  if p_photo is null or length(p_photo) = 0 then
    raise exception '写真がありません';
  end if;
  -- 縮小前提（長辺480px・JPEG）なので、この長さを超えるのは想定外の入力
  if length(p_photo) > 500000 then
    raise exception '写真が大きすぎます';
  end if;

  update trips set photos = photos || jsonb_build_object(p_spot_id, p_photo)
  where id = p_trip_id
  returning * into t;
  return t;
end $$;

grant execute on function add_photo(uuid, text, text, uuid) to anon, authenticated;
