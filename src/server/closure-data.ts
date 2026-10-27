import "server-only";

// 営業時間と休業日ルールのデータ取得(配線に徹する)。
// business_hours / nth_weekday_closures / salon_settings.close_on_holidays /
// date_overrides の取得・DBの行の型・src/lib/ の純粋関数が受け取る型への
// 詰め替えは、すべてここに置く(判断は closures.ts などの純粋関数が行う)。
//
// クライアントは引数で受け取り、このモジュール自身は選ばない。
// 客側(booking-data.ts)は service_role、管理画面(admin-data.ts・
// settings-data.ts・各Server Action)は authenticated(RLS適用)で呼ぶため。

import type { BusinessDay } from "@/lib/availability";
import type { ClosureRules } from "@/lib/closures";
import { must } from "@/server/postgrest";
import type { DbClient } from "@/types/database";

// ---------------------------------------------------------------------------
// DBの行の型(supabase/migrations/ のスキーマに対応)
// ---------------------------------------------------------------------------

type BusinessHoursRow = {
  weekday: number;
  is_open: boolean;
  open_time: string | null; // time型は "HH:MM:SS"
  close_time: string | null;
};

type NthWeekdayClosureRow = {
  weekday: number;
  nth: number;
};

type DateOverrideRow = {
  id: string;
  start_date: string; // date型は "YYYY-MM-DD"
  end_date: string;
  is_open: boolean;
  label: string | null;
  open_time: string | null; // 臨時営業日の営業時間。time型は "HH:MM:SS"
  close_time: string | null;
};

// ---------------------------------------------------------------------------
// 取得関数
// ---------------------------------------------------------------------------

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

/** 営業時間(business_hours の全行)と休業日ルールの一式 */
export type BusinessCalendar = {
  /** business_hours の全行(weekday順)。行が無い曜日は含まない */
  weeklyBusinessHours: Array<{ weekday: number } & BusinessDay>;
  /** 休業日ルール。overrides には id を含めない(客側にも渡るため) */
  closureRules: ClosureRules;
};

/** 営業時間(business_hours の全行)を weekday 順で取得する */
export async function fetchWeeklyBusinessHours(
  supabase: DbClient,
): Promise<Array<{ weekday: number } & BusinessDay>> {
  const result = await supabase
    .from("business_hours")
    .select("weekday, is_open, open_time, close_time")
    .order("weekday");
  const rows: BusinessHoursRow[] = must(result, "営業時間");
  return rows.map((row) => ({
    weekday: row.weekday,
    isOpen: row.is_open,
    openTime: row.open_time,
    closeTime: row.close_time,
  }));
}

/** 第◯曜日の定休を全件取得する */
export async function fetchNthWeekdayClosures(
  supabase: DbClient,
): Promise<ClosureRules["nthWeekdayClosures"]> {
  const result = await supabase
    .from("nth_weekday_closures")
    .select("weekday, nth");
  const rows: NthWeekdayClosureRow[] = must(result, "第◯曜日の定休");
  return rows.map((row) => ({ weekday: row.weekday, nth: row.nth }));
}

/** 「祝日を休業にする」(salon_settings.close_on_holidays)を取得する */
export async function fetchCloseOnHolidays(
  supabase: DbClient,
): Promise<boolean> {
  const result = await supabase
    .from("salon_settings")
    .select("close_on_holidays")
    .single();
  const settings = must(result, "店舗設定") as { close_on_holidays: boolean };
  return settings.close_on_holidays;
}

/** 臨時休業・臨時営業を全件(開始日順)取得する。重なりの事前チェックにも使う */
export async function fetchDateOverrides(
  supabase: DbClient,
): Promise<DateOverrideRecord[]> {
  const result = await supabase
    .from("date_overrides")
    .select("id, start_date, end_date, is_open, label, open_time, close_time")
    .order("start_date");
  const rows: DateOverrideRow[] = must(result, "臨時休業・臨時営業");
  return rows.map((row) => ({
    id: row.id,
    startDate: row.start_date,
    endDate: row.end_date,
    isOpen: row.is_open,
    label: row.label,
    openTime: row.open_time,
    closeTime: row.close_time,
  }));
}

/**
 * 営業時間と休業日ルール(毎週の定休・第◯曜日・祝日・臨時休業)を
 * まとめて取得する。4つの取得は並列に行う。どれも行数が少ないので全件取得する。
 */
export async function fetchBusinessCalendar(
  supabase: DbClient,
): Promise<BusinessCalendar> {
  const [weeklyBusinessHours, nthWeekdayClosures, closeOnHolidays, overrides] =
    await Promise.all([
      fetchWeeklyBusinessHours(supabase),
      fetchNthWeekdayClosures(supabase),
      fetchCloseOnHolidays(supabase),
      fetchDateOverrides(supabase),
    ]);

  return {
    weeklyBusinessHours,
    closureRules: {
      businessHours: weeklyBusinessHours.map((day) => ({
        weekday: day.weekday,
        isOpen: day.isOpen,
      })),
      nthWeekdayClosures,
      closeOnHolidays,
      // id は設定画面(fetchDateOverrides)だけが使う。客側の画面にも渡るので
      // 要らない値は載せない
      overrides: overrides.map((override) => ({
        startDate: override.startDate,
        endDate: override.endDate,
        isOpen: override.isOpen,
        label: override.label,
        openTime: override.openTime,
        closeTime: override.closeTime,
      })),
    },
  };
}
