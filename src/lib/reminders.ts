// 前日リマインド(M5)の判断ロジック(純粋関数)。
// 送ってよい時間帯・翌日の範囲・送る予約の選別・無料枠の残りを扱う。
// 時刻はすべてJSTの壁時計で判断する(Workers は UTC で動く。JST = UTC+9 固定)。
// 送信と記録は src/server/reminders.ts が担う。

import { PUSH_MONTHLY_FREE_LIMIT } from "./dashboard";
import { addCalendarDays, jstCalendarDate, jstDateTime, jstParts } from "./jst";

/** 送信時刻を過ぎていても、この時(21時台)より遅くは送らない(夜中に届くのを避ける) */
export const LATEST_SEND_HOUR = 21;

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
  const hour = jstParts(now).hours;
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

/** push_messages の一意制約違反(PostgreSQL のエラーコード unique_violation) */
const UNIQUE_VIOLATION = "23505";

/**
 * push_messages への insert の結果(エラーコード。成功なら null)から、記録が残っているかを返す。
 * 一意インデックス(1予約1通)に弾かれた 23505 は、前の実行で記録済みなので成功扱いにする。
 */
export function isPushMessageRecorded(insertErrorCode: string | null): boolean {
  return insertErrorCode === null || insertErrorCode === UNIQUE_VIOLATION;
}

/**
 * 予約1件ごとの結果。
 * sent: 送信して記録した / alreadyAccepted: 同じリトライキーで受理済み(409)で記録した /
 * failed: 送信または記録に失敗した(次の時間に再試行される) / skippedByQuota: 無料枠を使い切って送らなかった
 */
export type ReminderOutcome =
  "sent" | "alreadyAccepted" | "failed" | "skippedByQuota";

/** 1回の実行の状態。done: 送ってよい時間帯で処理した / それ以外: 送れない理由 */
export type ReminderRunStatus =
  "done" | Extract<ReminderWindow, { sendable: false }>["reason"];

/** 1回の実行の集計(Cron のルートが JSON で返し、ログにも残す) */
export type ReminderRunSummary = {
  status: ReminderRunStatus;
} & Record<ReminderOutcome, number>;

/** 予約ごとの結果を種類別に数える。送れない時間帯なら outcomes は空 */
export function summarizeReminderRun(
  status: ReminderRunStatus,
  outcomes: readonly ReminderOutcome[],
): ReminderRunSummary {
  const summary: ReminderRunSummary = {
    status,
    sent: 0,
    alreadyAccepted: 0,
    failed: 0,
    skippedByQuota: 0,
  };
  for (const outcome of outcomes) summary[outcome]++;
  return summary;
}
