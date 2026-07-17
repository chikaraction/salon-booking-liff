-- 開発用ダミーデータ(supabase db reset 時にローカルDBへ投入される)
-- 本番の店舗固有値は管理画面から設定する(ADR-007)。このファイルは開発専用。

insert into public.salon_settings (name) values ('サンプルサロン');

-- 営業時間: 月曜定休、それ以外 9:00-18:00
insert into public.business_hours (weekday, is_open, open_time, close_time) values
  (0, true, '09:00', '18:00'),
  (1, false, null, null),
  (2, true, '09:00', '18:00'),
  (3, true, '09:00', '18:00'),
  (4, true, '09:00', '18:00'),
  (5, true, '09:00', '18:00'),
  (6, true, '09:00', '18:00');

insert into public.staff (id, name, role, bio, display_order) values
  ('11111111-1111-1111-1111-111111111111', 'オーナー', 'owner', 'カット歴20年。お任せください', 1),
  ('22222222-2222-2222-2222-222222222222', 'スタッフA', 'staff', 'カラーが得意です', 2);

-- 勤務: オーナーは営業日フル、スタッフAは水〜土(休憩 12:00-13:00)
insert into public.staff_working_hours (staff_id, weekday, start_time, end_time, break_start, break_end) values
  ('11111111-1111-1111-1111-111111111111', 0, '09:00', '18:00', '12:00', '13:00'),
  ('11111111-1111-1111-1111-111111111111', 2, '09:00', '18:00', '12:00', '13:00'),
  ('11111111-1111-1111-1111-111111111111', 3, '09:00', '18:00', '12:00', '13:00'),
  ('11111111-1111-1111-1111-111111111111', 4, '09:00', '18:00', '12:00', '13:00'),
  ('11111111-1111-1111-1111-111111111111', 5, '09:00', '18:00', '12:00', '13:00'),
  ('11111111-1111-1111-1111-111111111111', 6, '09:00', '18:00', '12:00', '13:00'),
  ('22222222-2222-2222-2222-222222222222', 3, '10:00', '18:00', '13:00', '14:00'),
  ('22222222-2222-2222-2222-222222222222', 4, '10:00', '18:00', '13:00', '14:00'),
  ('22222222-2222-2222-2222-222222222222', 5, '10:00', '18:00', '13:00', '14:00'),
  ('22222222-2222-2222-2222-222222222222', 6, '10:00', '18:00', '13:00', '14:00');

insert into public.menu_categories (id, name, description, display_order) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'カット', 'シャンプー・ブロー込み(前髪カットは含まれません)', 1),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2', 'カラー', '前・後処理、頭皮保護込み', 2),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3', 'パーマ', null, 3),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4', 'トリートメント', null, 4);

insert into public.menus (name, category_id, price, duration_minutes, display_order) values
  ('カット', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 4400, 60, 1),
  ('前髪カット', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 1100, 15, 2),
  ('カラー', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2', 8800, 120, 3),
  ('パーマ', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3', 9900, 120, 4),
  ('トリートメント', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4', 3300, 30, 5);
