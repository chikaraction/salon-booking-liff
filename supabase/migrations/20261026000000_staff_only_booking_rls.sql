-- 予約系テーブルと店側RPCを「staff に紐付いたログインユーザー」に限定する(多層防御)
--
-- これまで予約の運用に使う4テーブル(customers / reservations / reservation_menus /
-- push_messages)は「authenticated なら全操作可」(初期スキーマ)のままで、
-- 店側RPC(admin_create_reservation / admin_update_reservation)にも本人確認が無かった。
-- 「authenticated = 招待制のスタッフ」(ADR-005)という前提は Supabase Auth の
-- セルフサインアップ無効化というダッシュボード設定だけで守られており、設定ミスや
-- staff に紐付かない検証用ユーザーの残りがあると、REST から全顧客の個人情報
-- (氏名・電話番号・LINEユーザーID・スタッフメモ)を読み書きできてしまう。
--
-- そこで、設定系テーブル(M4b)と同じく current_staff_role() で判定する:
-- - 予約系4テーブル: owner / staff のどちらでも全操作可(ADR-005「スタッフ: 予約の閲覧・
--   代行登録・代行キャンセル」。スタッフメモの編集もスタッフが行う)。紐付け無しは全拒否
-- - 店側RPC: security definer でRLSをバイパスするので、関数の先頭で同じ判定をする
--
-- 客側(LIFF)は service_role で動く(RLSバイパス・current_staff_role() を通らない)ので
-- 影響しない。店側RPCは管理画面の authenticated クライアントからだけ呼ばれる。

-- ---------------------------------------------------------------------------
-- 予約系4テーブルのRLS
-- ---------------------------------------------------------------------------
drop policy "店側スタッフは全操作可" on public.customers;
drop policy "店側スタッフは全操作可" on public.reservations;
drop policy "店側スタッフは全操作可" on public.reservation_menus;
drop policy "店側スタッフは全操作可" on public.push_messages;

create policy "店側スタッフは全操作可" on public.customers
  for all to authenticated
  using (public.current_staff_role() is not null)
  with check (public.current_staff_role() is not null);
create policy "店側スタッフは全操作可" on public.reservations
  for all to authenticated
  using (public.current_staff_role() is not null)
  with check (public.current_staff_role() is not null);
create policy "店側スタッフは全操作可" on public.reservation_menus
  for all to authenticated
  using (public.current_staff_role() is not null)
  with check (public.current_staff_role() is not null);
create policy "店側スタッフは全操作可" on public.push_messages
  for all to authenticated
  using (public.current_staff_role() is not null)
  with check (public.current_staff_role() is not null);

-- ---------------------------------------------------------------------------
-- 店側RPC: 先頭に staff 確認を足す(本体は M4 の定義と同じ)
-- 紐付け無しは insufficient_privilege(42501)。管理画面からは通常起きない経路なので、
-- アプリ側は既存の server_error 扱いのままでよい
-- ---------------------------------------------------------------------------
create or replace function public.admin_create_reservation(
  p_customer_id uuid,
  p_customer_name text,
  p_customer_phone text,
  p_staff_id uuid,
  p_start timestamptz,
  p_menu_ids uuid[],
  p_note text
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_customer_id uuid;
begin
  if public.current_staff_role() is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if p_customer_id is not null then
    select id into v_customer_id
    from customers
    where id = p_customer_id;

    if v_customer_id is null then
      raise exception 'invalid customer_id' using errcode = 'P0001';
    end if;
  else
    if p_customer_name is null or p_customer_name = '' then
      raise exception 'customer_name is required' using errcode = 'P0001';
    end if;
    insert into customers (line_user_id, name, phone)
    values (null, p_customer_name, nullif(p_customer_phone, ''))
    returning id into v_customer_id;
  end if;

  return _insert_booking(
    v_customer_id, p_staff_id, p_start, p_menu_ids, p_note, p_source => 'admin'
  );
end;
$$;

create or replace function public.admin_update_reservation(
  p_reservation_id uuid,
  p_staff_id uuid,
  p_start timestamptz,
  p_menu_ids uuid[],
  p_note text
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total_minutes integer;
  v_distinct_ids uuid[];
begin
  if public.current_staff_role() is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  perform 1
  from reservations
  where id = p_reservation_id
    and kind = 'booking'
    and status = 'confirmed'
  for update;

  if not found then
    return 'not_found';
  end if;

  select o_menu_ids, o_total_minutes
    into v_distinct_ids, v_total_minutes
  from _validate_menus(p_menu_ids);

  update reservations
  set staff_id = p_staff_id,
      during = tstzrange(p_start, p_start + make_interval(mins => v_total_minutes), '[)'),
      note = nullif(p_note, '')
  where id = p_reservation_id;

  delete from reservation_menus
  where reservation_id = p_reservation_id;

  insert into reservation_menus (reservation_id, menu_id, menu_name, price, duration_minutes)
  select p_reservation_id, m.id, m.name, m.price, m.duration_minutes
  from menus m
  where m.id = any (v_distinct_ids);

  return 'ok';
end;
$$;

-- create or replace は既存の権限を引き継ぐが、どこで作り直しても同じになるよう明示する
revoke execute on function public.admin_create_reservation from public, anon;
revoke execute on function public.admin_update_reservation from public, anon;
grant execute on function public.admin_create_reservation to authenticated;
grant execute on function public.admin_update_reservation to authenticated;
