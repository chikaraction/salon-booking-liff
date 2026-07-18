import "server-only";

// 管理画面(店側)のデータ取得(配線に徹する)。
// 原則: 店側のDBアクセスは authenticated クライアント(RLS適用)で行い、
// service_role は使わない(docs/milestone-4-plan.md「サーバー・UI」)。
// 例外はログイン画面(未認証で表示する店名)のみ。下記コメント参照。

import type { SupabaseClient } from "@supabase/supabase-js";

import type { AdminCalendarItem, AdminStaff } from "@/lib/admin-calendar";
import {
  addCalendarDays,
  jstCalendarDate,
  jstDateTime,
  type BusinessDay,
  type StaffWorkingDay,
} from "@/lib/availability";
import { addMonths } from "@/lib/calendar";
import { parseTstzrange } from "@/lib/tstzrange";
import { getServiceRoleClient } from "@/server/supabase";

/**
 * LINE公式アカウント(コミュニケーションプラン)の月間無料メッセージ数。
 * LINEの料金プランの仕様値であり、店舗固有の設定値ではない(ADR-007の対象外)。
 * サイドバーの「LINEプッシュ(今月) n/200通」バーの分母に使う(ADR-002)。
 */
export const PUSH_MONTHLY_FREE_LIMIT = 200;

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

/** 店名(salon_settings.name)を取得する(ADR-007: 店舗固有値はDBから) */
export async function fetchSalonName(
  supabase: SupabaseClient,
): Promise<string> {
  const result = await supabase.from("salon_settings").select("name").single();
  if (result.error !== null || result.data === null) {
    throw new Error(
      `店舗設定の取得に失敗しました: ${result.error?.message ?? "データがありません"}`,
    );
  }
  return (result.data as { name: string }).name;
}

/**
 * ログイン画面用の店名取得。
 * ログイン画面は未認証で表示されるため authenticated クライアントでは読めず、
 * anon にはRLSポリシーが無い(全拒否)。店名は客側予約画面でも公開している
 * 情報なので、ここに限り service_role の読み取りを許容する(書き込みはしない)。
 */
export async function fetchSalonNameForLogin(): Promise<string> {
  return fetchSalonName(getServiceRoleClient());
}

// ---------------------------------------------------------------------------
// 予約カレンダー(/admin)のデータ取得。
// DBの行を src/lib/admin-calendar.ts の純粋関数が受け取る型に変換して渡す
// アダプタ層(booking-data.ts と同じ役割分担)。
// ---------------------------------------------------------------------------

type StaffRow = {
  id: string;
  name: string;
  role: "owner" | "staff";
};

type BusinessHoursRow = {
  weekday: number;
  is_open: boolean;
  open_time: string | null; // time型は "HH:MM:SS"
  close_time: string | null;
};

type StaffWorkingHoursRow = {
  staff_id: string;
  start_time: string;
  end_time: string;
  break_start: string | null;
  break_end: string | null;
};

type AdminReservationRow = {
  id: string;
  kind: "booking" | "block";
  staff_id: string;
  during: string; // tstzrangeは文字列で返る
  // 多対一の埋め込み(reservations.customer_id → customers)は単一オブジェクトで返る
  customers: { name: string } | null;
  // 一対多の埋め込みは配列で返る(予約時点のスナップショット)
  reservation_menus: Array<{
    menu_name: string;
    price: number;
    duration_minutes: number;
  }>;
};

/** 有効スタッフ一覧(display_order順)を取得する */
export async function fetchAdminStaff(
  supabase: SupabaseClient,
): Promise<AdminStaff[]> {
  const result = await supabase
    .from("staff")
    .select("id, name, role")
    .eq("is_active", true)
    .order("display_order");
  const rows: StaffRow[] = must(result, "スタッフ");
  return rows.map((row) => ({ id: row.id, name: row.name, role: row.role }));
}

