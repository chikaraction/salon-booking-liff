import { describe, expect, it } from "vitest";

import { jstDateTime, type BookingPolicy } from "./availability";
import { makeIsClosedDay } from "./closures";
import {
  addMonths,
  buildCalendarWeeks,
  calendarDateLabel,
  canMoveToMonth,
  formatJstTime,
  isSelectableDate,
  jstYearMonth,
  yearMonthLabel,
} from "./calendar";

const policy: BookingPolicy = {
  slotIntervalMinutes: 30,
  bookingWindowDays: 30,
  minLeadMinutes: 60,
};

// 現在時刻: 2026-07-16(木)10:00 JST
const now = jstDateTime("2026-07-16", "10:00");

describe("jstYearMonth: JSTの年月", () => {
  it("UTCのDateをJSTの年月に変換する", () => {
    expect(jstYearMonth(now)).toBe("2026-07");
  });

  it("JSTでは翌月になるUTC時刻は翌月を返す", () => {
    // UTC 2026-07-31 15:30 = JST 2026-08-01 00:30
    expect(jstYearMonth(new Date("2026-07-31T15:30:00Z"))).toBe("2026-08");
  });
});

describe("addMonths: 年月の加算", () => {
  it("同じ年内で加算できる", () => {
    expect(addMonths("2026-07", 1)).toBe("2026-08");
  });

  it("年をまたいで加算できる", () => {
    expect(addMonths("2026-12", 1)).toBe("2027-01");
  });

  it("年をまたいで減算できる", () => {
    expect(addMonths("2026-01", -1)).toBe("2025-12");
  });
});

describe("yearMonthLabel: 年月の表示ラベル", () => {
  it("「2026年7月」形式にする(月の先頭0は付けない)", () => {
    expect(yearMonthLabel("2026-07")).toBe("2026年7月");
    expect(yearMonthLabel("2026-12")).toBe("2026年12月");
  });
});

describe("buildCalendarWeeks: 月カレンダーの週配列", () => {
  it("2026年7月は水曜始まりの5週で、月外はnull埋めになる", () => {
    const weeks = buildCalendarWeeks("2026-07");
    expect(weeks).toHaveLength(5);
    // 1日は水曜なので日〜火はnull
    expect(weeks[0].slice(0, 3)).toEqual([null, null, null]);
    expect(weeks[0][3]).toEqual({ date: "2026-07-01", day: 1 });
    // 7月18日は土曜(週の末尾)
    expect(weeks[2][6]).toEqual({ date: "2026-07-18", day: 18 });
    // 31日(金)の後はnull埋め
    expect(weeks[4][5]).toEqual({ date: "2026-07-31", day: 31 });
    expect(weeks[4][6]).toBeNull();
  });

  it("日曜始まりで全日数が収まる月はnullを含まない", () => {
    // 2026年2月は日曜始まりの28日でちょうど4週
    const weeks = buildCalendarWeeks("2026-02");
    expect(weeks).toHaveLength(4);
    expect(weeks.flat().every((cell) => cell !== null)).toBe(true);
  });

  it("どの月もすべての週が7マスになる", () => {
    for (const ym of ["2026-02", "2026-07", "2026-08", "2028-02"]) {
      for (const week of buildCalendarWeeks(ym)) {
        expect(week).toHaveLength(7);
      }
    }
  });
});

describe("isSelectableDate: カレンダーの日付選択可否", () => {
  // 月曜定休(weekday 0=日曜〜6=土曜)。休業日判定は closures.ts の
  // makeIsClosedDay を渡す想定なので、テストでも同じ形の関数を渡す
  const mondayClosed = makeIsClosedDay({
    businessHours: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
      weekday,
      isOpen: weekday !== 1,
    })),
    nthWeekdayClosures: [],
    closeOnHolidays: false,
    overrides: [],
  });

  const selectable = (date: string, isClosedDay = mondayClosed) =>
    isSelectableDate({ date, isClosedDay, policy, now });

  it("受付期間内の営業日は選択できる(今日を含む)", () => {
    expect(selectable("2026-07-16")).toBe(true); // 今日(木)
    expect(selectable("2026-08-15")).toBe(true); // 30日後(土)
  });

  it("定休の曜日は選択できない", () => {
    expect(selectable("2026-07-20")).toBe(false); // 月曜
  });

  it("過去の日付は選択できない", () => {
    expect(selectable("2026-07-15")).toBe(false);
  });

  it("受付期間(booking_window_days)を超える日付は選択できない", () => {
    expect(selectable("2026-08-16")).toBe(false); // 31日後
  });

  it("営業時間の行がない曜日は休業として選択できない", () => {
    const onlyMonday = makeIsClosedDay({
      businessHours: [{ weekday: 1, isOpen: true }],
      nthWeekdayClosures: [],
      closeOnHolidays: false,
      overrides: [],
    });
    expect(selectable("2026-07-16", onlyMonday)).toBe(false);
  });

  it("第◯曜日・祝日・臨時休業も同じ受け口で選択不可になる", () => {
    const closed = makeIsClosedDay({
      businessHours: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
        weekday,
        isOpen: true,
      })),
      nthWeekdayClosures: [{ weekday: 0, nth: 3 }],
      closeOnHolidays: true,
      overrides: [
        {
          startDate: "2026-07-29",
          endDate: "2026-07-29",
          isOpen: false,
          label: "臨時休業",
        },
      ],
    });
    expect(selectable("2026-07-19", closed)).toBe(false); // 第3日曜
    expect(selectable("2026-07-20", closed)).toBe(false); // 海の日
    expect(selectable("2026-07-29", closed)).toBe(false); // 臨時休業
    expect(selectable("2026-07-18", closed)).toBe(true); // 通常の営業日
  });
});

describe("canMoveToMonth: カレンダーの月移動可否", () => {
  it("当月には移動できる", () => {
    expect(canMoveToMonth("2026-07", policy, now)).toBe(true);
  });

  it("過去の月には移動できない", () => {
    expect(canMoveToMonth("2026-06", policy, now)).toBe(false);
  });

  it("受付期間がかかる翌月には移動できる", () => {
    // 受付期間は2026-08-15まで
    expect(canMoveToMonth("2026-08", policy, now)).toBe(true);
  });

  it("受付期間を過ぎた月には移動できない", () => {
    expect(canMoveToMonth("2026-09", policy, now)).toBe(false);
  });
});

describe("formatJstTime: 開始時刻ボタンの表示", () => {
  it("JSTの壁時計時刻を「10:00」形式にする", () => {
    expect(formatJstTime(jstDateTime("2026-07-18", "10:00"))).toBe("10:00");
  });

  it("時は先頭0を付けず、分は2桁にする", () => {
    expect(formatJstTime(jstDateTime("2026-07-18", "09:05"))).toBe("9:05");
  });
});

describe("calendarDateLabel: 日付見出しの表示", () => {
  it("「7月18日(土)」形式にする", () => {
    expect(calendarDateLabel("2026-07-18")).toBe("7月18日(土)");
  });

  it("曜日は実際の暦から求める", () => {
    expect(calendarDateLabel("2026-07-20")).toBe("7月20日(月)");
  });
});
