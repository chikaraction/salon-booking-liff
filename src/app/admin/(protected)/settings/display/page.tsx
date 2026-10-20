// 表示設定(モックF-2。テーマカラーのプリセット + フォント)。
// サーバーコンポーネント: authenticated クライアント(RLS適用)で保存済みの
// 表示設定を取得し、クライアントフォームへ渡す配線に徹する。
// 候補・検証・変更の有無の判定は純粋関数(display-settings.ts)。
// オーナー限定の確認は settings/layout.tsx が担う(ADR-005)。

import { createAdminAuthClient } from "@/server/admin-auth";
import { fetchDisplaySettings } from "@/server/settings-data";

import { DisplaySettingsForm } from "./_components/display-settings-form";

export default async function DisplaySettingsPage() {
  const supabase = await createAdminAuthClient();
  const settings = await fetchDisplaySettings(supabase);

  return <DisplaySettingsForm settings={settings} />;
}
