import { describe, expect, it } from "vitest";

import {
  calendarWeekday,
  computeStaffDaySlots,
  isCalendarDate,
  isWithinBookingWindow,
  jstCalendarDate,
  jstDateTime,
  mergeStaffSlots,
  pickStaffForStart,
  type BookingPolicy,
  type Slot,
} from "./availability";

const policy: BookingPolicy = {
  slotIntervalMinutes: 30,
  bookingWindowDays: 30,
  minLeadMinutes: 60,
};

// 2026-07-18(土)を対象日、前日昼を「現在時刻」とする
const date = "2026-07-18";
const now = jstDateTime("2026-07-17", "12:00");

const openDay = { isOpen: true, openTime: "09:00", closeTime: "18:00" };
const fullWork = {
  startTime: "09:00",
  endTime: "18:00",
  breakStart: null,
  breakEnd: null,
};

const baseParams = {
  date,
  durationMinutes: 60,
  businessDay: openDay,
  isClosedDay: false,
  working: fullWork,
  busy: [],
  policy,
  now,
};

const starts = (slots: Slot[]) => slots.map((s) => s.start.toISOString());
const at = (time: string) => jstDateTime(date, time).toISOString();
const statusAt = (slots: Slot[], time: string) =>
  slots.find((s) => s.start.toISOString() === at(time))?.status;

describe("jstDateTime", () => {
  it("JSTの暦日と壁時計時刻をUTCのDateに変換する", () => {
    expect(jstDateTime("2026-07-18", "11:00").toISOString()).toBe(
      "2026-07-18T02:00:00.000Z",
    );
  });

  it("PostgreSQLのtime型が返す HH:MM:SS 形式も受け付ける", () => {
    expect(jstDateTime("2026-07-18", "09:30:00").toISOString()).toBe(
      "2026-07-18T00:30:00.000Z",
    );
  });
});

describe("jstCalendarDate", () => {
  it("UTCのDateをJSTの暦日に変換する(日付をまたぐケース)", () => {
    // UTC 7/17 20:00 = JST 7/18 05:00
    expect(jstCalendarDate(new Date("2026-07-17T20:00:00Z"))).toBe(
      "2026-07-18",
    );
  });
});

describe("calendarWeekday", () => {
  it("JSTの暦日の曜日を返す(0=日曜〜6=土曜。DBのweekday列と同じ)", () => {
    expect(calendarWeekday("2026-07-18")).toBe(6); // 土曜
    expect(calendarWeekday("2026-07-19")).toBe(0); // 日曜
  });
});

describe("isCalendarDate", () => {
  it("実在する YYYY-MM-DD の暦日を受理する", () => {
    expect(isCalendarDate("2026-07-18")).toBe(true);
  });

  it("形式違い・実在しない日付は拒否する", () => {
    expect(isCalendarDate("2026/07/18")).toBe(false);
    expect(isCalendarDate("2026-7-18")).toBe(false);
    expect(isCalendarDate("2026-02-30")).toBe(false);
    expect(isCalendarDate("")).toBe(false);
  });
});

describe("isWithinBookingWindow", () => {
  it("今日(JST)から booking_window_days 日後までが予約可能", () => {
    expect(isWithinBookingWindow("2026-07-17", policy, now)).toBe(true);
    expect(isWithinBookingWindow("2026-08-16", policy, now)).toBe(true); // ちょうど30日後
  });

  it("窓を超える日付・過去の日付は予約不可", () => {
    expect(isWithinBookingWindow("2026-08-17", policy, now)).toBe(false); // 31日後
    expect(isWithinBookingWindow("2026-07-16", policy, now)).toBe(false); // 昨日
  });
});

describe("computeStaffDaySlots: 基本の枠列挙", () => {
  it("営業9:00-18:00・勤務フル・予約なし・所要60分なら 9:00〜17:00 の30分刻みで全枠が空き", () => {
    const slots = computeStaffDaySlots(baseParams);
    expect(slots).toHaveLength(17);
    expect(starts(slots)[0]).toBe(at("09:00"));
    expect(starts(slots)[16]).toBe(at("17:00")); // 17:00開始→18:00終了は営業内
    expect(slots.every((s) => s.status === "available")).toBe(true);
  });

  it("閉店までに所要時間が収まらない開始時刻はリストに含めない", () => {
    const slots = computeStaffDaySlots({ ...baseParams, durationMinutes: 120 });
    expect(starts(slots)).not.toContain(at("16:30"));
    expect(starts(slots)[slots.length - 1]).toBe(at("16:00")); // 16:00→18:00
  });

  it("枠の刻みは営業開始時刻を基準に slot_interval_minutes ごと", () => {
    const slots = computeStaffDaySlots({
      ...baseParams,
      policy: { ...policy, slotIntervalMinutes: 60 },
    });
    expect(starts(slots)).toEqual(
      [
        "09:00",
        "10:00",
        "11:00",
        "12:00",
        "13:00",
        "14:00",
        "15:00",
        "16:00",
        "17:00",
      ].map(at),
    );
  });
});

