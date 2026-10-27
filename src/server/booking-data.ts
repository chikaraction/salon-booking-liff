import "server-only";

// 客側予約フローのデータ取得(配線に徹する)。
// DBの行を src/lib/ の純粋関数が受け取る型に変換して渡すアダプタ層。
// - time型は "HH:MM:SS" 文字列で返る(availability.ts はその形式を受け付ける)
// - tstzrange型は文字列で返るため parseTstzrange(src/lib/tstzrange.ts)で変換する
// - 空き枠計算そのものは src/lib/availability.ts の純粋関数が行う

import { toStaffRole } from "@/lib/admin-permissions";
import {
  computeStaffDaySlots,
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
import {
  resolveBusinessDay,
  resolveDayClosure,
  resolveStaffWorkingDay,
  weeklyBusinessDayOf,
  type ClosureRules,
} from "@/lib/closures";
import { addCalendarDays, calendarWeekday, jstDateTime } from "@/lib/jst";
import type { ReservationCardInput } from "@/lib/my-reservations";
import { parseTstzrange } from "@/lib/tstzrange";
import { fetchBusinessCalendar } from "@/server/closure-data";
import { must } from "@/server/postgrest";
import { getServiceRoleClient } from "@/server/supabase";

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
  /**
   * 休業日ルール(毎週の定休・第◯曜日・祝日・臨時休業)。
   * クライアントは makeIsClosedDay(closures.ts)で判定関数にして
   * 月カレンダーの日付選択可否(isSelectableDate)に渡す。
   */
  closureRules: ClosureRules;
};

