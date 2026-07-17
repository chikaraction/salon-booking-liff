import { describe, expect, it } from "vitest";

import {
  buildReservationCard,
  canModifyReservation,
  remainingDaysLabel,
} from "./my-reservations";

describe("remainingDaysLabel: 残り日数ラベル(JST暦日差)", () => {
  // JST 2026-07-18 11:00 開始の予約(UTCでは 02:00)
  const start = new Date("2026-07-18T02:00:00Z");

  it("同じJST暦日なら「本日」", () => {
    // JST 7/18 09:00
    expect(remainingDaysLabel(new Date("2026-07-18T00:00:00Z"), start)).toBe(
      "本日",
    );
  });

  it("暦日差1〜7日は「あと◯日」", () => {
    // JST 7/17 → 7/18 で差1日
    expect(remainingDaysLabel(new Date("2026-07-17T03:00:00Z"), start)).toBe(
      "あと1日",
    );
    // JST 7/15 → 7/18 で差3日(モックの「あと3日」)
    expect(remainingDaysLabel(new Date("2026-07-15T03:00:00Z"), start)).toBe(
      "あと3日",
    );
    // JST 7/11 → 7/18 で差7日(「あと◯日」の上限)
    expect(remainingDaysLabel(new Date("2026-07-11T03:00:00Z"), start)).toBe(
      "あと7日",
    );
  });

  it("暦日差8日以上は「◯月◯日」(ゼロ埋めなし)", () => {
    // JST 7/10 → 7/18 で差8日
    expect(remainingDaysLabel(new Date("2026-07-10T03:00:00Z"), start)).toBe(
      "7月18日",
    );
    // JST 7/17 → 8/2 で差16日(モックの「8月2日」。08月02日にしない)
    expect(
      remainingDaysLabel(
        new Date("2026-07-17T03:00:00Z"),
        new Date("2026-08-02T01:00:00Z"), // JST 8/2 10:00
      ),
    ).toBe("8月2日");
  });

  it("JST深夜0時をまたぐと暦日差が変わる(UTCでは前日15:00が境界)", () => {
    // now: UTC 7/17 14:59:59 = JST 7/17 23:59:59 → 差1日
    expect(remainingDaysLabel(new Date("2026-07-17T14:59:59Z"), start)).toBe(
      "あと1日",
    );
    // now: UTC 7/17 15:00:00 = JST 7/18 00:00:00 → 差0日で「本日」
    expect(remainingDaysLabel(new Date("2026-07-17T15:00:00Z"), start)).toBe(
      "本日",
    );
  });

  it("月をまたぐ暦日差も正しく数える(7日以内なら「あと◯日」)", () => {
    // JST 7/30 → 8/2 で差3日
    expect(
      remainingDaysLabel(
        new Date("2026-07-30T03:00:00Z"),
        new Date("2026-08-02T01:00:00Z"),
      ),
    ).toBe("あと3日");
  });

  it("過去の予約(暦日差が負)は防御的に「本日」を返す", () => {
    // now: JST 7/19、start: JST 7/18
    expect(remainingDaysLabel(new Date("2026-07-19T03:00:00Z"), start)).toBe(
      "本日",
    );
  });
});

describe("canModifyReservation: キャンセル・変更可否(締切判定)", () => {
  // JST 2026-07-18 11:00 開始、締切60分前 → 締切時刻は JST 10:00(UTC 01:00)
  const start = new Date("2026-07-18T02:00:00Z");
  const deadlineMinutes = 60;

  it("締切より前なら可", () => {
    expect(
      canModifyReservation(
        new Date("2026-07-18T00:00:00Z"),
        start,
        deadlineMinutes,
      ),
    ).toBe(true);
  });

  it("ちょうど締切時刻(開始60分前)は可(DBのRPCと同じ境界)", () => {
    expect(
      canModifyReservation(
        new Date("2026-07-18T01:00:00.000Z"),
        start,
        deadlineMinutes,
      ),
    ).toBe(true);
  });

  it("締切を1ミリ秒でも過ぎたら不可", () => {
    expect(
      canModifyReservation(
        new Date("2026-07-18T01:00:00.001Z"),
        start,
        deadlineMinutes,
      ),
    ).toBe(false);
  });

  it("締切0分なら開始時刻ちょうどまで可", () => {
    expect(canModifyReservation(start, start, 0)).toBe(true);
    expect(canModifyReservation(new Date(start.getTime() + 1), start, 0)).toBe(
      false,
    );
  });
});

describe("buildReservationCard: 予約カードの表示整形", () => {
  const input = {
    id: "res-1",
    start: new Date("2026-07-18T02:00:00Z"), // JST 7/18(土) 11:00
    staffName: "田中",
    menus: [
      { menuName: "カット", price: 4950, durationMinutes: 60 },
      { menuName: "カラー", price: 6600, durationMinutes: 90 },
    ],
  };

  it("日時・メニュー/スタッフ・金額/所要時間を表示用に整形する", () => {
    const card = buildReservationCard(input);
    expect(card.dateTimeLabel).toBe("7月18日(土)11:00〜");
    expect(card.menuStaffLabel).toBe("カット + カラー / 田中");
    expect(card.priceDurationLabel).toBe("¥11,550 ・ 約150分");
  });

  it("idとstartはそのまま保持する(可否判定・キャンセルRPCに使う)", () => {
    const card = buildReservationCard(input);
    expect(card.id).toBe("res-1");
    expect(card.start).toEqual(new Date("2026-07-18T02:00:00Z"));
  });

  it("メニュー1件でも整形できる", () => {
    const card = buildReservationCard({
      id: "res-2",
      start: new Date("2026-08-02T01:00:00Z"), // JST 8/2(日) 10:00
      staffName: "佐藤",
      menus: [{ menuName: "カット", price: 4950, durationMinutes: 60 }],
    });
    expect(card.dateTimeLabel).toBe("8月2日(日)10:00〜");
    expect(card.menuStaffLabel).toBe("カット / 佐藤");
    expect(card.priceDurationLabel).toBe("¥4,950 ・ 約60分");
  });
});
