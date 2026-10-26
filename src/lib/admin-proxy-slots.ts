// 代行登録・店側変更フォームの空き表示の判断ロジック(純粋関数)。
// 指定した枠が空いているかの判定メッセージ(describeSlotAvailability)と、
// その日の空き時間ボタン一覧の整形(buildProxySlotOptions)を扱う。
// 判定順・境界は computeStaffDaySlots(availability.ts)の除外条件と揃える。
// ここの判定は店側への補助表示であり、ダブルブッキングの最終判定は
// DBのEXCLUDE制約(ADR-004)が行う。
// 営業時間・勤務時間・受付ポリシーなど店舗固有の値はすべて引数で受け取る
// (ADR-007: 店舗固有値をコードに書かない)。
// 日時の前提は availability.ts / booking.ts と同じ(JST = UTC+9 固定)。

import {
  isWithinBookingWindow,
  type BookingPolicy,
  type BusinessDay,
  type BusyRange,
  type SlotStatus,
  type StaffWorkingDay,
} from "./availability";
import {
  jstCalendarDate,
  jstClockTime,
  jstMinutesOfDay,
  minutesLabel,
  timeToMinutes,
} from "./jst";

const MINUTE_MS = 60 * 1000;

// ---------------------------------------------------------------------------
// 1. 代行登録の空き判定メッセージ
// ---------------------------------------------------------------------------

/**
 * 空き表示の状態。
 * - past: 開始が現在より過去(登録不可。canRegister=false)
 * - closed: 対象日が定休日(登録不可。canRegister=false)。休憩・勤務時間外の
 *   上書きは許すが、定休日だけは登録をブロックする(2026-07-18決定)
 * - available: 対象枠が空いている(登録可)
 * - unavailable: 空き枠ではない(休憩・勤務時間外・他予約と重なり)。
 *   店側は休憩を削って受けられるため、上書き登録は許可(canRegister=true)。
 *   最終判定はDBのEXCLUDE制約(ADR-004)であり、ここは断定しない。
 */
export type SlotAvailabilityStatus =
  "past" | "closed" | "available" | "unavailable";

/**
 * 空き枠が生成されなかった理由。computeStaffDaySlots(availability.ts)が
 * 候補から外す条件と1対1で対応する(同じ順序・同じ境界で判定する)。
 * - past / closed: 登録不可(status も同名)
 * - no_working_day: その日の勤務パターンが無い(週の勤務外)
 * - outside_booking_window: 受付期間(booking_window_days)の外
 * - too_soon: 直前締切(min_lead_minutes)を過ぎている
 * - duration_not_fit: 閉店までに所要時間が収まらない
 * - during_break: 勤務パターンの休憩と重なる
 * - outside_working_hours: 勤務区間(営業時間 ∩ 勤務時間)に収まらない
 * - overlaps_reservation: 既存の予約・ブロックと重なる
 * - off_grid: 上のどれでもないが、開始時刻が枠の刻みに乗っていない
 */
export type SlotUnavailableReason =
  | "past"
  | "closed"
  | "no_working_day"
  | "outside_booking_window"
  | "too_soon"
  | "duration_not_fit"
  | "outside_working_hours"
  | "during_break"
  | "overlaps_reservation"
  | "off_grid";

export type SlotAvailability = {
  status: SlotAvailabilityStatus;
  /** 空き枠でない理由(available では付かない)。UIの色分けには使わない */
  reason?: SlotUnavailableReason;
  /** このメッセージ状態で登録操作を許すか(past / closed のみ false) */
  canRegister: boolean;
  message: string;
};

/** 上書き登録は許す状態(past / closed 以外)の組み立て */
function unavailable(
  reason: SlotUnavailableReason,
  message: string,
): SlotAvailability {
  return { status: "unavailable", reason, canRegister: true, message };
}

/**
 * 代行登録フォームの空き判定メッセージ(モックD準拠)。
 * 「空き枠ではありません」で終わらせず、枠が生成されなかった理由まで返す
 * (実機フィードバック: 勤務が無いのか・休憩なのか・予約が入っているのかを
 * 区別できず、店側が「予約が入っているのか?」と誤解した)。
 *
 * 判定順・境界は computeStaffDaySlots(availability.ts)の除外条件と揃える:
 * past → closed → 勤務なし → 受付期間 → 直前締切 → 閉店に収まるか →
 * 休憩 → 勤務区間 → 既存予約との重なり(半開区間)→ 刻み → 空き。
 *
 * 登録可否は past / closed のみ false。休憩・勤務時間外・他予約との重なりは
 * 店側が事情を知って上書きできるため canRegister は true のままにし、
 * 最終判定はDBのEXCLUDE制約(ADR-004)に委ねる。
 *
 * メッセージ中の時刻・分数・日数はすべて引数(DB由来の営業時間・勤務時間・
 * salon_settings のポリシー)を差し込む(ADR-007: 店舗固有値を書かない)。
 */
