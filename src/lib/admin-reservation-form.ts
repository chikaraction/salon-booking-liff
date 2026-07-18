// 代行登録フォーム(電話予約用・モックD)の入力検証(純粋関数)。
// UIが各項目にエラーを出せるよう { ok:false, errors } を返す。
// 最後の砦はDBのEXCLUDE制約(ADR-004)であり、ここは入力の形式検証に徹する。
// DOM・Supabaseクライアントのimportはしない(CLAUDE.md)。

import { isCalendarDate } from "./availability";

export type ProxyRegistrationInput = {
  /** 既存顧客を選択した場合のID。新規客なら null */
  customerId: string | null;
  /** 新規客の名前(既存顧客選択時は無視する) */
  customerName: string;
  /** 新規客の電話(任意。既存顧客選択時は無視する) */
  customerPhone: string;
  /** 選択メニュー(1件以上) */
  menuIds: string[];
  staffId: string;
  /** JSTの暦日 "YYYY-MM-DD" */
  date: string;
  /** 壁時計時刻 "HH:MM" */
  time: string;
};

/** 各項目のエラーメッセージ(存在する項目だけ入る) */
export type ProxyRegistrationErrors = {
  customer?: string;
  menu?: string;
  staff?: string;
  date?: string;
  time?: string;
};

/** 検証済み・正規化済みの値(Server Action がRPCへ渡す形) */
export type ProxyRegistrationValue = {
  /** 既存顧客ID。新規客なら null */
  customerId: string | null;
  /** 新規客の名前。既存顧客選択時は null */
  customerName: string | null;
  /** 新規客の電話。既存顧客選択時・未入力なら null */
  customerPhone: string | null;
  menuIds: string[];
  staffId: string;
  date: string;
  time: string;
};

export type ProxyRegistrationResult =
  | { ok: true; value: ProxyRegistrationValue }
  | { ok: false; errors: ProxyRegistrationErrors };

/** "HH:MM"(00:00〜23:59)形式の壁時計時刻かどうかを判定する */
export function isWallClockTime(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

/**
 * 開始時刻が現在(now)より厳密に過去かどうかを判定する。
 * start===now は過去扱いしない(now ちょうどの開始は許可)。
 * Server Action の過去ガードと空き表示で共有し、判定を一箇所に集約する。
 * now はサーバーの現在時刻(new Date())を渡す(クライアント時計は信用しない)。
 */
export function isPastStart(start: Date, now: Date): boolean {
  return start.getTime() < now.getTime();
}

/**
 * 代行登録フォームの入力を検証する(モックD準拠)。
 * - 顧客: 既存顧客ID があるか、なければ新規客名(必須。電話は任意)
 * - メニュー: 1件以上(重複は除去)
 * - スタッフ・日付・時間: 必須。日付は実在する暦日、時間は "HH:MM"
 * 既存顧客ID がある場合は RPC が既存顧客を使うため、新規名・電話は捨てる。
 */
export function validateProxyRegistration(
  input: ProxyRegistrationInput,
): ProxyRegistrationResult {
  const errors: ProxyRegistrationErrors = {};

  // 顧客: 既存顧客ID があればそれを使う。なければ新規名が必須(電話は任意)
  const hasExisting = input.customerId !== null && input.customerId !== "";
  const trimmedName = input.customerName.trim();
  const trimmedPhone = input.customerPhone.trim();
  if (!hasExisting && trimmedName === "") {
    errors.customer = "お客様名を入力するか、既存のお客様を選択してください";
  }

  // メニュー: 重複を除去して1件以上
  const menuIds = [...new Set(input.menuIds)];
  if (menuIds.length === 0) {
    errors.menu = "メニューを1つ以上選択してください";
  }

  if (input.staffId === "") {
    errors.staff = "スタッフを選択してください";
  }

  if (!isCalendarDate(input.date)) {
    errors.date = "日付を選択してください";
  }

  if (!isWallClockTime(input.time)) {
    errors.time = "時間を選択してください";
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    value: {
      customerId: hasExisting ? input.customerId : null,
      customerName: hasExisting ? null : trimmedName,
      customerPhone: hasExisting || trimmedPhone === "" ? null : trimmedPhone,
      menuIds,
      staffId: input.staffId,
      date: input.date,
      time: input.time,
    },
  };
}

// ---------------------------------------------------------------------------
// 店側変更(代行登録フォームを変更モードで再利用)の入力検証。
// 顧客は固定(変更不可)なので顧客の検証はしない。それ以外(メニュー・スタッフ・
// 日付・時間)は代行登録と同じ規則で検証する。
// ---------------------------------------------------------------------------

/** 変更モードの入力(顧客は含めない = 変更不可) */
export type ReservationEditInput = {
  /** 選択メニュー(1件以上) */
  menuIds: string[];
  staffId: string;
  /** JSTの暦日 "YYYY-MM-DD" */
  date: string;
  /** 壁時計時刻 "HH:MM" */
  time: string;
};

/** 各項目のエラーメッセージ(存在する項目だけ入る)。顧客は対象外 */
export type ReservationEditErrors = {
  menu?: string;
  staff?: string;
  date?: string;
  time?: string;
};

/** 検証済み・正規化済みの値(Server Action が admin_update_reservation へ渡す形) */
export type ReservationEditValue = {
  menuIds: string[];
  staffId: string;
  date: string;
  time: string;
};

export type ReservationEditResult =
  | { ok: true; value: ReservationEditValue }
  | { ok: false; errors: ReservationEditErrors };

/**
 * 店側変更フォームの入力を検証する。顧客は変更できないため検証しない。
 * メニュー(重複除去して1件以上)・スタッフ・日付(実在する暦日)・
 * 時間("HH:MM")を代行登録と同じ規則で確認する。
 */
export function validateReservationEdit(
  input: ReservationEditInput,
): ReservationEditResult {
  const errors: ReservationEditErrors = {};

  const menuIds = [...new Set(input.menuIds)];
  if (menuIds.length === 0) {
    errors.menu = "メニューを1つ以上選択してください";
  }

  if (input.staffId === "") {
    errors.staff = "スタッフを選択してください";
  }

  if (!isCalendarDate(input.date)) {
    errors.date = "日付を選択してください";
  }

  if (!isWallClockTime(input.time)) {
    errors.time = "時間を選択してください";
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    value: {
      menuIds,
      staffId: input.staffId,
      date: input.date,
      time: input.time,
    },
  };
}

/**
 * 変更フォームの初期選択メニューを復元する。
 * 予約時のスナップショットに残るメニューIDのうち、現在も有効なメニュー
 * (fetchActiveMenus に載っているもの)だけを保存順で残す。無効化・改定で
 * 消えたメニューは落とす(1つも残らなければ未選択にフォールバック)。
 */
export function restoreSelectableMenuIds(
  savedMenuIds: string[],
  activeMenuIds: string[],
): string[] {
  const active = new Set(activeMenuIds);
  return [...new Set(savedMenuIds)].filter((id) => active.has(id));
}
