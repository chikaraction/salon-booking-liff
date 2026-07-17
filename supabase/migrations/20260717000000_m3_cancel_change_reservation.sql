-- Milestone 3: キャンセル締切 + 客自身のキャンセル・変更RPC
-- (docs/milestone-3-plan.md)

-- ---------------------------------------------------------------------------
-- キャンセル締切(店舗固有の運用値なのでコードに書かずDBへ: ADR-007)
-- 管理画面からの編集はM4
-- ---------------------------------------------------------------------------
alter table public.salon_settings
  add column cancel_deadline_minutes integer not null default 60
    check (cancel_deadline_minutes >= 0);

comment on column public.salon_settings.cancel_deadline_minutes is '開始何分前まで客自身でキャンセル・変更できるか';

-- ---------------------------------------------------------------------------
-- 内部関数: 本人予約のキャンセル(cancel_reservation / change_reservation で共有)
--
-- 戻り値:
--   'ok'              キャンセルした
--   'not_found'       存在しない / 他人の予約 / block / キャンセル済み
--   'deadline_passed' 締切(開始 cancel_deadline_minutes 前)を過ぎている
--
-- 「他人の予約」を 'not_found' に畳むのは意図的(予約IDの存在を外部に漏らさない)。
-- 対象行は for update でロックし、同時のキャンセル・変更操作と競合しないようにする。
-- ---------------------------------------------------------------------------
create or replace function public._cancel_own_booking(
  p_line_user_id text,
  p_reservation_id uuid
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reservation record;
  v_deadline_minutes integer;
begin
  select r.id, r.status, lower(r.during) as start_at
    into v_reservation
  from reservations r
  join customers c on c.id = r.customer_id
  where r.id = p_reservation_id
    and r.kind = 'booking'
    and c.line_user_id = p_line_user_id
  for update of r;

  if v_reservation.id is null or v_reservation.status <> 'confirmed' then
    return 'not_found';
  end if;

  select cancel_deadline_minutes into v_deadline_minutes from salon_settings;

  if now() > v_reservation.start_at
              - make_interval(mins => coalesce(v_deadline_minutes, 0)) then
    return 'deadline_passed';
  end if;

  update reservations
  set status = 'cancelled', cancelled_at = now()
  where id = p_reservation_id;

  return 'ok';
end;
$$;

comment on function public._cancel_own_booking is '内部関数。本人所有の確定予約を検証してキャンセルする(締切の最終判定はここ)';

-- ---------------------------------------------------------------------------
-- 内部関数: 予約+メニュースナップショットのINSERT
-- (create_reservation / change_reservation で共有。M2のcreate_reservation本体を抽出)
-- 時間範囲はメニュー所要時間の合計から導出し、クライアント申告を信用しない。
-- EXCLUDE制約違反(23P01)はそのまま呼び出し元へ伝搬させる(ADR-004)。
-- ---------------------------------------------------------------------------
create or replace function public._insert_booking(
  p_customer_id uuid,
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
  v_reservation_id uuid;
  v_total_minutes integer;
  v_distinct_ids uuid[];
begin
  select array_agg(distinct id) into v_distinct_ids
  from unnest(p_menu_ids) as id;

  if v_distinct_ids is null then
    raise exception 'menu_ids is required' using errcode = 'P0001';
  end if;

  select sum(duration_minutes) into v_total_minutes
  from menus
  where id = any (v_distinct_ids) and is_active;

  -- 存在しない・無効化済みメニューが混ざっていたら拒否
  if v_total_minutes is null
     or (select count(*) from menus where id = any (v_distinct_ids) and is_active)
        <> cardinality(v_distinct_ids) then
    raise exception 'invalid menu_ids' using errcode = 'P0001';
  end if;

  insert into reservations (kind, customer_id, staff_id, during, status, source, note)
  values (
    'booking',
    p_customer_id,
    p_staff_id,
    tstzrange(p_start, p_start + make_interval(mins => v_total_minutes), '[)'),
    'confirmed',
    'line',
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
-- create_reservation を内部関数の組み合わせで再定義(挙動はM2と同じ)
-- ---------------------------------------------------------------------------
create or replace function public.create_reservation(
  p_line_user_id text,
  p_customer_name text, -- 既存顧客なら null 可(初回は必須)
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
  if p_line_user_id is null or p_line_user_id = '' then
    raise exception 'line_user_id is required' using errcode = 'P0001';
  end if;

  select id into v_customer_id
  from customers
  where line_user_id = p_line_user_id;

  if v_customer_id is null then
    if p_customer_name is null or p_customer_name = '' then
      raise exception 'customer_name is required for first booking' using errcode = 'P0001';
    end if;
    insert into customers (line_user_id, name, phone)
    values (p_line_user_id, p_customer_name, p_customer_phone)
    returning id into v_customer_id;
  end if;

  return _insert_booking(v_customer_id, p_staff_id, p_start, p_menu_ids, p_note);
end;
$$;

-- ---------------------------------------------------------------------------
-- キャンセルRPC
-- Server Action が LINE IDトークン検証後に service_role で呼ぶ(ADR-003)。
-- 戻り値は _cancel_own_booking と同じ 'ok' / 'not_found' / 'deadline_passed'。
-- ---------------------------------------------------------------------------
create or replace function public.cancel_reservation(
  p_line_user_id text,
  p_reservation_id uuid
) returns text
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_line_user_id is null or p_line_user_id = '' then
    raise exception 'line_user_id is required' using errcode = 'P0001';
  end if;

  return _cancel_own_booking(p_line_user_id, p_reservation_id);
end;
$$;

comment on function public.cancel_reservation is '客側(LIFF)のキャンセル。本人所有・確定・締切前を検証して cancelled にする';

-- ---------------------------------------------------------------------------
-- 変更RPC: 旧予約キャンセル + 新規作成を1トランザクションで
--
-- 旧を先にキャンセルするため、同じスタッフの近接時間へずらす変更でも
-- EXCLUDE制約と自己衝突しない。新予約が制約違反(23P01)になった場合は
-- 例外が伝搬してトランザクション全体がロールバックし、旧予約は無傷で残る。
--
-- 戻り値(jsonb):
--   {"result": "ok", "reservation_id": "<新予約ID>"}
--   {"result": "not_found"} / {"result": "deadline_passed"}
-- ---------------------------------------------------------------------------
create or replace function public.change_reservation(
  p_line_user_id text,
  p_reservation_id uuid,
  p_staff_id uuid,
  p_start timestamptz,
  p_menu_ids uuid[],
  p_note text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cancel_result text;
  v_customer_id uuid;
  v_new_id uuid;
begin
  if p_line_user_id is null or p_line_user_id = '' then
    raise exception 'line_user_id is required' using errcode = 'P0001';
  end if;

  v_cancel_result := _cancel_own_booking(p_line_user_id, p_reservation_id);
  if v_cancel_result <> 'ok' then
    return jsonb_build_object('result', v_cancel_result);
  end if;

  select customer_id into v_customer_id
  from reservations
  where id = p_reservation_id;

  v_new_id := _insert_booking(v_customer_id, p_staff_id, p_start, p_menu_ids, p_note);

  return jsonb_build_object('result', 'ok', 'reservation_id', v_new_id);
end;
$$;

comment on function public.change_reservation is '客側(LIFF)の予約変更。旧キャンセル+新規作成をアトミックに行い、23P01時は全体をロールバック';

-- 呼び出しは service_role のみ(客の操作はサーバー経由: ADR-003)
revoke execute on function public._cancel_own_booking from public, anon, authenticated;
revoke execute on function public._insert_booking from public, anon, authenticated;
revoke execute on function public.cancel_reservation from public, anon, authenticated;
revoke execute on function public.change_reservation from public, anon, authenticated;
