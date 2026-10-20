// ダッシュボード小物(モックG)とサイドバーのミニ集計の判断ロジック(純粋関数)。
// 月の範囲・先月比の文言・スタッフ別内訳・LINEプッシュ無料枠の状態を扱う。
// データ取得は src/server/admin-data.ts の getDashboardSummary が担う。

import { addMonths } from "./calendar";

/**
 * LINE公式アカウント(コミュニケーションプラン)の月間無料メッセージ数。
 * LINEの料金プランの仕様値であり、店舗固有の設定値ではない(ADR-007の対象外)。
 * 使用量バーの分母に使う(ADR-002)。
 */
export const PUSH_MONTHLY_FREE_LIMIT = 200;

/** 管理画面に警告を出すしきい値。この通数を「超えたら」警告する(ADR-002) */
export const PUSH_WARNING_THRESHOLD = 150;

/** JST暦日の範囲 [start, endExclusive)("YYYY-MM-DD") */
export type DateRange = { start: string; endExclusive: string };

/** 年月("YYYY-MM")の月初から翌月初までの範囲 */
function monthRange(yearMonth: string): DateRange {
  return {
    start: `${yearMonth}-01`,
    endExclusive: `${addMonths(yearMonth, 1)}-01`,
  };
}

/** JST暦日("YYYY-MM-DD")から今月・先月の範囲を返す(1月の先月は前年12月) */
export function monthRanges(today: string): {
  thisMonth: DateRange;
  lastMonth: DateRange;
} {
  const yearMonth = today.slice(0, 7);
  return {
    thisMonth: monthRange(yearMonth),
    lastMonth: monthRange(addMonths(yearMonth, -1)),
  };
}

/** 先月比の文言。減少は U+2212(マイナス記号)、同数は「±0件」 */
export function formatMonthOverMonth(
  thisMonth: number,
  lastMonth: number,
): string {
  const diff = thisMonth - lastMonth;
  const signed = diff > 0 ? `+${diff}` : diff < 0 ? `−${Math.abs(diff)}` : "±0";
  return `先月比 ${signed}件`;
}

export type DashboardStaff = {
  id: string;
  name: string;
  isActive: boolean;
  displayOrder: number;
};

export type StaffDayCount = { staffId: string; name: string; count: number };

/**
 * 今日の予約(担当スタッフIDの一覧)をスタッフ別に数える。
 * - 並びは displayOrder 昇順(同値は id 順)
 * - 有効なスタッフは0件でも含める
 * - 無効化済みのスタッフは当日予約が1件以上あるときだけ含める
 *   (件数の合計と内訳が食い違わないように)
 * - スタッフ一覧に無いIDの予約は内訳に出さない(合計件数は別に数える)
 */
export function summarizeTodayByStaff(
  reservationStaffIds: string[],
  staff: DashboardStaff[],
): StaffDayCount[] {
  const counts = new Map<string, number>();
  for (const staffId of reservationStaffIds) {
    counts.set(staffId, (counts.get(staffId) ?? 0) + 1);
  }
  return [...staff]
    .sort(
      (a, b) =>
        a.displayOrder - b.displayOrder ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    )
    .map((member) => ({
      staffId: member.id,
      name: member.name,
      count: counts.get(member.id) ?? 0,
      isActive: member.isActive,
    }))
    .filter((row) => row.isActive || row.count > 0)
    .map(({ staffId, name, count }) => ({ staffId, name, count }));
}

/** 内訳を「名前 n件 ・ 名前 n件」の1行にする。空なら空文字 */
export function formatStaffBreakdown(summary: StaffDayCount[]): string {
  return summary.map((row) => `${row.name} ${row.count}件`).join(" ・ ");
}

/** ok: しきい値以下 / warning: しきい値超〜無料枠まで / over: 無料枠超 */
export type PushQuotaLevel = "ok" | "warning" | "over";

export type PushQuotaStatus = {
  count: number;
  limit: number;
  /** 無料枠の残り(0未満にしない) */
  remaining: number;
  /** 使用量バーの比率(0〜1で頭打ち) */
  ratio: number;
  level: PushQuotaLevel;
};

/** 今月のプッシュ送信数から無料枠に対する状態を求める */
export function pushQuotaStatus(count: number): PushQuotaStatus {
  const limit = PUSH_MONTHLY_FREE_LIMIT;
  const level: PushQuotaLevel =
    count > limit ? "over" : count > PUSH_WARNING_THRESHOLD ? "warning" : "ok";
  return {
    count,
    limit,
    remaining: Math.max(limit - count, 0),
    ratio: Math.min(Math.max(count / limit, 0), 1),
    level,
  };
}

/** ダッシュボードのカードに出す説明文 */
export function pushQuotaMessage(status: PushQuotaStatus): string {
  switch (status.level) {
    case "ok":
      return `残り${status.remaining}通。前日リマインドで使用しています。`;
    case "warning":
      return `今月の送信数が${PUSH_WARNING_THRESHOLD}通を超えました。残り${status.remaining}通です。`;
    case "over":
      return `無料枠の${status.limit}通を超えました。超過分は送信できない可能性があります。`;
  }
}

/** サイドバーのミニ集計に出す短い警告。ok は null(出さない) */
export function pushQuotaShortMessage(status: PushQuotaStatus): string | null {
  switch (status.level) {
    case "ok":
      return null;
    case "warning":
      return `${PUSH_WARNING_THRESHOLD}通を超えました`;
    case "over":
      return "無料枠を超えました";
  }
}
