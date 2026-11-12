// 代行登録(電話予約用・モックD)= 店側が電話で受けた予約を登録する画面。
// サーバーコンポーネント: authenticated クライアント(RLS適用)でスタッフ・
// メニューを取得し、配線に徹してクライアントフォームへ渡す。認証は保護レイアウトが担う。

import { ProxyRegistrationForm } from "@/app/admin/(protected)/_components/proxy-registration-form";
import { jstCalendarDate } from "@/lib/jst";
import {
  canUseAdminInRender,
  createAdminAuthClient,
} from "@/server/admin-auth";
import { fetchActiveMenus, fetchAdminStaff } from "@/server/admin-data";

export default async function ProxyRegistrationPage() {
  // 管理画面を使えないユーザー(未紐付け・無効にされたスタッフ)には保護レイアウトが
  // 案内だけを出す。そのときもページは実行されるので、何も取得せずに終える
  if (!(await canUseAdminInRender())) return null;

  const supabase = await createAdminAuthClient();
  const [staff, menus] = await Promise.all([
    fetchAdminStaff(supabase),
    fetchActiveMenus(supabase),
  ]);

  const today = jstCalendarDate(new Date());

  return (
    <ProxyRegistrationForm
      staff={staff}
      menus={menus}
      defaultDate={today}
      // 登録をやめてカレンダーへ戻る導線(初期表示の日 = 今日)
      backHref={`/admin?date=${today}`}
    />
  );
}
