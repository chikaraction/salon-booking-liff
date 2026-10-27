import { describe, expect, it } from "vitest";

import {
  addCalendarDays,
  calendarWeekday,
  isCalendarDate,
  isWallClockTime,
  jstCalendarDate,
  jstClockTime,
  jstDateTime,
  jstMinutesOfDay,
  jstParts,
  minutesLabel,
  timeToMinutes,
  WEEKDAY_LABELS,
} from "./jst";

describe("timeToMinutes", () => {
  it("HH:MM を0時からの分数にする", () => {
    expect(timeToMinutes("09:30")).toBe(570);
  });

  it("PostgreSQLのtime型が返す HH:MM:SS 形式も受け付ける", () => {
    expect(timeToMinutes("09:30:00")).toBe(570);
  });

  it("0:00 は 0 分", () => {
    expect(timeToMinutes("00:00")).toBe(0);
  });

  it("23:59 は 1439 分(1日の最後の分)", () => {
    expect(timeToMinutes("23:59")).toBe(1439);
  });

  it("秒は切り捨てる(59秒でも次の分に繰り上げない)", () => {
    expect(timeToMinutes("09:30:59")).toBe(570);
    expect(timeToMinutes("23:59:59")).toBe(1439);
  });
});

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

  it("不正な Date(Invalid Date)を渡すと例外を投げる", () => {
    expect(() => jstCalendarDate(new Date(Number.NaN))).toThrow(RangeError);
  });
});

describe("jstClockTime", () => {
  it("UTCのDateをJSTの壁時計時刻 HH:MM(ゼロ埋め)にする", () => {
    // UTC 02:00 = JST 11:00
    expect(jstClockTime(new Date("2026-07-18T02:00:00Z"))).toBe("11:00");
  });

  it('時・分ともゼロ埋めする(<input type="time"> にそのまま入る形)', () => {
    // UTC 00:30 = JST 09:30
    expect(jstClockTime(new Date("2026-07-18T00:30:00Z"))).toBe("09:30");
  });

  it("日付をまたぐ深夜も壁時計時刻を返す", () => {
    // UTC 7/17 20:05 = JST 7/18 05:05
    expect(jstClockTime(new Date("2026-07-17T20:05:00Z"))).toBe("05:05");
  });
});

