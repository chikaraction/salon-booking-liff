// 営業日・営業時間の設定画面(モックE-2 + 曜日ごとの時刻)の判断ロジック(純粋関数)。
// UI・Server Action は配線に徹し、判断はここへ押し戻す(CLAUDE.md)。
// DOM・Supabaseクライアントのimportはしない。
//
// 扱う設定は4つ。DBの制約と同じルールをUIでも先出しするのがこのファイルの役割で、
// 最後の砦はあくまでDB制約(ADR-004と同じ考え方):
//   1. business_hours          … 毎週の定休 + 曜日ごとの営業時間
//   2. nth_weekday_closures    … 第◯曜日の定休((weekday, nth) の行集合)
//   3. salon_settings.close_on_holidays … 祝日を休業にするトグル
//   4. date_overrides          … 臨時休業・臨時営業(日付範囲)
//
// 休業日そのものの判定(優先順位・祝日・第◯曜日)は closures.ts が持つ。
// ここは「設定を編集して保存するまで」に必要な判断だけを置く。

import { isSlotTakenError } from "./booking";
import {
  addCalendarDays,
  calendarWeekday,
  isCalendarDate,
  WEEKDAY_LABELS,
} from "./jst";

/** すべての曜日(0=日曜〜6=土曜)。チップの描画・入力の検証で使う */
export const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6] as const;

/** 曜日チップの短いラベル「日」〜「土」 */
export function weekdayShortLabel(weekday: number): string {
  return WEEKDAY_LABELS[weekday] ?? "";
}

/** 曜日の長いラベル「日曜日」〜「土曜日」(第◯曜日の選択・補足文で使う) */
export function weekdayLongLabel(weekday: number): string {
  const label = WEEKDAY_LABELS[weekday];
  return label === undefined ? "" : `${label}曜日`;
}

/** "HH:MM"(00:00〜23:59)形式の壁時計時刻か */
function isWallClockTime(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

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
 * 不正な入力を弾くのは validateWeeklyBusinessHours の仕事)。
 */
export function canonicalTimeInput(value: string): string {
  const trimmed = value.trim();
  const matched = /^(\d{1,2}):([0-5]\d)(?::[0-5]\d)?$/.exec(trimmed);
  if (matched === null) return trimmed;
  return `${matched[1].padStart(2, "0")}:${matched[2]}`;
}

// ---------------------------------------------------------------------------
// 1. 毎週の定休 + 曜日ごとの営業時間(business_hours)
// ---------------------------------------------------------------------------

/** business_hours の1行(DBから読んだ生の形) */
export type WeeklyBusinessHoursRow = {
  weekday: number;
  isOpen: boolean;
  openTime: string | null;
  closeTime: string | null;
};

/**
 * 行が無い曜日を「休業・時刻なし」で補い、日曜〜土曜の7件に揃える。
 * closures.ts の判定も「行がない曜日は休業」なので、表示と判定を一致させる。
 */
export function fillWeeklyBusinessHours(
  rows: readonly WeeklyBusinessHoursRow[],
): WeeklyBusinessHoursRow[] {
  return WEEKDAYS.map((weekday) => {
    const row = rows.find((candidate) => candidate.weekday === weekday);
    if (row === undefined) {
      return { weekday, isOpen: false, openTime: null, closeTime: null };
    }
    return row;
  });
}

/** フォームの入力値(時刻は input[type=time] の "HH:MM" または空文字) */
export type WeeklyHoursInput = {
  weekday: number;
  isOpen: boolean;
  openTime: string;
  closeTime: string;
};

/** 検証済みの値(そのまま business_hours へ upsert できる形) */
export type WeeklyHoursValue = {
  weekday: number;
  isOpen: boolean;
  openTime: string | null;
  closeTime: string | null;
};

export type WeeklyHoursResult =
  | { ok: true; value: WeeklyHoursValue[] }
  | {
      ok: false;
      /** 曜日 → その曜日のエラーメッセージ(入力欄の下に出す) */
      errors: Record<number, string>;
      /** 全体のエラーメッセージ(曜日が特定できない不正な入力にも使う) */
      message: string;
    };

/** 営業時間全体のエラーメッセージ(フォームの先頭に出す) */
export const WEEKLY_HOURS_INVALID_MESSAGE = "営業時間の入力が正しくありません";

/**
 * 曜日ごとの営業時間を検証する。
 * DB制約 business_hours_times_required(営業する曜日は開店・閉店が必須で
 * open_time < close_time)と同じルールをUIでも先出しする。
 * 休業の曜日の時刻は矛盾を持ち込まないよう捨てて NULL にする。
 */