/** 予約フローUIの初期表示に必要なデータをまとめて取得する */
export async function getBookingPageData(): Promise<BookingPageData> {
  const supabase = getServiceRoleClient();

  const [settingsRes, calendar, categoriesRes, menusRes, staffRes] =
    await Promise.all([
      supabase
        .from("salon_settings")
        .select(
          "name, slot_interval_minutes, booking_window_days, min_lead_minutes",
        )
        .single(),
      // 営業時間と休業日ルール(毎週の定休・第◯曜日・祝日・臨時休業)
      fetchBusinessCalendar(supabase),
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

  const settings = must(settingsRes, "店舗設定");
  const categories = must(categoriesRes, "メニューカテゴリ");
  const menus = must(menusRes, "メニュー");
  const staff = must(staffRes, "スタッフ");

  return {
    salonName: settings.name,
    policy: toPolicy(settings),
    businessHours: calendar.weeklyBusinessHours,
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
      role: toStaffRole(row.role),
      photoUrl: row.photo_url,
      bio: row.bio,
    })),
    closureRules: calendar.closureRules,
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
      /** 対象日が休業日(毎週の定休・第◯曜日・祝日・臨時休業)か */
      isClosed: boolean;
      /** 有効スタッフ(display_order順)。perStaff / perStaffContext も同順 */
      staff: Array<{ id: string; name: string }>;
      perStaff: StaffSlots[];
      /**
       * 枠の計算に使った素材(店側の「なぜ空き枠が無いのか」の説明に使う。
       * describeSlotAvailability が computeStaffDaySlots と同じ入力で判定できるよう
       * 加算的に返す。客側は参照しない)
       */
      businessDay: BusinessDay;
      policy: BookingPolicy;
      perStaffContext: Array<{
        staffId: string;
        working: StaffWorkingDay | null;
        busy: BusyRange[];
      }>;
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
 *
 * excludeReservationId: 「埋まり」計算から除外する予約ID。変更フロー(M3)で
 * 自分の旧予約の枠を空きとして見せるために使う。省略時は従来どおり全予約が対象。
 */
export async function getDayAvailability(
  date: string, // "YYYY-MM-DD"(呼び出し元で形式検証済みであること)
  menuIds: string[],
  now: Date,
  excludeReservationId?: string,
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

  // 対象日と重なる確定済みの予約+ブロック(kindは問わない)。
  // tstzrangeの重なり(&&)は overlaps フィルタ(PostgRESTのov演算子)に
  // 範囲の文字列表現を渡す(@supabase/postgrest-js の型定義で確認)
  let busyQuery = supabase
    .from("reservations")
    .select("staff_id, during")
    .eq("status", "confirmed")
    .overlaps("during", `[${dayStart.toISOString()},${dayEnd.toISOString()})`);
  // 変更フロー(M3)では自分の旧予約を除外する(省略時は条件を足さない = 従来と同一)
  if (excludeReservationId !== undefined) {
    busyQuery = busyQuery.neq("id", excludeReservationId);
  }

  const [settingsRes, calendar, menusRes, staffRes, workingRes, busyRes] =
    await Promise.all([
      supabase
        .from("salon_settings")
        .select("slot_interval_minutes, booking_window_days, min_lead_minutes")
        .single(),
      // 営業時間と休業日ルール(毎週の定休・第◯曜日・祝日・臨時休業)。
      // どれも行数が少ないので、対象日の分に絞らず全件取得する
      fetchBusinessCalendar(supabase),
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
      busyQuery,
    ]);

  const settings = must(settingsRes, "店舗設定");
  const menus = must(menusRes, "メニュー");
  const staff = must(staffRes, "スタッフ");
  const workingRows = must(workingRes, "スタッフ勤務時間");
  const busyRows = must(busyRes, "既存予約");

  // 存在しない・無効化済みメニューが混ざっていたら拒否(RPC側と同じ判定)
  if (menus.length !== distinctMenuIds.length) {
    return { kind: "invalid_menus" };
  }

  // 休業日ルール(毎週の定休・第◯曜日・祝日・臨時休業)。判定は closures.ts に一本化する
  const closureRules = calendar.closureRules;
  const weeklyBusinessDay = weeklyBusinessDayOf(
    calendar.weeklyBusinessHours,
    weekday,
  );
  const isClosed = resolveDayClosure(date, closureRules).isClosed;

  // その日の営業時間を確定してから枠計算へ渡す。休業日(祝日・第◯曜日・臨時休業を
  // 含む)は閉じ、客側の予約枠が開かないようにする(モックE-2の説明文どおりの要件)。
  // 時刻付きの臨時営業はその時刻で開く(定休曜日でも枠が出る)。
  const businessDay: BusinessDay = resolveBusinessDay({
    date,
    weeklyBusinessDay,
    rules: closureRules,
  });

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

  // 定休曜日を臨時営業にした日は、その曜日の勤務行が無いスタッフを
  // 営業時間いっぱいの勤務とみなす(判断は closures.ts の resolveStaffWorkingDay)。
  // その日に出ないスタッフは臨時休ブロックで塞ぐ運用にする。
  const perStaffContext = staff.map((member) => ({
    staffId: member.id,
    working: resolveStaffWorkingDay({
      date,
      weeklyWorking: workingByStaff.get(member.id) ?? null,
      weeklyBusinessDay,
      businessDay,
    }),
    busy: busyByStaff.get(member.id) ?? [],
  }));

  const perStaff: StaffSlots[] = perStaffContext.map((context) => ({
    staffId: context.staffId,
    slots: computeStaffDaySlots({
      date,
      durationMinutes: summary.totalDurationMinutes,
      // 休業日(毎週の定休・第◯曜日・祝日・臨時休業)は上で閉じてある
      businessDay,
      working: context.working,
      busy: context.busy,
      policy,
      now,
    }),
  }));

  return {
    kind: "ok",
    isClosed,
    staff,
    perStaff,
    businessDay,
    policy,
    perStaffContext,
    menus: selectedMenus,
    summary,
  };
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
  return result.data;
}

// ---------------------------------------------------------------------------
// 変更元予約の取得(M3: 変更フロー)
// ---------------------------------------------------------------------------

export type OwnConfirmedBooking = {
  id: string;
  staffId: string;
  start: Date;
  note: string | null;
  /** 予約時のメニューID(元メニュー削除でnullになったスナップショットは除く) */
  menuIds: string[];
};

/**
 * 本人所有の確定予約(kind=booking)を1件取得する。
 * 存在しない・他人の予約・キャンセル済み・blockはすべて null に畳む
 * (予約IDの存在を外部に漏らさない。RPC側の判定と同じ発想)。
 * reservationId はUUID形式であること(呼び出し元で isUuid 検証済みであること)。
 */
export async function findOwnConfirmedBooking(
  lineUserId: string,
  reservationId: string,
): Promise<OwnConfirmedBooking | null> {
  const customer = await findCustomerByLineUserId(lineUserId);
  if (customer === null) {
    return null;
  }

  const supabase = getServiceRoleClient();
  const result = await supabase
    .from("reservations")
    .select("id, staff_id, during, note, reservation_menus(menu_id)")
    .eq("id", reservationId)
    .eq("customer_id", customer.id)
    .eq("kind", "booking")
    .eq("status", "confirmed")
    .maybeSingle();
  if (result.error !== null) {
    throw new Error(`変更元予約の取得に失敗しました: ${result.error.message}`);
  }
  // 一対多の埋め込み(reservation_menus)は配列として推論される
  const row = result.data;
  if (row === null) {
    return null;
  }

  return {
    id: row.id,
    staffId: row.staff_id,
    start: parseTstzrange(row.during).start,
    note: row.note,
    menuIds: row.reservation_menus
      .map((menu) => menu.menu_id)
      .filter((menuId): menuId is string => menuId !== null),
  };
}

// ---------------------------------------------------------------------------
// マイ予約(M3): 今後の確定予約一覧 + キャンセル締切
// ---------------------------------------------------------------------------

/**
 * 該当顧客の今後の確定予約(kind=booking)を開始時刻昇順で返す。
 * メニュースナップショット・スタッフ名込みで、buildReservationCard
 * (src/lib/my-reservations.ts)の入力にそのまま渡せる形にする。
 * 顧客が未登録なら空配列(予約フローを経ていない客がマイ予約を開いた場合)。
 * 件数は高々数件なので、開始時刻のフィルタ・ソートはサーバー側で行う。
 */
export async function getUpcomingReservations(
  lineUserId: string,
  now: Date,
): Promise<ReservationCardInput[]> {
  const customer = await findCustomerByLineUserId(lineUserId);
  if (customer === null) {
    return [];
  }

  const supabase = getServiceRoleClient();
  const result = await supabase
    .from("reservations")
    .select(
      "id, staff_id, during, reservation_menus(menu_name, price, duration_minutes)",
    )
    .eq("customer_id", customer.id)
    .eq("kind", "booking")
    .eq("status", "confirmed");
  // 一対多の埋め込み(reservation_menus)は配列として推論される
  const rows = must(result, "マイ予約");

  // スタッフ名は別クエリで引く(退職などで無効化済みでも予約表示には名前が要るため
  // is_active では絞らない)
  const staffIds = [...new Set(rows.map((row) => row.staff_id))];
  const staffNameById = new Map<string, string>();
  if (staffIds.length > 0) {
    const staffRes = await supabase
      .from("staff")
      .select("id, name")
      .in("id", staffIds);
    const staffRows = must(staffRes, "スタッフ");
    for (const row of staffRows) {
      staffNameById.set(row.id, row.name);
    }
  }

  return rows
    .map((row) => ({
      id: row.id,
      start: parseTstzrange(row.during).start,
      staffName: staffNameById.get(row.staff_id) ?? "",
      menus: row.reservation_menus.map((menu) => ({
        menuName: menu.menu_name,
        price: menu.price,
        durationMinutes: menu.duration_minutes,
      })),
    }))
    .filter((reservation) => reservation.start.getTime() >= now.getTime())
    .sort((a, b) => a.start.getTime() - b.start.getTime());
}

/** キャンセル締切(開始何分前まで客自身で変更・キャンセルできるか)を取得する */
export async function getCancelDeadlineMinutes(): Promise<number> {
  const supabase = getServiceRoleClient();
  const result = await supabase
    .from("salon_settings")
    .select("cancel_deadline_minutes")
    .single();
  const settings = must(result, "店舗設定");
  return settings.cancel_deadline_minutes;
}
