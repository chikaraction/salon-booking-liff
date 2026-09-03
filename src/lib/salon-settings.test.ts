import { describe, expect, it } from "vitest";

import {
  BOOKING_POLICY_INVALID_MESSAGE,
  BOOKING_POLICY_LIMITS,
  SALON_NAME_MAX_LENGTH,
  describeBookingWindow,
  describeCancelDeadline,
  describeMinLead,
  describeSlotInterval,
  formatMinutesDuration,
  validateBookingPolicyInput,
  validateSalonName,
  type BookingPolicyInput,
} from "./salon-settings";

// テスト用の入力。店舗固有の値(実際の店名・刻み・受付期間)をコードに
// 書かない(ADR-007)ため、値はテストの中だけで組み立てる架空のものにする。

function policyInput(
  patch: Partial<BookingPolicyInput> = {},
): BookingPolicyInput {
  return {
    slotIntervalMinutes: "30",
    bookingWindowDays: "30",
    minLeadMinutes: "60",
    cancelDeadlineMinutes: "60",
    ...patch,
  };
}

describe("validateSalonName", () => {
  it("前後の空白を落とした店名を返す", () => {
    const result = validateSalonName("  サンプル店  ");
    expect(result).toEqual({ ok: true, value: "サンプル店" });
  });

  it("空文字は入力エラーにする(salon_settings.name は NOT NULL)", () => {
    const result = validateSalonName("");
    expect(result.ok).toBe(false);
  });

  it("空白のみの入力は空文字と同じくエラーにする", () => {
    const result = validateSalonName("   　 ");
    expect(result.ok).toBe(false);
  });

  it("上限文字数ちょうどは通る", () => {
    const name = "あ".repeat(SALON_NAME_MAX_LENGTH);
    expect(validateSalonName(name)).toEqual({ ok: true, value: name });
  });

  it("上限文字数を超える店名は、前後の空白を落としたうえで判定してエラーにする", () => {
    const name = `  ${"あ".repeat(SALON_NAME_MAX_LENGTH + 1)}  `;
    const result = validateSalonName(name);
    expect(result.ok).toBe(false);
  });
});

