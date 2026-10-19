// /admin(ホーム)= 予約カレンダー(サーバーコンポーネント)。
// 配線に徹する: searchParams から表示種別・日付を読み、authenticated
// クライアント(RLS適用)でデータを取り、純粋関数 admin-calendar.ts に
// 配置計算を任せ、結果をクライアントの <CalendarView> に渡す。

import {
  buildDayTimeline,
  buildReservationListItems,
  buildWeekView,
  weekStartOf,
  type DayTimeline,
  type ReservationListItem,
  type WeekView,
} from "@/lib/admin-calendar";
import {
  addCalendarDays,
  calendarWeekday,
  isCalendarDate,
  jstCalendarDate,
} from "@/lib/availability";
import {
  makeBusinessDayOf,
  makeIsClosedDay,
  resolveBusinessDay,
} from "@/lib/closures";
import { createAdminAuthClient } from "@/server/admin-auth";
import {
  fetchActiveMenus,
  fetchAdminBusinessHours,
  fetchAdminCalendarItems,
  fetchAdminStaff,
  fetchClosureRules,
  fetchSlotIntervalMinutes,
  fetchStaffWorkingHoursForWeekday,
} from "@/server/admin-data";

import { CalendarView } from "./_components/calendar-view";

// 空の初期値(表示していない側の入力に渡す。CalendarView は view で分岐する)
const EMPTY_TIMELINE: DayTimeline = {
  isClosed: false,
  axis: null,
  ticks: [],
  tickMarks: [],
  columns: [],
};
const EMPTY_WEEK: WeekView = {
  axis: null,
  ticks: [],
  tickMarks: [],
  days: [],
};

type SearchParams = { view?: string; date?: string };

export default async function AdminCalendarPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const todayDate = jstCalendarDate(new Date());
  const view = params.view === "week" ? "week" : "day";
  const date =
    typeof params.date === "string" && isCalendarDate(params.date)
      ? params.date
      : todayDate;

  const supabase = await createAdminAuthClient();
  // 刻み・メニューは日表示の代行登録ダイアログ(空き枠クリック)に渡す。
  // 刻みは salon_settings 由来(ADR-007: 30分などをコードに書かない)
  const [staff, businessHours, slotIntervalMinutes, menus] = await Promise.all([
    fetchAdminStaff(supabase),
    fetchAdminBusinessHours(supabase),
    fetchSlotIntervalMinutes(supabase),
    fetchActiveMenus(supabase),
  ]);
  // 休業日判定(毎週の定休・第◯曜日・祝日・臨時休業)は closures.ts に一本化する
  const closureRules = await fetchClosureRules(supabase, businessHours);
  const isClosedDay = makeIsClosedDay(closureRules);

  let timeline: DayTimeline = EMPTY_TIMELINE;
  let listItems: ReservationListItem[] = [];
  let weekView: WeekView = EMPTY_WEEK;

  if (view === "day") {
    const weekday = calendarWeekday(date);
    const weeklyDay = businessHours.find((h) => h.weekday === weekday) ?? {
      isOpen: false,
      openTime: null,
      closeTime: null,
    };
    // 第◯曜日・祝日・臨時休業の休業日も日表示で休業として出し、
    // 時刻付きの臨時営業の日はその時刻を日表示の時間軸にする
    const businessDay = resolveBusinessDay({
      date,
      weeklyBusinessDay: weeklyDay,
      rules: closureRules,
    });
    const [items, workingHours] = await Promise.all([
      fetchAdminCalendarItems(supabase, date, addCalendarDays(date, 1)),
      fetchStaffWorkingHoursForWeekday(supabase, weekday),
    ]);
    timeline = buildDayTimeline({
      date,
      businessDay,
      staff,
      items,
      workingHours,
    });
    listItems = buildReservationListItems(items, staff);
  } else {
    const weekStart = weekStartOf(date);
    const items = await fetchAdminCalendarItems(
      supabase,
      weekStart,
      addCalendarDays(weekStart, 7),
    );
    weekView = buildWeekView({
      weekStart,
      items,
      isClosedDay,
      // 軸・営業時間外の帯は曜日の行ではなくその日の実効営業時間で決める
      // (臨時営業・短縮営業が週表示にも効く)
      businessDayOf: makeBusinessDayOf({
        rules: closureRules,
        weeklyBusinessHours: businessHours,
      }),
    });
  }

  return (
    <CalendarView
      staff={staff}
      date={date}
      todayDate={todayDate}
      view={view}
      timeline={timeline}
      listItems={listItems}
      weekView={weekView}
      slotIntervalMinutes={slotIntervalMinutes}
      menus={menus}
    />
  );
}