export function validateWeeklyBusinessHours(
  input: readonly WeeklyHoursInput[],
): WeeklyHoursResult {
  // 日曜〜土曜が1つずつ揃っていること(UIは常に7件送るので通常は起きない)
  const weekdays = input.map((day) => day.weekday);
  const isComplete =
    input.length === WEEKDAYS.length &&
    WEEKDAYS.every(
      (weekday) => weekdays.filter((w) => w === weekday).length === 1,
    );
  if (!isComplete) {
    return { ok: false, errors: {}, message: WEEKLY_HOURS_INVALID_MESSAGE };
  }

  const errors: Record<number, string> = {};
  const value: WeeklyHoursValue[] = [];

  for (const weekday of WEEKDAYS) {
    const day = input.find((candidate) => candidate.weekday === weekday);
    if (day === undefined) continue; // isComplete で担保済み(型を絞るためのガード)

    if (!day.isOpen) {
      value.push({ weekday, isOpen: false, openTime: null, closeTime: null });
      continue;
    }

    if (!isWallClockTime(day.openTime) || !isWallClockTime(day.closeTime)) {
      errors[weekday] = "開店・閉店の時刻を入力してください";
    } else if (day.openTime >= day.closeTime) {
      // "HH:MM" は固定長なので文字列比較がそのまま時刻の比較になる
      errors[weekday] = "開店時刻は閉店時刻より前にしてください";
    }

    value.push({
      weekday,
      isOpen: true,
      openTime: day.openTime,
      closeTime: day.closeTime,
    });
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, errors, message: WEEKLY_HOURS_INVALID_MESSAGE };
  }
  return { ok: true, value };
}

// ---------------------------------------------------------------------------
// 2. 第◯曜日の定休(nth_weekday_closures)
// ---------------------------------------------------------------------------

/** 選べる「第◯」(nth_weekday_closures.nth の check 制約と同じ範囲) */
export const NTH_CHOICES = [1, 2, 3, 4, 5] as const;

/** DBの行((weekday, nth) の集合) */
export type NthWeekdayClosureRow = { weekday: number; nth: number };

/** UIの1ブロック(モックの「[曜日▼] の [第1]〜[第5]」1行ぶん) */
export type NthWeekdayGroup = { weekday: number; nths: number[] };

/**
 * DBの行集合をUIのブロックに畳む(曜日でグルーピング)。
 * 曜日順・第◯の昇順に整えるので、DBの並びに表示が左右されない。
 */
export function groupNthWeekdayClosures(
  rows: readonly NthWeekdayClosureRow[],
): NthWeekdayGroup[] {
  const byWeekday = new Map<number, Set<number>>();
  for (const row of rows) {
    const nths = byWeekday.get(row.weekday) ?? new Set<number>();
    nths.add(row.nth);
    byWeekday.set(row.weekday, nths);
  }
  return [...byWeekday.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([weekday, nths]) => ({
      weekday,
      nths: [...nths].sort((a, b) => a - b),
    }));
}

/**
 * UIのブロックをDBの行集合に展開する。
 * 第◯を1つも選んでいないブロック(「+ 追加」しただけの空行)は行にしない。
 * 同じ曜日のブロックが複数あっても (weekday, nth) は重複させない
 * (DB制約 nth_weekday_closures_unique)。
 */
