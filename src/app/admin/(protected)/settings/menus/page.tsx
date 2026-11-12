// メニュー管理(モックF・F詳細)。
// サーバーコンポーネント: authenticated クライアント(RLS適用)でカテゴリと
// メニューを取得し、カテゴリ別のグルーピングは純粋関数(menu-settings.ts)に
// 任せ、結果をクライアントフォームへ渡す配線に徹する。
// オーナー限定の確認は settings/layout.tsx が担う(ADR-005)。

import {
  buildMenuAdminGroups,
  countMenusByCategory,
} from "@/lib/menu-settings";
import {
  canUseAdminInRender,
  createAdminAuthClient,
} from "@/server/admin-auth";
import { fetchMenuSettings } from "@/server/settings-data";

import { MenuSettingsForm } from "./_components/menu-settings-form";

export default async function MenuSettingsPage() {
  // 管理画面を使えないユーザー(未紐付け・無効にされたスタッフ)には保護レイアウトが
  // 案内だけを出す。そのときもページは実行されるので、何も取得せずに終える
  if (!(await canUseAdminInRender())) return null;

  const supabase = await createAdminAuthClient();
  const settings = await fetchMenuSettings(supabase);

  return (
    <MenuSettingsForm
      groups={buildMenuAdminGroups(settings.categories, settings.menus)}
      // カテゴリ削除の可否はダイアログでも先に判定するので件数を渡す
      // (非表示のメニューも参照が残るため数に入る)
      menuCounts={countMenusByCategory(settings.menus)}
    />
  );
}
