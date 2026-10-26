// スタッフ設定(モックE)。
// サーバーコンポーネント: authenticated クライアント(RLS適用)でスタッフ・
// 週次勤務パターン・今後の臨時休ブロックを取得し、7曜日への整形は純粋関数
// (staff-settings.ts)に任せ、結果をクライアントフォームへ渡す配線に徹する。
// オーナー限定の確認は settings/layout.tsx が担う(ADR-005)。

import { jstCalendarDate, jstClockTime } from "@/lib/jst";
import { fillStaffWorkingHours } from "@/lib/staff-settings";
import { createAdminAuthClient } from "@/server/admin-auth";
import {
  fetchStaffSettings,
  fetchUpcomingStaffBlocks,
} from "@/server/settings-data";

import { StaffSettingsForm } from "./_components/staff-settings-form";

/**
 * 臨時休の一覧に出す期間(今日から半年ぶん)。
 * 営業日設定の一覧(closureListWindow)と同じ考え方で、過ぎた臨時休は
 * 操作の意味がないので出さない。
 */
const BLOCK_LIST_DAYS = 180;

export default async function StaffSettingsPage() {
  const supabase = await createAdminAuthClient();
  const today = jstCalendarDate(new Date());

  const [settings, blocks] = await Promise.all([
    fetchStaffSettings(supabase),
    fetchUpcomingStaffBlocks(supabase, today, BLOCK_LIST_DAYS),
  ]);

  return (
    <StaffSettingsForm
      today={today}
      staff={settings.staff.map((staff) => ({
        id: staff.id,
        name: staff.name,
        role: staff.role,
        displayOrder: staff.displayOrder,
        isActive: staff.isActive,
        bio: staff.bio,
        hasAuthUser: staff.hasAuthUser,
        // 行が無い曜日を「休み」で補って7件に揃えるのは純粋関数側の判断
        // (枠計算の「その曜日の行が無いスタッフは休み」と解釈を揃える)
        workingDays: fillStaffWorkingHours(
          settings.workingHours.filter((row) => row.staffId === staff.id),
        ),
        // ブロックはUTCで持っているので、画面に出すJSTの暦日・壁時計時刻に直す
        blocks: blocks
          .filter((block) => block.staffId === staff.id)
          .map((block) => ({
            id: block.id,
            date: jstCalendarDate(block.start),
            startTime: jstClockTime(block.start),
            endTime: jstClockTime(block.end),
          })),
      }))}
    />
  );
}