export function describeSlotAvailability(params: {
  start: Date; // 希望開始時刻(UTC)
  durationMinutes: number; // 選択メニューの合計所要分
  businessDay: BusinessDay; // その曜日の営業時間
  isClosedDay: boolean; // 休業日ルール(定休日・臨時休業)
  working: StaffWorkingDay | null; // 対象スタッフのその曜日の勤務パターン
  busy: BusyRange[]; // 対象スタッフの確定済み予約・ブロック
  policy: BookingPolicy;
  now: Date; // 現在時刻(過去・直前締切の基準。サーバーの now を渡す)
  staffName?: string; // 分かるならメッセージに入れる(「田中さんは…」)
}): SlotAvailability {
  const {
    start,
    durationMinutes,
    businessDay,
    isClosedDay,
    working,
    busy,
    policy,
    now,
    staffName,
  } = params;

  // 1. 過去(start === now は過去扱いしない)。定休日より優先する
  if (start.getTime() < now.getTime()) {
    return {
      status: "past",
      reason: "past",
      canRegister: false,
      message: "過去の時間は登録できません",
    };
  }

  // 2. 定休日(computeStaffDaySlots の最初の除外条件と同じ)
  if (
    isClosedDay ||
    !businessDay.isOpen ||
    !businessDay.openTime ||
    !businessDay.closeTime
  ) {
    return {
      status: "closed",
      reason: "closed",
      canRegister: false,
      message: "定休日は登録できません",
    };
  }

  // 3. その日の勤務パターンが無い(週の勤務外)
  if (working === null) {
    return unavailable(
      "no_working_day",
      staffName !== undefined && staffName !== ""
        ? `${staffName}さんはこの日の勤務がありません`
        : "この日は勤務がありません",
    );
  }

  const date = jstCalendarDate(start);

  // 4. 受付期間外
  if (!isWithinBookingWindow(date, policy, now)) {
    return unavailable(
      "outside_booking_window",
      `受付期間(${policy.bookingWindowDays}日先まで)を超えています`,
    );
  }

  // 5. 直前締切(start < now + min_lead_minutes)
  if (start.getTime() < now.getTime() + policy.minLeadMinutes * MINUTE_MS) {
    return unavailable(
      "too_soon",
      `直前すぎます(${policy.minLeadMinutes}分前までに受付)`,
    );
  }

  const open = timeToMinutes(businessDay.openTime);
  const close = timeToMinutes(businessDay.closeTime);
  const startMinutes = jstMinutesOfDay(date, start);
  const endMinutes = startMinutes + durationMinutes;

  // 6. 閉店までに所要時間が収まらない(ループ条件 t + duration <= close と同じ)
  if (endMinutes > close) {
    return unavailable(
      "duration_not_fit",
      `${minutesLabel(close)}の閉店までに${durationMinutes}分は確保できません`,
    );
  }

  // 勤務区間 = 営業時間 ∩ 勤務時間(computeStaffDaySlots と同じ切り詰め)
  const workStart = Math.max(open, timeToMinutes(working.startTime));
  const workEnd = Math.min(close, timeToMinutes(working.endTime));

  // 7. 休憩と重なる(半開区間 [開始, 終了)。勤務時間外より優先する)
  if (working.breakStart !== null && working.breakEnd !== null) {
    const breakStart = timeToMinutes(working.breakStart);
    const breakEnd = timeToMinutes(working.breakEnd);
    if (startMinutes < breakEnd && breakStart < endMinutes) {
      return unavailable(
        "during_break",
        `休憩時間です(${minutesLabel(breakStart)}〜${minutesLabel(breakEnd)})`,
      );
    }
  }

  // 8. 勤務区間に収まらない
  if (startMinutes < workStart || endMinutes > workEnd) {
    return unavailable(
      "outside_working_hours",
      `勤務時間外です(${minutesLabel(workStart)}〜${minutesLabel(workEnd)})`,
    );
  }

  // 9. 既存の予約・ブロックと重なる(半開区間。EXCLUDE制約と同じ扱い)
  const end = new Date(start.getTime() + durationMinutes * MINUTE_MS);
  if (busy.some((range) => start < range.end && range.start < end)) {
    return unavailable(
      "overlaps_reservation",
      "この時間は他の予約と重なっています",
    );
  }

  // 10. 刻みに乗っていない(候補は開店時刻を基準に slot_interval_minutes 刻み)
  const interval =
    policy.slotIntervalMinutes > 0 ? policy.slotIntervalMinutes : 1;
  if ((startMinutes - open) % interval !== 0) {
    return unavailable(
      "off_grid",
      `開始時刻が${interval}分刻みに合っていません`,
    );
  }

  return {
    status: "available",
    canRegister: true,
    message: `この枠は空いています。${durationMinutes}分確保できます。`,
  };
}

// ---------------------------------------------------------------------------
// 2. 代行登録の「その日の空き時間」一覧(客側 step-datetime と同じ見せ方)
// ---------------------------------------------------------------------------

/**
 * 代行登録フォームに渡す空き枠。Server Action の境界を越えるため
 * Date ではなくISO文字列で運ぶ(客側 AvailabilitySlot と同じ形)。
 */
export type ProxyDaySlot = {
  /** 開始時刻(UTCのISO文字列) */
  startISO: string;
  status: SlotStatus;
};

/** 時刻ボタン1個分の表示情報 */
export type ProxySlotOption = {
  /** JSTの壁時計時刻 "HH:MM"。表示ラベルであり <input type="time"> の値でもある */
  time: string;
  /** 埋まっている枠(取り消し線+グレーで選択不可にする。モック準拠) */
  isTaken: boolean;
};

/**
 * 空き枠(UTCのISO)を、時刻ボタン一覧の表示情報に整形する。
 * - JSTの壁時計時刻に直す(そのまま時間フィールドへ反映できるゼロ埋め形式)
 * - taken は「埋まり」として残す(隠さない。客側と同じ取り消し線表示)
 * - 開始時刻の昇順に並べる(入力配列は破壊しない)
 */
export function buildProxySlotOptions(
  slots: ProxyDaySlot[],
): ProxySlotOption[] {
  return [...slots]
    .sort(
      (a, b) => new Date(a.startISO).getTime() - new Date(b.startISO).getTime(),
    )
    .map((slot) => ({
      time: jstClockTime(new Date(slot.startISO)),
      isTaken: slot.status === "taken",
    }));
}
