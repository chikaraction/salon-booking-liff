// 空き枠計算(純粋関数)。
// 営業時間・勤務時間は店舗ローカル(JST)の壁時計時刻、予約はUTCのDateで扱う。
// JSTとUTCの変換は jst.ts に任せる(JST = UTC+9 固定)。
// このロジックはUX向上のための表示用フィルタであり、
// ダブルブッキング防止の最後の砦はDBのEXCLUDE制約(ADR-004)。

import {
  addCalendarDays,
  jstCalendarDate,
  jstDateTime,
  timeToMinutes,
} from "./jst";

export type BookingPolicy = {
  slotIntervalMinutes: number;
  bookingWindowDays: number;
  minLeadMinutes: number;
};

export type BusinessDay = {
  isOpen: boolean;
  openTime: string | null; // "09:00" または "09:00:00"
  closeTime: string | null;
};

export type StaffWorkingDay = {
  startTime: string;
  endTime: string;
  breakStart: string | null;
  breakEnd: string | null;
};

export type BusyRange = {
  start: Date;
  end: Date; // [start, end) の半開区間
};

export type SlotStatus = "available" | "taken";

export type Slot = {
  start: Date;
  status: SlotStatus;
};

export type StaffSlots = {
  staffId: string;
  slots: Slot[];
};

const MINUTE_MS = 60 * 1000;

/** 今日(JST)から booking_window_days 日後までの日付だけ予約を受け付ける */
export function isWithinBookingWindow(
  date: string,
  policy: BookingPolicy,
  now: Date,
): boolean {
  const today = jstCalendarDate(now);
  return (
    date >= today && date <= addCalendarDays(today, policy.bookingWindowDays)
  );
}

/**
 * 1スタッフ・1日分の開始時刻候補を列挙する。
 *
 * - 候補は営業開始時刻を基準に slot_interval_minutes 刻み
 * - 勤務時間(休憩除く)と営業時間の両方に所要時間が収まらない時刻、
 *   直前締切(min_lead_minutes)を過ぎた時刻はリストに含めない(画面に出さない)
 * - 既存の確定済み予約・ブロックと重なる時刻は「埋まり(taken)」として残す
 *   (モック準拠: 取り消し線表示)
 * - isClosedDay は休業日ルール(第◯曜日・祝日・指定日: M4)の受け口
 */
export function computeStaffDaySlots(params: {
  date: string; // JSTの暦日 "YYYY-MM-DD"
  durationMinutes: number;
  businessDay: BusinessDay;
  isClosedDay?: boolean;
  working: StaffWorkingDay | null; // その曜日の勤務パターン(なければ休み)
  busy: BusyRange[];
  policy: BookingPolicy;
  now: Date;
}): Slot[] {
  const {
    date,
    durationMinutes,
    businessDay,
    isClosedDay,
    working,
    busy,
    policy,
    now,
  } = params;

  if (
    isClosedDay ||
    !businessDay.isOpen ||
    !businessDay.openTime ||
    !businessDay.closeTime
  ) {
    return [];
  }
  if (!working) return [];
  if (!isWithinBookingWindow(date, policy, now)) return [];

  const open = timeToMinutes(businessDay.openTime);
  const close = timeToMinutes(businessDay.closeTime);

  // 勤務区間 = 営業時間 ∩ 勤務時間 から休憩を除いたもの(分単位)
  const workStart = Math.max(open, timeToMinutes(working.startTime));
  const workEnd = Math.min(close, timeToMinutes(working.endTime));
  const workRanges: Array<[number, number]> = [];
  if (working.breakStart && working.breakEnd) {
    workRanges.push([
      workStart,
      Math.min(workEnd, timeToMinutes(working.breakStart)),
    ]);
    workRanges.push([
      Math.max(workStart, timeToMinutes(working.breakEnd)),
      workEnd,
    ]);
  } else {
    workRanges.push([workStart, workEnd]);
  }

  const dayStart = jstDateTime(date, "00:00");
  const leadLimit = now.getTime() + policy.minLeadMinutes * MINUTE_MS;

  const slots: Slot[] = [];
  for (
    let t = open;
    t + durationMinutes <= close;
    t += policy.slotIntervalMinutes
  ) {
    const fitsWork = workRanges.some(
      ([from, to]) => from <= t && t + durationMinutes <= to,
    );
    if (!fitsWork) continue;

    const start = new Date(dayStart.getTime() + t * MINUTE_MS);
    if (start.getTime() < leadLimit) continue;

    const end = new Date(start.getTime() + durationMinutes * MINUTE_MS);
    const taken = busy.some((b) => start < b.end && b.start < end);
    slots.push({ start, status: taken ? "taken" : "available" });
  }
  return slots;
}

/**
 * 「どちらでも」用にスタッフごとの候補を統合する。
 * 同じ開始時刻は、いずれかのスタッフが空いていれば「空き」になる。
 */
export function mergeStaffSlots(slotLists: Slot[][]): Slot[] {
  const byStart = new Map<number, Slot>();
  for (const slots of slotLists) {
    for (const slot of slots) {
      const key = slot.start.getTime();
      const existing = byStart.get(key);
      if (
        !existing ||
        (existing.status === "taken" && slot.status === "available")
      ) {
        byStart.set(key, slot);
      }
    }
  }
  return [...byStart.values()].sort(
    (a, b) => a.start.getTime() - b.start.getTime(),
  );
}

/**
 * 「どちらでも」の担当割当: その開始時刻が空いているスタッフのうち先頭を選ぶ。
 * 呼び出し側は perStaff を display_order 順で渡すこと(実質オーナー優先)。
 */
export function pickStaffForStart(
  perStaff: StaffSlots[],
  start: Date,
): string | null {
  for (const { staffId, slots } of perStaff) {
    const slot = slots.find((s) => s.start.getTime() === start.getTime());
    if (slot?.status === "available") return staffId;
  }
  return null;
}
