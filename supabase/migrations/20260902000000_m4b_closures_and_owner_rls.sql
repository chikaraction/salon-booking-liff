-- Milestone 4b: 休業日ルール(第◯曜日・祝日・日付上書き)+ オーナー限定のRLS
-- (docs/milestone-4b-plan.md)
--
-- 命名規約(M4b決定): 「店が休む」= closed / closure、「日本の祝日」= holiday。
-- 祝日は定休より強い別ルール(優先順位が違う)なので同じ語を当てない。
-- 毎週固定の定休は既存の business_hours.is_open が持ち、
-- 「第3日曜」のような月内の第◯曜日だけを nth_weekday_closures が持つ。

-- ---------------------------------------------------------------------------
-- 第◯曜日の定休(モックE-2「特定の週だけの定休日」)
--
-- UIの1ブロック(曜日 + 第1〜第5の複数選択)は (weekday, nth) の行集合として持ち、
-- 表示時に曜日でグルーピングして復元する。
-- ---------------------------------------------------------------------------
create table public.nth_weekday_closures (
  id uuid primary key default gen_random_uuid(),
  -- 0=日曜 〜 6=土曜(business_hours.weekday と同じ規約)
  weekday smallint not null check (weekday between 0 and 6),
  -- その月の第何◯曜日か(第5週は月によって存在しない)
  nth smallint not null check (nth between 1 and 5),
  created_at timestamptz not null default now(),
  constraint nth_weekday_closures_unique unique (weekday, nth)
);

comment on table public.nth_weekday_closures is '第◯曜日の定休(例: 毎月第3日曜)。毎週固定の定休は business_hours.is_open';

-- ---------------------------------------------------------------------------
-- 臨時休業・臨時営業(モックE-2「臨時休業・指定日」)
--
-- 日付範囲の上書き。休業日判定でもっとも強い(祝日・第◯曜日・毎週の定休に勝つ)。
-- is_open = true は「祝日だが営業する」の逃がし口で、祝日の算出が特例法に
-- 追随できないケースを店側の操作で吸収するためのもの。
-- ---------------------------------------------------------------------------
create table public.date_overrides (
  id uuid primary key default gen_random_uuid(),
  -- 単日は start_date = end_date。連休は1行で表す
  start_date date not null,
  end_date date not null,
  -- false=休業(臨時休・連休) / true=定休・祝日でも営業する
  is_open boolean not null default false,
  -- 「夏季休業」など。表示のバッジ(休業/臨時休/連休)は日数と is_open から表示側で導出
  label text,
  created_at timestamptz not null default now(),
  constraint date_overrides_range check (start_date <= end_date),
  -- 同じ日に「休業」と「営業」が同時に登録される曖昧さを構造的に防ぐ。
  -- 判定ロジック側で優先順位を決めずに済むよう、DBで一意性を担保する
  constraint date_overrides_no_overlap exclude using gist (
    daterange(start_date, end_date, '[]') with &&
  )
);

comment on table public.date_overrides is '臨時休業・臨時営業(日付範囲)。休業日判定でもっとも強い上書き';

create index date_overrides_start_date_idx on public.date_overrides (start_date);

-- ---------------------------------------------------------------------------
-- 「祝日を休業にする」トグル(店舗固有の運用値なのでDBへ: ADR-007)
-- 祝日そのものは japanese-holidays の getHolidaysOf(year) でアプリ側が算出する
-- ---------------------------------------------------------------------------
alter table public.salon_settings
  add column close_on_holidays boolean not null default false;

comment on column public.salon_settings.close_on_holidays is '日本の祝日を自動で休業扱いにするか(例外は date_overrides で上書き)';

-- ---------------------------------------------------------------------------
-- ログイン中スタッフのロール(ADR-005 のオーナー/スタッフの権限差)
--
-- security definer にするのは必須。staff テーブル自身のRLSポリシーから呼ぶため、
-- 呼び出し元の権限で staff を読むと再帰する。定義者(postgres)権限で読めば
-- RLSをバイパスして再帰しない。
-- auth_user_id 未紐付けのユーザーは NULL を返す(= 設定変更不可)。
-- ---------------------------------------------------------------------------
create or replace function public.current_staff_role() returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.staff where auth_user_id = auth.uid();
$$;

