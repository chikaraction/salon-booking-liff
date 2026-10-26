import "server-only";

// 設定系画面(/admin/settings/*)のデータ取得(配線に徹する)。
// 原則: authenticated クライアント(RLS適用)で読む。service_role は使わない
// (docs/milestone-4b-plan.md「サーバー・UI」)。
// 設定系テーブルのSELECTは全スタッフに許可されているので普通に引ける
// (変更だけがオーナー限定: ADR-005)。

import type { SupabaseClient } from "@supabase/supabase-js";

import { isStaffRole, type StaffRole } from "@/lib/admin-permissions";
import {
  fillWeeklyBusinessHours,
  type NthWeekdayClosureRow,
  type WeeklyBusinessHoursRow,
} from "@/lib/business-settings";
import {
  resolveDisplaySettings,
  type DisplaySettings,
} from "@/lib/display-settings";
import { jstDateTime } from "@/lib/jst";
import type { MenuCategoryRecord, MenuRecord } from "@/lib/menu-settings";
import type { StaffWorkingHoursRow } from "@/lib/staff-settings";
import { formatTstzrange, parseTstzrange } from "@/lib/tstzrange";
import {
  fetchCloseOnHolidays,
  fetchDateOverrides,
  fetchNthWeekdayClosures,
  fetchWeeklyBusinessHours,
  type DateOverrideRecord,
} from "@/server/closure-data";
import { must } from "@/server/postgrest";

/** 営業日・営業時間の設定画面(モックE-2)が必要とする設定一式 */
export type BusinessSettings = {
  /** 日曜〜土曜の7件(行が無い曜日は休業で補う) */
  businessHours: WeeklyBusinessHoursRow[];
  nthWeekdayClosures: NthWeekdayClosureRow[];
  closeOnHolidays: boolean;
  /** 開始日順。重なりの事前チェックにも使うので期間で絞らず全件持つ */
  dateOverrides: DateOverrideRecord[];
};

/**
 * 営業日・営業時間の設定画面の初期表示に必要な設定をまとめて取得する。
 * 取得と行の詰め替えは closure-data.ts に任せる。上書きは削除の導線に
 * id が要るので、id を落とす fetchBusinessCalendar ではなく fetchDateOverrides で引く
 */
export async function fetchBusinessSettings(
  supabase: SupabaseClient,
): Promise<BusinessSettings> {
  const [hours, nthWeekdayClosures, closeOnHolidays, dateOverrides] =
    await Promise.all([
      fetchWeeklyBusinessHours(supabase),
      fetchNthWeekdayClosures(supabase),
      fetchCloseOnHolidays(supabase),
      fetchDateOverrides(supabase),
    ]);

  return {
    // 行が無い曜日を休業で補うのは純粋関数側の判断(closures.ts の判定と揃える)
    businessHours: fillWeeklyBusinessHours(hours),
    nthWeekdayClosures,
    closeOnHolidays,
    dateOverrides,
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
// 店舗・予約設定画面(モックなし)
// ---------------------------------------------------------------------------

/** 店舗・予約設定画面が編集する salon_settings の列(単一行) */
export type SalonSettings = {
  name: string;
  slotIntervalMinutes: number;
  bookingWindowDays: number;
  minLeadMinutes: number;
  cancelDeadlineMinutes: number;
  /** 前日リマインドの送信時刻(JSTの時。0〜23) */
  reminderHour: number;
};

type SalonSettingsRow = {
  name: string;
  slot_interval_minutes: number;
  booking_window_days: number;
  min_lead_minutes: number;
  cancel_deadline_minutes: number;
  reminder_hour: number;
};

/**
 * 店名と予約ポリシー4値・前日リマインドの送信時刻を取得する(salon_settings は id=true の1行だけ)。
 *
 * close_on_holidays は同じテーブルの列だが休業日ルールの一部なので、
 * 営業日設定画面の fetchBusinessSettings が持つ。画面ごとに必要な列だけを
 * 引き、どの画面がどの設定を編集するのかを取得の形にも表す。
 */
export async function fetchSalonSettings(
  supabase: SupabaseClient,
): Promise<SalonSettings> {
  const result = await supabase
    .from("salon_settings")
    .select(
      "name, slot_interval_minutes, booking_window_days, min_lead_minutes, cancel_deadline_minutes, reminder_hour",
    )
    .single();
  const row: SalonSettingsRow = must(result, "店舗設定");

  return {
    name: row.name,
    slotIntervalMinutes: row.slot_interval_minutes,
    bookingWindowDays: row.booking_window_days,
    minLeadMinutes: row.min_lead_minutes,
    cancelDeadlineMinutes: row.cancel_deadline_minutes,
    reminderHour: row.reminder_hour,
  };
}

// ---------------------------------------------------------------------------
// 表示設定画面(モックF-2)
// ---------------------------------------------------------------------------

/**
 * 表示設定(テーマカラーのプリセット・フォント)の保存済みの値を取得する。
 *
 * ルートレイアウト用の getDisplaySettings(@/server/display-settings)とは別に置く。
 * あちらは客側のために service_role で読み、失敗しても既定値で描画を続けるが、
 * この画面は「保存済みの値」を編集の基準にするので、取得失敗を既定値で
 * 隠すと保存済みでない値を「採用中」と見せてしまう。他の設定画面と同じく
 * authenticated クライアントで読み、失敗は例外にする。
 * check 制約の外の値は起きないはずだが、念のため純粋関数で既定値に倒す。
 */
export async function fetchDisplaySettings(
  supabase: SupabaseClient,
): Promise<DisplaySettings> {
  const result = await supabase
    .from("salon_settings")
    .select("theme_preset, font_family")
    .single();
  const row: { theme_preset: unknown; font_family: unknown } = must(
    result,
    "表示設定",
  );
  return resolveDisplaySettings(row);
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
