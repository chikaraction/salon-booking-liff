// フォームの入力値と保存値を比べる・表示するための整形(純粋関数)。
// 依存の向きを増やさないよう、どのドメインのファイルにも依存しない。
// DOM・Supabaseクライアントのimportはしない(CLAUDE.md)。

/**
 * DBの time 型("HH:MM:SS")を input[type=time] が扱う "HH:MM" にする。
 * NULL・空文字は空文字(未入力)にする。
 */
export function normalizeTimeInput(value: string | null): string {
  if (value === null || value === "") return "";
  return value.slice(0, 5);
}

/**
 * 時刻入力を**比較用**に揃える(保存はしない)。
 * 見た目が違っても保存結果が同じになる差を潰すのが目的:
 * - 前後の空白(手入力・貼り付け)
 * - 時が1桁("9:00" と "09:00"。input[type=time] は2桁で返すが、
 *   DBから来た値やブラウザ差で1桁が混ざっても同じ時刻として扱う)
 * - 秒("HH:MM:SS"。DBの time 型。normalizeTimeInput 前の値が混ざっても揃う)
 *
 * 時刻として読めない値は前後の空白だけ落として返す(比較はできる。
 * 不正な入力を弾くのは各設定の検証関数の仕事)。
 */
export function canonicalTimeInput(value: string): string {
  const trimmed = value.trim();
  const matched = /^(\d{1,2}):([0-5]\d)(?::[0-5]\d)?$/.exec(trimmed);
  if (matched === null) return trimmed;
  return `${matched[1].padStart(2, "0")}:${matched[2]}`;
}

/**
 * 整数の入力欄を**比較用**に揃える(保存はしない)。
 * 前後の空白と桁揃え("30" と " 030 ")を潰す。整数として読めない値は
 * 前後の空白だけ落として返す(不正な入力を弾くのは各設定の検証関数の仕事)。
 */
export function canonicalIntegerInput(value: string): string {
  const trimmed = value.trim();
  if (trimmed === "") return "";
  const parsed = Number(trimmed);
  return Number.isInteger(parsed) ? String(parsed) : trimmed;
}

/**
 * 曜日ごとの値で、保存済み(saved)と編集中(draft)に差がある曜日を昇順で返す。
 * 空配列なら「変更なし」。
 * 1曜日ぶんの値は canonical で比較用の文字列に直してから比べるので、
 * 「同じ値」の定義(保存結果が同じか)は canonical を渡す側が決める。
 * 曜日は weekday どうしで突き合わせるので、入力の並び順には左右されない。
 * 片方にしか無い曜日は差として返す。
 */
export function changedWeekdays<T extends { weekday: number }>(
  saved: readonly T[],
  draft: readonly T[],
  canonical: (day: T) => string,
): number[] {
  const toMap = (days: readonly T[]) =>
    new Map(days.map((day) => [day.weekday, canonical(day)]));
  const savedMap = toMap(saved);
  const draftMap = toMap(draft);

  return [...new Set([...savedMap.keys(), ...draftMap.keys()])]
    .filter((weekday) => savedMap.get(weekday) !== draftMap.get(weekday))
    .sort((a, b) => a - b);
}
