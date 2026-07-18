// 代行登録(電話予約用・モックD)= 店側が電話で受けた予約を登録する画面。
// サーバーコンポーネント: authenticated クライアント(RLS適用)でスタッフ・
// メニューを取得し、配線に徹してクライアントフォームへ渡す。認証は保護レイアウトが担う。

import { jstCalendarDate } from "@/lib/availability";
import { createAdminAuthClient } from "@/server/admin-auth";
import { fetchActiveMenus, fetchAdminStaff } from "@/server/admin-data";

import { ProxyRegistrationForm } from "./_components/proxy-registration-form";

export default async function ProxyRegistrationPage() {
  const supabase = await createAdminAuthClient();
  const [staff, menus] = await Promise.all([
    fetchAdminStaff(supabase),
    fetchActiveMenus(supabase),
  ]);

  return (
    <ProxyRegistrationForm
      staff={staff}
      menus={menus}
      defaultDate={jstCalendarDate(new Date())}
    />
  );
}
