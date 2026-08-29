-- ============================================================
-- 地図APIキーを、コードやgit履歴に残さず持たせる置き場
--
-- Geoapify のキーはどのみちブラウザに渡す前提のものだが、
-- このリポジトリは公開している。.env や画面入力のかわりに、
-- ここ（app_config）に1行だけ持たせ、起動時にクライアントから
-- 読みに行く形にする。誰でも読めるが、誰も書けない（RPC も無い）。
--
-- 実際のキーの値はこのファイルには書かない。
-- 適用後、Supabase の SQL Editor で1回だけ次を実行して入れる:
--   update app_config set value = 'ここに実際のキー' where key = 'geoapify_key';
-- ============================================================

create table app_config (
  key   text primary key,
  value text not null default ''
);

alter table app_config enable row level security;

create policy app_config_select on app_config
  for select
  using (true);

-- 既定で付く insert/update/delete を剥がす。0003_grants.sql と同じ理由
revoke insert, update, delete on app_config from anon, authenticated;
grant select on app_config to anon, authenticated;

insert into app_config (key, value) values ('geoapify_key', '');
