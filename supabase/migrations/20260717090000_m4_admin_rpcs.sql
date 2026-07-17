-- Milestone 4: 管理画面コア用RPC(docs/milestone-4-plan.md)
--
-- - _insert_booking の source 引数化(代行登録が 'admin' を渡せるように)
-- - admin_create_reservation: 電話予約の代行登録(既存顧客 or 新規顧客)
-- - admin_update_reservation: 店側変更(UPDATE方式。EXCLUDE制約は更新後の値を
--   他の行とだけ照合するため自己衝突せず、予約IDも変わらない)
--
-- 権限方針(ADR-005): 客側RPCが service_role のみなのに対し、店側RPCは
-- authenticated(= Supabase Auth でログインした店側スタッフ)のみ実行可。
-- 店側キャンセルは単文UPDATEで足りるためRPCにしない。

-- ---------------------------------------------------------------------------
-- 内部関数: メニューIDの検証と合計所要時間の導出
-- (_insert_booking / admin_update_reservation で共有。
--  エラーメッセージ・SQLSTATEはM2/M3の挙動をそのまま引き継ぐ)
-- ---------------------------------------------------------------------------
create or replace function public._validate_menus(
  p_menu_ids uuid[],
  out o_menu_ids uuid[],
  out o_total_minutes integer
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  select array_agg(distinct id) into o_menu_ids
  from unnest(p_menu_ids) as id;

  if o_menu_ids is null then
    raise exception 'menu_ids is required' using errcode = 'P0001';
  end if;

  select sum(duration_minutes) into o_total_minutes
  from menus
  where id = any (o_menu_ids) and is_active;

  -- 存在しない・無効化済みメニューが混ざっていたら拒否
  if o_total_minutes is null
     or (select count(*) from menus where id = any (o_menu_ids) and is_active)
        <> cardinality(o_menu_ids) then
    raise exception 'invalid menu_ids' using errcode = 'P0001';
  end if;
end;
$$;

comment on function public._validate_menus is '内部関数。メニューIDの重複除去・有効性検証と合計所要時間の導出';

-- ---------------------------------------------------------------------------
-- _insert_booking に p_source(既定 'line')を追加
-- 引数追加は CREATE OR REPLACE では別オーバーロードになるため、旧5引数版を
-- DROPしてから6引数版を作り直す(既定値により既存呼び出しの挙動は変わらない)
-- ---------------------------------------------------------------------------
drop function public._insert_booking(uuid, uuid, timestamptz, uuid[], text);

create function public._insert_booking(
  p_customer_id uuid,
  p_staff_id uuid,
  p_start timestamptz,
  p_menu_ids uuid[],
  p_note text,
  p_source text default 'line'
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reservation_id uuid;
  v_total_minutes integer;
  v_distinct_ids uuid[];
begin
  select o_menu_ids, o_total_minutes
    into v_distinct_ids, v_total_minutes
  from _validate_menus(p_menu_ids);

  insert into reservations (kind, customer_id, staff_id, during, status, source, note)
  values (
    'booking',
    p_customer_id,
    p_staff_id,
    tstzrange(p_start, p_start + make_interval(mins => v_total_minutes), '[)'),
    'confirmed',
    p_source,
    nullif(p_note, '')
  )
  returning id into v_reservation_id;

  insert into reservation_menus (reservation_id, menu_id, menu_name, price, duration_minutes)
  select v_reservation_id, m.id, m.name, m.price, m.duration_minutes
  from menus m
  where m.id = any (v_distinct_ids);

  return v_reservation_id;
end;
$$;

comment on function public._insert_booking is '内部関数。メニュー検証+予約INSERT+スナップショットINSERT(23P01は伝搬)';

-- ---------------------------------------------------------------------------
-- 代行登録RPC(電話予約: ADR-005)
-- p_customer_id があれば既存顧客、なければ名前(必須)+電話で新規作成
-- (line_user_id は NULL = 電話客)。EXCLUDE制約違反(23P01)はそのまま伝搬。
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

comment on function public.admin_create_reservation is '店側の代行登録(電話予約)。既存顧客ID or 新規顧客情報を受け、source=admin で予約を作る';

-- ---------------------------------------------------------------------------
-- 店側変更RPC
-- 客側の change_reservation(旧キャンセル+新規作成)と違いUPDATE方式:
-- EXCLUDE制約は更新後の値を他の行とだけ照合するため自己衝突せず、
-- 予約IDが保たれる(将来のリマインド送信ログとの対応も切れない)。
-- 23P01時はトランザクション全体がロールバックし、元の予約は無傷で残る。
-- 店側の操作なのでキャンセル締切(cancel_deadline_minutes)は適用しない。
-- 戻り値: 'ok' / 'not_found'(対象が booking かつ confirmed でない)
-- ---------------------------------------------------------------------------
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

comment on function public.admin_update_reservation is '店側の予約変更(UPDATE方式・自己非衝突)。メニュー合計から during を再計算しスナップショットを差し替える';

-- ---------------------------------------------------------------------------
-- 権限
-- 内部関数と_insert_booking(作り直しでrevokeが消えている)は全ロール実行不可、
-- 店側RPCは authenticated のみ実行可
-- ---------------------------------------------------------------------------
revoke execute on function public._validate_menus from public, anon, authenticated;
revoke execute on function public._insert_booking from public, anon, authenticated;
revoke execute on function public.admin_create_reservation from public, anon;
revoke execute on function public.admin_update_reservation from public, anon;
grant execute on function public.admin_create_reservation to authenticated;
grant execute on function public.admin_update_reservation to authenticated;
