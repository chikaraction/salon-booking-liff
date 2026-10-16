// 店舗・予約設定画面(/admin/settings/salon)の判断ロジック(純粋関数)。
// UI・Server Action は配線に徹し、判断はここへ押し戻す(CLAUDE.md)。
// DOM・Supabaseクライアントのimportはしない。
//
// 扱うのは salon_settings(単一行)のうち次の5列:
//   1. name                    … 店名
//   2. slot_interval_minutes   … 空き枠の開始時刻の刻み(分)
//   3. booking_window_days     … 何日先まで予約を受け付けるか
//   4. min_lead_minutes        … 開始何分前まで予約できるか(直前締切)
//   5. cancel_deadline_minutes … 開始何分前まで客自身でキャンセル・変更できるか
//
// close_on_holidays(祝日を休業にする)は同じテーブルの列だが、休業日ルールの
// 一部なので営業日設定画面(business-settings.ts)の担当。ここでは触らない。
//
// DB制約と同じルールをUIでも先出しするのがこのファイルの役割で、
// 最後の砦はあくまでDB制約(ADR-004と同じ考え方)。
// 店名・刻みなどの実際の値はここには書かない(ADR-007)。

// ---------------------------------------------------------------------------
// 1. 店名(salon_settings.name)
// ---------------------------------------------------------------------------

/**
 * 店名の最大文字数。
 * DBの name は text 型で長さ制約が無いが、店名は管理画面のサイドバー見出しと
 * ログイン画面の見出しに素通しで出るため、際限なく長い値を許すと表示が壊れる。
 * 実在の店名を書かずに済ませつつ打ち間違い(貼り付け事故)を止めるための上限。
 */
export const SALON_NAME_MAX_LENGTH = 100;

/** 店名が空のときの文言 */
export const SALON_NAME_REQUIRED_MESSAGE = "店名を入力してください";

/** 店名が長すぎるときの文言 */
export const SALON_NAME_TOO_LONG_MESSAGE = `店名は${SALON_NAME_MAX_LENGTH}文字以内で入力してください`;

export type SalonNameResult =
  { ok: true; value: string } | { ok: false; message: string };

/**
 * 店名を検証する。
 * - 前後の空白は落とす(見出しに出る値なので、表示のたびに揺れないようにする)
 * - 空文字・空白のみは不可(salon_settings.name は NOT NULL)
 * - 長さは trim 後の文字数で見る
 */
export function validateSalonName(name: string): SalonNameResult {
  const value = name.trim();
  if (value === "") {
    return { ok: false, message: SALON_NAME_REQUIRED_MESSAGE };
  }
  if (value.length > SALON_NAME_MAX_LENGTH) {
    return { ok: false, message: SALON_NAME_TOO_LONG_MESSAGE };
  }
  return { ok: true, value };
}

// ---------------------------------------------------------------------------
// 2. 予約の受付ルール(予約ポリシー4値)
// ---------------------------------------------------------------------------

/** 1日の分数(受付期間と直前締切を突き合わせるのに使う) */
const MINUTES_PER_DAY = 24 * 60;

/**
 * 入力として受け付ける範囲。
 *
 * 下限はDB制約と同じ(slot_interval_minutes > 0 / booking_window_days > 0 /
 * min_lead_minutes >= 0 / cancel_deadline_minutes >= 0)だが、DB制約は
 * 「0より大きい」しか言わないため 1分刻み・10年先といった極端な値も通る。
 * 実害があるものにだけアプリ側の上限・下限を足した:
 *
 * - **刻み 5〜240分**: computeStaffDaySlots(availability.ts)は営業時間を刻みで
 *   割った数だけ開始時刻の候補を作る。1分刻みにすると10時間営業で600候補が
 *   スタッフごとに並び、客側の枠リストが実用にならない。上限側は
 *   「30を300と打ち間違えて枠が1つも出ない」事故を止めるためのもの
 * - **受付期間 1〜365日**: canMoveToMonth(calendar.ts)は受付期間の最終日が
 *   属する月まで月送りを許すので、3650日にすると客が10年ぶんの月を送れてしまう
 * - **直前締切・キャンセル締切 0〜43200分(30日)**: 分の欄に日数のつもりの値を
 *   入れるなどの打ち間違いを止める上限
 *
 * いずれも「この店の運用値」ではなく打ち間違いを止めるガードレールなので、
 * 店舗固有値をコードに書かない原則(ADR-007)には反しない。
 * 実運用の値はこの範囲の中からDBに保存され、コードは値そのものを持たない。
 */
