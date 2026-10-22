-- M5: LINE通知(前日リマインドの送信時刻・1予約1通)。docs/milestone-5-plan.md
--
-- - リマインドの送信時刻は店ごとに変わりうるので salon_settings に持つ(ADR-007)。
--   Cron は毎時動き、送るかどうかは src/lib/reminders.ts が決める。既定は18時
-- - 前日リマインドは1予約1通(ADR-002)。二重送信の記録を一意インデックスで拒否する。
--   LINE 側でも予約IDをリトライキーにして二重送信を防ぐ(src/server/reminders.ts)
-- - 新しいテーブルは作らない。push_messages・salon_settings の grant と RLS は既存
--   (20261021000000_explicit_table_grants.sql)のまま。リマインドの記録は service_role

alter table public.salon_settings
  add column reminder_hour smallint not null default 18
    constraint salon_settings_reminder_hour_check
      check (reminder_hour between 0 and 23);

comment on column public.salon_settings.reminder_hour is '前日リマインドの送信時刻(JSTの時。0〜23)。この時刻以降、毎時のCronで未送信分を送る';

-- reservation_id が null の行(予約が削除された記録)は重複とみなされないので影響しない
create unique index push_messages_one_reminder_per_reservation
  on public.push_messages (reservation_id)
  where type = 'reminder';
