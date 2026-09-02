// スタッフ設定画面(モックE)の判断ロジック(純粋関数)。
// UI・Server Action は配線に徹し、判断はここへ押し戻す(CLAUDE.md)。
// DOM・Supabaseクライアントのimportはしない。
//
// 扱うのは3つ:
//   1. staff               … スタッフ行(名前・ロール・表示順・有効/無効・自己紹介)
//   2. staff_working_hours … 週次勤務パターン((staff_id, weekday) ごとに1行)
//   3. reservations(kind='block') … 臨時休ブロックの時間帯
//
// DB制約と同じルールをUIでも先出しするのがこのファイルの役割で、
// 最後の砦はあくまでDB制約(ADR-004と同じ考え方)。
// 臨時休ブロックの重なりは EXCLUDE制約 reservations_no_overlap が拒否する。

import { isStaffRole, type StaffRole } from "./admin-permissions";
import {
  isCalendarDate,
  jstDateTime,
  type StaffWorkingDay,
} from "./availability";
import { isSlotTakenError } from "./booking";
import { WEEKDAYS } from "./business-settings";
import { calendarDateLabel } from "./calendar";

/** "HH:MM"(00:00〜23:59)形式の壁時計時刻か */
function isWallClockTime(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

/**
 * DBの time 型("HH:MM:SS")を input[type=time] が扱う "HH:MM" にする。
 * NULL・空文字は空文字(未入力)にする。
 * business-settings.ts の normalizeTimeInput と同じ変換だが、
 * 依存の向きを増やさないためこちらにも置く(どちらも1行の整形)。
 */
function toTimeInput(value: string | null): string {
  if (value === null || value === "") return "";
  return value.slice(0, 5);
}

// ---------------------------------------------------------------------------
// 1. スタッフ行(staff)
// ---------------------------------------------------------------------------

/** ロールの日本語ラベル(モックEの見出し「田中(オーナー)」で使う) */
export function staffRoleLabel(role: StaffRole): string {
  return role === "owner" ? "オーナー" : "スタッフ";
}

/** カードの見出し「田中(オーナー)」(モックE準拠) */
export function staffHeadingLabel(staff: {
  name: string;
  role: StaffRole;
}): string {
  return `${staff.name}(${staffRoleLabel(staff.role)})`;
}

/** フォームの入力値(select・input の生の文字列) */
export type StaffInput = {
  name: string;
  /** select の生値。owner / staff のいずれかであること自体を検証する */
  role: string;
  /** input[type=number] の生値 */
  displayOrder: string;
  isActive: boolean;
  bio: string;
};

/** 各項目のエラーメッセージ(存在する項目だけ入る) */
export type StaffErrors = {
  name?: string;
  role?: string;
  displayOrder?: string;
};

/** 検証済みの値(そのまま staff へ upsert できる形) */
export type StaffValue = {
  name: string;
  role: StaffRole;
  displayOrder: number;
  isActive: boolean;
  bio: string | null;
};

export type StaffValidationResult =
  | { ok: true; value: StaffValue }
  | { ok: false; errors: StaffErrors; message: string };

/** スタッフの入力全体のエラーメッセージ(フォームの先頭に出す) */
export const STAFF_INVALID_MESSAGE = "スタッフの入力が正しくありません";

/**
 * スタッフ行の入力を検証する。
 * - 名前は必須(staff.name は NOT NULL)。前後の空白は落とす
 * - ロールは owner / staff のみ(staff.role の check 制約と同じ)
 * - 表示順は0以上の整数(staff.display_order は integer NOT NULL。
 *   DBは負数も許すが、並び順の入力欄として意味を持たないのでUIで弾く)
 * - 自己紹介は任意。空文字はNULLにして「未入力」と一意に対応させる
 *
 * auth_user_id はここでは扱わない。管理画面ユーザーの作成はSupabaseダッシュボード、
 * 紐付けはSQLで行う運用(README「店側スタッフ(管理画面ユーザー)の登録」)。
 */
export function validateStaffInput(input: StaffInput): StaffValidationResult {
  const errors: StaffErrors = {};

  const name = input.name.trim();
  if (name === "") {
    errors.name = "名前を入力してください";
  }

  if (!isStaffRole(input.role)) {
    errors.role = "ロールの指定が正しくありません";
  }

  const displayOrder = Number(input.displayOrder);
  if (
    input.displayOrder.trim() === "" ||
    !Number.isInteger(displayOrder) ||
    displayOrder < 0
  ) {
    errors.displayOrder = "表示順は0以上の整数で入力してください";
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, errors, message: STAFF_INVALID_MESSAGE };
  }

  const bio = input.bio.trim();
  return {
    ok: true,
    value: {
      name,
      // 上の検証を通っているので owner / staff のいずれか
      role: input.role as StaffRole,
      displayOrder,
      isActive: input.isActive,
      bio: bio === "" ? null : bio,
    },
  };
}

