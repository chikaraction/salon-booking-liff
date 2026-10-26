-- 無効にしたスタッフ(is_active = false)を管理画面の権限から外す
--
-- 物理削除できないため、やめたスタッフは is_active = false で表す運用
-- (src/app/admin/(protected)/settings/actions.ts の saveStaff)。ところが
-- current_staff_role() は is_active を見ていなかったため、無効にしただけでは
-- 管理画面にログインでき、予約・顧客情報の閲覧と操作もできた。
--
-- current_staff_role() はRLSポリシー(予約系・設定系)と店側RPCの判定の元なので、
-- ここで無効スタッフに NULL を返せば全経路で「未紐付け」と同じ扱いになる。
-- 権限は毎回DBから引くため、ログイン中のセッションも次の操作から拒否される。
--
-- 有効なオーナーが0人になる変更は saveStaff の findLastOwnerViolation が拒否するので、
-- この変更で設定画面に誰も入れなくなることはない。

create or replace function public.current_staff_role() returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.staff where auth_user_id = auth.uid() and is_active;
$$;

comment on function public.current_staff_role is 'ログイン中スタッフのロール(owner/staff)。未紐付け・無効・未ログインはNULL';

-- create or replace は既存の権限を引き継ぐが、どこで作り直しても同じになるよう明示する
revoke execute on function public.current_staff_role from public, anon;
grant execute on function public.current_staff_role to authenticated;
