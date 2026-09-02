import "server-only";

// 設定系画面(/admin/settings/*)のデータ取得(配線に徹する)。
// 原則: authenticated クライアント(RLS適用)で読む。service_role は使わない
// (docs/milestone-4b-plan.md「サーバー・UI」)。
// 設定系テーブルのSELECTは全スタッフに許可されているので普通に引ける
// (変更だけがオーナー限定: ADR-005)。

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  fillWeeklyBusinessHours,
  type NthWeekdayClosureRow,
  type WeeklyBusinessHoursRow,
} from "@/lib/business-settings";

/** PostgRESTの結果からデータを取り出す。エラーは例外にする(サーバー側の障害) */
function must<T>(
  result: { data: T | null; error: { message: string } | null },
  subject: string,
): T {
  if (result.error !== null || result.data === null) {
    throw new Error(
      `${subject}の取得に失敗しました: ${result.error?.message ?? "データがありません"}`,
    );
  }
  return result.data;
}

/** date_overrides の1行(画面が扱う形。時刻は "HH:MM:SS" のまま持つ) */
export type DateOverrideRecord = {
  id: string;
  startDate: string;
  endDate: string;
  isOpen: boolean;
  label: string | null;
  openTime: string | null;
  closeTime: string | null;
};

/** 営業日・営業時間の設定画面(モックE-2)が必要とする設定一式 */
export type BusinessSettings = {
  /** 日曜〜土曜の7件(行が無い曜日は休業で補う) */
  businessHours: WeeklyBusinessHoursRow[];
  nthWeekdayClosures: NthWeekdayClosureRow[];
  closeOnHolidays: boolean;
  /** 開始日順。重なりの事前チェックにも使うので期間で絞らず全件持つ */
  dateOverrides: DateOverrideRecord[];
};

type BusinessHoursRow = {
  weekday: number;
  is_open: boolean;
  open_time: string | null; // time型は "HH:MM:SS"
  close_time: string | null;
};

type DateOverrideRow = {
  id: string;
  start_date: string; // date型は "YYYY-MM-DD"
  end_date: string;
  is_open: boolean;
  label: string | null;
  open_time: string | null;
  close_time: string | null;
};

function toDateOverrideRecord(row: DateOverrideRow): DateOverrideRecord {
  return {
    id: row.id,
    startDate: row.start_date,
    endDate: row.end_date,
    isOpen: row.is_open,
    label: row.label,
    openTime: row.open_time,
    closeTime: row.close_time,
  };
}

/** 臨時休業・臨時営業を全件(開始日順)取得する。重なりの事前チェックにも使う */
export async function fetchDateOverrides(
  supabase: SupabaseClient,
): Promise<DateOverrideRecord[]> {
  const result = await supabase
    .from("date_overrides")
    .select("id, start_date, end_date, is_open, label, open_time, close_time")
    .order("start_date");
  const rows: DateOverrideRow[] = must(result, "臨時休業・臨時営業");
  return rows.map(toDateOverrideRecord);
}

/** 営業日・営業時間の設定画面の初期表示に必要な設定をまとめて取得する */
export async function fetchBusinessSettings(
  supabase: SupabaseClient,
): Promise<BusinessSettings> {
  const [hoursRes, settingsRes, nthRes, overrides] = await Promise.all([
    supabase
      .from("business_hours")
      .select("weekday, is_open, open_time, close_time")
      .order("weekday"),
    supabase.from("salon_settings").select("close_on_holidays").single(),
    supabase.from("nth_weekday_closures").select("weekday, nth"),
    fetchDateOverrides(supabase),
  ]);

  const hours: BusinessHoursRow[] = must(hoursRes, "営業時間");
  const settings = must(settingsRes, "店舗設定") as {
    close_on_holidays: boolean;
  };
  const nthClosures: NthWeekdayClosureRow[] = must(nthRes, "第◯曜日の定休");

  return {
    // 行が無い曜日を休業で補うのは純粋関数側の判断(closures.ts の判定と揃える)
    businessHours: fillWeeklyBusinessHours(
      hours.map((row) => ({
        weekday: row.weekday,
        isOpen: row.is_open,
        openTime: row.open_time,
        closeTime: row.close_time,
      })),
    ),
    nthWeekdayClosures: nthClosures,
    closeOnHolidays: settings.close_on_holidays,
    dateOverrides: overrides,
  };
}
