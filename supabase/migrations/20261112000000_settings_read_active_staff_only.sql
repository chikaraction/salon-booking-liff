-- 設定系テーブルの閲覧を「有効なスタッフに紐付いたログインユーザー」に限定する
--
-- M4b(20260902000000)で設定系8テーブルの閲覧ポリシーは
-- 「for select to authenticated using (true)」にした。その後、予約系4テーブルと
-- 店側RPCは current_staff_role() の判定に切り替えたが(20261026000000)、
-- 設定系の閲覧だけは「ログインしていれば誰でも可」のまま残っていた。
--
-- そのため、次のユーザーが REST から設定系のデータを読めた:
-- - 無効にしたスタッフ(Auth ユーザーを消すまでの間)
-- - staff に紐付いていない Auth ユーザー(検証用の残りや、セルフサインアップを
--   無効にし忘れた場合の第三者)
-- 読めるのはスタッフ名・ロール・勤務時間・メニュー(非表示のものも含む)・
-- 営業時間・店舗設定で、個人情報ではない。ただし SECURITY.md と docs/setup.md は
-- 「無効にしたスタッフはどのデータにも触れない」と説明しているので、実装を合わせる。
--
-- current_staff_role() は security definer で staff を読むので、staff 自身の
-- ポリシーから呼んでも RLS の再帰にはならない(無効・未紐付け・未ログインは NULL)。
--
-- 変更は閲覧ポリシーだけ。「オーナーは変更可」(for all・オーナーのみ)はそのまま。
-- 客側(LIFF)とログイン画面の店名は service_role で読むので影響しない。

drop policy "店側スタッフは閲覧可" on public.salon_settings;
drop policy "店側スタッフは閲覧可" on public.business_hours;
drop policy "店側スタッフは閲覧可" on public.staff;
drop policy "店側スタッフは閲覧可" on public.staff_working_hours;
drop policy "店側スタッフは閲覧可" on public.menus;
drop policy "店側スタッフは閲覧可" on public.menu_categories;
drop policy "店側スタッフは閲覧可" on public.nth_weekday_closures;
drop policy "店側スタッフは閲覧可" on public.date_overrides;

create policy "店側スタッフは閲覧可" on public.salon_settings
  for select to authenticated
  using (public.current_staff_role() is not null);
create policy "店側スタッフは閲覧可" on public.business_hours
  for select to authenticated
  using (public.current_staff_role() is not null);
create policy "店側スタッフは閲覧可" on public.staff
  for select to authenticated
  using (public.current_staff_role() is not null);
create policy "店側スタッフは閲覧可" on public.staff_working_hours
  for select to authenticated
  using (public.current_staff_role() is not null);
create policy "店側スタッフは閲覧可" on public.menus
  for select to authenticated
  using (public.current_staff_role() is not null);
create policy "店側スタッフは閲覧可" on public.menu_categories
  for select to authenticated
  using (public.current_staff_role() is not null);
create policy "店側スタッフは閲覧可" on public.nth_weekday_closures
  for select to authenticated
  using (public.current_staff_role() is not null);
create policy "店側スタッフは閲覧可" on public.date_overrides
  for select to authenticated
  using (public.current_staff_role() is not null);