describe("computeStaffDaySlots: 勤務パターンと休憩", () => {
  it("休憩(12:00-13:00)にかかる開始時刻はリストに含めない(構造的に不可)", () => {
    const slots = computeStaffDaySlots({
      ...baseParams,
      working: { ...fullWork, breakStart: "12:00", breakEnd: "13:00" },
    });
    // 11:30開始は60分が休憩に食い込む。12:00・12:30開始も不可。13:00開始は可
    expect(starts(slots)).not.toContain(at("11:30"));
    expect(starts(slots)).not.toContain(at("12:00"));
    expect(starts(slots)).not.toContain(at("12:30"));
    expect(statusAt(slots, "11:00")).toBe("available"); // 12:00終了は休憩に接するだけでOK
    expect(statusAt(slots, "13:00")).toBe("available");
  });

  it("勤務時間(10:00-18:00)が営業時間より狭ければ勤務内だけが候補になる", () => {
    const slots = computeStaffDaySlots({
      ...baseParams,
      working: { ...fullWork, startTime: "10:00" },
    });
    expect(starts(slots)[0]).toBe(at("10:00"));
  });

  it("その曜日に勤務パターンがなければ枠なし", () => {
    expect(computeStaffDaySlots({ ...baseParams, working: null })).toEqual([]);
  });
});

describe("computeStaffDaySlots: 既存予約・ブロックとの重なり", () => {
  const busy = [
    { start: jstDateTime(date, "11:00"), end: jstDateTime(date, "12:00") },
  ];

  it("既存予約と重なる開始時刻は「埋まり」としてリストに残る(取り消し線表示用)", () => {
    const slots = computeStaffDaySlots({ ...baseParams, busy });
    expect(statusAt(slots, "10:30")).toBe("taken"); // 10:30→11:30 が重なる
    expect(statusAt(slots, "11:00")).toBe("taken");
    expect(statusAt(slots, "11:30")).toBe("taken");
  });

  it("半開区間なので既存予約に接するだけの枠は空きのまま", () => {
    const slots = computeStaffDaySlots({ ...baseParams, busy });
    expect(statusAt(slots, "10:00")).toBe("available"); // 10:00→11:00 は接するだけ
    expect(statusAt(slots, "12:00")).toBe("available"); // 12:00開始も接するだけ
  });
});

describe("computeStaffDaySlots: 直前締切と受付期間", () => {
  it("現在時刻 + min_lead_minutes より前に始まる枠はリストに含めない", () => {
    const slots = computeStaffDaySlots({
      ...baseParams,
      now: jstDateTime(date, "09:10"), // 当日朝。締切は10:10
    });
    expect(starts(slots)).not.toContain(at("09:30"));
    expect(starts(slots)).not.toContain(at("10:00"));
    expect(starts(slots)[0]).toBe(at("10:30"));
  });

  it("受付期間(booking_window_days)を超える日付は枠なし", () => {
    expect(
      computeStaffDaySlots({
        ...baseParams,
        now: jstDateTime("2026-06-01", "12:00"),
      }),
    ).toEqual([]);
  });

  it("過去の日付は枠なし", () => {
    expect(
      computeStaffDaySlots({
        ...baseParams,
        now: jstDateTime("2026-07-19", "12:00"),
      }),
    ).toEqual([]);
  });
});

describe("computeStaffDaySlots: 休業日", () => {
  it("定休日(is_open=false)は枠なし", () => {
    const slots = computeStaffDaySlots({
      ...baseParams,
      businessDay: { isOpen: false, openTime: null, closeTime: null },
    });
    expect(slots).toEqual([]);
  });

  it("休業日判定(isClosedDay)がtrueなら枠なし(M4の祝日・指定日ルールの受け口)", () => {
    expect(computeStaffDaySlots({ ...baseParams, isClosedDay: true })).toEqual(
      [],
    );
  });
});

describe("mergeStaffSlots: 「どちらでも」の和集合", () => {
  const slot = (time: string, status: Slot["status"]): Slot => ({
    start: jstDateTime(date, time),
    status,
  });

  it("いずれかのスタッフが空いていれば空き、全員埋まりなら埋まり", () => {
    const merged = mergeStaffSlots([
      [slot("10:00", "taken"), slot("10:30", "taken")],
      [slot("10:00", "available"), slot("10:30", "taken")],
    ]);
    expect(statusAt(merged, "10:00")).toBe("available");
    expect(statusAt(merged, "10:30")).toBe("taken");
  });

  it("片方のスタッフにしかない候補も含め、開始時刻順に並ぶ", () => {
    const merged = mergeStaffSlots([
      [slot("14:00", "available")],
      [slot("10:00", "available"), slot("14:00", "available")],
    ]);
    expect(starts(merged)).toEqual([at("10:00"), at("14:00")]);
  });
});

describe("pickStaffForStart: 「どちらでも」の担当割当", () => {
  const slot = (time: string, status: Slot["status"]): Slot => ({
    start: jstDateTime(date, time),
    status,
  });

  it("その開始時刻が空いているスタッフのうち、先頭(=display_orderが小さい)を選ぶ", () => {
    const perStaff = [
      { staffId: "owner", slots: [slot("10:00", "available")] },
      { staffId: "staff-a", slots: [slot("10:00", "available")] },
    ];
    expect(pickStaffForStart(perStaff, jstDateTime(date, "10:00"))).toBe(
      "owner",
    );
  });

  it("先頭のスタッフが埋まっていれば次のスタッフを選ぶ", () => {
    const perStaff = [
      { staffId: "owner", slots: [slot("10:00", "taken")] },
      { staffId: "staff-a", slots: [slot("10:00", "available")] },
    ];
    expect(pickStaffForStart(perStaff, jstDateTime(date, "10:00"))).toBe(
      "staff-a",
    );
  });

  it("誰も空いていなければnull", () => {
    const perStaff = [
      { staffId: "owner", slots: [slot("10:00", "taken")] },
      { staffId: "staff-a", slots: [] },
    ];
    expect(pickStaffForStart(perStaff, jstDateTime(date, "10:00"))).toBeNull();
  });
});
