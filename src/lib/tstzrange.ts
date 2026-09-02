// PostgreSQLのtstzrange文字列をDateの半開区間に変換する(純粋関数)。
//
// PostgREST(supabase-js)はtstzrange列を
//   ["2026-07-18 02:00:00+00","2026-07-18 03:00:00+00")
// のような文字列で返す(@supabase/postgrest-js の型定義内 exampleResponse で確認)。
// reservations.during はCHECK制約で「空でない [開始, 終了) の半開区間」に
// 正規化されているため、この形式以外は想定外としてエラーにする。

import type { BusyRange } from "./availability";

/**
 * tstzrangeの境界のタイムスタンプをDateが解釈できるISO 8601形式に正規化する。
 * - 日付と時刻の区切りの空白を "T" にする
 * - "+00" / "+0900" 形式のUTCオフセットを "+00:00" 形式にする
 */
function toIsoTimestamp(raw: string): string {
  let ts = raw.trim().replace(" ", "T");
  if (/[+-]\d{2}$/.test(ts)) {
    // 例: "+00" → "+00:00"
    ts = `${ts}:00`;
  } else if (/[+-]\d{4}$/.test(ts)) {
    // 例: "+0900" → "+09:00"
    ts = `${ts.slice(0, -2)}:${ts.slice(-2)}`;
  }
  return ts;
}

/** tstzrange文字列を { start, end }(いずれもUTCのDate)に変換する */
export function parseTstzrange(value: string): BusyRange {
  // 境界のタイムスタンプは空白を含むためPostgreSQLが二重引用符で囲む
  const match = /^\["?([^",]+?)"?\s*,\s*"?([^",]+?)"?\)$/.exec(value.trim());
  if (!match) {
    throw new Error(`tstzrangeとして解釈できない値です: ${value}`);
  }

  const start = new Date(toIsoTimestamp(match[1]));
  const end = new Date(toIsoTimestamp(match[2]));
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new Error(`tstzrangeの時刻を解釈できません: ${value}`);
  }
  return { start, end };
}

/**
 * Dateの半開区間を tstzrange のリテラル文字列にする(parseTstzrange の逆)。
 * reservations.during へ書き込むときに使う。境界はUTCのISO 8601で書き、
 * 上端を含めない "[開始, 終了)" にする(CHECK制約
 * lower_inc(during) and not upper_inc(during) と同じ形)。
 */
export function formatTstzrange(start: Date, end: Date): string {
  return `[${start.toISOString()},${end.toISOString()})`;
}