export const BOOKING_POLICY_LIMITS = {
  slotIntervalMinutes: { min: 5, max: 240 },
  bookingWindowDays: { min: 1, max: 365 },
  minLeadMinutes: { min: 0, max: 30 * MINUTES_PER_DAY },
  cancelDeadlineMinutes: { min: 0, max: 30 * MINUTES_PER_DAY },
} as const;

/** フォームの入力値(input[type=number] の生の文字列) */
export type BookingPolicyInput = {
  slotIntervalMinutes: string;
  bookingWindowDays: string;
  minLeadMinutes: string;
  cancelDeadlineMinutes: string;
};

/** 各項目のエラーメッセージ(存在する項目だけ入る) */
export type BookingPolicyErrors = {
  slotIntervalMinutes?: string;
  bookingWindowDays?: string;
  minLeadMinutes?: string;
  cancelDeadlineMinutes?: string;
};

/** 検証済みの値(そのまま salon_settings へ update できる形) */
export type BookingPolicyValue = {
  slotIntervalMinutes: number;
  bookingWindowDays: number;
  minLeadMinutes: number;
  cancelDeadlineMinutes: number;
};

export type BookingPolicyResult =
  | { ok: true; value: BookingPolicyValue }
  | { ok: false; errors: BookingPolicyErrors; message: string };

/** 予約の受付ルール全体のエラーメッセージ(フォームの先頭に出す) */
export const BOOKING_POLICY_INVALID_MESSAGE =
  "予約の受付ルールの入力が正しくありません";

/** 直前締切が受付期間を超えていて枠が1つも出なくなるときの文言 */
export const MIN_LEAD_EXCEEDS_WINDOW_MESSAGE =
  "直前締切が受付期間より長いため、予約できる枠が無くなります";

/**
 * 入力欄の生の文字列を整数として読む。整数でない・空文字なら null。
 * Number("") が 0 になる・Number("３０") が NaN になるといった素の変換の癖を
 * ここで吸収し、呼び出し側が数値かどうかだけを見られるようにする。
 */
