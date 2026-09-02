// 休業日判定(純粋関数)。「店が休む」= closed / closure、「日本の祝日」= holiday
// という用語の使い分けは docs/milestone-4b-plan.md の決定に従う。
//
// 休業のルールは4種類あり、優先順位は次のとおり(上が強い):
//   1. date_overrides(臨時休業・臨時営業。日付範囲の上書き)
//   2. 祝日(salon_settings.close_on_holidays が true のときだけ)
//   3. nth_weekday_closures(第◯曜日の定休。例: 毎月第3日曜)
//   4. business_hours.is_open(毎週固定の定休。行がない曜日も休業扱い)
//
// 祝日は japanese-holidays の getHolidaysOf(year) だけで求める。
// isHoliday(date) は Date#getMonth()/getDate() という実行環境のローカル時刻で
// 判定するため、UTCで動く本番環境ではJSTの暦日とずれる(実物で確認済み)。

import { getHolidaysOf } from "japanese-holidays";

import { addCalendarDays, calendarWeekday } from "./availability";
import { calendarDateLabel } from "./calendar";

export type ClosureRules = {
  /** 毎週の定休(weekday 0=日曜〜6=土曜)。行がない曜日は休業として扱う */
  businessHours: Array<{ weekday: number; isOpen: boolean }>;
  /** 第◯曜日の定休(nth は1〜5) */
  nthWeekdayClosures: Array<{ weekday: number; nth: number }>;
  /** 日本の祝日を自動で休業扱いにするか */
  closeOnHolidays: boolean;
  /** 臨時休業・臨時営業(両端を含む日付範囲) */
  overrides: Array<{
    startDate: string;
    endDate: string;
    isOpen: boolean;
    label: string | null;
  }>;
};

export type ClosureReason = "override" | "holiday" | "nth-weekday" | "weekly";

export type DayClosure = {
  isClosed: boolean;
  /** どのルールで決まったか(営業日は null) */
  reason: ClosureReason | null;
  /** 「海の日」「夏季休業」など。定休には付かない */
  label: string | null;
};

/** モックE-2下部の混在リスト1行分 */
export type ClosureListItem = {
  /** 「7月29日(水)」「8月13日(木)〜16日(日)」 */
  dateRangeLabel: string;
  /** 「夏季休業」「海の日・祝日」 */
  label: string;
  badge: "休業" | "臨時休" | "連休" | "臨時営業";
};

// ---------------------------------------------------------------------------
// 第◯曜日
// ---------------------------------------------------------------------------

/**
 * その月の第何◯曜日かを返す(1〜5)。
 * 曜日は関係なく日付だけで決まる(1〜7日が第1週、8〜14日が第2週…)。
 * 第5週はその曜日が月内に5回ある月にしか現れない。
 */
export function nthWeekdayOfMonth(date: string): number {
  const day = Number(date.slice(8, 10));
  return Math.floor((day - 1) / 7) + 1;
}

// ---------------------------------------------------------------------------
// 祝日
// ---------------------------------------------------------------------------

/** 年ごとの「MM-DD → 祝日名」。同じ年を何度も引くのでモジュール内でメモ化する */
const holidaysByYear = new Map<number, Map<string, string>>();

function holidayMapOf(year: number): Map<string, string> {
  const cached = holidaysByYear.get(year);
  if (cached !== undefined) return cached;
  const map = new Map<string, string>();
  for (const holiday of getHolidaysOf(year)) {
    const key = `${String(holiday.month).padStart(2, "0")}-${String(
      holiday.date,
    ).padStart(2, "0")}`;
    map.set(key, holiday.name);
  }
  holidaysByYear.set(year, map);
  return map;
}

/** JSTの暦日("YYYY-MM-DD")が祝日ならその名前、祝日でなければ null */
export function japaneseHolidayName(date: string): string | null {
  const year = Number(date.slice(0, 4));
  return holidayMapOf(year).get(date.slice(5, 10)) ?? null;
}

// ---------------------------------------------------------------------------
// 休業日判定
// ---------------------------------------------------------------------------

/** その日を含む上書き(date_overrides)を返す。両端を含む */
function findOverride(
  date: string,
  overrides: ClosureRules["overrides"],
): ClosureRules["overrides"][number] | undefined {
  // 暦日は "YYYY-MM-DD" 固定長なので文字列比較で日付比較になる
  return overrides.find(
    (override) => override.startDate <= date && date <= override.endDate,
  );
}

/**
 * その日が休業かを、理由・ラベル付きで判定する。
 * 上書き(臨時営業)は isClosed=false でも reason は "override" のまま返す
 * (「祝日・定休だが営業する」という判断の出どころを呼び出し側に残す)。
 */
