// 営業日・営業時間の設定(モックE-2「定休日・祝日の設定」+ 曜日ごとの営業時間)。
// サーバーコンポーネント: authenticated クライアント(RLS適用)で設定を取得し、
// 一覧の組み立ては純粋関数(closures.ts / business-settings.ts)に任せ、
// 結果をクライアントフォームへ渡す配線に徹する。
// オーナー限定の確認は settings/layout.tsx が担う(ADR-005)。
//
// モックに無い「曜日ごとの営業時間」をこの画面に足しているのは、
// 店舗固有の営業時間をコードに書かない(ADR-007)ために編集口が要るため。
// 毎週の定休日チップと同じ business_hours の行を編集するので同じ節に置く。

import { jstCalendarDate } from "@/lib/availability";
import { closureListWindow, normalizeTimeInput } from "@/lib/business-settings";
import { buildClosureListItems, type ClosureRules } from "@/lib/closures";
import { createAdminAuthClient } from "@/server/admin-auth";
import { fetchBusinessSettings } from "@/server/settings-data";

import { BusinessSettingsForm } from "./_components/business-settings-form";

export default async function BusinessSettingsPage() {
  const supabase = await createAdminAuthClient();
  const settings = await fetchBusinessSettings(supabase);

  const today = jstCalendarDate(new Date());
  const window = closureListWindow({
    today,
    overrides: settings.dateOverrides,
  });

  // 一覧(祝日 + 登録データの混在リスト)は closures.ts の判定をそのまま使う。
  // 客側の枠計算・管理画面カレンダーと同じルールで表示するための共有
  const rules: ClosureRules = {
    businessHours: settings.businessHours.map((day) => ({
      weekday: day.weekday,
      isOpen: day.isOpen,
    })),
    nthWeekdayClosures: settings.nthWeekdayClosures,
    closeOnHolidays: settings.closeOnHolidays,
    overrides: settings.dateOverrides.map((override) => ({
      // 一覧の行から削除対象をたどるため、出どころのIDを載せて渡す
      id: override.id,
      startDate: override.startDate,
      endDate: override.endDate,
      isOpen: override.isOpen,
      label: override.label,
      openTime: override.openTime,
      closeTime: override.closeTime,
    })),
  };

  // 祝日行は自動導出の読み取り専用なので overrideId が null になり、
  // 登録データの行にだけ削除の導線が出る
  const closureItems = buildClosureListItems({
    from: window.from,
    days: window.days,
    rules,
  });

  return (
    <BusinessSettingsForm
      today={today}
      businessHours={settings.businessHours.map((day) => ({
        weekday: day.weekday,
        isOpen: day.isOpen,
        // input[type=time] が扱う "HH:MM" に正規化する(DBは "HH:MM:SS")
        openTime: normalizeTimeInput(day.openTime),
        closeTime: normalizeTimeInput(day.closeTime),
      }))}
      nthWeekdayClosures={settings.nthWeekdayClosures}
      closeOnHolidays={settings.closeOnHolidays}
      closureItems={closureItems}
    />
  );
}