comment on function public.current_staff_role is 'ログイン中スタッフのロール(owner/staff)。未紐付け・未ログインはNULL';

-- RLSポリシーの評価に必要なので authenticated には実行を許す
revoke execute on function public.current_staff_role from public, anon;
grant execute on function public.current_staff_role to authenticated;

-- ---------------------------------------------------------------------------
-- 設定系テーブルのRLS: 閲覧は全スタッフ / 変更はオーナーのみ(ADR-005)
--
-- 初期スキーマの「店側スタッフは全操作可」(for all)を、
-- 「閲覧可」(for select・全スタッフ)と「変更可」(for all・オーナーのみ)に分割する。
-- ポリシーはPERMISSIVE(OR結合)なので、SELECTは前者で全スタッフに通り、
-- INSERT/UPDATE/DELETE は後者しか該当せずオーナーに限定される。
--
-- 予約の運用に使うテーブル(reservations / reservation_menus / customers /
-- push_messages)は据え置き。スタッフも代行登録・代行キャンセル・スタッフメモ編集を
-- 行うため(ADR-005「スタッフ: 予約の閲覧・代行登録・代行キャンセル」)。
-- ---------------------------------------------------------------------------
drop policy "店側スタッフは全操作可" on public.salon_settings;
drop policy "店側スタッフは全操作可" on public.business_hours;
drop policy "店側スタッフは全操作可" on public.staff;
drop policy "店側スタッフは全操作可" on public.staff_working_hours;
drop policy "店側スタッフは全操作可" on public.menus;
drop policy "店側スタッフは全操作可" on public.menu_categories;

create policy "店側スタッフは閲覧可" on public.salon_settings
  for select to authenticated using (true);
create policy "オーナーは変更可" on public.salon_settings
  for all to authenticated
  using (public.current_staff_role() = 'owner')
  with check (public.current_staff_role() = 'owner');

create policy "店側スタッフは閲覧可" on public.business_hours
  for select to authenticated using (true);
create policy "オーナーは変更可" on public.business_hours
  for all to authenticated
  using (public.current_staff_role() = 'owner')
  with check (public.current_staff_role() = 'owner');

create policy "店側スタッフは閲覧可" on public.staff
  for select to authenticated using (true);
create policy "オーナーは変更可" on public.staff
  for all to authenticated
  using (public.current_staff_role() = 'owner')
  with check (public.current_staff_role() = 'owner');

create policy "店側スタッフは閲覧可" on public.staff_working_hours
  for select to authenticated using (true);
create policy "オーナーは変更可" on public.staff_working_hours
  for all to authenticated
  using (public.current_staff_role() = 'owner')
  with check (public.current_staff_role() = 'owner');

create policy "店側スタッフは閲覧可" on public.menus
  for select to authenticated using (true);
create policy "オーナーは変更可" on public.menus
  for all to authenticated
  using (public.current_staff_role() = 'owner')
  with check (public.current_staff_role() = 'owner');

create policy "店側スタッフは閲覧可" on public.menu_categories
  for select to authenticated using (true);
create policy "オーナーは変更可" on public.menu_categories
  for all to authenticated
  using (public.current_staff_role() = 'owner')
  with check (public.current_staff_role() = 'owner');

-- 新規テーブルも同じ方針(anon にはポリシーを作らない = 全拒否)
alter table public.nth_weekday_closures enable row level security;
alter table public.date_overrides enable row level security;

create policy "店側スタッフは閲覧可" on public.nth_weekday_closures
  for select to authenticated using (true);
create policy "オーナーは変更可" on public.nth_weekday_closures
  for all to authenticated
  using (public.current_staff_role() = 'owner')
  with check (public.current_staff_role() = 'owner');

create policy "店側スタッフは閲覧可" on public.date_overrides
  for select to authenticated using (true);
create policy "オーナーは変更可" on public.date_overrides
  for all to authenticated
  using (public.current_staff_role() = 'owner')
  with check (public.current_staff_role() = 'owner');
