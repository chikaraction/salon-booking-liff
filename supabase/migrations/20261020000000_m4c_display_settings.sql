-- M4c: 表示設定(テーマカラーのプリセット・フォント)。docs/milestone-4c-plan.md
--
-- - 持つのは色そのものではなくプリセットID。色の定義は src/app/globals.css だけに
--   置く(ADR-006「デザイントークンは1ファイル」)。DBに色を持つのはカスタム色
--   (将来対応)を実装するとき
-- - 既定値は M4b までの見た目(テーマB モーヴ + LINE Seed JP)。既存の1行は
--   既定値で埋まるので、適用しても画面は変わらない
-- - 値の集合は src/lib/display-settings.ts の THEME_PRESETS / FONT_OPTIONS と一致させる
-- - RLS は M4b の salon_settings のポリシー(閲覧=店側スタッフ・変更=オーナー)が
--   そのまま効くため追加しない。客側(匿名)の画面は service_role で表示用の2列だけ読む

alter table public.salon_settings
  add column theme_preset text not null default 'mauve'
    constraint salon_settings_theme_preset_check
      check (theme_preset in ('sage', 'mauve', 'slate')),
  add column font_family text not null default 'line_seed_jp'
    constraint salon_settings_font_family_check
      check (font_family in ('noto_sans_jp', 'line_seed_jp'));

comment on column public.salon_settings.theme_preset is 'テーマカラーのプリセットID(sage / mauve / slate)。色の値は globals.css が持つ';
comment on column public.salon_settings.font_family is 'お客様画面・管理画面のフォント(noto_sans_jp / line_seed_jp)';
