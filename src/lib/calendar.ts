// 月カレンダー表示の判断ロジック(純粋関数)。
// 週配列の生成・日付の選択可否・月移動の可否・時刻ラベルを扱う。
// カレンダーで無効化するのは定休日・受付期間外・過去の日付のみで、
// 日ごとの空き有無は日付選択時に空き枠計算(availability.ts)で判定する。

import {
  addCalendarDays,
  calendarWeekday,
  isWithinBookingWindow,
  jstCalendarDate,
  type BookingPolicy,
} from "./availability";

export type CalendarDay = {
  date: string; // "YYYY-MM-DD"
  day: number; // 月内の日(1〜31)
};

/** カレンダーの1マス。月外の詰め物は null */
export type CalendarCell = CalendarDay | null;

const WEEKDAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"];

/** UTCのDateをJSTの年月("YYYY-MM")に変換する */
export function jstYearMonth(at: Date): string {
  return jstCalendarDate(at).slice(0, 7);
}

/** 年月("YYYY-MM")にnか月を加算する */
export function addMonths(yearMonth: string, delta: number): string {
  const [year, month] = yearMonth.split("-").map(Number);
  const total = year * 12 + (month - 1) + delta;
  const newYear = Math.floor(total / 12);
  const newMonth = (total % 12) + 1;
  return `${newYear}-${String(newMonth).padStart(2, "0")}`;
}

/** 年月を「2026年7月」形式にする */
export function yearMonthLabel(yearMonth: string): string {
  const [year, month] = yearMonth.split("-").map(Number);
  return `${year}年${month}月`;
}

/**
 * 月カレンダーの週配列(日曜始まり)を生成する。
 * 各週は7マスで、月に属さないマスは null で埋める。
 */
export function buildCalendarWeeks(yearMonth: string): CalendarCell[][] {
  const [year, month] = yearMonth.split("-").map(Number);
  const firstWeekday = calendarWeekday(`${yearMonth}-01`);
  // 翌月0日 = 当月末日
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();

  const cells: CalendarCell[] = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let day = 1; day <= daysInMonth; day++) {
    cells.push({ date: `${yearMonth}-${String(day).padStart(2, "0")}`, day });
  }
  while (cells.length % 7 !== 0) cells.push(null);

  const weeks: CalendarCell[][] = [];
  for (let i = 0; i < cells.length; i += 7) {
    weeks.push(cells.slice(i, i + 7));
  }
  return weeks;
}

/**
 * カレンダー上で日付を選択できるかを判定する。
 * 無効: 過去・受付期間(booking_window_days)外・定休日
 * (行がない曜日は休業として扱う: booking-data.ts と同じ判定)。
 */
export function isSelectableDate(params: {
  date: string;
  businessHours: Array<{ weekday: number; isOpen: boolean }>;
  policy: BookingPolicy;
  now: Date;
}): boolean {
  const { date, businessHours, policy, now } = params;
  if (!isWithinBookingWindow(date, policy, now)) return false;
  const weekday = calendarWeekday(date);
  const day = businessHours.find((hours) => hours.weekday === weekday);
  return day?.isOpen === true;
}

/**
 * その月へカレンダーを移動できるかを判定する。
 * 今日の属する月から、受付期間の最終日が属する月までを移動可能とする。
 */
export function canMoveToMonth(
  yearMonth: string,
  policy: BookingPolicy,
  now: Date,
): boolean {
  const today = jstCalendarDate(now);
  const windowEnd = addCalendarDays(today, policy.bookingWindowDays);
  return yearMonth >= today.slice(0, 7) && `${yearMonth}-01` <= windowEnd;
}

/** 開始時刻(UTC)をJSTの「10:00」形式にする(時は先頭0なし・分は2桁) */
export function formatJstTime(at: Date): string {
  const jst = new Date(at.getTime() + 9 * 60 * 60 * 1000);
  return `${jst.getUTCHours()}:${String(jst.getUTCMinutes()).padStart(2, "0")}`;
}

/** JSTの暦日("YYYY-MM-DD")を「7月18日(土)」形式にする */
export function calendarDateLabel(date: string): string {
  const [, month, day] = date.split("-").map(Number);
  return `${month}月${day}日(${WEEKDAY_LABELS[calendarWeekday(date)]})`;
}