/** 最後のオーナー判定に使うスタッフの状態(名前などは判定に要らない) */
export type StaffRoleState = {
  id: string;
  role: StaffRole;
  isActive: boolean;
};

/** 最後のオーナーを降格・無効化しようとしたときの文言 */
export const LAST_OWNER_MESSAGE =
  "設定を変更できるオーナーがいなくなるため、この変更はできません";

/**
 * 「有効なオーナーが1人もいなくなる変更」を拒否する判定。
 * 拒否するならメッセージ、問題なければ null を返す。
 *
 * 全員がスタッフになる・オーナーが全員無効になると、誰も設定を変更できなくなり
 * 復旧にSQLが要る(current_staff_role() が 'owner' を返す行が無くなり、
 * アプリ層の requireOwner もRLSも通らなくなる)。物理削除を提供しないのと
 * 同じ理由で、画面から自分の首を絞められないようにする。
 *
 * 無効(is_active = false)のオーナーを頭数に入れないのは、無効なスタッフを
 * オーナーとして残しても運用上は「設定を変更できる人」がいないため。
 *
 * @param params.staffList 変更前の全スタッフ(無効なスタッフも含む)
 * @param params.target    変更後の値。新規追加は id を null にする
 */
export function findLastOwnerViolation(params: {
  staffList: readonly StaffRoleState[];
  target: { id: string | null; role: StaffRole; isActive: boolean };
}): string | null {
  const { staffList, target } = params;

  const after: StaffRoleState[] =
    target.id === null
      ? [...staffList, { id: "", role: target.role, isActive: target.isActive }]
      : staffList.map((staff) =>
          staff.id === target.id
            ? { id: staff.id, role: target.role, isActive: target.isActive }
            : staff,
        );

  const activeOwners = after.filter(
    (staff) => staff.role === "owner" && staff.isActive,
  );
  return activeOwners.length === 0 ? LAST_OWNER_MESSAGE : null;
}

// ---------------------------------------------------------------------------
// 2. 週次勤務パターン(staff_working_hours)
// ---------------------------------------------------------------------------

/** フォームの入力値(時刻は input[type=time] の "HH:MM" または空文字) */
export type WorkingDayInput = {
  weekday: number;
  /** 曜日チップがON = その曜日は勤務日(staff_working_hours に行がある) */
  isWorking: boolean;
  startTime: string;
  endTime: string;
  breakStart: string;
  breakEnd: string;
};

/** 検証済みの値(そのまま staff_working_hours へ upsert できる形) */
export type WorkingHoursValue = {
  weekday: number;
  startTime: string;
  endTime: string;
  breakStart: string | null;
  breakEnd: string | null;
};

export type WorkingHoursResult =
  | { ok: true; value: WorkingHoursValue[] }
  | {
      ok: false;
      /** 曜日 → その曜日のエラーメッセージ(入力欄の下に出す) */
      errors: Record<number, string>;
      message: string;
    };

/** 勤務パターン全体のエラーメッセージ(フォームの先頭に出す) */
export const WORKING_HOURS_INVALID_MESSAGE = "勤務時間の入力が正しくありません";

/** DBから読んだ勤務パターンの行(時刻は "HH:MM:SS") */
export type StaffWorkingHoursRow = {
  weekday: number;
  startTime: string;
  endTime: string;
  breakStart: string | null;
  breakEnd: string | null;
};

/**
 * 行が無い曜日を「勤務でない」で補い、日曜〜土曜の7件に揃える。
 * 枠計算(computeStaffDaySlots)も「その曜日の行が無いスタッフは休み」なので、
 * 表示と枠計算の解釈を一致させる。
 */
export function fillStaffWorkingHours(
  rows: readonly StaffWorkingHoursRow[],
): WorkingDayInput[] {
  return WEEKDAYS.map((weekday) => {
    const row = rows.find((candidate) => candidate.weekday === weekday);
    if (row === undefined) {
      return {
        weekday,
        isWorking: false,
        startTime: "",
        endTime: "",
        breakStart: "",
        breakEnd: "",
      };
    }
    return {
      weekday,
      isWorking: true,
      startTime: toTimeInput(row.startTime),
      endTime: toTimeInput(row.endTime),
      breakStart: toTimeInput(row.breakStart),
      breakEnd: toTimeInput(row.breakEnd),
    };
  });
}

