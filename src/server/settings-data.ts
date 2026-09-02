import "server-only";

// 設定系画面(/admin/settings/*)のデータ取得(配線に徹する)。
// 原則: authenticated クライアント(RLS適用)で読む。service_role は使わない
// (docs/milestone-4b-plan.md「サーバー・UI」)。
// 設定系テーブルのSELECTは全スタッフに許可されているので普通に引ける
// (変更だけがオーナー限定: ADR-005)。

import type { SupabaseClient } from "@supabase/supabase-js";

import { isStaffRole, type StaffRole } from "@/lib/admin-permissions";
import { jstDateTime } from "@/lib/availability";
import {
  fillWeeklyBusinessHours,
  type NthWeekdayClosureRow,
  type WeeklyBusinessHoursRow,
} from "@/lib/business-settings";
import type { MenuCategoryRecord, MenuRecord } from "@/lib/menu-settings";
import type { StaffWorkingHoursRow } from "@/lib/staff-settings";
import { formatTstzrange, parseTstzrange } from "@/lib/tstzrange";

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

// ---------------------------------------------------------------------------
// スタッフ設定画面(モックE)
// ---------------------------------------------------------------------------

/** staff の1行(画面が扱う形) */
export type StaffRecord = {
  id: string;
  name: string;
  role: StaffRole;
  displayOrder: number;
  isActive: boolean;
  bio: string | null;
  /**
   * 管理画面ユーザー(auth.users)と紐付いているか。
   * auth_user_id そのものは画面に出さない(編集させない項目であり、
   * クライアントへ渡す必要のないIDのため)。紐付け漏れの案内にだけ使う。
   */
  hasAuthUser: boolean;
};

/** スタッフ設定画面の初期表示に必要な設定一式 */
export type StaffSettings = {
  /** 無効なスタッフも含む全件(display_order順)。無効化の取り消しができるように */
  staff: StaffRecord[];
  /** 全スタッフの勤務パターン。staffId でひもづける */
  workingHours: Array<{ staffId: string } & StaffWorkingHoursRow>;
};

type StaffTableRow = {
  id: string;
  name: string;
  role: string;
  display_order: number;
  is_active: boolean;
  bio: string | null;
  auth_user_id: string | null;
};

type StaffWorkingHoursTableRow = {
  staff_id: string;
  weekday: number;
  start_time: string; // time型は "HH:MM:SS"
  end_time: string;
  break_start: string | null;
  break_end: string | null;
};

/**
 * スタッフ(無効も含む全件)と週次勤務パターンをまとめて取得する。
 * 並びは display_order → name。同じ表示順のときに並びが揺れないよう name を足す。
 */
export async function fetchStaffSettings(
  supabase: SupabaseClient,
): Promise<StaffSettings> {
  const [staffRes, hoursRes] = await Promise.all([
    supabase
      .from("staff")
      .select("id, name, role, display_order, is_active, bio, auth_user_id")
      .order("display_order")
      .order("name"),
    supabase
      .from("staff_working_hours")
      .select("staff_id, weekday, start_time, end_time, break_start, break_end")
      .order("weekday"),
  ]);

  const staffRows: StaffTableRow[] = must(staffRes, "スタッフ");
  const hoursRows: StaffWorkingHoursTableRow[] = must(
    hoursRes,
    "スタッフ勤務時間",
  );

  return {
    staff: staffRows.map((row) => ({
      id: row.id,
      name: row.name,
      // check 制約があるので通常は起きない。想定外の値はスタッフ扱いにする
      role: isStaffRole(row.role) ? row.role : "staff",
      displayOrder: row.display_order,
      isActive: row.is_active,
      bio: row.bio,
      hasAuthUser: row.auth_user_id !== null,
    })),
    workingHours: hoursRows.map((row) => ({
      staffId: row.staff_id,
      weekday: row.weekday,
      startTime: row.start_time,
      endTime: row.end_time,
      breakStart: row.break_start,
      breakEnd: row.break_end,
    })),
  };
}

/** 臨時休ブロック1件(reservations の kind='block' の行) */
export type StaffBlockRecord = {
  id: string;
  staffId: string;
  start: Date;
  end: Date;
};

type BlockRow = {
  id: string;
  staff_id: string;
  during: string; // tstzrangeは文字列で返る
};

/**
 * 今後の臨時休ブロックを取得する(全スタッフ分)。
 * 期間は [fromDate, fromDate + days) のJST暦日。過ぎたブロックは
 * 画面に出しても操作の意味がないので取らない。
 *
 * 臨時休は予約テーブル(reservations)の kind='block' の行なので、
 * SELECT自体はスタッフにも許されている(予約運用のテーブルであるため)。
 * オーナー限定なのはアプリ層(設定レイアウト・Server Action)の側。
 */
export async function fetchUpcomingStaffBlocks(
  supabase: SupabaseClient,
  fromDate: string,
  days: number,
): Promise<StaffBlockRecord[]> {
  const start = jstDateTime(fromDate, "00:00");
  const end = new Date(start.getTime() + days * 24 * 60 * 60 * 1000);

  const result = await supabase
    .from("reservations")
    .select("id, staff_id, during")
    .eq("kind", "block")
    .eq("status", "confirmed")
    .overlaps("during", formatTstzrange(start, end));
  const rows: BlockRow[] = must(result, "臨時休");

  return rows
    .map((row) => {
      const during = parseTstzrange(row.during);
      return {
        id: row.id,
        staffId: row.staff_id,
        start: during.start,
        end: during.end,
      };
    })
    .sort((a, b) => a.start.getTime() - b.start.getTime());
}

// ---------------------------------------------------------------------------
// メニュー管理画面(モックF・F詳細)
// ---------------------------------------------------------------------------

/** メニュー管理画面の初期表示に必要なデータ一式 */
export type MenuSettings = {
  /** 表示順のカテゴリ全件 */
  categories: MenuCategoryRecord[];
  /**
   * 非表示(is_active = false)も含むメニュー全件。
   * 非表示が削除の代わりなので、管理画面では戻せるように必ず出す。
   * カテゴリの削除可否(所属メニュー数)の判定にも全件が要る。
   */
  menus: MenuRecord[];
};

type MenuCategoryTableRow = {
  id: string;
  name: string;
  description: string | null;
  display_order: number;
};

type MenuTableRow = {
  id: string;
  name: string;
  category_id: string;
  price: number;
  duration_minutes: number;
  display_order: number;
  is_active: boolean;
};

/**
 * カテゴリとメニューをまとめて取得する。
 * 並べ替え・グルーピングの判断は純粋関数(menu-settings.ts)に任せるので、
 * ここは display_order 順に引いて形を変えるだけにする。
 */
export async function fetchMenuSettings(
  supabase: SupabaseClient,
): Promise<MenuSettings> {
  const [categoriesRes, menusRes] = await Promise.all([
    supabase
      .from("menu_categories")
      .select("id, name, description, display_order")
      .order("display_order"),
    supabase
      .from("menus")
      .select(
        "id, name, category_id, price, duration_minutes, display_order, is_active",
      )
      .order("display_order"),
  ]);

  const categories: MenuCategoryTableRow[] = must(
    categoriesRes,
    "メニューカテゴリ",
  );
  const menus: MenuTableRow[] = must(menusRes, "メニュー");

  return {
    categories: categories.map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      displayOrder: row.display_order,
    })),
    menus: menus.map((row) => ({
      id: row.id,
      name: row.name,
      categoryId: row.category_id,
      price: row.price,
      durationMinutes: row.duration_minutes,
      displayOrder: row.display_order,
      isActive: row.is_active,
    })),
  };
}