export function resolveDayClosure(
  date: string,
  rules: ClosureRules,
): DayClosure {
  // 1. 日付上書き(もっとも強い。営業にも休業にもできる)
  const override = findOverride(date, rules.overrides);
  if (override !== undefined) {
    return {
      isClosed: !override.isOpen,
      reason: "override",
      label: override.label,
    };
  }

  // 2. 祝日(トグルがONのときだけ)
  if (rules.closeOnHolidays) {
    const holidayName = japaneseHolidayName(date);
    if (holidayName !== null) {
      return { isClosed: true, reason: "holiday", label: holidayName };
    }
  }

  const weekday = calendarWeekday(date);

  // 3. 第◯曜日の定休
  const nth = nthWeekdayOfMonth(date);
  const isNthClosure = rules.nthWeekdayClosures.some(
    (closure) => closure.weekday === weekday && closure.nth === nth,
  );
  if (isNthClosure) {
    return { isClosed: true, reason: "nth-weekday", label: null };
  }

  // 4. 毎週の定休(行がない曜日も休業として扱う)
  const businessDay = rules.businessHours.find(
    (hours) => hours.weekday === weekday,
  );
  if (businessDay?.isOpen !== true) {
    return { isClosed: true, reason: "weekly", label: null };
  }

  return { isClosed: false, reason: null, label: null };
}

/**
 * 休業日判定を1引数の関数にする。
 * buildWeekView の isClosedDay(admin-calendar.ts)・isSelectableDate
 * (calendar.ts)の受け口にそのまま嵌る形。
 */
export function makeIsClosedDay(
  rules: ClosureRules,
): (date: string) => boolean {
  return (date) => resolveDayClosure(date, rules).isClosed;
}

// ---------------------------------------------------------------------------
// モックE-2下部の混在リスト(臨時休業・連休 + 自動導出の祝日)
// ---------------------------------------------------------------------------

/** 範囲の表示ラベル。単日は1日分、複数日は終端を足す(同月なら日から) */
function dateRangeLabel(startDate: string, endDate: string): string {
  const startLabel = calendarDateLabel(startDate);
  if (startDate === endDate) return startLabel;
  // 「8月16日(日)」。同じ年月なら先頭の「8月」を落として「16日(日)」にし、
  // 月(年)が変われば月から表記する(週表示の weekNavLabel と同じ方針)
  const endLabel = calendarDateLabel(endDate);
  const endPart =
    startDate.slice(0, 7) === endDate.slice(0, 7)
      ? endLabel.slice(endLabel.indexOf("月") + 1)
      : endLabel;
  return `${startLabel}〜${endPart}`;
}

/** 上書き1件のバッジ。臨時営業 > 連休(複数日)> 臨時休(単日) */
function overrideBadge(override: {
  startDate: string;
  endDate: string;
  isOpen: boolean;
}): ClosureListItem["badge"] {
  if (override.isOpen) return "臨時営業";
  return override.startDate === override.endDate ? "臨時休" : "連休";
}

/**
 * モックE-2下部の混在リストを組み立てる。
 * - 上書き(臨時休業・連休・臨時営業)は登録データなので期間ごとに1行
 *   (日ごとには展開しない)
 * - 祝日は自動導出の読み取り専用行。「祝日を休業にする」がONのときだけ載せ、
 *   臨時営業(is_open=true)で上書きされた祝日は休業ではないので載せない
 * - 毎週の定休・第◯曜日の定休は載せない(モックでは上部の別UIが担当する)
 * 並びは日付順。同じ日付なら登録データ(上書き)を先にする。
 */
export function buildClosureListItems(params: {
  /** 期間の開始(JSTの暦日) */
  from: string;
  /** 期間の日数(from を1日目として days 日ぶん) */
  days: number;
  rules: ClosureRules;
}): ClosureListItem[] {
  const { from, days, rules } = params;
  const until = addCalendarDays(from, Math.max(days, 1) - 1);

  const rows: Array<{ sortKey: string; item: ClosureListItem }> = [];

  // 1. 期間に1日でも掛かる上書き
  for (const override of rules.overrides) {
    if (override.endDate < from || until < override.startDate) continue;
    rows.push({
      sortKey: override.startDate,
      item: {
        dateRangeLabel: dateRangeLabel(override.startDate, override.endDate),
        label: override.label ?? "",
        badge: overrideBadge(override),
      },
    });
  }

  // 2. 期間内の祝日(トグルON時のみ。臨時営業で上書きされた日は除く)
  if (rules.closeOnHolidays) {
    for (let date = from; date <= until; date = addCalendarDays(date, 1)) {
      const holidayName = japaneseHolidayName(date);
      if (holidayName === null) continue;
      if (findOverride(date, rules.overrides)?.isOpen === true) continue;
      rows.push({
        sortKey: date,
        item: {
          dateRangeLabel: calendarDateLabel(date),
          label: `${holidayName}・祝日`,
          badge: "休業",
        },
      });
    }
  }

  // Array#sort は安定なので、同じ日付では上書き(先に積んだ)が祝日より前に出る
  return rows
    .sort((a, b) => a.sortKey.localeCompare(b.sortKey))
    .map((row) => row.item);
}