/**
 * 曜日ごとの勤務時間を検証する。DB制約と同じルールを先出しする:
 * - staff_working_hours_valid_range  … start_time < end_time
 * - staff_working_hours_break_pair   … 休憩は開始・終了のペア(両方NULLか両方あり)
 * - staff_working_hours_break_within … start <= break_start < break_end <= end
 *
 * 勤務でない曜日(チップOFF)の時刻は行そのものが消えるので検証しない。
 * 「時刻を直さないと曜日を休みにできない」という手詰まりを作らないため。
 */
export function validateStaffWorkingHours(
  input: readonly WorkingDayInput[],
): WorkingHoursResult {
  const errors: Record<number, string> = {};
  const value: WorkingHoursValue[] = [];

  for (const day of input) {
    if (!day.isWorking) continue;

    if (!isWallClockTime(day.startTime) || !isWallClockTime(day.endTime)) {
      errors[day.weekday] = "開始・終了の時刻を入力してください";
      continue;
    }
    // "HH:MM" は固定長なので文字列比較がそのまま時刻の比較になる
    if (day.startTime >= day.endTime) {
      errors[day.weekday] = "開始時刻は終了時刻より前にしてください";
      continue;
    }

    const hasBreakStart = day.breakStart !== "";
    const hasBreakEnd = day.breakEnd !== "";
    if (hasBreakStart !== hasBreakEnd) {
      errors[day.weekday] =
        "休憩は開始・終了の両方を入力してください(休憩なしは両方空欄)";
      continue;
    }

    if (hasBreakStart && hasBreakEnd) {
      if (
        !isWallClockTime(day.breakStart) ||
        !isWallClockTime(day.breakEnd) ||
        day.breakStart >= day.breakEnd ||
        day.breakStart < day.startTime ||
        day.breakEnd > day.endTime
      ) {
        errors[day.weekday] = "休憩は勤務時間の中に収めてください";
        continue;
      }
    }

    value.push({
      weekday: day.weekday,
      startTime: day.startTime,
      endTime: day.endTime,
      breakStart: hasBreakStart ? day.breakStart : null,
      breakEnd: hasBreakEnd ? day.breakEnd : null,
    });
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, errors, message: WORKING_HOURS_INVALID_MESSAGE };
  }
  return { ok: true, value };
}

/**
 * 曜日チップのON/OFF(検証済みの値)を staff_working_hours の
 * upsert / delete に振り分ける。
 * (staff_id, weekday) が一意なので、勤務日はupsert、それ以外の曜日は
 * delete(行が無ければ何も起きない)で画面の状態がそのまま入る。
 */
export function diffStaffWorkingHours(values: readonly WorkingHoursValue[]): {
  upserts: WorkingHoursValue[];
  deleteWeekdays: number[];
} {
  const working = new Set(values.map((value) => value.weekday));
  return {
    upserts: [...values].sort((a, b) => a.weekday - b.weekday),
    deleteWeekdays: WEEKDAYS.filter((weekday) => !working.has(weekday)),
  };
}

/**
 * ある曜日の時刻(開始・終了・休憩)をほかの勤務日にもコピーする。
 * モックEは全曜日が同じ時刻に見えるが、DBは曜日ごとに時刻を持てるため
 * 入力欄も曜日ごとにある。全曜日同じ店のための入力の手間を減らす操作で、
 * 休みの曜日(チップOFF)は行そのものが無いので触らない。
 */
export function applyTimesToWorkingDays(
  days: readonly WorkingDayInput[],
  sourceWeekday: number,
): WorkingDayInput[] {
  const source = days.find((day) => day.weekday === sourceWeekday);
  if (source === undefined) return [...days];
  return days.map((day) =>
    day.isWorking
      ? {
          ...day,
          startTime: source.startTime,
          endTime: source.endTime,
          breakStart: source.breakStart,
          breakEnd: source.breakEnd,
        }
      : day,
  );
}

// ---------------------------------------------------------------------------
// 3. 臨時休ブロック(reservations.kind = 'block')
// ---------------------------------------------------------------------------

/** フォームの入力値(日付・時刻は input の生の文字列。未入力は空文字) */
export type StaffBlockInput = {
  date: string;
  /** true=終日(その日の実効勤務時間ぜんぶ)/ false=時間帯指定 */
  allDay: boolean;
  startTime: string;
  endTime: string;
};

