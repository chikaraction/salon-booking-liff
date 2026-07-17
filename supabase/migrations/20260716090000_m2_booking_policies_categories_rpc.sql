-- Milestone 2: 予約ポリシー列 + メニューカテゴリの実体化 + 予約作成RPC
-- (docs/milestone-2-plan.md)

-- ---------------------------------------------------------------------------
-- 予約ポリシー(店舗固有の運用値なのでコードに書かずDBへ: ADR-007)
-- 管理画面からの編集はM4
-- ---------------------------------------------------------------------------
alter table public.salon_settings
  add column slot_interval_minutes integer not null default 30
    check (slot_interval_minutes > 0),
  add column booking_window_days integer not null default 30
    check (booking_window_days > 0),
  add column min_lead_minutes integer not null default 60
    check (min_lead_minutes >= 0);

comment on column public.salon_settings.slot_interval_minutes is '空き枠の開始時刻の刻み(分)';
comment on column public.salon_settings.booking_window_days is '何日先まで予約を受け付けるか';
comment on column public.salon_settings.min_lead_minutes is '開始何分前まで予約できるか(直前締切)';

-- ---------------------------------------------------------------------------
-- メニューカテゴリの実体化
-- 客側画面のカテゴリ説明文と、店側カテゴリ編集ダイアログ(M4)の両方が
-- 「カテゴリ=並べ替え可能な実体」を前提とするため、テキスト列から昇格する
-- ---------------------------------------------------------------------------
create table public.menu_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  display_order integer not null default 0,
  created_at timestamptz not null default now()
);

comment on table public.menu_categories is 'メニューカテゴリ(名前は自由入力: ADR-007)。説明文は客側のグループ見出し下に表示';

alter table public.menus
  add column category_id uuid references public.menu_categories (id);

-- 既存データの移行: カテゴリ名ごとに1行作り、表示順はメニューの最小表示順を引き継ぐ
insert into public.menu_categories (name, display_order)
select category, min(display_order)
from public.menus
group by category;

update public.menus m
set category_id = c.id
from public.menu_categories c
where c.name = m.category;

alter table public.menus
  alter column category_id set not null;

alter table public.menus
  drop column category;

alter table public.menu_categories enable row level security;

create policy "店側スタッフは全操作可" on public.menu_categories
  for all to authenticated using (true) with check (true);

-- ---------------------------------------------------------------------------
-- 予約作成RPC
-- supabase-js は複数文のトランザクションを張れないため、
-- 「顧客の作成/特定 → 予約INSERT → メニュースナップショットINSERT」を
-- 1関数にまとめてアトミックにする。
-- 予約の時間範囲はメニューの所要時間合計からサーバー(DB)側で導出し、
-- クライアント申告の終了時刻を信用しない。
-- EXCLUDE制約違反(23P01)はそのまま呼び出し元へ伝搬させ、
-- Server Action が「その枠は埋まりました」に変換する(ADR-004)。
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
  v_reservation_id uuid;
  v_total_minutes integer;
  v_distinct_ids uuid[];
begin
  if p_line_user_id is null or p_line_user_id = '' then
    raise exception 'line_user_id is required' using errcode = 'P0001';
  end if;

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

  insert into reservations (kind, customer_id, staff_id, during, status, source, note)
  values (
    'booking',
    v_customer_id,
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

comment on function public.create_reservation is '客側(LIFF)の予約作成。Server Action が LINE IDトークン検証後に service_role で呼ぶ(ADR-003)';

-- 呼び出しは service_role のみ(客の操作はサーバー経由: ADR-003)
revoke execute on function public.create_reservation from public, anon, authenticated;
