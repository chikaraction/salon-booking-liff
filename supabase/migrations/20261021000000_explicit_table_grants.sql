-- publicスキーマの全テーブルに、Data API用の権限を明示的に付ける
--
-- Supabaseは 2026-10-30 から、既存プロジェクトでも public に新しく作るテーブルへ
-- Data API の権限(anon / authenticated / service_role)を自動では付けなくなる。
-- 今あるテーブルは自動で付いた権限が残るので、本番DBでの動作は変わらない。
-- ただし新規プロジェクト・プレビューブランチ・db reset などマイグレーションから
-- 作り直したDBでは権限が無いままになり、アプリから「permission denied」になる。
-- そのため、どこで作り直しても同じ権限になるようマイグレーションに書いておく。
--
-- ロールごとの方針(src/server/ の実際の使い方に合わせる):
-- - service_role: 客側(LIFF)のDBアクセス(src/server/supabase.ts)。RLSをバイパスする
-- - authenticated: 店側の管理画面(src/server/admin-auth.ts)。誰が何をできるかは
--   既存のRLSポリシー(閲覧=店側スタッフ・変更=オーナー、M4b)が決める
-- - anon: テーブルを直接読む処理は無く、anon向けのRLSポリシーも無いので付けない
--
-- これ以降に public へテーブルを追加するときは、作るのと同じマイグレーションで
-- 同じ形の grant を書くこと(.claude/skills/milestone/SKILL.md)。
-- 本番DBの anon に自動で付いた権限は外さない(RLSで何も読めないため実害が無い)。

grant select, insert, update, delete on table
  public.salon_settings,
  public.business_hours,
  public.staff,
  public.staff_working_hours,
  public.menu_categories,
  public.menus,
  public.customers,
  public.reservations,
  public.reservation_menus,
  public.push_messages,
  public.nth_weekday_closures,
  public.date_overrides
to authenticated, service_role;