export type StaffBlockErrors = {
  date?: string;
  time?: string;
};

export type StaffBlockRangeResult =
  | { ok: true; value: { start: Date; end: Date } }
  | { ok: false; errors: StaffBlockErrors };

/** その日にもともと勤務が無く「終日」を算出できないときの文言 */
export const BLOCK_NO_WORKING_DAY_MESSAGE =
  "その日は勤務時間が設定されていないため、終日の臨時休を登録できません。時間帯を指定してください";

/** 既存予約と重なって登録できなかったときの文言(23P01 の変換先) */
export const BLOCK_CONFLICT_MESSAGE = "その時間帯には予約が入っています";

/**
 * 臨時休ブロックの時間範囲 [開始, 終了) を求める。
 *
 * - 終日 … その日の実効勤務時間(closures.ts の resolveStaffWorkingDay の
 *   戻り値)の開始〜終了。休憩をまたいで1本のブロックにする
 *   (休憩は枠計算が別途落とすので、分割しても結果は変わらない)
 * - 時間帯指定 … 指定範囲そのまま。勤務パターンが無い日でも登録できる
 *   (定休曜日の臨時営業日を塞ぐ用途があるため範囲を勤務時間で丸めない)
 *
 * JSTの壁時計時刻 → UTC の変換は jstDateTime(availability.ts)を通す。
 * 返す区間は reservations.during と同じ半開区間 [開始, 終了) で、
 * 空の区間(開始 = 終了)は check 制約 not isempty(during) に弾かれるため
 * ここで先に拒否する。
 */
export function resolveStaffBlockRange(params: {
  input: StaffBlockInput;
  /** その日の実効勤務時間。終日のときだけ使う(無ければ null) */
  workingDay: StaffWorkingDay | null;
}): StaffBlockRangeResult {
  const { input, workingDay } = params;

  if (!isCalendarDate(input.date)) {
    return { ok: false, errors: { date: "日付を選択してください" } };
  }

  if (input.allDay) {
    if (workingDay === null) {
      return { ok: false, errors: { time: BLOCK_NO_WORKING_DAY_MESSAGE } };
    }
    return {
      ok: true,
      value: {
        start: jstDateTime(input.date, workingDay.startTime),
        end: jstDateTime(input.date, workingDay.endTime),
      },
    };
  }

  if (!isWallClockTime(input.startTime) || !isWallClockTime(input.endTime)) {
    return {
      ok: false,
      errors: { time: "開始・終了の時刻を入力してください" },
    };
  }
  if (input.startTime >= input.endTime) {
    return {
      ok: false,
      errors: { time: "開始時刻は終了時刻より前にしてください" },
    };
  }

  return {
    ok: true,
    value: {
      start: jstDateTime(input.date, input.startTime),
      end: jstDateTime(input.date, input.endTime),
    },
  };
}

/**
 * 臨時休ブロックのINSERTが「既存の予約と重なった」ことによる失敗か判定する。
 * EXCLUDE制約 reservations_no_overlap の違反は SQLSTATE 23P01。
 * この制約がダブルブッキング防止の本体で、外す・迂回することは禁止(ADR-004)。
 * アプリ側の事前チェックを足す場合もこの判定は必ず残す(同時操作ですり抜けるため)。
 */
export function isBlockConflictError(error: unknown): boolean {
  return isSlotTakenError(error);
}

/** 画面が扱う臨時休ブロック1件(時刻はJSTの壁時計時刻に直したもの) */
export type StaffBlockView = {
  id: string;
  date: string;
  startTime: string;
  endTime: string;
};

/**
 * モックEの補足文「7/29(水)は休診に設定済み」を登録内容から組み立てる。
 * 日付の表記は既存の calendarDateLabel(「7月29日(水)」)に揃える
 * (同じ日付が画面のあちこちで別の書式にならないようにする)。
 * 複数日は日付順に読点でつなぐ。登録が無ければ null(補足文を出さない)。
 */
export function describeStaffBlocks(
  blocks: ReadonlyArray<{ date: string }>,
): string | null {
  const dates = [...new Set(blocks.map((block) => block.date))].sort();
  if (dates.length === 0) return null;
  return `${dates.map(calendarDateLabel).join("、")}は休診に設定済み`;
}

/** 一覧の1行「7月29日(水) 10:00〜19:00」 */
export function staffBlockLabel(block: {
  date: string;
  startTime: string;
  endTime: string;
}): string {
  return `${calendarDateLabel(block.date)} ${block.startTime}〜${block.endTime}`;
}