/** 営業時間(全曜日)を取得する */
export async function fetchAdminBusinessHours(
  supabase: SupabaseClient,
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

/** 対象曜日のスタッフ勤務パターン(休憩ブロックの生成に使う)を取得する */
export async function fetchStaffWorkingHoursForWeekday(
  supabase: SupabaseClient,
  weekday: number,
): Promise<Array<{ staffId: string } & StaffWorkingDay>> {
  const result = await supabase
    .from("staff_working_hours")
    .select("staff_id, start_time, end_time, break_start, break_end")
    .eq("weekday", weekday);
  const rows: StaffWorkingHoursRow[] = must(result, "スタッフ勤務時間");
  return rows.map((row) => ({
    staffId: row.staff_id,
    startTime: row.start_time,
    endTime: row.end_time,
    breakStart: row.break_start,
    breakEnd: row.break_end,
  }));
}

/** JST暦日の範囲 [startDate, endDateExclusive) をtstzrangeの文字列表現にする */
function jstDayRange(startDate: string, endDateExclusive: string): string {
  const start = jstDateTime(startDate, "00:00");
  const end = jstDateTime(endDateExclusive, "00:00");
  return `[${start.toISOString()},${end.toISOString()})`;
}

/**
 * JST暦日の範囲 [startDate, endDateExclusive) に重なる確定済みの
 * 予約(顧客名・メニュースナップショット込み)+ブロックを取得し、
 * AdminCalendarItem に変換する。
 * - 日表示: (date, date+1日) / 週表示: (weekStart, weekStart+7日) を渡す
 * - tstzrangeの重なり(&&)は overlaps フィルタ(booking-data.ts と同じ)
 */
export async function fetchAdminCalendarItems(
  supabase: SupabaseClient,
  startDate: string,
  endDateExclusive: string,
): Promise<AdminCalendarItem[]> {
  const result = await supabase
    .from("reservations")
    .select(
      "id, kind, staff_id, during, customers(name), reservation_menus(menu_name, price, duration_minutes)",
    )
    .eq("status", "confirmed")
    .overlaps("during", jstDayRange(startDate, endDateExclusive));
  const rows = must(result, "予約") as unknown as AdminReservationRow[];

  return rows.map((row) => {
    const during = parseTstzrange(row.during);
    if (row.kind === "block") {
      return { kind: "block", id: row.id, staffId: row.staff_id, during };
    }
    return {
      kind: "booking",
      id: row.id,
      staffId: row.staff_id,
      during,
      customerName: row.customers?.name ?? "",
      menus: row.reservation_menus.map((menu) => ({
        menuName: menu.menu_name,
        price: menu.price,
        durationMinutes: menu.duration_minutes,
      })),
    };
  });
}

// ---------------------------------------------------------------------------
// サイドバーのミニ集計(今日の予約件数・今月のLINEプッシュ数)
// ---------------------------------------------------------------------------

export type AdminMiniSummary = {
  /** 今日(JST暦日)の確定予約(kind=booking)件数 */
  todayReservationCount: number;
  /** 今月(JST)の push_messages 件数(M4時点では送信機能がないため0件) */
  monthlyPushCount: number;
};

/** JST暦日の範囲に重なる確定予約(kind=booking)の件数を数える */
export async function countConfirmedBookings(
  supabase: SupabaseClient,
  startDate: string,
  endDateExclusive: string,
): Promise<number> {
  const result = await supabase
    .from("reservations")
    .select("id", { count: "exact", head: true })
    .eq("kind", "booking")
    .eq("status", "confirmed")
    .overlaps("during", jstDayRange(startDate, endDateExclusive));
  if (result.error !== null || result.count === null) {
    throw new Error(
      `予約件数の取得に失敗しました: ${result.error?.message ?? "件数がありません"}`,
    );
  }
  return result.count;
}

/** 今月(JSTの暦月)に送信したLINEプッシュ数を数える(ADR-002の可視化用) */
export async function countPushMessagesThisMonth(
  supabase: SupabaseClient,
  now: Date,
): Promise<number> {
  const yearMonth = jstCalendarDate(now).slice(0, 7);
  const monthStart = jstDateTime(`${yearMonth}-01`, "00:00");
  const nextMonthStart = jstDateTime(`${addMonths(yearMonth, 1)}-01`, "00:00");
  const result = await supabase
    .from("push_messages")
    .select("id", { count: "exact", head: true })
    .gte("sent_at", monthStart.toISOString())
    .lt("sent_at", nextMonthStart.toISOString());
  if (result.error !== null || result.count === null) {
    throw new Error(
      `プッシュ送信数の取得に失敗しました: ${result.error?.message ?? "件数がありません"}`,
    );
  }
  return result.count;
}

/** サイドバーのミニ集計(モックB左下)をまとめて取得する */
export async function getAdminMiniSummary(
  supabase: SupabaseClient,
  now: Date,
): Promise<AdminMiniSummary> {
  const today = jstCalendarDate(now);
  const [todayReservationCount, monthlyPushCount] = await Promise.all([
    countConfirmedBookings(supabase, today, addCalendarDays(today, 1)),
    countPushMessagesThisMonth(supabase, now),
  ]);
  return { todayReservationCount, monthlyPushCount };
}

// ---------------------------------------------------------------------------
// 代行登録(モックD)のデータ取得
// ---------------------------------------------------------------------------

/** 代行登録のメニュー複数選択に渡す有効メニュー1件 */
export type ActiveMenu = {
  id: string;
  name: string;
  price: number;
  durationMinutes: number;
};

type ActiveMenuRow = {
  id: string;
  name: string;
  price: number;
  duration_minutes: number;
};

/** 有効メニュー一覧(display_order順)を取得する(代行登録の複数選択用) */
export async function fetchActiveMenus(
  supabase: SupabaseClient,
): Promise<ActiveMenu[]> {
  const result = await supabase
    .from("menus")
    .select("id, name, price, duration_minutes")
    .eq("is_active", true)
    .order("display_order");
  const rows: ActiveMenuRow[] = must(result, "メニュー");
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    price: row.price,
    durationMinutes: row.duration_minutes,
  }));
}

/** 顧客検索の候補1件(名前+電話) */
export type CustomerSearchResult = {
  id: string;
  name: string;
  phone: string | null;
};

/** 顧客検索の表示上限(モックDの候補リスト) */
const CUSTOMER_SEARCH_LIMIT = 10;

/**
 * 名前または電話の部分一致で顧客を検索する(代行登録の既存顧客検索)。
 * 空クエリは空配列。上限は CUSTOMER_SEARCH_LIMIT 件、名前順。
 * PostgREST の or フィルタを壊す文字と LIKE のワイルドカードは無害化する
 * (店側の入力だがフィルタ構文の破損を防ぐ)。
 */
export async function searchCustomers(
  supabase: SupabaseClient,
  query: string,
): Promise<CustomerSearchResult[]> {
  const sanitized = query
    .trim()
    // or フィルタの区切り(, () )と LIKE ワイルドカード(% _ \ *)を空白に畳む
    .replace(/[,()%_\\*]/g, " ")
    .trim();
  if (sanitized === "") {
    return [];
  }
  const pattern = `%${sanitized}%`;
  const result = await supabase
    .from("customers")
    .select("id, name, phone")
    .or(`name.ilike.${pattern},phone.ilike.${pattern}`)
    .order("name")
    .limit(CUSTOMER_SEARCH_LIMIT);
  const rows: CustomerSearchResult[] = must(result, "顧客検索");
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    phone: row.phone,
  }));
}
