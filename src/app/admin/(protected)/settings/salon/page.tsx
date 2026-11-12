// 店舗・予約設定(モックなし。店名 + 予約の受付ルール + 前日リマインドの送信時刻)。
// サーバーコンポーネント: authenticated クライアント(RLS適用)で
// salon_settings の1行を取得し、クライアントフォームへ渡す配線に徹する。
// 検証・補足文の組み立ては純粋関数(salon-settings.ts)。
// オーナー限定の確認は settings/layout.tsx が担う(ADR-005)。
//
// 既定値は画面から埋めない。DBのdefault(マイグレーションで定義)が正で、
// この画面は現在値を出して編集するだけにする(ADR-007)。

import {
  canUseAdminInRender,
  createAdminAuthClient,
} from "@/server/admin-auth";
import { fetchSalonSettings } from "@/server/settings-data";

import { SalonSettingsForm } from "./_components/salon-settings-form";

export default async function SalonSettingsPage() {
  // 管理画面を使えないユーザー(未紐付け・無効にされたスタッフ)には保護レイアウトが
  // 案内だけを出す。そのときもページは実行されるので、何も取得せずに終える
  if (!(await canUseAdminInRender())) return null;

  const supabase = await createAdminAuthClient();
  const settings = await fetchSalonSettings(supabase);

  return (
    <SalonSettingsForm
      name={settings.name}
      // 数値の入力欄は文字列で扱う(検証は文字列からの変換込みで純粋関数が行う)
      policy={{
        slotIntervalMinutes: String(settings.slotIntervalMinutes),
        bookingWindowDays: String(settings.bookingWindowDays),
        minLeadMinutes: String(settings.minLeadMinutes),
        cancelDeadlineMinutes: String(settings.cancelDeadlineMinutes),
        reminderHour: String(settings.reminderHour),
      }}
    />
  );
}