export function flattenNthWeekdayGroups(
  groups: readonly NthWeekdayGroup[],
): NthWeekdayClosureRow[] {
  const seen = new Set<string>();
  const rows: NthWeekdayClosureRow[] = [];
  for (const group of groups) {
    for (const nth of group.nths) {
      const key = `${group.weekday}-${nth}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push({ weekday: group.weekday, nth });
    }
  }
  return rows.sort((a, b) => a.weekday - b.weekday || a.nth - b.nth);
}

/** DBから読んだ現在の行(削除に使う id 付き) */
export type StoredNthWeekdayClosureRow = NthWeekdayClosureRow & { id: string };

/** 現在の行集合を希望の行集合へ近づけるための差分 */
export type NthWeekdayClosureDiff = {
  /** 追加する行(重複なし。曜日→第◯の昇順) */
  inserts: NthWeekdayClosureRow[];
  /** 削除する行の id(曜日→第◯の昇順) */
  deleteIds: string[];
};

/** (weekday, nth) の比較キー */
function nthWeekdayKey(row: NthWeekdayClosureRow): string {
  return `${row.weekday}-${row.nth}`;
}

/** 曜日→第◯の昇順の比較関数 */
function compareNthWeekday(
  a: NthWeekdayClosureRow,
  b: NthWeekdayClosureRow,
): number {
  return a.weekday - b.weekday || a.nth - b.nth;
}

/**
 * 現在の行集合(DB)と希望の行集合(画面)の差分を出す。
 * 両方にある (weekday, nth) には触らない。希望に重複があっても追加は1件にする
 * (DB制約 nth_weekday_closures_unique)。並びは入力の順序に左右されないよう、
 * 追加・削除とも曜日→第◯の昇順に揃える。
 */
export function diffNthWeekdayClosures(params: {
  current: readonly StoredNthWeekdayClosureRow[];
  desired: readonly NthWeekdayClosureRow[];
}): NthWeekdayClosureDiff {
  const desiredKeys = new Set(params.desired.map(nthWeekdayKey));
  const currentKeys = new Set(params.current.map(nthWeekdayKey));

  const inserts: NthWeekdayClosureRow[] = [];
  const seen = new Set<string>();
  for (const row of params.desired) {
    const key = nthWeekdayKey(row);
    if (currentKeys.has(key) || seen.has(key)) continue;
    seen.add(key);
    inserts.push({ weekday: row.weekday, nth: row.nth });
  }

  const deleteIds = params.current
    .filter((row) => !desiredKeys.has(nthWeekdayKey(row)))
    .sort((a, b) => compareNthWeekday(a, b) || a.id.localeCompare(b.id))
    .map((row) => row.id);

  return { inserts: inserts.sort(compareNthWeekday), deleteIds };
}

/**
 * モックの補足文「毎月 第3日曜日 を定休に設定中。カレンダーの該当日は
 * 自動で休業になります。」を設定内容から組み立てる(文言のハードコード禁止)。
 * 同じ曜日の複数の週は「第1・第3日曜日」とまとめ、曜日が複数なら読点でつなぐ。
 * 未登録なら null(補足文そのものを出さない)。
 */
export function describeNthWeekdayClosures(
  rows: readonly NthWeekdayClosureRow[],
): string | null {
  const groups = groupNthWeekdayClosures(rows).filter(
    (group) => group.nths.length > 0,
  );
  if (groups.length === 0) return null;

  const phrases = groups.map(
    (group) =>
      `${group.nths.map((nth) => `第${nth}`).join("・")}${weekdayLongLabel(group.weekday)}`,
  );
  return `毎月 ${phrases.join("、")} を定休に設定中。カレンダーの該当日は自動で休業になります。`;
}

// ---------------------------------------------------------------------------
// 3. 臨時休業・臨時営業(date_overrides)
// ---------------------------------------------------------------------------

/** フォームの入力値(日付・時刻は input の生の文字列。未入力は空文字) */
export type DateOverrideInput = {
  startDate: string;
  endDate: string;
  /** false=休業 / true=臨時営業 */
  isOpen: boolean;
  label: string;
  openTime: string;
  closeTime: string;
};

/** 各項目のエラーメッセージ(存在する項目だけ入る) */
export type DateOverrideErrors = {
  startDate?: string;
  endDate?: string;
  time?: string;
};

/** 検証済みの値(そのまま date_overrides へ insert できる形) */
export type DateOverrideValue = {
  startDate: string;
  endDate: string;
  isOpen: boolean;
  label: string | null;
  openTime: string | null;
  closeTime: string | null;
};

export type DateOverrideResult =
  | { ok: true; value: DateOverrideValue }
  | { ok: false; errors: DateOverrideErrors };

/**
 * 期間に含まれる曜日(0=日曜〜6=土曜)を昇順で返す。
 * 7日以上の期間は必ず全曜日を含むので、走査は7日で打ち切る。
 */
export function weekdaysInRange(startDate: string, endDate: string): number[] {
  const weekdays = new Set<number>();
  let date = startDate;
  for (let i = 0; i < 7 && date <= endDate; i += 1) {
    weekdays.add(calendarWeekday(date));
    date = addCalendarDays(date, 1);
  }
  return [...weekdays].sort((a, b) => a - b);
}

/**
 * 臨時休業・臨時営業の入力を検証する。DB制約と同じルールを先出しする:
 * - date_overrides_range               … 開始 <= 終了
 * - date_overrides_closed_has_no_times … 休業に時刻は付けない(捨てる)
 * - date_overrides_times_pair          … 時刻は開店・閉店のペア
 * - date_overrides_times_valid         … 開店 < 閉店
 *
 * さらにDB制約には無い業務ルールを1つ足す:
 * **臨時営業の期間に毎週の定休曜日が含まれるなら営業時間を必須にする**。
 * 定休曜日の business_hours には時刻が無いため、時刻なしの臨時営業では
 * 休業判定は解けても営業時間が定まらず、客側の枠が1つも出ない
 * (closures.ts の resolveBusinessDay / resolveStaffWorkingDay のコメント参照)。
 */
export function validateDateOverride(params: {
  input: DateOverrideInput;
  /** 毎週の定休曜日(business_hours.is_open = false の曜日) */
  closedWeekdays: readonly number[];
}): DateOverrideResult {
  const { input, closedWeekdays } = params;
  const errors: DateOverrideErrors = {};

  const hasStart = isCalendarDate(input.startDate);
  const hasEnd = isCalendarDate(input.endDate);
  if (!hasStart) errors.startDate = "開始日を選択してください";
  if (!hasEnd) errors.endDate = "終了日を選択してください";
  if (hasStart && hasEnd && input.endDate < input.startDate) {
    errors.endDate = "終了日は開始日以降にしてください";
  }

  // 休業は時刻を持てないので、時刻の検証そのものを行わず捨てる
  let openTime: string | null = null;
  let closeTime: string | null = null;

  if (input.isOpen) {
    const hasOpen = input.openTime !== "";
    const hasClose = input.closeTime !== "";
    const includesClosedWeekday =
      hasStart &&
      hasEnd &&
      input.startDate <= input.endDate &&
      weekdaysInRange(input.startDate, input.endDate).some((weekday) =>
        closedWeekdays.includes(weekday),
      );

    if (!hasOpen && !hasClose) {
      if (includesClosedWeekday) {
        errors.time =
          "定休の曜日を臨時営業にするときは営業時間の入力が必要です";
      }
    } else if (!hasOpen || !hasClose) {
      errors.time = "開店・閉店の両方を入力してください";
    } else if (
      !isWallClockTime(input.openTime) ||
      !isWallClockTime(input.closeTime)
    ) {
      errors.time = "開店・閉店の両方を入力してください";
    } else if (input.openTime >= input.closeTime) {
      errors.time = "開店時刻は閉店時刻より前にしてください";
    } else {
      openTime = input.openTime;
      closeTime = input.closeTime;
    }
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }

  const label = input.label.trim();
  return {
    ok: true,
    value: {
      startDate: input.startDate,
      endDate: input.endDate,
      isOpen: input.isOpen,
      label: label === "" ? null : label,
      openTime,
      closeTime,
    },
  };
}

/** 期間が重なる登録の文言(事前チェックと23P01の変換で同じものを使う) */
export const DATE_OVERRIDE_OVERLAP_MESSAGE = "その期間はすでに登録されています";

/** 期間(両端を含む)が重なっている登録を1件返す。無ければ null */
export function findOverlappingOverride<
  T extends { startDate: string; endDate: string },
>(
  candidate: { startDate: string; endDate: string },
  existing: readonly T[],
): T | null {
  // 暦日は "YYYY-MM-DD" 固定長なので文字列比較がそのまま日付比較になる
  return (
    existing.find(
      (row) =>
        row.startDate <= candidate.endDate &&
        candidate.startDate <= row.endDate,
    ) ?? null
  );
}

/**
 * date_overrides_no_overlap(EXCLUDE制約)違反かどうか。
 * PostgreSQLのエラーコードは 23P01 で、予約枠の EXCLUDE 制約と同じ
 * (判定は booking.ts の isSlotTakenError を再利用する)。
 * アプリ側の事前チェックはUXのためのもので、最後の砦はこの制約(ADR-004)。
 */
export function isDateRangeOverlapError(error: unknown): boolean {
  return isSlotTakenError(error);
}

// ---------------------------------------------------------------------------
// 4. 臨時休業・指定日リスト(モックE-2下部)の表示期間
// ---------------------------------------------------------------------------

/** 一覧の既定の表示日数(今日から半年ぶん) */
const DEFAULT_CLOSURE_LIST_DAYS = 180;

/** 暦日 a から b までの日数(b - a) */
function diffCalendarDays(from: string, to: string): number {
  const parse = (date: string) =>
    Date.UTC(
      Number(date.slice(0, 4)),
      Number(date.slice(5, 7)) - 1,
      Number(date.slice(8, 10)),
    );
  return (parse(to) - parse(from)) / 86_400_000;
}

/**
 * 臨時休業・指定日リストの表示期間を決める。
 * 既定は今日から180日ぶんだが、それより先に登録がある場合はその終了日まで
 * 伸ばす(登録した行が一覧に出ず、削除もできなくなるのを防ぐ)。
 * 終わった登録では伸ばさない(一覧は今後の休業予定を見るもの)。
 */
export function closureListWindow(params: {
  /** 今日(JSTの暦日) */
  today: string;
  overrides: ReadonlyArray<{ startDate: string; endDate: string }>;
}): { from: string; days: number } {
  const { today, overrides } = params;
  let until = addCalendarDays(today, DEFAULT_CLOSURE_LIST_DAYS - 1);
  for (const override of overrides) {
    if (override.endDate < today) continue;
    if (override.endDate > until) until = override.endDate;
  }
  return { from: today, days: diffCalendarDays(today, until) + 1 };
}

// ---------------------------------------------------------------------------
// 5. 未保存の変更の判定(節ごとの保存ボタン・「元に戻す」・変更箇所の目印)
// ---------------------------------------------------------------------------
//
// 設定画面は節ごとに保存する。節ごとに
//   - 変更が無ければ保存ボタンを押せない
//   - 変更があるときだけ「元に戻す」を出す
//   - 見出しに「未保存の変更」バッジ、変更された行に目印を出す
// という挙動が要るので、「保存済みの値(props)と編集中の値の差」を判定する。
//
// **汎用の深い比較を1つ作るのではなく、節ごとの判定関数を置いた**。理由:
//   1. 差を取りたい粒度が「真偽値」ではなく「どの行・どの項目が変わったか」で、
//      節ごとに単位が違う(曜日 / 第◯曜日の曜日 / スタッフの項目名 / 入力欄名)。
//      目印を出すにはこの粒度が必要で、汎用比較では表現できない
//   2. 「同じ値」の定義が構造の一致ではなく**保存結果の一致**。休業の曜日に
//      残った時刻("09:00" が入ったままの定休曜日)は保存時に捨てられるので
//      差とみなさない、表示順 "1" と " 01 " は同じ、店名の前後の空白は落ちる、
//      といった正規化が各節の検証関数(validate*)と対になっている。
//      汎用の深い比較では必ずこの正規化を取りこぼし、
//      「保存しても未保存バッジが消えない」「変更が無いのに押せる」になる
// 判定は各設定のファイル(business / staff / salon)に置き、
// それぞれの検証関数と同じ正規化を使う。

/** 比較用に揃えた1曜日ぶんの営業時間(保存結果が同じなら同じ文字列になる) */
function canonicalWeeklyHours(day: WeeklyHoursInput): string {
  // 休業の曜日は時刻を捨てて NULL にして保存するので、残った時刻は差ではない
  // (validateWeeklyBusinessHours と同じ扱い)
  if (!day.isOpen) return "closed";
  return `open:${canonicalTimeInput(day.openTime)}-${canonicalTimeInput(day.closeTime)}`;
}

/**
 * 曜日ごとの営業時間で、保存済みの値と差がある曜日を昇順で返す。
 * 空配列なら「変更なし」(保存ボタンを無効にする)。
 * 片方にしか無い曜日は差として返す(通常はUIが常に7件持つので起きない)。
 */
export function changedWeeklyHourWeekdays(
  saved: readonly WeeklyHoursInput[],
  draft: readonly WeeklyHoursInput[],
): number[] {
  const toMap = (days: readonly WeeklyHoursInput[]) =>
    new Map(days.map((day) => [day.weekday, canonicalWeeklyHours(day)]));
  const savedMap = toMap(saved);
  const draftMap = toMap(draft);

  return [...new Set([...savedMap.keys(), ...draftMap.keys()])]
    .filter((weekday) => savedMap.get(weekday) !== draftMap.get(weekday))
    .sort((a, b) => a - b);
}

/**
 * 第◯曜日の定休で、保存済みの内容と差がある曜日を昇順で返す。
 * 空配列なら「変更なし」。
 *
 * 比較は「保存されるDBの行集合」どうしで行う(flattenNthWeekdayGroups を通す)。
 * そのため、第◯を1つも選んでいない空のブロック(「+ 追加」しただけ)や
 * 同じ曜日の重複ブロック・第◯の並び順の違いは差にならない
 * ── いずれも保存時に落ちて行集合が変わらないため。
 */
export function changedNthWeekdayWeekdays(
  saved: readonly NthWeekdayClosureRow[],
  draft: readonly NthWeekdayGroup[],
): number[] {
  const toMap = (rows: readonly NthWeekdayClosureRow[]) => {
    const map = new Map<number, string>();
    for (const group of groupNthWeekdayClosures(rows)) {
      map.set(group.weekday, group.nths.join(","));
    }
    return map;
  };
  const savedMap = toMap(saved);
  const draftMap = toMap(flattenNthWeekdayGroups(draft));

  return [...new Set([...savedMap.keys(), ...draftMap.keys()])]
    .filter((weekday) => savedMap.get(weekday) !== draftMap.get(weekday))
    .sort((a, b) => a - b);
}
