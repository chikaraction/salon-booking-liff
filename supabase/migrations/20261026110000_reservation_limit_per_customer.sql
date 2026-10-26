-- 客側の予約に「1人あたりの、これからの予約」の上限を設ける(濫用対策)
--
-- LINEアカウントがあれば誰でも予約を作れるため、上限が無いと1人で空き枠を
-- 埋められ、前日リマインドで LINE プッシュの無料枠(ADR-002)も使い切られうる。
-- 上限は1人ごとにかかるので、攻撃者が全員分の枠を使い切る手段にはならない。
--
-- - 上限値は店ごとの運用値なので salon_settings に持つ(ADR-007)。初期値 3。
--   設定画面の項目はモックに無いため今回は作らない(変えるときはSQLで更新する)
-- - 判定するのは客側の新規予約(create_reservation)だけ。
--   店側の代行登録(admin_create_reservation)は電話客の受け皿なので上限をかけない。
--   客側の変更(change_reservation)は旧予約をキャンセルしてから作るので件数は増えない
-- - 数えるのは「確定済み・まだ始まっていない予約」(施術中・過去の予約は数えない)
-- - 同じ客の同時リクエストで上限をすり抜けないよう、顧客行をロックしてから数える
-- - 上限超過は独自の SQLSTATE 'R0001' で返す(Server Action が画面の文言に変換する)。
--   クラス R0 は PostgreSQL が使っていない

alter table public.salon_settings
  add column max_upcoming_reservations integer not null default 3
    constraint salon_settings_max_upcoming_reservations_check
      check (max_upcoming_reservations > 0);

comment on column public.salon_settings.max_upcoming_reservations is 'お客様1人あたり、これからの予約を同時に何件まで入れられるか(LINEからの予約のみ。店側の代行登録は対象外)';

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
  v_limit integer;
  v_upcoming integer;
begin
  if p_line_user_id is null or p_line_user_id = '' then
    raise exception 'line_user_id is required' using errcode = 'P0001';
  end if;

  -- 既存顧客なら行をロックする(同じ客の同時予約を直列にして、件数判定をすり抜けさせない)
  select id into v_customer_id
  from customers
  where line_user_id = p_line_user_id
  for update;

  if v_customer_id is null then
    if p_customer_name is null or p_customer_name = '' then
      raise exception 'customer_name is required for first booking' using errcode = 'P0001';
    end if;
    -- 初回同士の同時リクエストは line_user_id の一意制約で片方が失敗する
    insert into customers (line_user_id, name, phone)
    values (p_line_user_id, p_customer_name, p_customer_phone)
    returning id into v_customer_id;
  end if;

  select max_upcoming_reservations into v_limit from salon_settings;

  select count(*) into v_upcoming
  from reservations
  where customer_id = v_customer_id
    and kind = 'booking'
    and status = 'confirmed'
    and lower(during) > now();

  if v_limit is not null and v_upcoming >= v_limit then
    raise exception 'too many upcoming reservations (limit %)', v_limit
      using errcode = 'R0001';
  end if;

  return _insert_booking(v_customer_id, p_staff_id, p_start, p_menu_ids, p_note);
end;
$$;

-- 呼び出しは service_role のみ(客の操作はサーバー経由: ADR-003)。
-- create or replace は既存の権限を引き継ぐが、どこで作り直しても同じになるよう明示する
revoke execute on function public.create_reservation from public, anon, authenticated;
