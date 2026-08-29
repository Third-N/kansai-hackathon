-- ============================================================
-- 道中 / B — 既定の権限を剥がす
--
-- 0001 と 0002 は「vetoes と submissions には権限を1つも与えない」つもりで
-- 書いたが、GRANT を書かなかっただけで REVOKE をしていなかった。
-- Supabase は public スキーマの新しいテーブルに既定の GRANT を付けるので、
-- 実プロジェクトでは anon が SELECT 権限を持っていた。
--
-- 実害は出ていない。RLS を有効にしてポリシーを1つも作っていないので、
-- 行は1件も返らない。ただし守りが RLS 1枚だけになっている。
-- 票が読めないことは、この作品でいちばん壊してはいけないところなので、
-- 権限側でも塞いでおく。
--
-- 確認のしかた（anon キーで叩いて 401 になること）:
--   curl "$URL/rest/v1/vetoes?select=*" -H "apikey: $KEY" -H "Authorization: Bearer $KEY"
-- 0003 の前は 200 [] が返る。あとは 401 になる。
-- ============================================================

revoke all on vetoes      from anon, authenticated;
revoke all on submissions from anon, authenticated;

-- rounds も同じ。0002 で select だけ grant したが、既定で付いた
-- insert / update / delete が残っている。開くのも開示するのも RPC の中だけ
revoke insert, update, delete on rounds from anon, authenticated;

-- 念のためもう一度。0002 で剥がしているが、順番に流されなかった場合に備える
revoke insert, update, delete on trips   from anon, authenticated;
revoke insert, update, delete on members from anon, authenticated;

-- 読める範囲は変えない。Realtime は SELECT 権限と RLS の両方を見るので、
-- ここを削ると購読が届かなくなる
grant select on trips   to anon, authenticated;
grant select on members to anon, authenticated;
grant select on rounds  to anon, authenticated;
