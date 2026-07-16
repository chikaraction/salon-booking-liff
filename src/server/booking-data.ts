import "server-only";

// 客側予約フローのデータ取得(配線に徹する)。
// DBの行を src/lib/ の純粋関数が受け取る型に変換して渡すアダプタ層。
// - time型は "HH:MM:SS" 文字列で返る(availability.ts はその形式を受け付ける)
// - tstzrange型は文字列で返るため parseTstzrange(src/lib/tstzrange.ts)で変換する
// - 空き枠計算そのものは src/lib/availability.ts の純粋関数が行う

import {
  addCalendarDays,
  calendarWeekday,
  computeStaffDaySlots,
  jstDateTime,
  type BookingPolicy,
  type BusinessDay,
  type BusyRange,
  type StaffSlots,
  type StaffWorkingDay,
} from "@/lib/availability";
import {
  groupMenusByCategory,
  summarizeSelectedMenus,
  type MenuCategoryGroup,
  type MenuSummary,
} from "@/lib/booking";
import { parseTstzrange } from "@/lib/tstzrange";
import { getServiceRoleClient } from "@/server/supabase";

// ---------------------------------------------------------------------------
// DBの行の型(supabase/migrations/ のスキーマに対応)
// ---------------------------------------------------------------------------

type SalonSettingsRow = {
  name: string;
  slot_interval_minutes: number;
  booking_window_days: number;
  min_lead_minutes: number;
};

type BusinessHoursRow = {
  weekday: number;
  is_open: boolean;
  open_time: string | null; // time型は "HH:MM:SS"
  close_time: string | null;
};

type MenuCategoryRow = {
  id: string;
  name: string;
  description: string | null;
};

type MenuRow = {
  id: string;
  name: string;
  price: number;
  duration_minutes: number;
  category_id: string;
};

type StaffRow = {
  id: string;
  name: string;
  role: "owner" | "staff";
  photo_url: string | null;
  bio: string | null;
};

type StaffWorkingHoursRow = {
  staff_id: string;
  start_time: string;
  end_time: string;
  break_start: string | null;
  break_end: string | null;
};

type ReservationRangeRow = {
  staff_id: string;
  during: string; // tstzrangeは文字列で返る
};

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

// ---------------------------------------------------------------------------
// 予約フローUIの初期表示データ
// ---------------------------------------------------------------------------

export type BookingStaff = {
  id: string;
  name: string;
  role: "owner" | "staff";
  photoUrl: string | null;
  bio: string | null;
};

export type BookingPageData = {
  salonName: string;
  policy: BookingPolicy;
  /** weekday(0=日曜〜6=土曜)ごとの営業時間 */
  businessHours: Array<{ weekday: number } & BusinessDay>;
  /** カテゴリ(display_order順)ごとの有効メニュー一覧 */
  categories: MenuCategoryGroup[];
  /** 有効スタッフ一覧(display_order順) */
  staff: BookingStaff[];
};

