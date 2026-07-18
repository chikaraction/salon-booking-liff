// /admin(ホーム)= 予約カレンダー(サーバーコンポーネント)。
// 配線に徹する: searchParams から表示種別・日付を読み、authenticated
// クライアント(RLS適用)でデータを取り、純粋関数 admin-calendar.ts に
// 配置計算を任せ、結果をクライアントの <CalendarView> に渡す。

import {
  buildDayTimeline,
  buildReservationListItems,
  buildWeekView,
  isClosedByBusinessHours,
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
import { createAdminAuthClient } from "@/server/admin-auth";
import {
  fetchAdminBusinessHours,
  fetchAdminCalendarItems,
  fetchAdminStaff,
  fetchStaffWorkingHoursForWeekday,
} from "@/server/admin-data";

import { CalendarView } from "./_components/calendar-view";

// 空の初期値(表示していない側の入力に渡す。CalendarView は view で分岐する)
const EMPTY_TIMELINE: DayTimeline = {
  isClosed: false,
  ticks: [],
  tickMarks: [],
  columns: [],
};
const EMPTY_WEEK: WeekView = { ticks: [], tickMarks: [], days: [] };

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
  const [staff, businessHours] = await Promise.all([
    fetchAdminStaff(supabase),
    fetchAdminBusinessHours(supabase),
  ]);

  let timeline: DayTimeline = EMPTY_TIMELINE;
  let listItems: ReservationListItem[] = [];
  let weekView: WeekView = EMPTY_WEEK;

  if (view === "day") {
    const weekday = calendarWeekday(date);
    const businessDay = businessHours.find((h) => h.weekday === weekday) ?? {
      isOpen: false,
      openTime: null,
      closeTime: null,
    };
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
      businessHours,
      items,
      isClosedDay: (d) => isClosedByBusinessHours(d, businessHours),
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
    />
  );
}
