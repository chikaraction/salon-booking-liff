-- 初期スキーマ(docs/milestone-1-plan.md のデータモデル)
--
-- 設計の要点:
-- - ADR-004: ダブルブッキング防止の本体は reservations の EXCLUDE 制約。
--   アプリ側の空きチェックはUX向上のための補助にすぎない
-- - ADR-007: 店舗IDは持たない(1デプロイ=1店舗)。店名・メニュー・営業時間は
--   すべてデータとして持ち、管理画面から設定する
-- - ADR-003/005: Supabase Auth を使うのは店側スタッフのみ。客(LIFF)の操作は
--   サーバー側で LINE IDトークンを検証したうえで service_role で実行する

-- EXCLUDE制約(uuid の = と tstzrange の && の複合)に必要
create extension if not exists btree_gist;

-- ---------------------------------------------------------------------------
-- 店舗設定(単一行)
-- ---------------------------------------------------------------------------
create table public.salon_settings (
  id boolean primary key default true,
  name text not null,
  created_at timestamptz not null default now(),
  -- id は常に true = 1行しか存在できない
  constraint salon_settings_singleton check (id)
);

comment on table public.salon_settings is '店舗設定(単一行)。店名などコードに書かない店舗固有値を置く(ADR-007)';

-- ---------------------------------------------------------------------------
-- 営業時間(店全体・曜日ごと)
-- ---------------------------------------------------------------------------
create table public.business_hours (
  -- 0=日曜 〜 6=土曜(JavaScriptのDate#getDayと同じ)
  weekday smallint primary key check (weekday between 0 and 6),
  is_open boolean not null default true,
  open_time time,
  close_time time,
  constraint business_hours_times_required
    check (not is_open or (open_time is not null and close_time is not null and open_time < close_time))
);

comment on table public.business_hours is '店の営業時間(曜日ごと)。時刻は店舗ローカル(JST)の壁時計時刻';

-- ---------------------------------------------------------------------------
-- スタッフ(施術者 兼 管理画面ユーザー)
-- ---------------------------------------------------------------------------
create table public.staff (
  id uuid primary key default gen_random_uuid(),
  -- 管理画面ログイン用。招待制のため作成時はNULL可(ADR-005)
  auth_user_id uuid unique references auth.users (id) on delete set null,
  name text not null,
  role text not null default 'staff' check (role in ('owner', 'staff')),
  photo_url text,
  bio text,
  display_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

comment on table public.staff is 'スタッフ。予約の指名対象であり、管理画面のユーザーでもある(role: owner/staff)';

-- ---------------------------------------------------------------------------
-- スタッフの週次勤務パターン(勤務時間・休憩)
-- 臨時休などの単発の予約不可時間は reservations(kind=block)で表す
-- ---------------------------------------------------------------------------
create table public.staff_working_hours (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.staff (id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6),
  start_time time not null,
  end_time time not null,
  break_start time,
  break_end time,
  constraint staff_working_hours_unique unique (staff_id, weekday),
  constraint staff_working_hours_valid_range check (start_time < end_time),
  constraint staff_working_hours_break_pair check ((break_start is null) = (break_end is null)),
  constraint staff_working_hours_break_within
    check (
      break_start is null
      or (start_time <= break_start and break_start < break_end and break_end <= end_time)
    )
);

comment on table public.staff_working_hours is 'スタッフの週次勤務パターン。空き枠計算(src/lib/)がアプリ側で参照するルール';

-- ---------------------------------------------------------------------------
-- メニュー
-- ---------------------------------------------------------------------------
create table public.menus (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  -- カテゴリは自由入力(ADR-007: 業種が変わっても同じ仕組みで表現できる)
  category text not null,
  price integer not null check (price >= 0),
  duration_minutes integer not null check (duration_minutes > 0),
  display_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

comment on table public.menus is 'メニュー(施術内容・料金・所要時間)。管理画面から編集する';

-- ---------------------------------------------------------------------------
-- 顧客
-- ---------------------------------------------------------------------------
create table public.customers (
  id uuid primary key default gen_random_uuid(),
  -- LINE経由の客の識別子(ADR-003)。電話予約の代行登録客はNULL
  line_user_id text unique,
  name text not null,
  phone text,
  note text,
  created_at timestamptz not null default now()
);

comment on table public.customers is '顧客。LINE客は line_user_id で識別、電話客はNULL(将来のマージ機能はADR-003参照)';

-- ---------------------------------------------------------------------------
-- 予約 + 予約不可ブロック
-- ---------------------------------------------------------------------------
create table public.reservations (
  id uuid primary key default gen_random_uuid(),
  -- booking=客の予約 / block=臨時休などの予約不可時間(ADR-004)
  kind text not null default 'booking' check (kind in ('booking', 'block')),
  customer_id uuid references public.customers (id),
  staff_id uuid not null references public.staff (id),
  -- 予約の時間範囲。[開始, 終了) の半開区間に正規化して保存する
  during tstzrange not null
    check (not isempty(during) and lower_inc(during) and not upper_inc(during)),
  status text not null default 'confirmed' check (status in ('confirmed', 'cancelled')),
  -- line=客がLIFFから / admin=店側の代行登録・ブロック
  source text not null default 'line' check (source in ('line', 'admin')),
  note text,
  created_at timestamptz not null default now(),
  cancelled_at timestamptz,
  constraint reservations_booking_requires_customer
    check (kind = 'block' or customer_id is not null),
  constraint reservations_cancelled_has_timestamp
    check (status <> 'cancelled' or cancelled_at is not null),
  -- ADR-004: ダブルブッキング防止の本体。同一スタッフの時間範囲重複をDBが拒否する。
  -- キャンセル済みは判定から除外。kind=block も confirmed なら判定に含まれるため、
  -- 予約とブロックの重複も構造的に発生しない。
  -- この制約を外す・迂回する変更は禁止(CLAUDE.md)
  constraint reservations_no_overlap exclude using gist (
    staff_id with =,
    during with &&
  ) where (status = 'confirmed')
);

comment on table public.reservations is '予約(kind=booking)と予約不可ブロック(kind=block)。重複防止はEXCLUDE制約(ADR-004)';

create index reservations_customer_id_idx on public.reservations (customer_id);
create index reservations_staff_id_idx on public.reservations (staff_id);
-- カレンダーの日別表示用(開始時刻での絞り込み)
create index reservations_lower_during_idx on public.reservations (lower(during));

-- ---------------------------------------------------------------------------
-- 予約⇔メニュー(複数選択可)
-- ---------------------------------------------------------------------------
create table public.reservation_menus (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null references public.reservations (id) on delete cascade,
  -- 元メニューが削除されても予約履歴は残す
  menu_id uuid references public.menus (id) on delete set null,
  -- 予約時点のスナップショット(料金改定・メニュー削除が過去の予約表示を壊さないため)
  menu_name text not null,
  price integer not null check (price >= 0),
  duration_minutes integer not null check (duration_minutes > 0)
);

comment on table public.reservation_menus is '予約に含まれるメニュー。名前・料金・所要時間は予約時点のスナップショット';

create index reservation_menus_reservation_id_idx on public.reservation_menus (reservation_id);

-- ---------------------------------------------------------------------------
-- LINEプッシュ送信ログ(無料枠200通/月の可視化用: ADR-002)
-- ---------------------------------------------------------------------------
create table public.push_messages (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid references public.reservations (id) on delete set null,
  type text not null check (type in ('reminder', 'other')),
  sent_at timestamptz not null default now()
);

comment on table public.push_messages is 'LINEプッシュ送信ログ。月間送信数を集計し、150通超で管理画面に警告を出す(ADR-002)';

create index push_messages_sent_at_idx on public.push_messages (sent_at);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- 方針(ADR-003/005):
-- - anon キーでは一切アクセスできない(ポリシーを作らない = 全拒否)
-- - authenticated = 店側スタッフ(招待制)。管理画面の操作に必要な全操作を許可
-- - 客(LIFF)の操作はサーバー側で LINE IDトークンを検証し service_role で実行
--   (service_role はRLSをバイパスする)
-- - オーナー/スタッフの権限差(メニュー編集等)は当面アプリ層で制御し、
--   必要になったらRLSで厳格化する
-- ---------------------------------------------------------------------------
alter table public.salon_settings enable row level security;
alter table public.business_hours enable row level security;
alter table public.staff enable row level security;
alter table public.staff_working_hours enable row level security;
alter table public.menus enable row level security;
alter table public.customers enable row level security;
alter table public.reservations enable row level security;
alter table public.reservation_menus enable row level security;
alter table public.push_messages enable row level security;

create policy "店側スタッフは全操作可" on public.salon_settings
  for all to authenticated using (true) with check (true);
create policy "店側スタッフは全操作可" on public.business_hours
  for all to authenticated using (true) with check (true);
create policy "店側スタッフは全操作可" on public.staff
  for all to authenticated using (true) with check (true);
create policy "店側スタッフは全操作可" on public.staff_working_hours
  for all to authenticated using (true) with check (true);
create policy "店側スタッフは全操作可" on public.menus
  for all to authenticated using (true) with check (true);
create policy "店側スタッフは全操作可" on public.customers
  for all to authenticated using (true) with check (true);
create policy "店側スタッフは全操作可" on public.reservations
  for all to authenticated using (true) with check (true);
create policy "店側スタッフは全操作可" on public.reservation_menus
  for all to authenticated using (true) with check (true);
create policy "店側スタッフは全操作可" on public.push_messages
  for all to authenticated using (true) with check (true);