function parseIntegerInput(value: string): number | null {
  if (value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
}

/** 範囲外・整数でない入力に出す文言(単位ごとに文を作る) */
function rangeMessage(params: {
  label: string;
  unit: string;
  min: number;
  max: number;
}): string {
  return `${params.label}は${params.min}〜${params.max}${params.unit}の整数で入力してください`;
}

/**
 * 予約ポリシー4値を検証する。DB制約と同じルールを先出しし、
 * さらに BOOKING_POLICY_LIMITS のガードレールと、値どうしの整合を1つ見る。
 *
 * 値どうしの整合(直前締切 < 受付期間):
 * computeStaffDaySlots は「受付期間内の日」かつ「今から直前締切ぶん先」の
 * 開始時刻しか残さない。直前締切が受付期間(日数 × 1440分)以上になると、
 * 受付期間内のどの時刻も締切より手前になり、客側の枠が1つも出なくなる。
 * DBはこの組み合わせを止められないのでアプリ側で拒否する。
 */
export function validateBookingPolicyInput(
  input: BookingPolicyInput,
): BookingPolicyResult {
  const errors: BookingPolicyErrors = {};

  const slotIntervalMinutes = parseIntegerInput(input.slotIntervalMinutes);
  const slotLimits = BOOKING_POLICY_LIMITS.slotIntervalMinutes;
  if (
    slotIntervalMinutes === null ||
    slotIntervalMinutes < slotLimits.min ||
    slotIntervalMinutes > slotLimits.max
  ) {
    errors.slotIntervalMinutes = rangeMessage({
      label: "空き枠の刻み",
      unit: "分",
      ...slotLimits,
    });
  }

  const bookingWindowDays = parseIntegerInput(input.bookingWindowDays);
  const windowLimits = BOOKING_POLICY_LIMITS.bookingWindowDays;
  if (
    bookingWindowDays === null ||
    bookingWindowDays < windowLimits.min ||
    bookingWindowDays > windowLimits.max
  ) {
    errors.bookingWindowDays = rangeMessage({
      label: "受付期間",
      unit: "日",
      ...windowLimits,
    });
  }

  const minLeadMinutes = parseIntegerInput(input.minLeadMinutes);
  const leadLimits = BOOKING_POLICY_LIMITS.minLeadMinutes;
  if (
    minLeadMinutes === null ||
    minLeadMinutes < leadLimits.min ||
    minLeadMinutes > leadLimits.max
  ) {
    errors.minLeadMinutes = rangeMessage({
      label: "直前締切",
      unit: "分",
      ...leadLimits,
    });
  }

  const cancelDeadlineMinutes = parseIntegerInput(input.cancelDeadlineMinutes);
  const cancelLimits = BOOKING_POLICY_LIMITS.cancelDeadlineMinutes;
  if (
    cancelDeadlineMinutes === null ||
    cancelDeadlineMinutes < cancelLimits.min ||
    cancelDeadlineMinutes > cancelLimits.max
  ) {
    errors.cancelDeadlineMinutes = rangeMessage({
      label: "キャンセル締切",
      unit: "分",
      ...cancelLimits,
    });
  }

  // 突き合わせは両方が単独で妥当なときだけ行う(片方が不正なら、その項目の
  // エラーを直すのが先。関係のないエラーを重ねて出さない)
  if (
    errors.minLeadMinutes === undefined &&
    errors.bookingWindowDays === undefined &&
    minLeadMinutes !== null &&
    bookingWindowDays !== null &&
    minLeadMinutes >= bookingWindowDays * MINUTES_PER_DAY
  ) {
    errors.minLeadMinutes = MIN_LEAD_EXCEEDS_WINDOW_MESSAGE;
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, errors, message: BOOKING_POLICY_INVALID_MESSAGE };
  }

  return {
    ok: true,
    value: {
      // 上の検証を通っているので4つとも整数
      slotIntervalMinutes: slotIntervalMinutes as number,
      bookingWindowDays: bookingWindowDays as number,
      minLeadMinutes: minLeadMinutes as number,
      cancelDeadlineMinutes: cancelDeadlineMinutes as number,
    },
  };
}

// ---------------------------------------------------------------------------
// 3. 入力欄の補足文(設定値が客側でどう効くか)
// ---------------------------------------------------------------------------
//
// 文面はどれも実際のコードの挙動に合わせてある。合わないことを書くと、
// 店側が設定を読み違えて客側の見え方が意図とずれるため:
//   - 刻み        … computeStaffDaySlots が営業開始時刻を基準に刻む
//                    (timeFromTimelineRatio も同じ基準で切り下げる)
//   - 受付期間    … isWithinBookingWindow が today〜today+N日を許す
//   - 直前締切    … computeStaffDaySlots が now + 締切より手前の枠を落とす
//                    (ちょうど締切時刻の枠は残る)
//   - キャンセル締切 … canModifyReservation / DBのRPCが「開始 - 締切」で判定する
//                    (ちょうど締切時刻は可。店側キャンセルには適用しない)

/**
 * 分数を「1日1時間30分」のような読みやすい表記にする。
 * 0は「0分」。ちょうどの単位は下の位を出さない。
 */
export function formatMinutesDuration(minutes: number): string {
  if (minutes === 0) return "0分";

  const days = Math.floor(minutes / MINUTES_PER_DAY);
  const hours = Math.floor((minutes % MINUTES_PER_DAY) / 60);
  const remainder = minutes % 60;

  let text = "";
  if (days > 0) text += `${days}日`;
  if (hours > 0) text += `${hours}時間`;
  if (remainder > 0) text += `${remainder}分`;
  return text;
}

/** 補足文に使える値(0以上の整数)だけを取り出す。読めなければ null */
function describableMinutes(value: string): number | null {
  const parsed = parseIntegerInput(value);
  if (parsed === null || parsed < 0) return null;
  return parsed;
}

/**
 * 空き枠の刻みの補足文。
 * 候補は「開店時刻から刻みぶんずつ」進むので、時計の00分・30分に揃うとは
 * 限らない(availability.ts の computeStaffDaySlots は open を起点に刻む)。
 */