/** 予約フローUIの初期表示に必要なデータをまとめて取得する */
export async function getBookingPageData(): Promise<BookingPageData> {
  const supabase = getServiceRoleClient();

  const [settingsRes, hoursRes, categoriesRes, menusRes, staffRes] =
    await Promise.all([
      supabase
        .from("salon_settings")
        .select(
          "name, slot_interval_minutes, booking_window_days, min_lead_minutes",
        )
        .single(),
      supabase
        .from("business_hours")
        .select("weekday, is_open, open_time, close_time")
        .order("weekday"),
      supabase
        .from("menu_categories")
        .select("id, name, description")
        .order("display_order"),
      supabase
        .from("menus")
        .select("id, name, price, duration_minutes, category_id")
        .eq("is_active", true)
        .order("display_order"),
      supabase
        .from("staff")
        .select("id, name, role, photo_url, bio")
        .eq("is_active", true)
        .order("display_order"),
    ]);

  const settings: SalonSettingsRow = must(settingsRes, "店舗設定");
  const hours: BusinessHoursRow[] = must(hoursRes, "営業時間");
  const categories: MenuCategoryRow[] = must(categoriesRes, "メニューカテゴリ");
  const menus: MenuRow[] = must(menusRes, "メニュー");
  const staff: StaffRow[] = must(staffRes, "スタッフ");

  return {
    salonName: settings.name,
    policy: toPolicy(settings),
    businessHours: hours.map((row) => ({
      weekday: row.weekday,
      isOpen: row.is_open,
      openTime: row.open_time,
      closeTime: row.close_time,
    })),
    categories: groupMenusByCategory(
      categories,
      menus.map((menu) => ({
        id: menu.id,
        name: menu.name,
        price: menu.price,
        durationMinutes: menu.duration_minutes,
        categoryId: menu.category_id,
      })),
    ),
    staff: staff.map((row) => ({
      id: row.id,
      name: row.name,
      role: row.role,
      photoUrl: row.photo_url,
      bio: row.bio,
    })),
  };
}

function toPolicy(settings: {
  slot_interval_minutes: number;
  booking_window_days: number;
  min_lead_minutes: number;
}): BookingPolicy {
  return {
    slotIntervalMinutes: settings.slot_interval_minutes,
    bookingWindowDays: settings.booking_window_days,
    minLeadMinutes: settings.min_lead_minutes,
  };
}

// ---------------------------------------------------------------------------
// 1日分の空き枠(Server Actionの空き枠取得・予約前の再チェックで共用)
// ---------------------------------------------------------------------------

export type DayAvailability =
  | { kind: "invalid_menus" }
  | {
      kind: "ok";
      /** 有効スタッフ(display_order順)。perStaff も同順 */
      staff: Array<{ id: string; name: string }>;
      perStaff: StaffSlots[];
      /** 選択メニュー(所要時間・金額の根拠) */
      menus: Array<{
        id: string;
        name: string;
        price: number;
        durationMinutes: number;
      }>;
      summary: MenuSummary;
    };

/**
 * 対象日(JSTの暦日)の全スタッフの空き枠を計算する。
 * 所要時間はメニューIDからサーバーで再計算する(クライアント申告を信用しない)。
 */