describe("addCalendarDays", () => {
  it("同じ月の中で日を足す", () => {
    expect(addCalendarDays("2026-07-18", 3)).toBe("2026-07-21");
  });

  it("月末から翌月へ繰り上がる(31日の月・30日の月)", () => {
    expect(addCalendarDays("2026-07-31", 1)).toBe("2026-08-01");
    expect(addCalendarDays("2026-04-30", 1)).toBe("2026-05-01");
  });

  it("年末から翌年へ繰り上がる", () => {
    expect(addCalendarDays("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("うるう年の2月は29日まで、平年は28日の翌日が3月1日", () => {
    expect(addCalendarDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addCalendarDays("2027-02-28", 1)).toBe("2027-03-01");
  });

  it("負の日数なら前へ戻る(月初から前月末へ、年初から前年末へ)", () => {
    expect(addCalendarDays("2026-08-01", -1)).toBe("2026-07-31");
    expect(addCalendarDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addCalendarDays("2026-01-01", -1)).toBe("2025-12-31");
  });

  it("0日なら同じ暦日を返す", () => {
    expect(addCalendarDays("2026-07-18", 0)).toBe("2026-07-18");
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

describe("isWallClockTime", () => {
  it("HH:MM 形式(00:00〜23:59)を受け付ける", () => {
    expect(isWallClockTime("00:00")).toBe(true);
    expect(isWallClockTime("09:30")).toBe(true);
    expect(isWallClockTime("23:59")).toBe(true);
  });

  it("範囲外・桁数違い・秒付きは拒否する", () => {
    expect(isWallClockTime("24:00")).toBe(false);
    expect(isWallClockTime("9:00")).toBe(false);
    expect(isWallClockTime("11:60")).toBe(false);
    expect(isWallClockTime("11:00:00")).toBe(false);
    expect(isWallClockTime("")).toBe(false);
  });
});

describe("WEEKDAY_LABELS", () => {
  it("曜日の短いラベルを日曜始まりで並べる(添字0=日曜〜6=土曜。DBのweekday列と同じ)", () => {
    expect(WEEKDAY_LABELS).toEqual(["日", "月", "火", "水", "木", "金", "土"]);
  });

  it("calendarWeekday の結果でそのまま引ける", () => {
    expect(WEEKDAY_LABELS[calendarWeekday("2026-07-18")]).toBe("土");
    expect(WEEKDAY_LABELS[calendarWeekday("2026-07-19")]).toBe("日");
  });
});

describe("jstParts", () => {
  it("UTCの瞬間をJSTの年・月(1〜12)・日・曜日(0=日曜)・時・分に分解する", () => {
    // UTC 7/18 02:05 = JST 7/18(土) 11:05
    expect(jstParts(new Date("2026-07-18T02:05:00Z"))).toEqual({
      year: 2026,
      month: 7,
      day: 18,
      weekday: 6,
      hours: 11,
      minutes: 5,
    });
  });

  it("UTCの15:00はJSTの翌日0:00になる(日付・曜日が繰り上がる)", () => {
    // UTC 7/18(土) 15:00 = JST 7/19(日) 00:00
    expect(jstParts(new Date("2026-07-18T15:00:00Z"))).toEqual({
      year: 2026,
      month: 7,
      day: 19,
      weekday: 0,
      hours: 0,
      minutes: 0,
    });
  });

  it("UTCの14:59はJSTの同じ日の23:59のまま", () => {
    // UTC 7/18(土) 14:59 = JST 7/18(土) 23:59
    expect(jstParts(new Date("2026-07-18T14:59:00Z"))).toEqual({
      year: 2026,
      month: 7,
      day: 18,
      weekday: 6,
      hours: 23,
      minutes: 59,
    });
  });

  it("月末のUTC15:00はJSTの翌月1日になる", () => {
    // UTC 7/31(金) 15:00 = JST 8/1(土) 00:00
    expect(jstParts(new Date("2026-07-31T15:00:00Z"))).toEqual({
      year: 2026,
      month: 8,
      day: 1,
      weekday: 6,
      hours: 0,
      minutes: 0,
    });
  });

  it("2月末(平年)のUTC15:00はJSTの3月1日になる", () => {
    // UTC 2027-02-28(日) 15:00 = JST 2027-03-01(月) 00:00
    expect(jstParts(new Date("2027-02-28T15:00:00Z"))).toEqual({
      year: 2027,
      month: 3,
      day: 1,
      weekday: 1,
      hours: 0,
      minutes: 0,
    });
  });

  it("年末のUTC15:00はJSTの翌年1月1日になる", () => {
    // UTC 2026-12-31(木) 15:00 = JST 2027-01-01(金) 00:00
    expect(jstParts(new Date("2026-12-31T15:00:00Z"))).toEqual({
      year: 2027,
      month: 1,
      day: 1,
      weekday: 5,
      hours: 0,
      minutes: 0,
    });
  });

  it("年末のUTC14:59はJSTの12月31日23:59のまま", () => {
    // UTC 2026-12-31(木) 14:59 = JST 2026-12-31(木) 23:59
    expect(jstParts(new Date("2026-12-31T14:59:00Z"))).toEqual({
      year: 2026,
      month: 12,
      day: 31,
      weekday: 4,
      hours: 23,
      minutes: 59,
    });
  });

  it("秒・ミリ秒は切り捨てる(分までを返す)", () => {
    // UTC 02:05:59.999 = JST 11:05:59.999
    expect(jstParts(new Date("2026-07-18T02:05:59.999Z"))).toMatchObject({
      hours: 11,
      minutes: 5,
    });
  });
});

describe("minutesLabel", () => {
  it("0時からの分数を「13:00」形式にする", () => {
    expect(minutesLabel(13 * 60)).toBe("13:00");
    expect(minutesLabel(18 * 60 + 30)).toBe("18:30");
  });

  it("時は先頭0なし・分は2桁にする", () => {
    expect(minutesLabel(9 * 60 + 5)).toBe("9:05");
    expect(minutesLabel(0)).toBe("0:00");
  });

  it("24時以降の分数は24時を超える時のまま表す(日をまたいで繰り返さない)", () => {
    expect(minutesLabel(25 * 60 + 15)).toBe("25:15");
  });
});

describe("jstMinutesOfDay", () => {
  it("UTCのDateを対象日(JST)の0時からの分数に変換する", () => {
    // JST 2026-07-18 13:30 = UTC 04:30
    expect(
      jstMinutesOfDay("2026-07-18", new Date("2026-07-18T04:30:00Z")),
    ).toBe(13 * 60 + 30);
  });

  it("対象日の0時ちょうどは0になる", () => {
    expect(
      jstMinutesOfDay("2026-07-18", jstDateTime("2026-07-18", "00:00")),
    ).toBe(0);
  });

  it("翌日にかかる時刻は24時間ぶん(1440分)を超えた分数になる", () => {
    expect(
      jstMinutesOfDay("2026-07-18", jstDateTime("2026-07-19", "01:00")),
    ).toBe(25 * 60);
  });

  it("対象日より前の時刻は負の分数になる", () => {
    expect(
      jstMinutesOfDay("2026-07-18", jstDateTime("2026-07-17", "23:30")),
    ).toBe(-30);
  });

  it("秒以下は最も近い分に丸める", () => {
    const at = jstDateTime("2026-07-18", "10:00");
    expect(
      jstMinutesOfDay("2026-07-18", new Date(at.getTime() + 29 * 1000)),
    ).toBe(600);
    expect(
      jstMinutesOfDay("2026-07-18", new Date(at.getTime() + 31 * 1000)),
    ).toBe(601);
  });
});
