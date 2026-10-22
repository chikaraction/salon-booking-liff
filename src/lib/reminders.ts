// 前日リマインド(M5)の判断ロジック(純粋関数)。
// 送ってよい時間帯・翌日の範囲・送る予約の選別・無料枠の残りを扱う。
// 時刻はすべてJSTの壁時計で判断する(Workers は UTC で動く。JST = UTC+9 固定)。
// 送信と記録は src/server/reminders.ts が担う。

import { addCalendarDays, jstCalendarDate, jstDateTime } from "./availability";
import { PUSH_MONTHLY_FREE_LIMIT } from "./dashboard";

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** 送信時刻を過ぎていても、この時(21時台)より遅くは送らない(夜中に届くのを避ける) */
const LATEST_SEND_HOUR = 21;

/** 翌日(JST)の範囲 [start, endExclusive) */
export type ReminderDayRange = { start: Date; endExclusive: Date };

/**
 * 送ってよいなら翌日の範囲、送れないならその理由。
 * before_send_hour: 当日の送信時刻より前 / too_late: 夜遅すぎる
 */
export type ReminderWindow =
  | ({ sendable: true } & ReminderDayRange)
  | { sendable: false; reason: "before_send_hour" | "too_late" };

/** 時刻 "HH:00"(reminderHour は 0〜23 の整数) */
function hourTime(hour: number): string {
  return `${String(hour).padStart(2, "0")}:00`;
}

/**
 * いまが前日リマインドを送ってよい時間帯かを判定し、対象の「翌日(JST)」の範囲を返す。
 * 送ってよいのは JST の時が reminderHour 〜 max(reminderHour, 21) の間
 * (Cron は毎時なので、送信時刻を過ぎたら失敗しても次の時間に送り直せる。
 * 送信時刻自体が22・23時なら、その時だけ)。
 */
export function reminderWindow(
  now: Date,
  reminderHour: number,
): ReminderWindow {
  const hour = new Date(now.getTime() + JST_OFFSET_MS).getUTCHours();
  if (hour < reminderHour)
    return { sendable: false, reason: "before_send_hour" };
  if (hour > Math.max(reminderHour, LATEST_SEND_HOUR)) {
    return { sendable: false, reason: "too_late" };
  }
  const tomorrow = addCalendarDays(jstCalendarDate(now), 1);
  return {
    sendable: true,
    start: jstDateTime(tomorrow, "00:00"),
    endExclusive: jstDateTime(addCalendarDays(tomorrow, 1), "00:00"),
  };
}

export type ReminderReservation = {
  id: string;
  kind: string;
  status: string;
  startsAt: Date;
  createdAt: Date;
  lineUserId: string | null;
};

/**
 * 前日リマインドを送る予約を開始時刻順に返す。対象は
 * 予約(kind = booking)・確定済み・LINEのユーザーIDあり・開始が翌日の範囲内・未送信で、
 * 当日(JST)の送信時刻(reminderHour:00)より前に作成されたもの。
 * 送信時刻の後に入った翌日の予約は、直前に確認メッセージを受け取っているので送らない。
 */
export function selectReminderTargets<T extends ReminderReservation>(
  reservations: readonly T[],
  alreadySentReservationIds: Iterable<string>,
  window: ReminderDayRange,
  reminderHour: number,
): T[] {
  const sent = new Set(alreadySentReservationIds);
  const today = addCalendarDays(jstCalendarDate(window.start), -1);
  const sendAt = jstDateTime(today, hourTime(reminderHour));
  return reservations
    .filter(
      (r) =>
        r.kind === "booking" &&
        r.status === "confirmed" &&
        !!r.lineUserId &&
        window.start <= r.startsAt &&
        r.startsAt < window.endExclusive &&
        !sent.has(r.id) &&
        r.createdAt < sendAt,
    )
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
}

/** 今月のプッシュ送信数が無料枠(ADR-002)未満なら送ってよい。使い切ったら送らない */
export function canSendPush(monthCount: number): boolean {
  return monthCount < PUSH_MONTHLY_FREE_LIMIT;
}
