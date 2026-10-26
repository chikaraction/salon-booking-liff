// マイ予約画面(M3)の判断ロジック(純粋関数)。
// 残り日数ラベル・キャンセル/変更可否・予約カードの表示整形を扱う。
// 日時の前提は availability.ts / booking.ts と同じ(JST = UTC+9 固定)。

import {
  formatJstDateTimeLabel,
  formatYen,
  menuNamesLabel,
  summarizeSelectedMenus,
} from "./booking";
import { jstCalendarDate } from "./jst";

const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

/** JSTの暦日差(start − now、日数)を返す */
function jstCalendarDayDiff(now: Date, start: Date): number {
  return Math.round(
    (Date.parse(`${jstCalendarDate(start)}T00:00:00Z`) -
      Date.parse(`${jstCalendarDate(now)}T00:00:00Z`)) /
      DAY_MS,
  );
}

/**
 * 予約カード右上の残り日数ラベル。時刻ではなくJST暦日の差で数える。
 * 当日は「本日」、1〜7日先は「あと◯日」、8日以上先は「◯月◯日」(ゼロ埋めなし)。
 * 過去の予約は入力に来ない前提だが、防御的に差が負でも「本日」を返す。
 */
export function remainingDaysLabel(now: Date, start: Date): string {
  const diffDays = jstCalendarDayDiff(now, start);
  if (diffDays <= 0) return "本日";
  if (diffDays <= 7) return `あと${diffDays}日`;
  const [, month, day] = jstCalendarDate(start).split("-").map(Number);
  return `${month}月${day}日`;
}

/**
 * 客自身がキャンセル・変更できるか(締切判定)。ちょうど締切時刻は可。
 * DBのRPCが `now() > start - deadline` で deadline_passed と判定するのと同じ境界。
 * この判定は表示用の補助で、最終判定はRPC内で行う(ADR-004と同じ発想)。
 */
export function canModifyReservation(
  now: Date,
  start: Date,
  cancelDeadlineMinutes: number,
): boolean {
  return now.getTime() <= start.getTime() - cancelDeadlineMinutes * MINUTE_MS;
}

/** reservation_menus スナップショット1行分(予約時点のメニュー名・料金・所要時間) */
export type ReservationMenuSnapshot = {
  menuName: string;
  price: number;
  durationMinutes: number;
};

/** サーバー層が渡す予約1件分の入力 */
export type ReservationCardInput = {
  id: string;
  start: Date;
  staffName: string;
  menus: ReservationMenuSnapshot[];
};

/** マイ予約一覧のカード1枚分(表示用文字列+可否判定に使う生値) */
export type ReservationCard = {
  id: string;
  start: Date;
  dateTimeLabel: string;
  menuStaffLabel: string;
  priceDurationLabel: string;
};

/**
 * 予約1件をカード表示用に整形する。
 * 表記は booking.ts の既存フォーマッタに合わせる(客側画面全体の一貫性のため)。
 */
export function buildReservationCard(
  input: ReservationCardInput,
): ReservationCard {
  const summary = summarizeSelectedMenus(input.menus);
  return {
    id: input.id,
    start: input.start,
    dateTimeLabel: formatJstDateTimeLabel(input.start),
    menuStaffLabel: `${menuNamesLabel(input.menus.map((m) => m.menuName))} / ${input.staffName}`,
    priceDurationLabel: `${formatYen(summary.totalPrice)} ・ 約${summary.totalDurationMinutes}分`,
  };
}
