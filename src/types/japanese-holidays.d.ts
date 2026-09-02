// japanese-holidays(MIT・依存なし)は型定義を同梱していないため自前で置く。
//
// 宣言するのは getHolidaysOf だけ。同ライブラリの isHoliday / isHolidayAt は
// Date#getMonth()/getDate() という実行環境のローカル時刻で判定するため、
// UTCで動く本番環境ではJSTの暦日とずれる(docs/milestone-4b-plan.md「祝日の扱い」)。
// getHolidaysOf の戻り値は { month, date, name } でタイムゾーンに依存しない。
declare module "japanese-holidays" {
  /**
   * 指定年の祝日一覧(月日の昇順)。
   * furikae は振替休日を含めるか(既定 true)。
   */
  export function getHolidaysOf(
    year: number,
    furikae?: boolean,
  ): Array<{ month: number; date: number; name: string }>;
}