describe("validateBookingPolicyInput", () => {
  it("4つの値を整数に変換して返す", () => {
    const result = validateBookingPolicyInput(
      policyInput({
        slotIntervalMinutes: "15",
        bookingWindowDays: "14",
        minLeadMinutes: "120",
        cancelDeadlineMinutes: "0",
      }),
    );
    expect(result).toEqual({
      ok: true,
      value: {
        slotIntervalMinutes: 15,
        bookingWindowDays: 14,
        minLeadMinutes: 120,
        cancelDeadlineMinutes: 0,
      },
    });
  });

  it("未入力(空文字)は項目ごとのエラーにする", () => {
    const result = validateBookingPolicyInput(
      policyInput({ slotIntervalMinutes: "" }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.slotIntervalMinutes).toBeDefined();
    expect(result.message).toBe(BOOKING_POLICY_INVALID_MESSAGE);
  });

  it("小数は整数でないので弾く(DBの列は integer)", () => {
    const result = validateBookingPolicyInput(
      policyInput({ slotIntervalMinutes: "30.5" }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.slotIntervalMinutes).toBeDefined();
  });

  it("数値として読めない文字列は弾く", () => {
    const result = validateBookingPolicyInput(
      policyInput({ bookingWindowDays: "３０" }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.bookingWindowDays).toBeDefined();
  });

  it("空き枠の刻みが0以下はDB制約(slot_interval_minutes > 0)と同じく弾く", () => {
    const result = validateBookingPolicyInput(
      policyInput({ slotIntervalMinutes: "0" }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.slotIntervalMinutes).toBeDefined();
  });

  it("受付期間が0以下はDB制約(booking_window_days > 0)と同じく弾く", () => {
    const result = validateBookingPolicyInput(
      policyInput({ bookingWindowDays: "0" }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.bookingWindowDays).toBeDefined();
  });

  it("直前締切とキャンセル締切は0を許す(DB制約は >= 0)", () => {
    const result = validateBookingPolicyInput(
      policyInput({ minLeadMinutes: "0", cancelDeadlineMinutes: "0" }),
    );
    expect(result.ok).toBe(true);
  });

  it("直前締切とキャンセル締切の負数は弾く", () => {
    const result = validateBookingPolicyInput(
      policyInput({ minLeadMinutes: "-1", cancelDeadlineMinutes: "-1" }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.minLeadMinutes).toBeDefined();
    expect(result.errors.cancelDeadlineMinutes).toBeDefined();
  });

  it("複数の項目が不正なら、それぞれのエラーをまとめて返す", () => {
    const result = validateBookingPolicyInput(
      policyInput({ slotIntervalMinutes: "0", bookingWindowDays: "0" }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(Object.keys(result.errors).sort()).toEqual([
      "bookingWindowDays",
      "slotIntervalMinutes",
    ]);
  });
});

// DB制約は「0より大きい」しか言わないため、1分刻み・10年先といった極端な値も
// 通ってしまう。実害(客側の枠リストが実用にならない・月送りが際限なく続く)を
// 止めるため、アプリ側だけの上限・下限を置く。値そのものは店舗固有値ではなく
// 打ち間違いを止めるためのガードレールなので ADR-007 に反しない。
describe("validateBookingPolicyInput(極端な値のガードレール)", () => {
  it("下限・上限ちょうどは通る", () => {
    const result = validateBookingPolicyInput(
      policyInput({
        slotIntervalMinutes: String(
          BOOKING_POLICY_LIMITS.slotIntervalMinutes.min,
        ),
        bookingWindowDays: String(BOOKING_POLICY_LIMITS.bookingWindowDays.max),
        minLeadMinutes: String(BOOKING_POLICY_LIMITS.minLeadMinutes.min),
        cancelDeadlineMinutes: String(
          BOOKING_POLICY_LIMITS.cancelDeadlineMinutes.max,
        ),
      }),
    );
    expect(result.ok).toBe(true);
  });

  it("刻みが下限未満(1分など)は弾く", () => {
    const result = validateBookingPolicyInput(
      policyInput({ slotIntervalMinutes: "1" }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.slotIntervalMinutes).toBeDefined();
  });

  it("刻みが上限超えは弾く", () => {
    const result = validateBookingPolicyInput(
      policyInput({
        slotIntervalMinutes: String(
          BOOKING_POLICY_LIMITS.slotIntervalMinutes.max + 1,
        ),
      }),
    );
    expect(result.ok).toBe(false);
  });

  it("受付期間が上限超え(10年先など)は弾く", () => {
    const result = validateBookingPolicyInput(
      policyInput({ bookingWindowDays: "3650" }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.bookingWindowDays).toBeDefined();
  });

  it("キャンセル締切が上限超えは弾く", () => {
    const result = validateBookingPolicyInput(
      policyInput({
        cancelDeadlineMinutes: String(
          BOOKING_POLICY_LIMITS.cancelDeadlineMinutes.max + 1,
        ),
      }),
    );
    expect(result.ok).toBe(false);
  });

  // computeStaffDaySlots は「受付期間内」かつ「今から直前締切ぶん先」の枠しか
  // 出さないので、直前締切が受付期間を超えると枠が1つも出なくなる
  it("直前締切が受付期間(日数×1440分)以上だと、枠が出なくなるので弾く", () => {
    const result = validateBookingPolicyInput(
      policyInput({ bookingWindowDays: "1", minLeadMinutes: "1440" }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.minLeadMinutes).toBeDefined();
  });

  it("直前締切が受付期間より短ければ通る", () => {
    const result = validateBookingPolicyInput(
      policyInput({ bookingWindowDays: "1", minLeadMinutes: "1439" }),
    );
    expect(result.ok).toBe(true);
  });

  it("受付期間そのものが不正なときは、直前締切との突き合わせを行わない", () => {
    const result = validateBookingPolicyInput(
      policyInput({ bookingWindowDays: "0", minLeadMinutes: "1440" }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.minLeadMinutes).toBeUndefined();
  });
});

describe("formatMinutesDuration", () => {
  it("60分未満は分だけで表す", () => {
    expect(formatMinutesDuration(45)).toBe("45分");
  });

  it("0分は0分と表す", () => {
    expect(formatMinutesDuration(0)).toBe("0分");
  });

  it("ちょうど1時間は分を付けない", () => {
    expect(formatMinutesDuration(60)).toBe("1時間");
  });

  it("時間と分に分ける", () => {
    expect(formatMinutesDuration(90)).toBe("1時間30分");
  });

  it("ちょうど1日は時間・分を付けない", () => {
    expect(formatMinutesDuration(1440)).toBe("1日");
  });

  it("日・時間・分に分ける", () => {
    expect(formatMinutesDuration(1500)).toBe("1日1時間");
    expect(formatMinutesDuration(1505)).toBe("1日1時間5分");
  });
});

// 補足文はどれも「実際のコードがその値をどう使うか」を書いたもの。
// 値が数値として読めないあいだは補足そのものを出さない(null)。
describe("設定値の補足文", () => {
  it("刻みは開店時刻を基準にすることを述べる", () => {
    const text = describeSlotInterval("30");
    expect(text).not.toBeNull();
    expect(text).toContain("開店時刻");
    expect(text).toContain("30分");
  });

  it("受付期間は今日からの日数で述べる", () => {
    expect(describeBookingWindow("14")).toContain("14日後");
  });

  it("直前締切が0なら開始時刻ちょうどまで受け付けると述べる", () => {
    const text = describeMinLead("0");
    expect(text).not.toBeNull();
    expect(text).toContain("開始時刻ちょうど");
  });

  it("直前締切が正なら開始の何分前で締め切るかを述べる", () => {
    expect(describeMinLead("120")).toContain("2時間前");
  });

  it("キャンセル締切は店側のキャンセルに効かないことを述べる", () => {
    const text = describeCancelDeadline("60");
    expect(text).not.toBeNull();
    expect(text).toContain("1時間前");
    expect(text).toContain("店側");
  });

  it("キャンセル締切が0なら開始時刻ちょうどまで変更できると述べる", () => {
    expect(describeCancelDeadline("0")).toContain("開始時刻ちょうど");
  });

  it("数値として読めない入力では補足を出さない", () => {
    expect(describeSlotInterval("")).toBeNull();
    expect(describeBookingWindow("abc")).toBeNull();
    expect(describeMinLead("-1")).toBeNull();
    expect(describeCancelDeadline("1.5")).toBeNull();
  });
});
