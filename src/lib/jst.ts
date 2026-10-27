// 日本時間(JST)の基本関数(純粋関数)。DOM・Supabaseクライアントはimportしない。
//
// 日時の前提: 店舗はJST(UTC+9固定、夏時間なし)。
// 予約などの瞬間はUTCのDate、営業時間・勤務時間は店舗ローカル(JST)の壁時計時刻、
// 暦日は "YYYY-MM-DD" の文字列で扱う。
// UTC⇔JSTの9時間ずらしはこのファイルの中だけに置き、ほかのファイルは
// ここの関数(jstParts など)を使う。

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

/** 曜日の短いラベル。添字は 0=日曜〜6=土曜(DBのweekday列・calendarWeekday と同じ) */
export const WEEKDAY_LABELS = [
  "日",
  "月",
  "火",
  "水",
  "木",
  "金",
  "土",
] as const;

/** JSTの壁時計に分解した日時。month は1〜12、weekday は0=日曜〜6=土曜 */
export type JstParts = {
  year: number;
  month: number;
  day: number;
  weekday: number;
  hours: number;
  minutes: number;
};

/** UTCの瞬間をJSTの壁時計(年・月・日・曜日・時・分)に分解する。秒以下は切り捨て */
export function jstParts(at: Date): JstParts {
  // JSTぶんずらしたDateをUTCとして読むと、JSTの壁時計の値になる
  const jst = new Date(at.getTime() + JST_OFFSET_MS);
  return {
    year: jst.getUTCFullYear(),
    month: jst.getUTCMonth() + 1,
    day: jst.getUTCDate(),
    weekday: jst.getUTCDay(),
    hours: jst.getUTCHours(),
    minutes: jst.getUTCMinutes(),
  };
}

/** 数値を2桁にゼロ埋めする("5" → "05") */
function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/** "HH:MM" / "HH:MM:SS" を0時からの分数に変換する */
export function timeToMinutes(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

/** JSTの暦日("YYYY-MM-DD")と壁時計時刻をUTCのDateに変換する */
export function jstDateTime(date: string, time: string): Date {
  const midnight = new Date(`${date}T00:00:00+09:00`);
  return new Date(midnight.getTime() + timeToMinutes(time) * MINUTE_MS);
}

/** 0時からの分数を「13:00」形式にする(時は先頭0なし・分は2桁) */
export function minutesLabel(minutes: number): string {
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;
}

/** UTCのDateを対象日(JST)の0時からの分数に変換する */
export function jstMinutesOfDay(date: string, at: Date): number {
  const midnight = jstDateTime(date, "00:00");
  return Math.round((at.getTime() - midnight.getTime()) / MINUTE_MS);
}

/** UTCのDateをJSTの暦日("YYYY-MM-DD")に変換する */
export function jstCalendarDate(at: Date): string {
  return new Date(at.getTime() + JST_OFFSET_MS).toISOString().slice(0, 10);
}

/**
 * UTCのDateをJSTの壁時計時刻 "HH:MM"(24時間・時も分もゼロ埋め)にする。
 * <input type="time"> の value や isWallClockTime が受け付ける形式で、
 * 店側変更の初期時刻を既存予約の開始時刻から復元するのに使う。
 */
export function jstClockTime(at: Date): string {
  const { hours, minutes } = jstParts(at);
  return `${pad2(hours)}:${pad2(minutes)}`;
}

/** JSTの暦日にn日を加算する */
export function addCalendarDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** JSTの暦日("YYYY-MM-DD")の曜日を返す(0=日曜〜6=土曜。DBのweekday列と同じ) */
export function calendarWeekday(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

/** "YYYY-MM-DD" 形式の実在する暦日かどうかを判定する(クライアント入力の検証用) */
export function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  // Dateは "2026-02-30" のような実在しない日を翌月に繰り越して解釈するため、
  // 往復変換して元の文字列に戻ることを確認する
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}

/** "HH:MM"(00:00〜23:59)形式の壁時計時刻かどうかを判定する(クライアント入力の検証用) */
export function isWallClockTime(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}