export async function getDayAvailability(
  date: string, // "YYYY-MM-DD"(呼び出し元で形式検証済みであること)
  menuIds: string[],
  now: Date,
): Promise<DayAvailability> {
  const distinctMenuIds = [...new Set(menuIds)];
  if (distinctMenuIds.length === 0) {
    return { kind: "invalid_menus" };
  }

  const supabase = getServiceRoleClient();
  const weekday = calendarWeekday(date);
  // 対象日のJST 0時〜翌0時(UTCに変換して問い合わせる)
  const dayStart = jstDateTime(date, "00:00");
  const dayEnd = jstDateTime(addCalendarDays(date, 1), "00:00");

  const [settingsRes, hoursRes, menusRes, staffRes, workingRes, busyRes] =
    await Promise.all([
      supabase
        .from("salon_settings")
        .select("slot_interval_minutes, booking_window_days, min_lead_minutes")
        .single(),
      supabase
        .from("business_hours")
        .select("weekday, is_open, open_time, close_time")
        .eq("weekday", weekday)
        .maybeSingle(),
      supabase
        .from("menus")
        .select("id, name, price, duration_minutes")
        .in("id", distinctMenuIds)
        .eq("is_active", true),
      supabase
        .from("staff")
        .select("id, name")
        .eq("is_active", true)
        .order("display_order"),
      supabase
        .from("staff_working_hours")
        .select("staff_id, start_time, end_time, break_start, break_end")
        .eq("weekday", weekday),
      // 対象日と重なる確定済みの予約+ブロック(kindは問わない)。
      // tstzrangeの重なり(&&)は overlaps フィルタ(PostgRESTのov演算子)に
      // 範囲の文字列表現を渡す(@supabase/postgrest-js の型定義で確認)
      supabase
        .from("reservations")
        .select("staff_id, during")
        .eq("status", "confirmed")
        .overlaps(
          "during",
          `[${dayStart.toISOString()},${dayEnd.toISOString()})`,
        ),
    ]);

  const settings = must(settingsRes, "店舗設定") as Pick<
    SalonSettingsRow,
    "slot_interval_minutes" | "booking_window_days" | "min_lead_minutes"
  >;
  const menus: Array<Omit<MenuRow, "category_id">> = must(menusRes, "メニュー");
  const staff: Array<Pick<StaffRow, "id" | "name">> = must(
    staffRes,
    "スタッフ",
  );
  const workingRows: StaffWorkingHoursRow[] = must(
    workingRes,
    "スタッフ勤務時間",
  );
  const busyRows: ReservationRangeRow[] = must(busyRes, "既存予約");
  if (hoursRes.error !== null) {
    throw new Error(`営業時間の取得に失敗しました: ${hoursRes.error.message}`);
  }

  // 存在しない・無効化済みメニューが混ざっていたら拒否(RPC側と同じ判定)
  if (menus.length !== distinctMenuIds.length) {
    return { kind: "invalid_menus" };
  }

  // 行がない曜日は休業として扱う
  const hoursRow = hoursRes.data as BusinessHoursRow | null;
  const businessDay: BusinessDay = hoursRow
    ? {
        isOpen: hoursRow.is_open,
        openTime: hoursRow.open_time,
        closeTime: hoursRow.close_time,
      }
    : { isOpen: false, openTime: null, closeTime: null };

  const workingByStaff = new Map<string, StaffWorkingDay>(
    workingRows.map((row) => [
      row.staff_id,
      {
        startTime: row.start_time,
        endTime: row.end_time,
        breakStart: row.break_start,
        breakEnd: row.break_end,
      },
    ]),
  );

  const busyByStaff = new Map<string, BusyRange[]>();
  for (const row of busyRows) {
    const ranges = busyByStaff.get(row.staff_id) ?? [];
    ranges.push(parseTstzrange(row.during));
    busyByStaff.set(row.staff_id, ranges);
  }

  const selectedMenus = menus.map((menu) => ({
    id: menu.id,
    name: menu.name,
    price: menu.price,
    durationMinutes: menu.duration_minutes,
  }));
  const summary = summarizeSelectedMenus(selectedMenus);
  const policy = toPolicy(settings);

  const perStaff: StaffSlots[] = staff.map((member) => ({
    staffId: member.id,
    slots: computeStaffDaySlots({
      date,
      durationMinutes: summary.totalDurationMinutes,
      businessDay,
      // M2の休業日判定は毎週の定休(business_hours.is_open)のみ。
      // 第◯曜日・祝日・指定日ルール(M4)は isClosedDay に載せる
      working: workingByStaff.get(member.id) ?? null,
      busy: busyByStaff.get(member.id) ?? [],
      policy,
      now,
    }),
  }));

  return { kind: "ok", staff, perStaff, menus: selectedMenus, summary };
}

// ---------------------------------------------------------------------------
// 顧客の照合(ADR-003: LINEのuserIdで識別)
// ---------------------------------------------------------------------------

/** line_user_id で顧客を検索する。未登録なら null */
export async function findCustomerByLineUserId(
  lineUserId: string,
): Promise<{ id: string; name: string } | null> {
  const supabase = getServiceRoleClient();
  const result = await supabase
    .from("customers")
    .select("id, name")
    .eq("line_user_id", lineUserId)
    .maybeSingle();
  if (result.error !== null) {
    throw new Error(`顧客の取得に失敗しました: ${result.error.message}`);
  }
  return result.data as { id: string; name: string } | null;
}