export function describeSlotInterval(value: string): string | null {
  const minutes = describableMinutes(value);
  if (minutes === null || minutes <= 0) return null;
  const duration = formatMinutesDuration(minutes);
  return `お客様の予約画面に、開店時刻から${duration}ごとの開始時刻が並びます(開店時刻ちょうど、その${duration}後…)。管理画面カレンダーで空き枠をクリックしたときの開始時刻も同じ刻みに丸まります。`;
}

/** 受付期間の補足文(isWithinBookingWindow は today〜today+N日を許す) */
export function describeBookingWindow(value: string): string | null {
  const days = describableMinutes(value);
  if (days === null || days <= 0) return null;
  return `今日から${days}日後までの予約を受け付けます。それより先の日はお客様のカレンダーで選べません。`;
}

/** 直前締切の補足文(ちょうど締切時刻の枠は残る) */
export function describeMinLead(value: string): string | null {
  const minutes = describableMinutes(value);
  if (minutes === null) return null;
  if (minutes === 0) {
    return "開始時刻ちょうどまでお客様の予約を受け付けます。";
  }
  const duration = formatMinutesDuration(minutes);
  return `開始${duration}前を過ぎた枠は、お客様の予約画面に出なくなります(ちょうど${duration}前は予約できます)。`;
}

/** キャンセル締切の補足文(店側からのキャンセルには適用しない) */
export function describeCancelDeadline(value: string): string | null {
  const minutes = describableMinutes(value);
  if (minutes === null) return null;
  if (minutes === 0) {
    return "開始時刻ちょうどまで、お客様自身でキャンセル・変更できます。店側からのキャンセルはこの設定に左右されません。";
  }
  const duration = formatMinutesDuration(minutes);
  return `開始${duration}前を過ぎると、お客様自身ではキャンセル・変更できなくなります(ちょうど${duration}前は可)。店側からのキャンセルはこの設定に左右されません。`;
}

// ---------------------------------------------------------------------------
// 4. 未保存の変更の判定(節ごとの保存ボタン・「元に戻す」・変更箇所の目印)
// ---------------------------------------------------------------------------
//
// 「保存済みの値(props)と編集中の値の差」を節ごとの単位で返す。
// 汎用の深い比較を置かない理由は business-settings.ts の同じ節に書いた
// (差の粒度が節ごとに違い、「同じ値」の定義が保存結果の一致であるため)。

/**
 * 店名が保存済みの値から変わっているか。
 * validateSalonName が前後の空白を落として保存するので、
 * 空白だけの違いは変更として扱わない。
 */
export function isSalonNameChanged(saved: string, draft: string): boolean {
  return saved.trim() !== draft.trim();
}

/** 予約の受付ルールの入力欄名(変更の目印を出す単位) */
export type BookingPolicyFieldKey = keyof BookingPolicyInput;

/** 画面の並び順(返す配列の順序をこれに揃える) */
const BOOKING_POLICY_FIELD_KEYS: readonly BookingPolicyFieldKey[] = [
  "slotIntervalMinutes",
  "bookingWindowDays",
  "minLeadMinutes",
  "cancelDeadlineMinutes",
];

/**
 * 整数の入力欄を**比較用**に揃える(保存はしない)。
 * 前後の空白と桁揃え("30" と " 030 ")を潰す。整数として読めない値は
 * 前後の空白だけ落として返す(弾くのは validateBookingPolicyInput の仕事)。
 */
function canonicalIntegerInput(value: string): string {
  const parsed = parseIntegerInput(value);
  return parsed === null ? value.trim() : String(parsed);
}

/**
 * 予約の受付ルールで、保存済みの値と差がある項目を画面の並び順で返す。
 * 空配列なら「変更なし」(保存ボタンを無効にする)。
 * 保存するのは整数に変換した値なので、突き合わせも整数で行う。
 */
export function changedBookingPolicyFields(
  saved: BookingPolicyInput,
  draft: BookingPolicyInput,
): BookingPolicyFieldKey[] {
  return BOOKING_POLICY_FIELD_KEYS.filter(
    (key) =>
      canonicalIntegerInput(saved[key]) !== canonicalIntegerInput(draft[key]),
  );
}
